#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod drafts;
mod fs_ops;
mod icon_gen;
mod ipc;
mod markdown;
mod single_instance;
mod state;
mod window_prefs;

use crate::fs_ops::{clean_windows_path, is_image_path, normalize_existing_path};
use crate::icon_gen::render_marklive_rgba;
use crate::ipc::handle_protocol_request;
use crate::single_instance::{
    cleanup_instance_lock, start_primary_instance_listener, try_forward_to_running_instance,
};
use crate::state::{AppState, UserEvent};
use crate::window_prefs::{load_window_prefs, save_window_prefs, WindowPrefs};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tao::dpi::{LogicalSize, PhysicalPosition};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop, EventLoopBuilder, EventLoopProxy};
use tao::window::{Icon, Window, WindowBuilder};
use wry::{DragDropEvent, NewWindowResponse, WebContext, WebView, WebViewBuilder};

#[cfg(target_os = "windows")]
use wry::{ScrollBarStyle, WebViewBuilderExtWindows};

struct CliArgs {
    initial_files: Vec<PathBuf>,
    initial_folder: Option<PathBuf>,
    force_new_window: bool,
}

fn parse_cli_targets() -> CliArgs {
    let mut initial_files = Vec::new();
    let mut initial_folder = None;
    let mut force_new_window = false;

    for arg in env::args_os().skip(1) {
        let s = arg.to_string_lossy();
        if s == "--new-window" || s == "-n" {
            force_new_window = true;
            continue;
        }
        if s.starts_with('-') {
            continue;
        }
        let candidate = PathBuf::from(&arg);
        if candidate.is_dir() {
            if initial_folder.is_none() {
                initial_folder = Some(normalize_existing_path(&candidate));
            }
        } else if candidate.is_file() {
            let norm = normalize_existing_path(&candidate);
            if initial_folder.is_none() {
                initial_folder = norm.parent().map(|p| p.to_path_buf());
            }
            initial_files.push(norm);
        }
    }

    CliArgs {
        initial_files,
        initial_folder,
        force_new_window,
    }
}

fn generate_window_rgba_icon(size: u32) -> Option<Icon> {
    let rgba = render_marklive_rgba(size);
    Icon::from_rgba(rgba, size, size).ok()
}

/// Validates that saved physical window coordinates overlap at least one connected monitor
/// so undocking an external display never spawns an invisible off-screen window.
fn is_position_visible_on_monitors(
    event_loop: &EventLoop<UserEvent>,
    x: i32,
    y: i32,
    width_px: i32,
    height_px: i32,
) -> bool {
    let min_visible_w = 120;
    let min_visible_h = 80;

    let mut checked_any = false;
    for monitor in event_loop.available_monitors() {
        checked_any = true;
        let m_pos = monitor.position();
        let m_size = monitor.size();
        let m_left = m_pos.x;
        let m_top = m_pos.y;
        let m_right = m_left + m_size.width as i32;
        let m_bottom = m_top + m_size.height as i32;

        let overlap_x = (x + width_px).min(m_right) - x.max(m_left);
        let overlap_y = (y + height_px).min(m_bottom) - y.max(m_top);
        if overlap_x >= min_visible_w && overlap_y >= min_visible_h {
            return true;
        }
    }

    // If monitor enumeration returned empty, allow sane positive coordinates
    !checked_any && x > -8_000 && y > -8_000
}

/// Removes orphaned `WebView2-instance-<pid>` directories left behind by closed secondary windows.
fn cleanup_stale_webview_profiles(base_data_dir: &Path) {
    let current_pid_dir = format!("WebView2-instance-{}", std::process::id());
    let Ok(entries) = fs::read_dir(base_data_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else {
            continue;
        };
        if name_str.starts_with("WebView2-instance-") && name_str != current_pid_dir {
            // If another process actively holds a WebView2 lock inside this folder, remove_dir_all
            // safely fails on the locked file while cleaning unlocked stale directories.
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

fn dispatch_frontend_event(webview: &WebView, event_name: &str, payload_json: &str) {
    let js = format!(
        "if (window.__markliveReceive) {{ window.__markliveReceive({:?}, {}); }}",
        event_name, payload_json
    );
    let _ = webview.evaluate_script(&js);
}

fn build_webview_with_context<'a>(
    web_context: &'a mut WebContext,
    window: &'a Window,
    app_state: AppState,
    proxy: EventLoopProxy<UserEvent>,
) -> wry::Result<WebView> {
    let protocol_state = app_state.clone();
    let drop_state = app_state;
    let drop_proxy = proxy.clone();
    let nav_proxy = proxy.clone();
    let new_win_proxy = proxy;

    let builder = WebViewBuilder::new_with_web_context(web_context)
        .with_transparent(false)
        .with_clipboard(true)
        .with_devtools(cfg!(debug_assertions))
        .with_asynchronous_custom_protocol("marklive".into(), move |_webview_id, req, responder| {
            handle_protocol_request(protocol_state.clone(), req, responder);
        })
        .with_navigation_handler(move |uri| {
            let allowed = uri.starts_with("https://marklive.localhost")
                || uri.starts_with("http://marklive.localhost")
                || uri.starts_with("marklive://");
            if !allowed
                && (uri.starts_with("https://")
                    || uri.starts_with("http://")
                    || uri.starts_with("mailto:"))
            {
                let _ = nav_proxy.send_event(UserEvent::OpenExternalUrl(uri));
            }
            allowed
        })
        .with_new_window_req_handler(move |uri, _features| {
            if uri.starts_with("https://")
                || uri.starts_with("http://")
                || uri.starts_with("mailto:")
            {
                let _ = new_win_proxy.send_event(UserEvent::OpenExternalUrl(uri));
            }
            NewWindowResponse::Deny
        })
        .with_drag_drop_handler(move |event| {
            match event {
                DragDropEvent::Enter { paths, .. } => {
                    let _ = drop_proxy.send_event(UserEvent::FrontendEvent {
                        name: "drag-enter".to_string(),
                        payload_json: serde_json::json!({ "count": paths.len() }).to_string(),
                    });
                }
                DragDropEvent::Leave => {
                    let _ = drop_proxy.send_event(UserEvent::FrontendEvent {
                        name: "drag-leave".to_string(),
                        payload_json: "{}".to_string(),
                    });
                }
                DragDropEvent::Drop { paths, .. } => {
                    let mut files = Vec::new();
                    let mut images = Vec::new();
                    let mut folder: Option<String> = None;
                    for p in paths {
                        let cleaned = clean_windows_path(&p);
                        if cleaned.is_dir() && folder.is_none() {
                            drop_state.set_workspace_folder(&cleaned);
                            folder = Some(cleaned.to_string_lossy().into_owned());
                        } else if cleaned.is_file() {
                            drop_state.allow_file_parent(&cleaned);
                            if is_image_path(&cleaned) {
                                images.push(cleaned.to_string_lossy().into_owned());
                            } else {
                                files.push(cleaned.to_string_lossy().into_owned());
                            }
                        }
                    }
                    let payload_json = serde_json::json!({
                        "files": files,
                        "images": images,
                        "folder": folder
                    })
                    .to_string();
                    let _ = drop_proxy.send_event(UserEvent::FrontendEvent {
                        name: "files-dropped".to_string(),
                        payload_json,
                    });
                }
                _ => {}
            }
            true
        })
        .with_url("marklive://localhost/");

    #[cfg(target_os = "windows")]
    let builder = builder
        .with_https_scheme(true)
        .with_browser_accelerator_keys(false)
        .with_scroll_bar_style(ScrollBarStyle::FluentOverlay);

    builder.build(window)
}

fn persist_current_window_state(
    window: &Window,
    app_state: &AppState,
    normal_size: (f64, f64),
    normal_pos: Option<(i32, i32)>,
) {
    let (last_folder, ui_prefs) = app_state
        .inner
        .lock()
        .ok()
        .map(|g| {
            (
                g.workspace_folder
                    .as_ref()
                    .map(|p| p.to_string_lossy().into_owned()),
                g.ui_prefs.clone(),
            )
        })
        .unwrap_or_default();

    let prefs = WindowPrefs {
        width: normal_size.0.max(760.0),
        height: normal_size.1.max(480.0),
        x: normal_pos.map(|p| p.0),
        y: normal_pos.map(|p| p.1),
        maximized: window.is_maximized(),
        last_workspace_folder: last_folder,
        ui: ui_prefs,
    };
    save_window_prefs(&prefs);
}

fn main() {
    let cli = parse_cli_targets();

    // Forward CLI targets to an already running primary instance unless --new-window is set
    if !cli.force_new_window
        && try_forward_to_running_instance(&cli.initial_files, &cli.initial_folder)
    {
        return;
    }

    let prefs = load_window_prefs();
    let initial_folder = cli.initial_folder.or_else(|| {
        prefs
            .last_workspace_folder
            .as_ref()
            .map(PathBuf::from)
            .filter(|p| p.is_dir())
    });

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    let base_data_dir = dirs::data_local_dir()
        .unwrap_or_else(env::temp_dir)
        .join("MarkLive");

    let is_primary = !cli.force_new_window;
    if is_primary {
        cleanup_stale_webview_profiles(&base_data_dir);
        start_primary_instance_listener(proxy.clone());
    }

    let app_state = AppState::new(
        cli.initial_files,
        initial_folder,
        prefs.ui.clone(),
        proxy.clone(),
    );

    let mut win_builder = WindowBuilder::new()
        .with_title("MarkLive")
        .with_inner_size(LogicalSize::new(prefs.width, prefs.height))
        .with_min_inner_size(LogicalSize::new(760.0, 480.0))
        .with_maximized(prefs.maximized)
        .with_window_icon(generate_window_rgba_icon(32))
        .with_transparent(false);

    if let (Some(x), Some(y)) = (prefs.x, prefs.y) {
        if is_position_visible_on_monitors(
            &event_loop,
            x,
            y,
            prefs.width.round() as i32,
            prefs.height.round() as i32,
        ) {
            win_builder = win_builder.with_position(PhysicalPosition::new(x, y));
        }
    }

    let window = win_builder
        .build(&event_loop)
        .expect("Windows-Fenster konnte nicht erstellt werden");

    #[cfg(target_os = "windows")]
    {
        let _ = window_vibrancy::apply_mica(&window, None);
    }

    let profile_subdir = if cfg!(debug_assertions) {
        "WebView2-dev"
    } else {
        "WebView2"
    };
    let mut primary_context = WebContext::new(Some(base_data_dir.join(profile_subdir)));
    let mut fallback_context: Option<WebContext> = None;
    let mut fallback_pid_dir: Option<PathBuf> = None;

    // Resilient WebView2 initialization: falls back to an isolated per-process profile if locked
    let webview = match build_webview_with_context(
        &mut primary_context,
        &window,
        app_state.clone(),
        proxy.clone(),
    ) {
        Ok(wv) => wv,
        Err(_) => {
            let pid_dir = base_data_dir.join(format!("WebView2-instance-{}", std::process::id()));
            fallback_pid_dir = Some(pid_dir.clone());
            let ctx = fallback_context.insert(WebContext::new(Some(pid_dir)));
            build_webview_with_context(&mut *ctx, &window, app_state.clone(), proxy)
                .expect("Windows 11 WebView2 konnte nicht initialisiert werden")
        }
    };

    // Track last non-maximized, non-minimized bounds so restore geometry stays accurate
    let mut last_normal_size = (prefs.width.max(760.0), prefs.height.max(480.0));
    let mut last_normal_pos = prefs.x.zip(prefs.y);

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::WindowEvent {
                event: WindowEvent::Resized(physical_size),
                ..
            } => {
                if !window.is_maximized()
                    && !window.is_minimized()
                    && physical_size.width > 0
                    && physical_size.height > 0
                {
                    let logical = physical_size.to_logical::<f64>(window.scale_factor());
                    last_normal_size = (logical.width, logical.height);
                }
            }

            Event::WindowEvent {
                event: WindowEvent::Moved(pos),
                ..
            } => {
                if !window.is_maximized() && !window.is_minimized() && pos.x > -16_000 && pos.y > -16_000 {
                    last_normal_pos = Some((pos.x, pos.y));
                }
            }

            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                let has_unsaved = app_state
                    .inner
                    .lock()
                    .map(|g| g.has_unsaved_changes)
                    .unwrap_or(false);

                if has_unsaved {
                    dispatch_frontend_event(&webview, "close-requested", "{}");
                } else {
                    crate::drafts::clear_recovery_snapshot();
                    persist_current_window_state(
                        &window,
                        &app_state,
                        last_normal_size,
                        last_normal_pos,
                    );
                    if is_primary {
                        cleanup_instance_lock();
                    }
                    *control_flow = ControlFlow::Exit;
                }
            }

            Event::LoopDestroyed => {
                if let Some(ref pid_dir) = fallback_pid_dir {
                    let _ = fs::remove_dir_all(pid_dir);
                }
            }

            Event::UserEvent(user_evt) => match user_evt {
                UserEvent::SetWindowTitle(title) => {
                    window.set_title(&title);
                }
                UserEvent::SetWindowTheme(theme) => {
                    window.set_theme(theme);
                    #[cfg(target_os = "windows")]
                    {
                        let dark_opt = match theme {
                            Some(tao::window::Theme::Dark) => Some(true),
                            Some(tao::window::Theme::Light) => Some(false),
                            _ => None,
                        };
                        let _ = window_vibrancy::apply_mica(&window, dark_opt);
                    }
                }
                UserEvent::SetFullscreen(fs) => {
                    let target = if fs {
                        Some(tao::window::Fullscreen::Borderless(None))
                    } else {
                        None
                    };
                    window.set_fullscreen(target);
                }
                UserEvent::ForceCloseWindow => {
                    crate::drafts::clear_recovery_snapshot();
                    persist_current_window_state(
                        &window,
                        &app_state,
                        last_normal_size,
                        last_normal_pos,
                    );
                    if is_primary {
                        cleanup_instance_lock();
                    }
                    *control_flow = ControlFlow::Exit;
                }
                UserEvent::FsChanged { paths } => {
                    if !paths.is_empty() {
                        let payload = serde_json::json!({ "paths": paths }).to_string();
                        dispatch_frontend_event(&webview, "fs-changed", &payload);
                    }
                }
                UserEvent::FrontendEvent { name, payload_json } => {
                    dispatch_frontend_event(&webview, &name, &payload_json);
                }
                UserEvent::OpenExternalUrl(url) => {
                    #[cfg(target_os = "windows")]
                    {
                        let _ = Command::new("rundll32.exe")
                            .args(["url.dll,FileProtocolHandler", &url])
                            .spawn();
                    }
                }
                UserEvent::ActivateAndOpen { files, folder } => {
                    if window.is_minimized() {
                        window.set_minimized(false);
                    }
                    window.set_focus();
                    if let Some(ref dir) = folder {
                        app_state.set_workspace_folder(Path::new(dir));
                    }
                    for f in &files {
                        app_state.allow_file_parent(Path::new(f));
                    }
                    let payload = serde_json::json!({
                        "files": files,
                        "images": Vec::<String>::new(),
                        "folder": folder
                    })
                    .to_string();
                    dispatch_frontend_event(&webview, "files-dropped", &payload);
                }
                UserEvent::ExportPdf {
                    target_path,
                    done_tx,
                } => {
                    #[cfg(target_os = "windows")]
                    {
                        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_7;
                        use webview2_com::PrintToPdfCompletedHandler;
                        use windows_core::{Interface, HSTRING};
                        use wry::WebViewExtWindows;

                        match webview.webview().cast::<ICoreWebView2_7>() {
                            Ok(wv7) => {
                                let path_hstr = HSTRING::from(target_path.as_os_str());
                                let tx_cb = done_tx.clone();
                                let handler = PrintToPdfCompletedHandler::create(Box::new(
                                    move |hr, ok| {
                                        if hr.is_ok() && ok {
                                            let _ = tx_cb.send(Ok(()));
                                        } else {
                                            let _ = tx_cb.send(Err(
                                                "PDF-Erstellung durch WebView2 fehlgeschlagen."
                                                    .to_string(),
                                            ));
                                        }
                                        Ok(())
                                    },
                                ));
                                let res = unsafe { wv7.PrintToPdf(&path_hstr, None, &handler) };
                                if let Err(e) = res {
                                    let _ = done_tx.send(Err(format!(
                                        "PDF-Export konnte nicht gestartet werden: {e}"
                                    )));
                                }
                            }
                            Err(e) => {
                                let _ = done_tx.send(Err(format!(
                                    "WebView2 unterstützt direkten PDF-Export nicht: {e}"
                                )));
                            }
                        }
                    }
                    #[cfg(not(target_os = "windows"))]
                    {
                        let _ = target_path;
                        let _ = done_tx.send(Err("PDF-Export wird nur unter Windows unterstützt.".to_string()));
                    }
                }
            },

            _ => {}
        }
    });
}
