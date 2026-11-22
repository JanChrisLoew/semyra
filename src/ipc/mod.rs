mod assets;
mod dialogs;
mod pool;
mod render;

pub(crate) use pool::{is_dialog_active, spawn_background};

use assets::handle_local_asset;
use dialogs::{
    handle_export_html_dialog, handle_export_pdf, handle_open_files_dialog,
    handle_open_folder_dialog, handle_pick_pdf_target_dialog, handle_save_file_dialog,
};
use pool::{draft_worker_pool, ipc_worker_pool, search_worker_pool, ResponderGuard};
use render::handle_render;

use crate::drafts::DraftEntry;
use crate::fs_ops::encoding::write_text_file_if_unchanged;
use crate::fs_ops::{
    app_data_dir, build_directory_tree, clean_windows_path, create_ai_skill, create_new_folder,
    create_new_markdown_file, ensure_ai_library_tree, import_dropped_image,
    list_workspace_markdown_files, move_to_recycle_bin, normalize_existing_path, read_text_file,
    rename_fs_entry, replace_in_workspace_with_options, reveal_in_explorer, save_clipboard_image,
    search_workspace_with_metadata,
};
use crate::state::{AppState, UserEvent};
use crate::window_prefs::UiSessionPrefs;
use http::{Response, StatusCode};
use percent_encoding::percent_decode_str;
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::path::{Path, PathBuf};
use wry::RequestAsyncResponder;

#[derive(RustEmbed)]
#[folder = "frontend/dist"]
struct FrontendAssets;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathReq {
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListTreeReq {
    path: String,
    activate_workspace: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteReq {
    path: String,
    content: String,
    line_ending: Option<String>,
    expected_content: String,
    expected_line_ending: Option<String>,
    #[serde(default)]
    prefer_windows1252: bool,
    #[serde(default)]
    convert_windows1252: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateFileReq {
    parent_dir: String,
    file_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateFolderReq {
    parent_dir: String,
    folder_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSkillReq {
    parent_dir: String,
    skill_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenamePathReq {
    path: String,
    new_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavePastedImageReq {
    base_dir: Option<String>,
    mime_type: String,
    data_base64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportDroppedImageReq {
    base_dir: Option<String>,
    source_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchWorkspaceReq {
    root: String,
    query: String,
    #[serde(default)]
    case_sensitive: bool,
    #[serde(default)]
    use_regex: bool,
    #[serde(default)]
    whole_word: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReplaceWorkspaceReq {
    root: String,
    query: String,
    replacement: String,
    #[serde(default)]
    case_sensitive: bool,
    #[serde(default)]
    use_regex: bool,
    #[serde(default)]
    whole_word: bool,
    #[serde(default)]
    include_files: Option<Vec<crate::fs_ops::search::ReplaceTarget>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveDraftsReq {
    revision: u64,
    entries: Vec<DraftEntry>,
    recovery_restored: bool,
}

#[derive(Deserialize)]
struct SavePrefsReq {
    revision: u64,
    prefs: UiSessionPrefs,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloseWindowReq {
    recovery_restored: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowStateReq {
    title: Option<String>,
    theme: Option<String>,
    fullscreen: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExternalUrlReq {
    url: String,
}

#[derive(Serialize)]
struct ApiError {
    error: String,
}

pub(super) fn json_response<T: Serialize>(
    status: StatusCode,
    value: &T,
) -> Response<Cow<'static, [u8]>> {
    let body = serde_json::to_vec(value).unwrap_or_else(|_| b"{}".to_vec());
    Response::builder()
        .status(status)
        .header("Content-Type", "application/json; charset=utf-8")
        .header("Cache-Control", "no-store")
        .header("Access-Control-Allow-Origin", "*")
        .body(Cow::Owned(body))
        .unwrap()
}

pub(super) fn ok_json<T: Serialize>(value: &T) -> Response<Cow<'static, [u8]>> {
    json_response(StatusCode::OK, value)
}

pub(super) fn err_json(status: StatusCode, msg: impl Into<String>) -> Response<Cow<'static, [u8]>> {
    json_response(status, &ApiError { error: msg.into() })
}

pub(super) fn query_param(query: Option<&str>, key: &str) -> Option<String> {
    let q = query?;
    for pair in q.split('&') {
        let mut parts = pair.splitn(2, '=');
        let k = parts.next()?;
        let v = parts.next().unwrap_or("");
        if k == key {
            return Some(percent_decode_str(v).decode_utf8_lossy().into_owned());
        }
    }
    None
}

pub fn handle_protocol_request(
    state: AppState,
    request: http::Request<Vec<u8>>,
    responder: RequestAsyncResponder,
) {
    let responder = ResponderGuard::new(responder);
    let path = request.uri().path().to_string();
    let query = request.uri().query().map(|s| s.to_string());
    let body = request.into_body();

    // Local Markdown asset streaming (images referenced by relative path in Markdown)
    if path == "/api/local-asset" {
        handle_local_asset(query.as_deref(), state, responder);
        return;
    }

    if let Some(api_route) = path.strip_prefix("/api/") {
        handle_api_route(api_route, body, state, responder);
        return;
    }

    // Static frontend asset serving from RustEmbed
    let rel_path = path.trim_start_matches('/');
    if rel_path == "favicon.ico" {
        let resp = Response::builder()
            .status(StatusCode::NO_CONTENT)
            .body(Cow::Borrowed(&[][..]))
            .unwrap();
        responder.respond(resp);
        return;
    }

    let asset_key = if rel_path.is_empty() {
        "index.html"
    } else {
        rel_path
    };

    if let Some(asset) = FrontendAssets::get(asset_key) {
        let mime = mime_guess::from_path(asset_key)
            .first_or_octet_stream()
            .to_string();
        let resp = Response::builder()
            .status(StatusCode::OK)
            .header("Content-Type", mime)
            .body(asset.data)
            .unwrap();
        responder.respond(resp);
    } else {
        responder.respond(err_json(StatusCode::NOT_FOUND, "Asset nicht gefunden"));
    }
}

fn handle_api_route(route: &str, body: Vec<u8>, state: AppState, responder: ResponderGuard) {
    match route {
        "startup" => {
            state.mark_frontend_ready();
            ipc_worker_pool().execute(move || {
                let payload = state
                    .inner
                    .lock()
                    .map(|g| {
                        let mut s = g.startup.clone();
                        s.ui_prefs = g.ui_prefs.clone();
                        s
                    })
                    .unwrap_or(crate::state::StartupPayload {
                        initial_files: Vec::new(),
                        initial_folder: None,
                        recovered_drafts: Vec::new(),
                        ui_prefs: UiSessionPrefs::default(),
                    });
                responder.respond(ok_json(&payload));
            });
        }

        "prefs/save" => {
            let Ok(req) = serde_json::from_slice::<SavePrefsReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige Einstellungen"));
                return;
            };
            ipc_worker_pool().execute(move || {
                {
                    let Ok(mut guard) = state.inner.lock() else {
                        responder.respond(err_json(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Einstellungen sind nicht verfügbar.",
                        ));
                        return;
                    };
                    if req.revision > guard.ui_prefs_revision {
                        guard.ui_prefs_revision = req.revision;
                        guard.ui_prefs = req.prefs;
                    }
                }
                let result = crate::window_prefs::update_window_prefs(|disk| {
                    let guard = state
                        .inner
                        .lock()
                        .map_err(|_| std::io::Error::other("Einstellungen sind nicht verfügbar."))?;
                    if req.revision != guard.ui_prefs_revision {
                        return Ok(false);
                    }
                    disk.ui = guard.ui_prefs.clone();
                    if let Some(folder) = &guard.workspace_folder {
                        disk.last_workspace_folder = Some(folder.to_string_lossy().into_owned());
                    }
                    Ok(true)
                });
                match result {
                    Ok(()) => responder.respond(ok_json(&serde_json::json!({ "ok": true }))),
                    Err(err) => responder.respond(err_json(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Einstellungen konnten nicht gespeichert werden: {err}"),
                    )),
                }
            });
        }

        "drafts/save" => {
            let Ok(req) = serde_json::from_slice::<SaveDraftsReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige Entwurfsdaten"));
                return;
            };
            draft_worker_pool().execute(move || {
                let result = state
                    .drafts
                    .lock()
                    .map_err(|e| e.to_string())
                    .and_then(|mut store| {
                        store
                            .as_mut()
                            .ok_or_else(|| "Entwurfswiederherstellung ist nicht verfügbar.".to_string())?
                            .save(req.revision, req.entries, req.recovery_restored)
                    });
                match result {
                    Ok(()) => responder.respond(ok_json(&serde_json::json!({ "ok": true }))),
                    Err(err) => responder.respond(err_json(StatusCode::INTERNAL_SERVER_ERROR, err)),
                }
            });
        }

        "render" => handle_render(&body, responder),

        "read-file" => {
            let Ok(req) = serde_json::from_slice::<PathReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültiger Dateipfad"));
                return;
            };
            ipc_worker_pool().execute(move || {
                let p = PathBuf::from(&req.path);
                match read_text_file(&p) {
                    Ok(file_data) => {
                        state.allow_file_parent(&p);
                        responder.respond(ok_json(&file_data));
                    }
                    Err(err) => responder.respond(err_json(StatusCode::BAD_REQUEST, err)),
                }
            });
        }

        "write-file" => {
            let Ok(req) = serde_json::from_slice::<WriteReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige Speicher-Anfrage"));
                return;
            };
            ipc_worker_pool().execute(move || {
                let p = PathBuf::from(&req.path);
                let prefer_crlf = req
                    .line_ending
                    .as_deref()
                    .map(|le| le.eq_ignore_ascii_case("CRLF"))
                    .unwrap_or(true);
                match write_text_file_if_unchanged(
                    &p,
                    &req.content,
                    prefer_crlf,
                    &req.expected_content,
                    req.expected_line_ending.as_deref(),
                    req.prefer_windows1252,
                    req.convert_windows1252,
                ) {
                    Ok(Some((saved_path, encoding))) => {
                        let saved_p = Path::new(&saved_path);
                        state.allow_file_parent(saved_p);
                        responder.respond(ok_json(
                            &serde_json::json!({ "saved": true, "encoding": encoding }),
                        ));
                    }
                    Err(err) if err == crate::fs_ops::encoding::ENCODING_CONVERSION_REQUIRED => {
                        responder.respond(ok_json(
                            &serde_json::json!({ "saved": false, "conversionRequired": true }),
                        ));
                    }
                    Ok(None) => responder.respond(ok_json(&serde_json::json!({ "saved": false }))),
                    Err(err) => responder.respond(err_json(StatusCode::INTERNAL_SERVER_ERROR, err)),
                }
            });
        }

        "list-tree" => {
            let Ok(req) = serde_json::from_slice::<ListTreeReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültiger Ordnerpfad"));
                return;
            };
            let activate = req.activate_workspace.unwrap_or(true);
            let revision = if activate {
                state.begin_workspace_change()
            } else {
                None
            };
            ipc_worker_pool().execute(move || {
                let folder = PathBuf::from(&req.path);
                match build_directory_tree(&folder, 5) {
                    Ok(tree) => {
                        if activate {
                            let ai_lib_root =
                                normalize_existing_path(&app_data_dir().join("ai-library"));
                            let root = Path::new(&tree.path);
                            if root == ai_lib_root {
                                state.allow_and_watch_root(root);
                            } else if !revision
                                .is_some_and(|rev| state.finish_workspace_change(rev, root))
                            {
                                responder.respond(err_json(
                                    StatusCode::CONFLICT,
                                    "Die Auswahl des Arbeitsordners ist veraltet.",
                                ));
                                return;
                            }
                        }
                        responder.respond(ok_json(&tree));
                    }
                    Err(err) => responder.respond(err_json(StatusCode::BAD_REQUEST, err)),
                }
            });
        }

        "ai-library/init" => {
            ipc_worker_pool().execute(move || match ensure_ai_library_tree() {
                Ok((root, tree)) => {
                    state.allow_and_watch_root(&root);
                    responder.respond(ok_json(&serde_json::json!({
                        "root": clean_windows_path(&root).to_string_lossy(),
                        "tree": tree
                    })));
                }
                Err(err) => responder.respond(err_json(StatusCode::INTERNAL_SERVER_ERROR, err)),
            });
        }

        "ai-library/create-skill" => {
            let Ok(req) = serde_json::from_slice::<CreateSkillReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige Skill-Anfrage"));
                return;
            };
            ipc_worker_pool().execute(move || {
                match create_ai_skill(Path::new(&req.parent_dir), &req.skill_name) {
                    Ok(payload) => {
                        let p = Path::new(&payload.path);
                        state.allow_file_parent(p);
                        responder.respond(ok_json(&payload));
                    }
                    Err(err) => responder.respond(err_json(StatusCode::BAD_REQUEST, err)),
                }
            });
        }

        "workspace-files" => {
            let Ok(req) = serde_json::from_slice::<PathReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültiger Ordnerpfad"));
                return;
            };
            ipc_worker_pool().execute(move || {
                match list_workspace_markdown_files(Path::new(&req.path)) {
                    Ok(files) => responder.respond(ok_json(&serde_json::json!({ "files": files }))),
                    Err(err) => responder.respond(err_json(StatusCode::BAD_REQUEST, err)),
                }
            });
        }

        "save-pasted-image" => {
            let Ok(req) = serde_json::from_slice::<SavePastedImageReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige Bild-Anfrage"));
                return;
            };
            ipc_worker_pool().execute(move || {
                let base = req.base_dir.as_deref().map(Path::new);
                match save_clipboard_image(base, &req.mime_type, &req.data_base64) {
                    Ok((saved_path, md_snippet)) => {
                        state.allow_file_parent(&saved_path);
                        responder.respond(ok_json(&serde_json::json!({
                            "savedPath": saved_path.to_string_lossy(),
                            "markdownSnippet": md_snippet
                        })));
                    }
                    Err(err) => responder.respond(err_json(StatusCode::BAD_REQUEST, err)),
                }
            });
        }

        "import-dropped-image" => {
            let Ok(req) = serde_json::from_slice::<ImportDroppedImageReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige Bilddatei"));
                return;
            };
            ipc_worker_pool().execute(move || {
                let base = req.base_dir.as_deref().map(Path::new);
                match import_dropped_image(base, Path::new(&req.source_path)) {
                    Ok((saved_path, md_snippet)) => {
                        state.allow_file_parent(&saved_path);
                        responder.respond(ok_json(&serde_json::json!({
                            "savedPath": saved_path.to_string_lossy(),
                            "markdownSnippet": md_snippet
                        })));
                    }
                    Err(err) => responder.respond(err_json(StatusCode::BAD_REQUEST, err)),
                }
            });
        }

        "search-workspace" => {
            let Ok(req) = serde_json::from_slice::<SearchWorkspaceReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige Suchanfrage"));
                return;
            };
            search_worker_pool().execute(move || {
                match search_workspace_with_metadata(
                    Path::new(&req.root),
                    &req.query,
                    req.case_sensitive,
                    req.use_regex,
                    req.whole_word,
                ) {
                    Ok(outcome) => responder.respond(ok_json(&outcome)),
                    Err(err) => responder.respond(err_json(StatusCode::BAD_REQUEST, err)),
                }
            });
        }

        "replace-workspace" => {
            let Ok(req) = serde_json::from_slice::<ReplaceWorkspaceReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige Ersetzen-Anfrage"));
                return;
            };
            search_worker_pool().execute(move || {
                match replace_in_workspace_with_options(
                    Path::new(&req.root),
                    &req.query,
                    &req.replacement,
                    req.case_sensitive,
                    req.use_regex,
                    req.whole_word,
                    req.include_files,
                ) {
                    Ok(res) => responder.respond(ok_json(&res)),
                    Err(err) => responder.respond(err_json(StatusCode::BAD_REQUEST, err)),
                }
            });
        }

        "create-file" => {
            let Ok(req) = serde_json::from_slice::<CreateFileReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige Anfrage"));
                return;
            };
            ipc_worker_pool().execute(move || {
                match create_new_markdown_file(Path::new(&req.parent_dir), &req.file_name) {
                    Ok(payload) => {
                        state.allow_file_parent(Path::new(&payload.path));
                        responder.respond(ok_json(&payload));
                    }
                    Err(err) => responder.respond(err_json(StatusCode::BAD_REQUEST, err)),
                }
            });
        }

        "create-folder" => {
            let Ok(req) = serde_json::from_slice::<CreateFolderReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige Ordner-Anfrage"));
                return;
            };
            ipc_worker_pool().execute(move || {
                match create_new_folder(Path::new(&req.parent_dir), &req.folder_name) {
                    Ok(path) => {
                        responder.respond(ok_json(&serde_json::json!({ "path": path })));
                    }
                    Err(err) => responder.respond(err_json(StatusCode::BAD_REQUEST, err)),
                }
            });
        }

        "rename-path" => {
            let Ok(req) = serde_json::from_slice::<RenamePathReq>(&body) else {
                responder.respond(err_json(
                    StatusCode::BAD_REQUEST,
                    "Ungültige Umbenennungs-Anfrage",
                ));
                return;
            };
            ipc_worker_pool().execute(move || {
                let old_p = PathBuf::from(&req.path);
                match rename_fs_entry(&old_p, &req.new_name) {
                    Ok((new_path, new_name)) => {
                        let new_p = Path::new(&new_path);
                        if new_p.is_file() {
                            state.allow_file_parent(new_p);
                        }
                        responder.respond(ok_json(&serde_json::json!({
                            "path": new_path,
                            "name": new_name
                        })));
                    }
                    Err(err) => responder.respond(err_json(StatusCode::BAD_REQUEST, err)),
                }
            });
        }

        "delete-path" => {
            let Ok(req) = serde_json::from_slice::<PathReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültiger Pfad"));
                return;
            };
            ipc_worker_pool().execute(move || {
                let target = PathBuf::from(&req.path);
                match move_to_recycle_bin(&target) {
                    Ok(()) => responder.respond(ok_json(&serde_json::json!({ "ok": true }))),
                    Err(err) => responder.respond(err_json(StatusCode::BAD_REQUEST, err)),
                }
            });
        }

        "reveal-in-explorer" => {
            let Ok(req) = serde_json::from_slice::<PathReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültiger Pfad"));
                return;
            };
            ipc_worker_pool().execute(move || match reveal_in_explorer(Path::new(&req.path)) {
                Ok(()) => responder.respond(ok_json(&serde_json::json!({ "ok": true }))),
                Err(err) => responder.respond(err_json(StatusCode::BAD_REQUEST, err)),
            });
        }

        "window/set-state" => {
            let Ok(req) = serde_json::from_slice::<WindowStateReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültiger Status"));
                return;
            };
            if let Some(title) = req.title {
                let _ = state.proxy.send_event(UserEvent::SetWindowTitle(title));
            }
            if let Some(theme_str) = req.theme {
                let theme = match theme_str.as_str() {
                    "dark" => Some(tao::window::Theme::Dark),
                    "light" => Some(tao::window::Theme::Light),
                    _ => None,
                };
                let _ = state.proxy.send_event(UserEvent::SetWindowTheme(theme));
            }
            if let Some(fullscreen) = req.fullscreen {
                let _ = state.proxy.send_event(UserEvent::SetFullscreen(fullscreen));
            }
            responder.respond(ok_json(&serde_json::json!({ "ok": true })));
        }

        "window/force-close" => {
            let Ok(req) = serde_json::from_slice::<CloseWindowReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige Fenster-Anfrage"));
                return;
            };
            draft_worker_pool().execute(move || {
                if let Ok(mut guard) = state.drafts.lock() {
                    if let Some(store) = guard.as_mut() {
                        store.close(req.recovery_restored);
                    }
                }
                responder.respond(ok_json(&serde_json::json!({ "ok": true })));
                let _ = state.proxy.send_event(UserEvent::ForceCloseWindow);
            });
        }

        "open-external" => {
            let Ok(req) = serde_json::from_slice::<ExternalUrlReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige URL"));
                return;
            };
            if crate::navigation::classify_url(&req.url)
                != crate::navigation::NavigationTarget::External
            {
                responder.respond(err_json(
                    StatusCode::BAD_REQUEST,
                    "Externe URL wurde aus Sicherheitsgründen blockiert.",
                ));
                return;
            }
            let Ok(parsed) = url::Url::parse(&req.url) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige URL"));
                return;
            };
            if state
                .proxy
                .send_event(UserEvent::OpenExternalUrl(parsed.as_str().to_owned()))
                .is_err()
            {
                responder.respond(err_json(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Hauptfenster konnte nicht erreicht werden.",
                ));
                return;
            }
            responder.respond(ok_json(&serde_json::json!({ "ok": true })));
        }

        "dialog/open-files" => handle_open_files_dialog(&body, state, responder),
        "dialog/open-folder" => handle_open_folder_dialog(&body, state, responder),
        "dialog/save-file" => handle_save_file_dialog(&body, state, responder),
        "dialog/export-html" => handle_export_html_dialog(&body, state, responder),
        "dialog/pick-pdf-target" => handle_pick_pdf_target_dialog(&body, state, responder),
        "export-pdf" => handle_export_pdf(&body, state, responder),

        _ => responder.respond(err_json(StatusCode::NOT_FOUND, "Unbekannter API-Endpunkt")),
    }
}

#[cfg(test)]
mod tests {
    use super::assets::{classify_local_asset_headers, read_bounded_local_asset};
    use super::pool::{
        default_worker_count, draft_worker_pool, ipc_worker_pool, render_worker_pool,
        search_worker_pool, DialogActiveGuard, WorkerPool,
    };
    use super::render::{RenderCoalescer, SupersededRenderResult};
    use crate::drafts::DraftEntry;
    use crate::markdown::render_markdown;
    use http::StatusCode;
    use std::collections::HashSet;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{mpsc, Arc, Mutex};
    use std::thread::ThreadId;

    #[test]
    fn default_worker_count_is_clamped_to_4_to_8() {
        let count = default_worker_count();
        assert!((4..=8).contains(&count));
    }

    #[test]
    fn worker_pool_executes_jobs_and_bounds_threads() {
        let pool = WorkerPool::new("test", 4);
        let thread_ids = Arc::new(Mutex::new(HashSet::<ThreadId>::new()));
        let completed = Arc::new(AtomicUsize::new(0));
        let (done_tx, done_rx) = mpsc::channel();

        let total_jobs = 20;
        for _ in 0..total_jobs {
            let ids = Arc::clone(&thread_ids);
            let done = Arc::clone(&completed);
            let tx = done_tx.clone();
            pool.execute(move || {
                ids.lock().unwrap().insert(std::thread::current().id());
                if done.fetch_add(1, Ordering::SeqCst) + 1 == total_jobs {
                    let _ = tx.send(());
                }
            });
        }
        drop(done_tx);

        done_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("worker pool should complete all jobs");

        assert_eq!(completed.load(Ordering::SeqCst), total_jobs);
        assert!(thread_ids.lock().unwrap().len() <= 4);
    }

    #[test]
    fn draft_save_render_and_search_complete_while_general_workers_are_busy() {
        use crate::drafts::DraftStore;
        use std::time::{Duration, SystemTime, UNIX_EPOCH};

        let timeout = Duration::from_secs(5);
        let (started_tx, started_rx) = mpsc::channel();
        let mut release_workers = Vec::new();
        for _ in 0..default_worker_count() {
            let (release_tx, release_rx) = mpsc::channel::<()>();
            let started_tx = started_tx.clone();
            release_workers.push(release_tx);
            ipc_worker_pool().execute(move || {
                started_tx.send(()).unwrap();
                let _ = release_rx.recv();
            });
        }
        for _ in &release_workers {
            started_rx
                .recv_timeout(timeout)
                .expect("general worker should be occupied");
        }

        let (render_tx, render_rx) = mpsc::channel();
        render_worker_pool(Some("live")).execute(move || {
            let rendered = render_markdown("# Current preview", None);
            let _ = render_tx.send(rendered.html);
        });
        let (search_tx, search_rx) = mpsc::channel();
        search_worker_pool().execute(move || {
            let _ = search_tx.send("search-pool-ok");
        });
        let (draft_tx, draft_rx) = mpsc::channel();
        draft_worker_pool().execute(move || {
            let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
            let dir = std::env::temp_dir()
                .join(format!("semyra-ipc-drafts-{}-{timestamp}", std::process::id()));
            let (mut store, _) = DraftStore::open(&dir).unwrap();
            let draft = DraftEntry {
                name: "Draft.md".into(),
                path: None,
                parent_dir: None,
                content: "Unsaved text".into(),
                saved_content: String::new(),
                line_ending: "LF".into(),
                saved_line_ending: None,
            };
            store.save(1, vec![draft], true).unwrap();
            drop(store);
            let (mut store, recovered) = DraftStore::open(&dir).unwrap();
            store.close(true);
            drop(store);
            fs::remove_dir(&dir).unwrap();
            let _ = draft_tx.send(recovered);
        });

        let recovered = draft_rx
            .recv_timeout(timeout)
            .expect("draft save should finish while general workers are occupied");
        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0].content, "Unsaved text");
        let html = render_rx
            .recv_timeout(timeout)
            .expect("render should finish while general workers are occupied");
        assert!(html.contains("Current preview"));
        let search_msg = search_rx
            .recv_timeout(timeout)
            .expect("search pool should finish while general workers are occupied");
        assert_eq!(search_msg, "search-pool-ok");
        drop(release_workers);
    }

    #[test]
    fn render_coalescer_skips_stale_revisions_per_key() {
        let coalescer = RenderCoalescer::default();

        let t1 = coalescer.register("doc-a", None);
        let t2 = coalescer.register("doc-a", None);
        let tb = coalescer.register("doc-b", None);

        assert!(coalescer.is_superseded("doc-a", t1));
        assert!(!coalescer.is_superseded("doc-a", t2));
        assert!(!coalescer.is_superseded("doc-b", tb));

        // Explicit out-of-order client revisions
        let c10 = coalescer.register("doc-c", Some(10));
        let c12 = coalescer.register("doc-c", Some(12));
        let c11 = coalescer.register("doc-c", Some(11));

        assert!(coalescer.is_superseded("doc-c", c10));
        assert!(coalescer.is_superseded("doc-c", c11));
        assert!(!coalescer.is_superseded("doc-c", c12));
    }

    #[test]
    fn render_coalescing_on_worker_pool_skips_superseded_queued_work() {
        let pool = WorkerPool::new("test", 1);
        let coalescer = Arc::new(RenderCoalescer::default());
        let (gate_tx, gate_rx) = mpsc::channel::<()>();
        let (entered_tx, entered_rx) = mpsc::channel::<()>();
        let (done_tx, done_rx) = mpsc::channel::<(u64, bool)>();

        pool.execute(move || {
            let _ = entered_tx.send(());
            let _ = gate_rx.recv();
        });
        entered_rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("worker should enter gate");

        let mut tokens = Vec::new();
        for _ in 0..3 {
            let token = coalescer.register("tab-1", None);
            tokens.push(token);
            let c = Arc::clone(&coalescer);
            let tx = done_tx.clone();
            pool.execute(move || {
                let superseded = c.is_superseded("tab-1", token);
                let _ = tx.send((token, superseded));
            });
        }
        drop(done_tx);

        let _ = gate_tx.send(());

        let mut results: Vec<(u64, bool)> = done_rx.iter().collect();
        results.sort_by_key(|(token, _)| *token);

        assert_eq!(
            results,
            vec![(tokens[0], true), (tokens[1], true), (tokens[2], false)]
        );
    }

    #[test]
    fn superseded_render_response_matches_render_result_schema() {
        let val = serde_json::to_value(SupersededRenderResult::default()).unwrap();
        assert_eq!(val["superseded"], serde_json::json!(true));
        assert_eq!(val["html"], serde_json::json!(""));
        assert_eq!(val["outline"], serde_json::json!([]));
        assert_eq!(val["stats"]["words"], serde_json::json!(0));
        assert_eq!(val["stats"]["chars"], serde_json::json!(0));
        assert_eq!(val["stats"]["lines"], serde_json::json!(0));
        assert_eq!(val["stats"]["readingTimeSec"], serde_json::json!(0));
    }

    #[test]
    fn render_coalescer_evicts_only_oldest_key_when_capacity_reached() {
        let coalescer = RenderCoalescer::default();
        let oldest_t1 = coalescer.register("doc-0", Some(1));
        for i in 1..RenderCoalescer::MAX_KEYS {
            let key = format!("doc-{i}");
            coalescer.register(&key, Some(1));
        }

        coalescer.register("doc-new", Some(1));

        let state = coalescer.state.lock().unwrap();
        assert_eq!(state.entries.len(), RenderCoalescer::MAX_KEYS);
        assert!(!state.entries.contains_key("doc-0"));
        assert!(state.entries.contains_key("doc-1"));
        assert!(state.entries.contains_key("doc-new"));
        drop(state);

        let doc1_t2 = coalescer.register("doc-1", Some(2));
        assert!(coalescer.is_superseded("doc-1", oldest_t1));
        assert!(!coalescer.is_superseded("doc-1", doc1_t2));
    }

    #[test]
    fn classify_local_asset_headers_sandboxes_svg_and_forces_download_for_active_types() {
        let png = mime_guess::from_ext("png").first_or_octet_stream();
        let png_headers = classify_local_asset_headers(&png);
        assert_eq!(png_headers.content_type, "image/png");
        assert!(png_headers.csp.is_none());
        assert!(png_headers.content_disposition.is_none());

        let svg = mime_guess::from_ext("svg").first_or_octet_stream();
        let svg_headers = classify_local_asset_headers(&svg);
        assert_eq!(svg_headers.content_type, "image/svg+xml");
        assert_eq!(svg_headers.csp, Some("sandbox"));
        assert!(svg_headers.content_disposition.is_none());

        let html = mime_guess::from_ext("html").first_or_octet_stream();
        let html_headers = classify_local_asset_headers(&html);
        assert_eq!(html_headers.content_type, "application/octet-stream");
        assert_eq!(html_headers.csp, Some("sandbox"));
        assert_eq!(html_headers.content_disposition, Some("attachment"));
    }

    #[test]
    fn worker_pool_survives_panics_and_executes_subsequent_jobs() {
        let pool = WorkerPool::new("panic-test", 1);
        let (tx, rx) = mpsc::channel();
        pool.execute(|| panic!("simulated worker panic"));
        pool.execute(move || {
            let _ = tx.send(42u32);
        });
        assert_eq!(
            rx.recv_timeout(std::time::Duration::from_secs(5))
                .expect("worker should recover after panic"),
            42
        );
    }

    #[test]
    fn dialog_active_guard_prevents_concurrent_dialogs_until_dropped() {
        let first = DialogActiveGuard::try_acquire().expect("first dialog should acquire");
        assert!(DialogActiveGuard::try_acquire().is_none());
        drop(first);
        let second = DialogActiveGuard::try_acquire().expect("should re-acquire after drop");
        drop(second);
    }

    #[test]
    fn read_bounded_local_asset_enforces_size_limit_from_single_handle() {
        let dir = std::env::temp_dir().join(format!("semyra-local-asset-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let ok_file = dir.join("ok.png");
        let big_file = dir.join("big.png");
        fs::write(&ok_file, b"12345").unwrap();
        fs::write(&big_file, b"123456").unwrap();

        assert_eq!(read_bounded_local_asset(&ok_file, 5).unwrap(), b"12345");
        let err = read_bounded_local_asset(&big_file, 5).unwrap_err();
        assert_eq!(err.0, StatusCode::PAYLOAD_TOO_LARGE);
        assert_eq!(
            read_bounded_local_asset(&dir, 5).unwrap_err().0,
            StatusCode::BAD_REQUEST
        );

        fs::remove_dir_all(dir).unwrap();
    }
}
