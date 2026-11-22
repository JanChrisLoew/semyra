#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod drafts;
mod fs_ops;
mod icon_gen;
mod ipc;
mod markdown;
mod navigation;
mod single_instance;
mod state;
mod window_prefs;

use crate::fs_ops::{clean_windows_path, is_image_path, normalize_existing_path};
use crate::icon_gen::render_semyra_rgba;
use crate::ipc::{handle_protocol_request, is_dialog_active, spawn_background};
use crate::navigation::{classify_url, NavigationTarget};
use crate::single_instance::{
    cleanup_instance_lock, negotiate_single_instance, start_primary_instance_listener, StartupRole,
};
use crate::state::{AppState, UserEvent};
use crate::window_prefs::{load_window_prefs, update_window_prefs};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
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
    let rgba = render_semyra_rgba(size);
    Icon::from_rgba(rgba, size, size).ok()
}

#[cfg(target_os = "windows")]
mod win32_startup {
    use std::ffi::c_void;

    const MB_OK: u32 = 0x0000_0000;
    const MB_ICONERROR: u32 = 0x0000_0010;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const STILL_ACTIVE: u32 = 259;

    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(
            hwnd: *mut c_void,
            lp_text: *const u16,
            lp_caption: *const u16,
            u_type: u32,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn OpenProcess(
            dw_desired_access: u32,
            b_inherit_handle: i32,
            dw_process_id: u32,
        ) -> *mut c_void;
        fn GetExitCodeProcess(h_process: *mut c_void, lp_exit_code: *mut u32) -> i32;
        fn CloseHandle(h_object: *mut c_void) -> i32;
    }

    pub(crate) fn show_error_box(title: &str, message: &str) {
        let title_w: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();
        let msg_w: Vec<u16> = message.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                msg_w.as_ptr(),
                title_w.as_ptr(),
                MB_OK | MB_ICONERROR,
            );
        }
    }

    pub(crate) fn is_process_alive(pid: u32) -> bool {
        if pid == 0 {
            return false;
        }
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return false;
            }
            let mut exit_code: u32 = 0;
            let ok = GetExitCodeProcess(handle, &mut exit_code);
            CloseHandle(handle);
            ok != 0 && exit_code == STILL_ACTIVE
        }
    }
}

pub(crate) fn show_fatal_error_and_exit(title: &str, message: &str) -> ! {
    eprintln!("{title}: {message}");
    #[cfg(target_os = "windows")]
    win32_startup::show_error_box(title, message);
    std::process::exit(1);
}

fn should_force_close_on_retry(
    frontend_ready: bool,
    requested_at: Option<Instant>,
    now: Instant,
    acknowledged: bool,
    dialog_active: bool,
) -> bool {
    if !frontend_ready {
        return true;
    }
    !acknowledged
        && !dialog_active
        && requested_at.is_some_and(|ts| now.saturating_duration_since(ts) >= Duration::from_secs(2))
}

fn try_lock_exclusive(lock_path: &Path) -> Option<fs::File> {
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(lock_path)
        .ok()?;
    file.try_lock().ok().map(|()| file)
}

struct FallbackProfileLock {
    profile_dir: PathBuf,
    lock_path: PathBuf,
    lock: Option<fs::File>,
}

impl FallbackProfileLock {
    fn acquire(base_data_dir: &Path, dir_name: &str) -> Option<Self> {
        let _ = fs::create_dir_all(base_data_dir);
        let profile_dir = base_data_dir.join(dir_name);
        let lock_path = base_data_dir.join(format!("{dir_name}.lock"));
        let lock = try_lock_exclusive(&lock_path)?;
        Some(Self {
            profile_dir,
            lock_path,
            lock: Some(lock),
        })
    }
}

impl Drop for FallbackProfileLock {
    fn drop(&mut self) {
        drop(self.lock.take());
        if !self.profile_dir.exists() {
            let _ = fs::remove_file(&self.lock_path);
        }
    }
}

/// Validates that saved physical window coordinates overlap at least one connected monitor
/// so undocking an external display never spawns an invisible off-screen window.
fn is_position_visible_on_monitors(
    event_loop: &EventLoop<UserEvent>,
    x: i32,
    y: i32,
    logical_width: f64,
    logical_height: f64,
) -> bool {
    let min_visible_w = 120;
    let min_visible_h = 80;

    let mut checked_any = false;
    for monitor in event_loop.available_monitors() {
        checked_any = true;
        let m_pos = monitor.position();
        let m_size = monitor.size();
        let scale = monitor.scale_factor();
        let width_px = (logical_width * scale).round() as i32;
        let height_px = (logical_height * scale).round() as i32;
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
    let current_pid_lock = format!("{current_pid_dir}.lock");
    let Ok(entries) = fs::read_dir(base_data_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else {
            continue;
        };
        if !name_str.starts_with("WebView2-instance-") {
            continue;
        }
        if name_str == current_pid_dir || name_str == current_pid_lock {
            continue;
        }
        if let Some(dir_name) = name_str.strip_suffix(".lock") {
            let dir_path = base_data_dir.join(dir_name);
            if !dir_path.exists() {
                if let Some(lock) = try_lock_exclusive(&entry.path()) {
                    drop(lock);
                    let _ = fs::remove_file(entry.path());
                }
            }
            continue;
        }
        if !entry.path().is_dir() {
            continue;
        }
        #[cfg(target_os = "windows")]
        if let Some(pid_str) = name_str.strip_prefix("WebView2-instance-") {
            if let Ok(pid) = pid_str.parse::<u32>() {
                if win32_startup::is_process_alive(pid) {
                    continue;
                }
            }
        }
        let lock_path = base_data_dir.join(format!("{name_str}.lock"));
        let Some(lock) = try_lock_exclusive(&lock_path) else {
            continue;
        };
        if fs::remove_dir_all(entry.path()).is_ok() {
            drop(lock);
            let _ = fs::remove_file(&lock_path);
        }
    }
}

fn dispatch_frontend_event(
    webview: &WebView,
    event_name: &str,
    payload_json: &str,
) -> wry::Result<()> {
    let js = format!(
        "if (window.__semyraReceive) {{ window.__semyraReceive({:?}, {}); }}",
        event_name, payload_json
    );
    webview.evaluate_script(&js)
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
        .with_asynchronous_custom_protocol("semyra".into(), move |_webview_id, req, responder| {
            handle_protocol_request(protocol_state.clone(), req, responder);
        })
        .with_navigation_handler(move |uri| {
            match classify_url(&uri) {
                NavigationTarget::Internal => true,
                NavigationTarget::External => {
                    if let Ok(parsed) = url::Url::parse(&uri) {
                        let _ = nav_proxy.send_event(UserEvent::OpenExternalUrl(
                            parsed.as_str().to_owned(),
                        ));
                    }
                    false
                }
                NavigationTarget::Blocked => false,
            }
        })
        .with_new_window_req_handler(move |uri, _features| {
            if classify_url(&uri) == NavigationTarget::External {
                if let Ok(parsed) = url::Url::parse(&uri) {
                    let _ = new_win_proxy.send_event(UserEvent::OpenExternalUrl(
                        parsed.as_str().to_owned(),
                    ));
                }
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
                    let state = drop_state.clone();
                    let proxy = drop_proxy.clone();
                    spawn_background(move || {
                        let mut files = Vec::new();
                        let mut images = Vec::new();
                        let mut folder: Option<String> = None;
                        for p in paths {
                            let cleaned = clean_windows_path(&p);
                            if cleaned.is_dir() && folder.is_none() {
                                state.set_workspace_folder(&cleaned);
                                folder = Some(cleaned.to_string_lossy().into_owned());
                            } else if cleaned.is_file() {
                                state.allow_file_parent(&cleaned);
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
                        let _ = proxy.send_event(UserEvent::FrontendEvent {
                            name: "files-dropped".to_string(),
                            payload_json,
                        });
                    });
                }
                _ => {}
            }
            true
        })
        .with_url("semyra://localhost/");

    #[cfg(target_os = "windows")]
    let builder = builder
        .with_https_scheme(true)
        .with_browser_accelerator_keys(false)
        .with_scroll_bar_style(ScrollBarStyle::FluentOverlay);

    builder.build(window)
}

fn main() {
    let cli = parse_cli_targets();

    // Forward CLI targets to an already running primary instance unless --new-window is set
    let role = negotiate_single_instance(&cli.initial_files, &cli.initial_folder, cli.force_new_window);
    if role == StartupRole::Forwarded {
        return;
    }

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    let base_data_dir = crate::fs_ops::app_data_dir();
    let is_primary = role == StartupRole::Primary;
    if is_primary {
        // Publish instance.json immediately after acquiring PRIMARY_MUTEX so fast second
        // launches don't time out during preference/profile startup I/O.
        start_primary_instance_listener(proxy.clone());
        cleanup_stale_webview_profiles(&base_data_dir);
    }

    let prefs = load_window_prefs();
    let initial_folder = cli.initial_folder.or_else(|| {
        prefs
            .last_workspace_folder
            .as_ref()
            .map(PathBuf::from)
            .filter(|p| p.is_dir())
    });

    let app_state = AppState::new(
        cli.initial_files,
        initial_folder,
        prefs.ui.clone(),
        proxy.clone(),
    );

    let mut win_builder = WindowBuilder::new()
        .with_title("Semyra")
        .with_inner_size(LogicalSize::new(prefs.width, prefs.height))
        .with_min_inner_size(LogicalSize::new(760.0, 480.0))
        .with_maximized(prefs.maximized)
        .with_window_icon(generate_window_rgba_icon(32))
        .with_transparent(false);

    if let (Some(x), Some(y)) = (prefs.x, prefs.y) {
        if is_position_visible_on_monitors(&event_loop, x, y, prefs.width, prefs.height) {
            win_builder = win_builder.with_position(PhysicalPosition::new(x, y));
        }
    }

    let window = match win_builder.build(&event_loop) {
        Ok(win) => win,
        Err(err) => show_fatal_error_and_exit(
            "Semyra – Startfehler",
            &format!("Windows-Fenster konnte nicht erstellt werden: {err}"),
        ),
    };

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
    let mut fallback_lock: Option<FallbackProfileLock> = None;

    // Resilient WebView2 initialization: falls back to an isolated per-process profile if locked
    let webview = match build_webview_with_context(
        &mut primary_context,
        &window,
        app_state.clone(),
        proxy.clone(),
    ) {
        Ok(wv) => wv,
        Err(_) => {
            let pid_dir_name = format!("WebView2-instance-{}", std::process::id());
            fallback_lock = FallbackProfileLock::acquire(&base_data_dir, &pid_dir_name);
            let pid_dir = base_data_dir.join(&pid_dir_name);
            fallback_pid_dir = Some(pid_dir.clone());
            let ctx = fallback_context.insert(WebContext::new(Some(pid_dir)));
            match build_webview_with_context(&mut *ctx, &window, app_state.clone(), proxy) {
                Ok(wv) => wv,
                Err(err) => show_fatal_error_and_exit(
                    "Semyra – WebView2-Fehler",
                    &format!(
                        "Windows 11 WebView2 konnte nicht initialisiert werden. \
                         Bitte prüfen Sie, ob die Microsoft Edge WebView2-Laufzeit installiert ist.\n\nDetails: {err}"
                    ),
                ),
            }
        }
    };

    // Track last non-maximized, non-minimized bounds so restore geometry stays accurate
    let mut last_normal_size = (prefs.width.max(760.0), prefs.height.max(480.0));
    let mut last_normal_pos = prefs.x.zip(prefs.y);
    let mut close_requested_at: Option<Instant> = None;
    let close_ack = Arc::new(AtomicBool::new(false));

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
                if should_force_close_on_retry(
                    app_state.is_frontend_ready(),
                    close_requested_at,
                    Instant::now(),
                    close_ack.load(Ordering::SeqCst),
                    is_dialog_active(),
                ) {
                    let _ = app_state.proxy.send_event(UserEvent::ForceCloseWindow);
                } else {
                    close_ack.store(false, Ordering::SeqCst);
                    close_requested_at = Some(Instant::now());
                    let ack_cb = Arc::clone(&close_ack);
                    let close_js = "if (typeof window.__semyraReceive === 'function') { window.__semyraReceive(\"close-requested\", {}); } else { fetch('/api/window/force-close', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recoveryRestored: false }) }); }";
                    if webview
                        .evaluate_script_with_callback(close_js, move |_| {
                            ack_cb.store(true, Ordering::SeqCst);
                        })
                        .is_err()
                    {
                        let _ = app_state.proxy.send_event(UserEvent::ForceCloseWindow);
                    }
                }
            }

            Event::LoopDestroyed => {
                if let Some(ref pid_dir) = fallback_pid_dir {
                    let _ = fs::remove_dir_all(pid_dir);
                }
                drop(fallback_lock.take());
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
                    let (width, height) = last_normal_size;
                    let position = last_normal_pos;
                    let maximized = window.is_maximized();
                    let proxy = app_state.proxy.clone();
                    std::thread::spawn(move || {
                        if let Err(err) = update_window_prefs(|prefs| {
                            prefs.width = width.max(760.0);
                            prefs.height = height.max(480.0);
                            prefs.x = position.map(|p| p.0);
                            prefs.y = position.map(|p| p.1);
                            prefs.maximized = maximized;
                            Ok(true)
                        }) {
                            eprintln!("Fensterzustand konnte nicht gespeichert werden: {err}");
                        }
                        let _ = proxy.send_event(UserEvent::FinishCloseWindow);
                    });
                }
                UserEvent::FinishCloseWindow => {
                    if is_primary {
                        cleanup_instance_lock();
                    }
                    *control_flow = ControlFlow::Exit;
                }
                UserEvent::FsChanged { paths } => {
                    if !paths.is_empty() {
                        let payload = serde_json::json!({ "paths": paths }).to_string();
                        let _ = dispatch_frontend_event(&webview, "fs-changed", &payload);
                    }
                }
                UserEvent::FrontendEvent { name, payload_json } => {
                    let _ = dispatch_frontend_event(&webview, &name, &payload_json);
                }
                UserEvent::OpenExternalUrl(url) => {
                    #[cfg(target_os = "windows")]
                    {
                        if let Ok(parsed) = url::Url::parse(&url) {
                            if let Err(err) = Command::new("rundll32.exe")
                                .args(["url.dll,FileProtocolHandler", parsed.as_str()])
                                .spawn()
                            {
                                eprintln!("Externe URL konnte nicht geöffnet werden: {err}");
                            }
                        }
                    }
                }
                UserEvent::ActivateAndOpen { files, folder } => {
                    if window.is_minimized() {
                        window.set_minimized(false);
                    }
                    window.set_focus();
                    let state = app_state.clone();
                    let proxy = app_state.proxy.clone();
                    spawn_background(move || {
                        if let Some(ref dir) = folder {
                            state.set_workspace_folder(Path::new(dir));
                        }
                        for f in &files {
                            state.allow_file_parent(Path::new(f));
                        }
                        let payload_json = serde_json::json!({
                            "files": files,
                            "images": Vec::<String>::new(),
                            "folder": folder
                        })
                        .to_string();
                        let _ = proxy.send_event(UserEvent::FrontendEvent {
                            name: "files-dropped".to_string(),
                            payload_json,
                        });
                    });
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
                                        match hr {
                                            Ok(()) if ok => {
                                                let _ = tx_cb.try_send(Ok(()));
                                            }
                                            Ok(()) => {
                                                let _ = tx_cb.try_send(Err(
                                                    "PDF-Erstellung durch WebView2 fehlgeschlagen."
                                                        .to_string(),
                                                ));
                                            }
                                            Err(err) => {
                                                let _ = tx_cb.try_send(Err(format!(
                                                    "PDF-Erstellung durch WebView2 fehlgeschlagen (HRESULT 0x{:08X}: {err}).",
                                                    err.code().0 as u32
                                                )));
                                            }
                                        }
                                        Ok(())
                                    },
                                ));
                                let res = unsafe { wv7.PrintToPdf(&path_hstr, None, &handler) };
                                if let Err(e) = res {
                                    let _ = done_tx.try_send(Err(format!(
                                        "PDF-Export konnte nicht gestartet werden: {e}"
                                    )));
                                }
                            }
                            Err(e) => {
                                let _ = done_tx.try_send(Err(format!(
                                    "WebView2 unterstützt direkten PDF-Export nicht: {e}"
                                )));
                            }
                        }
                    }
                    #[cfg(not(target_os = "windows"))]
                    {
                        let _ = target_path;
                        let _ = done_tx.try_send(Err("PDF-Export wird nur unter Windows unterstützt.".to_string()));
                    }
                }
            },

            _ => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleanup_stale_webview_profiles_keeps_locked_and_removes_stale() {
        let base = std::env::temp_dir().join(format!("semyra-wv2-cleanup-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();

        let locked_name = "WebView2-instance-9999991";
        let locked_dir = base.join(locked_name);
        fs::create_dir_all(&locked_dir).unwrap();
        fs::write(locked_dir.join("state.dat"), b"keep").unwrap();
        let active_guard = FallbackProfileLock::acquire(&base, locked_name).unwrap();

        let stale_name = "WebView2-instance-9999992";
        let stale_dir = base.join(stale_name);
        fs::create_dir_all(&stale_dir).unwrap();
        fs::write(stale_dir.join("cache.dat"), b"stale").unwrap();
        fs::write(base.join(format!("{stale_name}.lock")), b"").unwrap();

        let orphan_lock = base.join("WebView2-instance-9999993.lock");
        fs::write(&orphan_lock, b"").unwrap();

        cleanup_stale_webview_profiles(&base);

        assert!(locked_dir.join("state.dat").is_file(), "locked active profile must remain intact");
        assert!(!stale_dir.exists(), "unlocked stale profile should be removed");
        assert!(!base.join(format!("{stale_name}.lock")).exists());
        assert!(!orphan_lock.exists(), "orphan lock without directory should be removed");

        drop(active_guard);
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn should_force_close_on_retry_respects_ack_and_dialogs() {
        let t0 = Instant::now();
        let t_fast = t0 + Duration::from_millis(500);
        let t_late = t0 + Duration::from_secs(3);

        assert!(should_force_close_on_retry(false, None, t0, false, false));
        assert!(!should_force_close_on_retry(true, None, t0, false, false));
        assert!(!should_force_close_on_retry(true, Some(t0), t_fast, false, false));
        assert!(!should_force_close_on_retry(true, Some(t0), t_late, true, false));
        assert!(!should_force_close_on_retry(true, Some(t0), t_late, false, true));
        assert!(should_force_close_on_retry(true, Some(t0), t_late, false, false));
    }
}
