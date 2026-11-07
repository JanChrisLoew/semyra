#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod drafts;
mod fs_ops;
mod ipc;
mod markdown;
mod single_instance;
mod state;
mod window_prefs;

use crate::fs_ops::{clean_windows_path, normalize_existing_path};
use crate::ipc::handle_protocol_request;
use crate::single_instance::{
    cleanup_instance_lock, start_primary_instance_listener, try_forward_to_running_instance,
};
use crate::state::{AppState, UserEvent};
use crate::window_prefs::{load_window_prefs, save_window_prefs, WindowPrefs};
use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;
use tao::dpi::{LogicalSize, PhysicalPosition};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
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
    let mut rgba = vec![0u8; (size * size * 4) as usize];
    let s = size as f32;

    for y in 0..size {
        for x in 0..size {
            let dx = x as f32;
            let dy = y as f32;
            let margin = s * 0.06;
            let radius = s * 0.22;
            let half = (s * 0.5) - margin;
            let cx = dx - s * 0.5;
            let cy = dy - s * 0.5;
            let qx = cx.abs() - (half - radius);
            let qy = cy.abs() - (half - radius);
            let dist = (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt()
                + qx.min(qy.max(0.0)).min(0.0)
                - radius;
            let alpha = (0.5 - dist).clamp(0.0, 1.0);
            if alpha <= 0.0 {
                continue;
            }

            let t = ((dx + dy) / (2.0 * s)).clamp(0.0, 1.0);
            let mut r = 37.0 * (1.0 - t) + 99.0 * t;
            let mut g = 99.0 * (1.0 - t) + 102.0 * t;
            let mut b = 235.0 * (1.0 - t) + 241.0 * t;

            let nx = dx / s;
            let ny = dy / s;
            let mut fg = false;
            if (0.28..=0.72).contains(&ny) {
                if (0.20..=0.28).contains(&nx) || (0.50..=0.58).contains(&nx) {
                    fg = true;
                }
                let diag_y = (ny - 0.28) / 0.30;
                if (0.0..=1.0).contains(&diag_y) {
                    let tl = 0.24 + diag_y * 0.15;
                    let tr = 0.54 - diag_y * 0.15;
                    if (nx - tl).abs() < 0.045 || (nx - tr).abs() < 0.045 {
                        fg = true;
                    }
                }
            }
            if (0.30..=0.62).contains(&ny) && (0.70..=0.78).contains(&nx) {
                fg = true;
            }
            if (0.54..=0.72).contains(&ny) && (nx - 0.74).abs() <= (0.72 - ny) * 0.85 {
                fg = true;
            }

            if fg {
                r = 255.0;
                g = 255.0;
                b = 255.0;
            }

            let idx = ((y * size + x) * 4) as usize;
            rgba[idx] = r.round() as u8;
            rgba[idx + 1] = g.round() as u8;
            rgba[idx + 2] = b.round() as u8;
            rgba[idx + 3] = (alpha * 255.0).round() as u8;
        }
    }

    Icon::from_rgba(rgba, size, size).ok()
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
    drop_tx: std::sync::mpsc::Sender<(String, String)>,
) -> wry::Result<WebView> {
    let protocol_state = app_state.clone();
    let drop_state = app_state;
    let drop_wakeup = proxy.clone();
    let nav_proxy = proxy.clone();
    let new_win_proxy = proxy;

    let builder = WebViewBuilder::new_with_web_context(web_context)
        .with_transparent(true)
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
                    let count = paths.len();
                    let _ = drop_tx.send((
                        "drag-enter".to_string(),
                        serde_json::json!({ "count": count }).to_string(),
                    ));
                    let _ = drop_wakeup.send_event(UserEvent::FsChanged { paths: Vec::new() });
                }
                DragDropEvent::Leave => {
                    let _ = drop_tx.send(("drag-leave".to_string(), "{}".to_string()));
                    let _ = drop_wakeup.send_event(UserEvent::FsChanged { paths: Vec::new() });
                }
                DragDropEvent::Drop { paths, .. } => {
                    let mut files = Vec::new();
                    let mut folder: Option<String> = None;
                    for p in paths {
                        let cleaned = clean_windows_path(&p);
                        if cleaned.is_dir() && folder.is_none() {
                            drop_state.set_workspace_folder(&cleaned);
                            folder = Some(cleaned.to_string_lossy().into_owned());
                        } else if cleaned.is_file() {
                            drop_state.allow_file_parent(&cleaned);
                            files.push(cleaned.to_string_lossy().into_owned());
                        }
                    }
                    let payload = serde_json::json!({
                        "files": files,
                        "folder": folder
                    })
                    .to_string();
                    let _ = drop_tx.send(("files-dropped".to_string(), payload));
                    let _ = drop_wakeup.send_event(UserEvent::FsChanged { paths: Vec::new() });
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

fn persist_current_window_state(window: &Window, app_state: &AppState) {
    let scale = window.scale_factor();
    let size = window.inner_size().to_logical::<f64>(scale);
    let pos = window.outer_position().ok();
    let last_folder = app_state
        .inner
        .lock()
        .ok()
        .and_then(|g| g.workspace_folder.as_ref().map(|p| p.to_string_lossy().into_owned()));

    let prefs = WindowPrefs {
        width: size.width.max(760.0),
        height: size.height.max(480.0),
        x: pos.map(|p| p.x),
        y: pos.map(|p| p.y),
        maximized: window.is_maximized(),
        last_workspace_folder: last_folder,
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

    let is_primary = !cli.force_new_window;
    if is_primary {
        start_primary_instance_listener(proxy.clone());
    }

    let app_state = AppState::new(cli.initial_files, initial_folder, proxy.clone());

    let mut win_builder = WindowBuilder::new()
        .with_title("MarkLive")
        .with_inner_size(LogicalSize::new(prefs.width, prefs.height))
        .with_min_inner_size(LogicalSize::new(760.0, 480.0))
        .with_maximized(prefs.maximized)
        .with_window_icon(generate_window_rgba_icon(32))
        .with_transparent(true);

    if let (Some(x), Some(y)) = (prefs.x, prefs.y) {
        if x > -16_000 && y > -16_000 {
            win_builder = win_builder.with_position(PhysicalPosition::new(x, y));
        }
    }

    let window = win_builder
        .build(&event_loop)
        .expect("Windows-Fenster konnte nicht erstellt werden");

    #[cfg(target_os = "windows")]
    {
        if window_vibrancy::apply_mica(&window, None).is_err() {
            let _ = window_vibrancy::apply_acrylic(&window, Some((18, 18, 24, 210)));
        }
    }

    let base_data_dir = dirs::data_local_dir()
        .unwrap_or_else(env::temp_dir)
        .join("MarkLive");

    let profile_subdir = if cfg!(debug_assertions) {
        "WebView2-dev"
    } else {
        "WebView2"
    };
    let mut primary_context = WebContext::new(Some(base_data_dir.join(profile_subdir)));
    let mut fallback_context: Option<WebContext> = None;

    let (drop_tx, drop_rx) = std::sync::mpsc::channel::<(String, String)>();

    // Resilient WebView2 initialization: falls back to an isolated per-process profile if locked
    let webview = match build_webview_with_context(
        &mut primary_context,
        &window,
        app_state.clone(),
        proxy.clone(),
        drop_tx.clone(),
    ) {
        Ok(wv) => wv,
        Err(_) => {
            let pid_dir = base_data_dir.join(format!("WebView2-instance-{}", std::process::id()));
            let ctx = fallback_context.insert(WebContext::new(Some(pid_dir)));
            build_webview_with_context(&mut *ctx, &window, app_state.clone(), proxy, drop_tx)
                .expect("Windows 11 WebView2 konnte nicht initialisiert werden")
        }
    };

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        while let Ok((evt_name, payload_json)) = drop_rx.try_recv() {
            dispatch_frontend_event(&webview, &evt_name, &payload_json);
        }

        match event {
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
                    persist_current_window_state(&window, &app_state);
                    if is_primary {
                        cleanup_instance_lock();
                    }
                    *control_flow = ControlFlow::Exit;
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
                UserEvent::ForceCloseWindow => {
                    crate::drafts::clear_recovery_snapshot();
                    persist_current_window_state(&window, &app_state);
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
                        "folder": folder
                    })
                    .to_string();
                    dispatch_frontend_event(&webview, "files-dropped", &payload);
                }
            },

            _ => {}
        }
    });
}
