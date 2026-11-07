use crate::drafts::{clear_recovery_snapshot, save_recovery_snapshot, DraftEntry};
use crate::fs_ops::{
    build_directory_tree, build_standalone_html_document, clean_windows_path, create_new_folder,
    create_new_markdown_file, import_dropped_image, inline_local_asset_images,
    list_workspace_markdown_files, move_to_recycle_bin, normalize_existing_path, read_text_file,
    rename_fs_entry, reveal_in_explorer, save_clipboard_image, search_workspace_files,
    write_text_file,
};
use crate::markdown::render_markdown;
use crate::state::{AppState, UserEvent};
use crate::window_prefs::UiSessionPrefs;
use http::{Response, StatusCode};
use percent_encoding::percent_decode_str;
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::fs;
use std::path::{Path, PathBuf};
use wry::RequestAsyncResponder;

#[derive(RustEmbed)]
#[folder = "frontend/dist"]
struct FrontendAssets;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenderReq {
    markdown: String,
    base_dir: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathReq {
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteReq {
    path: String,
    content: String,
    line_ending: Option<String>,
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
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveDraftsReq {
    entries: Vec<DraftEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveDialogReq {
    default_name: Option<String>,
    default_dir: Option<String>,
    content: String,
    line_ending: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportHtmlReq {
    title: String,
    markdown: String,
    rendered_html: Option<String>,
    base_dir: Option<String>,
    default_dir: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PickPdfTargetReq {
    title: String,
    default_dir: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecutePdfExportReq {
    token: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowStateReq {
    title: Option<String>,
    has_unsaved_changes: Option<bool>,
    theme: Option<String>,
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

fn json_response<T: Serialize>(status: StatusCode, value: &T) -> Response<Cow<'static, [u8]>> {
    let body = serde_json::to_vec(value).unwrap_or_else(|_| b"{}".to_vec());
    Response::builder()
        .status(status)
        .header("Content-Type", "application/json; charset=utf-8")
        .header("Cache-Control", "no-store")
        .header("Access-Control-Allow-Origin", "*")
        .body(Cow::Owned(body))
        .unwrap()
}

fn ok_json<T: Serialize>(value: &T) -> Response<Cow<'static, [u8]>> {
    json_response(StatusCode::OK, value)
}

fn err_json(status: StatusCode, msg: impl Into<String>) -> Response<Cow<'static, [u8]>> {
    json_response(status, &ApiError { error: msg.into() })
}

fn query_param(query: Option<&str>, key: &str) -> Option<String> {
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
    let path = request.uri().path().to_string();
    let query = request.uri().query().map(|s| s.to_string());
    let body = request.into_body();

    // Local Markdown asset streaming (images referenced by relative path in Markdown)
    if path == "/api/local-asset" {
        let Some(raw_path) = query_param(query.as_deref(), "path") else {
            responder.respond(err_json(StatusCode::BAD_REQUEST, "Fehlender Pfadparameter."));
            return;
        };
        std::thread::spawn(move || {
            let target = PathBuf::from(&raw_path);
            if !state.is_local_asset_allowed(&target) {
                responder.respond(err_json(
                    StatusCode::FORBIDDEN,
                    "Zugriff auf lokale Ressource außerhalb geöffneter Ordner verweigert.",
                ));
                return;
            }
            match fs::read(&target) {
                Ok(bytes) => {
                    let mime = mime_guess::from_path(&target)
                        .first_or_octet_stream()
                        .to_string();
                    let resp = Response::builder()
                        .status(StatusCode::OK)
                        .header("Content-Type", mime)
                        .header("Cache-Control", "no-cache")
                        .body(Cow::Owned(bytes))
                        .unwrap();
                    responder.respond(resp);
                }
                Err(_) => {
                    responder.respond(err_json(StatusCode::NOT_FOUND, "Bilddatei nicht gefunden."));
                }
            }
        });
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

fn handle_api_route(
    route: &str,
    body: Vec<u8>,
    state: AppState,
    responder: RequestAsyncResponder,
) {
    match route {
        "startup" => {
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
        }

        "prefs/save" => {
            let Ok(prefs) = serde_json::from_slice::<UiSessionPrefs>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige Einstellungen"));
                return;
            };
            let ws_folder = if let Ok(mut guard) = state.inner.lock() {
                guard.ui_prefs = prefs.clone();
                guard.workspace_folder.as_ref().map(|p| p.to_string_lossy().to_string())
            } else {
                None
            };
            std::thread::spawn(move || {
                let mut disk = crate::window_prefs::load_window_prefs();
                disk.ui = prefs;
                if ws_folder.is_some() {
                    disk.last_workspace_folder = ws_folder;
                }
                crate::window_prefs::save_window_prefs(&disk);
                responder.respond(ok_json(&serde_json::json!({ "ok": true })));
            });
        }

        "drafts/save" => {
            let Ok(req) = serde_json::from_slice::<SaveDraftsReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige Entwurfsdaten"));
                return;
            };
            std::thread::spawn(move || match save_recovery_snapshot(req.entries) {
                Ok(()) => responder.respond(ok_json(&serde_json::json!({ "ok": true }))),
                Err(err) => responder.respond(err_json(StatusCode::INTERNAL_SERVER_ERROR, err)),
            });
        }

        "drafts/clear" => {
            clear_recovery_snapshot();
            responder.respond(ok_json(&serde_json::json!({ "ok": true })));
        }

        "render" => {
            let Ok(req) = serde_json::from_slice::<RenderReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige Render-Anfrage"));
                return;
            };
            std::thread::spawn(move || {
                let base = req.base_dir.as_deref().map(Path::new);
                let result = render_markdown(&req.markdown, base);
                responder.respond(ok_json(&result));
            });
        }

        "read-file" => {
            let Ok(req) = serde_json::from_slice::<PathReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültiger Dateipfad"));
                return;
            };
            std::thread::spawn(move || {
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
            std::thread::spawn(move || {
                let p = PathBuf::from(&req.path);
                let prefer_crlf = req
                    .line_ending
                    .as_deref()
                    .map(|le| le.eq_ignore_ascii_case("CRLF"))
                    .unwrap_or(true);
                state.record_self_write(&p);
                match write_text_file(&p, &req.content, prefer_crlf) {
                    Ok(saved_path) => {
                        let saved_p = Path::new(&saved_path);
                        state.record_self_write(saved_p);
                        state.allow_file_parent(saved_p);
                        responder.respond(ok_json(&serde_json::json!({ "path": saved_path })));
                    }
                    Err(err) => {
                        responder.respond(err_json(StatusCode::INTERNAL_SERVER_ERROR, err))
                    }
                }
            });
        }

        "list-tree" => {
            let Ok(req) = serde_json::from_slice::<PathReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültiger Ordnerpfad"));
                return;
            };
            std::thread::spawn(move || {
                let folder = PathBuf::from(&req.path);
                match build_directory_tree(&folder, 5) {
                    Ok(tree) => {
                        state.set_workspace_folder(&folder);
                        responder.respond(ok_json(&tree));
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
            std::thread::spawn(move || {
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
            std::thread::spawn(move || {
                let base = req.base_dir.as_deref().map(Path::new);
                match save_clipboard_image(base, &req.mime_type, &req.data_base64) {
                    Ok((saved_path, md_snippet)) => {
                        state.record_self_write(&saved_path);
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
            std::thread::spawn(move || {
                let base = req.base_dir.as_deref().map(Path::new);
                match import_dropped_image(base, Path::new(&req.source_path)) {
                    Ok((saved_path, md_snippet)) => {
                        state.record_self_write(&saved_path);
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
            std::thread::spawn(move || {
                match search_workspace_files(
                    Path::new(&req.root),
                    &req.query,
                    req.case_sensitive,
                ) {
                    Ok(results) => {
                        responder.respond(ok_json(&serde_json::json!({ "results": results })))
                    }
                    Err(err) => responder.respond(err_json(StatusCode::BAD_REQUEST, err)),
                }
            });
        }

        "create-file" => {
            let Ok(req) = serde_json::from_slice::<CreateFileReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige Anfrage"));
                return;
            };
            match create_new_markdown_file(Path::new(&req.parent_dir), &req.file_name) {
                Ok(payload) => {
                    state.record_self_write(Path::new(&payload.path));
                    state.allow_file_parent(Path::new(&payload.path));
                    responder.respond(ok_json(&payload));
                }
                Err(err) => responder.respond(err_json(StatusCode::BAD_REQUEST, err)),
            }
        }

        "create-folder" => {
            let Ok(req) = serde_json::from_slice::<CreateFolderReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige Ordner-Anfrage"));
                return;
            };
            match create_new_folder(Path::new(&req.parent_dir), &req.folder_name) {
                Ok(path) => {
                    state.record_self_write(Path::new(&path));
                    responder.respond(ok_json(&serde_json::json!({ "path": path })));
                }
                Err(err) => responder.respond(err_json(StatusCode::BAD_REQUEST, err)),
            }
        }

        "rename-path" => {
            let Ok(req) = serde_json::from_slice::<RenamePathReq>(&body) else {
                responder.respond(err_json(
                    StatusCode::BAD_REQUEST,
                    "Ungültige Umbenennungs-Anfrage",
                ));
                return;
            };
            let old_p = PathBuf::from(&req.path);
            state.record_self_write(&old_p);
            match rename_fs_entry(&old_p, &req.new_name) {
                Ok((new_path, new_name)) => {
                    let new_p = Path::new(&new_path);
                    state.record_self_write(new_p);
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
        }

        "delete-path" => {
            let Ok(req) = serde_json::from_slice::<PathReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültiger Pfad"));
                return;
            };
            std::thread::spawn(move || {
                let target = PathBuf::from(&req.path);
                state.record_self_write(&target);
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
            match reveal_in_explorer(Path::new(&req.path)) {
                Ok(()) => responder.respond(ok_json(&serde_json::json!({ "ok": true }))),
                Err(err) => responder.respond(err_json(StatusCode::BAD_REQUEST, err)),
            }
        }

        "window/set-state" => {
            let Ok(req) = serde_json::from_slice::<WindowStateReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültiger Status"));
                return;
            };
            if let Some(unsaved) = req.has_unsaved_changes {
                if let Ok(mut guard) = state.inner.lock() {
                    guard.has_unsaved_changes = unsaved;
                }
            }
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
            responder.respond(ok_json(&serde_json::json!({ "ok": true })));
        }

        "window/force-close" => {
            if let Ok(mut guard) = state.inner.lock() {
                guard.has_unsaved_changes = false;
            }
            let _ = state.proxy.send_event(UserEvent::ForceCloseWindow);
            responder.respond(ok_json(&serde_json::json!({ "ok": true })));
        }

        "open-external" => {
            let Ok(req) = serde_json::from_slice::<ExternalUrlReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige URL"));
                return;
            };
            if req.url.starts_with("https://")
                || req.url.starts_with("http://")
                || req.url.starts_with("mailto:")
            {
                let _ = state.proxy.send_event(UserEvent::OpenExternalUrl(req.url));
            }
            responder.respond(ok_json(&serde_json::json!({ "ok": true })));
        }

        "dialog/open-files" => {
            std::thread::spawn(move || {
                let start_dir = state
                    .inner
                    .lock()
                    .ok()
                    .and_then(|g| g.workspace_folder.clone())
                    .or_else(dirs::document_dir);

                let mut dlg = rfd::FileDialog::new()
                    .set_title("Markdown-Datei öffnen")
                    .add_filter(
                        "Markdown-Dateien",
                        &["md", "markdown", "mdown", "mkd", "mdx", "txt"],
                    )
                    .add_filter("Alle Dateien", &["*"]);

                if let Some(dir) = start_dir {
                    dlg = dlg.set_directory(dir);
                }

                let picked = dlg.pick_files().unwrap_or_default();
                let mut files = Vec::new();
                for path in picked {
                    if let Ok(payload) = read_text_file(&path) {
                        state.allow_file_parent(&path);
                        files.push(payload);
                    }
                }
                responder.respond(ok_json(&serde_json::json!({ "files": files })));
            });
        }

        "dialog/open-folder" => {
            std::thread::spawn(move || {
                let start_dir = state
                    .inner
                    .lock()
                    .ok()
                    .and_then(|g| g.workspace_folder.clone())
                    .or_else(dirs::document_dir);

                let mut dlg = rfd::FileDialog::new().set_title("Arbeitsordner öffnen");
                if let Some(dir) = start_dir {
                    dlg = dlg.set_directory(dir);
                }

                if let Some(folder) = dlg.pick_folder() {
                    match build_directory_tree(&folder, 5) {
                        Ok(tree) => {
                            state.set_workspace_folder(&folder);
                            responder.respond(ok_json(&serde_json::json!({ "tree": tree })));
                        }
                        Err(err) => responder.respond(err_json(StatusCode::BAD_REQUEST, err)),
                    }
                } else {
                    responder.respond(ok_json(&serde_json::json!({ "tree": null })));
                }
            });
        }

        "dialog/save-file" => {
            let Ok(req) = serde_json::from_slice::<SaveDialogReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige Speicher-Anfrage"));
                return;
            };
            std::thread::spawn(move || {
                let start_dir = req
                    .default_dir
                    .as_ref()
                    .map(PathBuf::from)
                    .or_else(|| {
                        state
                            .inner
                            .lock()
                            .ok()
                            .and_then(|g| g.workspace_folder.clone())
                    })
                    .or_else(dirs::document_dir);

                let file_name = req
                    .default_name
                    .unwrap_or_else(|| "Unbenannt.md".to_string());

                let mut dlg = rfd::FileDialog::new()
                    .set_title("Markdown-Datei speichern unter")
                    .set_file_name(&file_name)
                    .add_filter("Markdown-Datei (*.md)", &["md", "markdown"])
                    .add_filter("Textdatei (*.txt)", &["txt"]);

                if let Some(dir) = start_dir {
                    dlg = dlg.set_directory(dir);
                }

                if let Some(chosen) = dlg.save_file() {
                    let prefer_crlf = req
                        .line_ending
                        .as_deref()
                        .map(|le| le.eq_ignore_ascii_case("CRLF"))
                        .unwrap_or(true);
                    state.record_self_write(&chosen);
                    match write_text_file(&chosen, &req.content, prefer_crlf) {
                        Ok(saved_path) => {
                            let norm = normalize_existing_path(Path::new(&saved_path));
                            state.record_self_write(&norm);
                            state.allow_file_parent(&norm);
                            let name = norm
                                .file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or("Unbenannt.md")
                                .to_string();
                            let parent_dir = norm
                                .parent()
                                .map(|p| clean_windows_path(p).to_string_lossy().into_owned());
                            responder.respond(ok_json(&serde_json::json!({
                                "saved": true,
                                "path": saved_path,
                                "name": name,
                                "parentDir": parent_dir
                            })));
                        }
                        Err(err) => {
                            responder.respond(err_json(StatusCode::INTERNAL_SERVER_ERROR, err))
                        }
                    }
                } else {
                    responder.respond(ok_json(&serde_json::json!({ "saved": false })));
                }
            });
        }

        "dialog/export-html" => {
            let Ok(req) = serde_json::from_slice::<ExportHtmlReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige Export-Anfrage"));
                return;
            };
            std::thread::spawn(move || {
                let stem = Path::new(&req.title)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Dokument");
                let html_name = format!("{stem}.html");
                let start_dir = req
                    .default_dir
                    .as_ref()
                    .map(PathBuf::from)
                    .or_else(|| {
                        state
                            .inner
                            .lock()
                            .ok()
                            .and_then(|g| g.workspace_folder.clone())
                    })
                    .or_else(dirs::document_dir);

                let mut dlg = rfd::FileDialog::new()
                    .set_title("Als HTML exportieren")
                    .set_file_name(&html_name)
                    .add_filter("HTML-Dokument (*.html)", &["html"]);

                if let Some(dir) = start_dir {
                    dlg = dlg.set_directory(dir);
                }

                if let Some(chosen) = dlg.save_file() {
                    let raw_body = match req
                        .rendered_html
                        .as_deref()
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                    {
                        Some(client_html) => client_html.to_string(),
                        None => {
                            let base = req.base_dir.as_deref().map(Path::new);
                            render_markdown(&req.markdown, base).html
                        }
                    };
                    let self_contained_body =
                        inline_local_asset_images(&raw_body, |p| state.is_local_asset_allowed(p));
                    let doc = build_standalone_html_document(stem, &self_contained_body);
                    match write_text_file(&chosen, &doc, true) {
                        Ok(saved_path) => responder.respond(ok_json(&serde_json::json!({
                            "exported": true,
                            "path": saved_path
                        }))),
                        Err(err) => {
                            responder.respond(err_json(StatusCode::INTERNAL_SERVER_ERROR, err))
                        }
                    }
                } else {
                    responder.respond(ok_json(&serde_json::json!({ "exported": false })));
                }
            });
        }

        "dialog/pick-pdf-target" => {
            let Ok(req) = serde_json::from_slice::<PickPdfTargetReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige PDF-Export-Anfrage"));
                return;
            };
            std::thread::spawn(move || {
                let stem = Path::new(&req.title)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Dokument");
                let pdf_name = format!("{stem}.pdf");
                let start_dir = req
                    .default_dir
                    .as_ref()
                    .map(PathBuf::from)
                    .or_else(|| {
                        state
                            .inner
                            .lock()
                            .ok()
                            .and_then(|g| g.workspace_folder.clone())
                    })
                    .or_else(dirs::document_dir);

                let mut dlg = rfd::FileDialog::new()
                    .set_title("Als PDF exportieren")
                    .set_file_name(&pdf_name)
                    .add_filter("PDF-Dokument (*.pdf)", &["pdf"]);

                if let Some(dir) = start_dir {
                    dlg = dlg.set_directory(dir);
                }

                if let Some(chosen) = dlg.save_file() {
                    let cleaned = clean_windows_path(&chosen);
                    let Ok(mut guard) = state.inner.lock() else {
                        responder.respond(err_json(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Interner Status für PDF-Export gesperrt.",
                        ));
                        return;
                    };
                    let token = guard.next_pdf_token;
                    guard.next_pdf_token = guard.next_pdf_token.wrapping_add(1);
                    guard.pending_pdf_exports.insert(token, cleaned);
                    responder.respond(ok_json(&serde_json::json!({
                        "chosen": true,
                        "token": token
                    })));
                } else {
                    responder.respond(ok_json(&serde_json::json!({ "chosen": false })));
                }
            });
        }

        "export-pdf" => {
            let Ok(req) = serde_json::from_slice::<ExecutePdfExportReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige PDF-Export-Anfrage"));
                return;
            };
            let target_opt = state
                .inner
                .lock()
                .ok()
                .and_then(|mut g| g.pending_pdf_exports.remove(&req.token));

            let Some(cleaned) = target_opt else {
                responder.respond(err_json(
                    StatusCode::FORBIDDEN,
                    "Ungültiges oder bereits eingelöstes PDF-Export-Token.",
                ));
                return;
            };

            std::thread::spawn(move || {
                let (done_tx, done_rx) = std::sync::mpsc::sync_channel(1);
                if state
                    .proxy
                    .send_event(UserEvent::ExportPdf {
                        target_path: cleaned.clone(),
                        done_tx,
                    })
                    .is_err()
                {
                    responder.respond(err_json(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Hauptfenster konnte für den PDF-Export nicht erreicht werden.",
                    ));
                    return;
                }

                match done_rx.recv_timeout(std::time::Duration::from_secs(30)) {
                    Ok(Ok(())) => {
                        let final_path =
                            normalize_existing_path(&cleaned).to_string_lossy().into_owned();
                        responder.respond(ok_json(&serde_json::json!({
                            "exported": true,
                            "path": final_path
                        })));
                    }
                    Ok(Err(err)) => {
                        responder.respond(err_json(StatusCode::INTERNAL_SERVER_ERROR, err))
                    }
                    Err(_) => responder.respond(err_json(
                        StatusCode::GATEWAY_TIMEOUT,
                        "Zeitüberschreitung beim Erstellen der PDF-Datei.",
                    )),
                }
            });
        }

        _ => responder.respond(err_json(StatusCode::NOT_FOUND, "Unbekannter API-Endpunkt")),
    }
}
