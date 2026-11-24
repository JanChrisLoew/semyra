use super::pool::{dialog_worker_pool, ipc_worker_pool, DialogActiveGuard, ResponderGuard};
use super::{err_json, ok_json};
use crate::fs_ops::{
    build_directory_tree, build_standalone_html_document, clean_windows_path,
    inline_local_asset_images, normalize_existing_path, read_text_file, write_text_file,
};
use crate::markdown::render_markdown_with_lang;
use crate::state::{AppState, UserEvent};
use http::StatusCode;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::mpsc::RecvTimeoutError;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct DialogLangReq {
    lang: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveDialogReq {
    default_name: Option<String>,
    default_dir: Option<String>,
    content: String,
    line_ending: Option<String>,
    lang: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportHtmlReq {
    title: String,
    markdown: String,
    rendered_html: Option<String>,
    base_dir: Option<String>,
    default_dir: Option<String>,
    lang: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PickPdfTargetReq {
    title: String,
    default_dir: Option<String>,
    lang: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecutePdfExportReq {
    token: u64,
}

fn default_dialog_dir(state: &AppState, override_dir: Option<&str>) -> Option<PathBuf> {
    override_dir
        .map(PathBuf::from)
        .or_else(|| {
            state
                .inner
                .lock()
                .ok()
                .and_then(|g| g.workspace_folder.clone())
        })
        .or_else(dirs::document_dir)
}

pub(super) fn handle_open_files_dialog(
    body: &[u8],
    state: AppState,
    responder: ResponderGuard,
) {
    let req_lang = serde_json::from_slice::<DialogLangReq>(body)
        .ok()
        .and_then(|r| r.lang);
    let Some(dialog_guard) = DialogActiveGuard::try_acquire() else {
        responder.respond(err_json(
            StatusCode::CONFLICT,
            "Ein Dateidialog ist bereits geöffnet.",
        ));
        return;
    };
    dialog_worker_pool().execute(move || {
        let _dialog_guard = dialog_guard;
        let is_en = req_lang.as_deref().unwrap_or(&state.get_language()) == "en";
        let start_dir = default_dialog_dir(&state, None);

        let title = if is_en {
            "Open Markdown or Text File"
        } else {
            "Dokument oder Textdatei öffnen"
        };
        let supported_filter = if is_en {
            "Supported Text Files"
        } else {
            "Unterstützte Textdateien"
        };
        let md_filter = if is_en {
            "Markdown Files (*.md)"
        } else {
            "Markdown-Dateien (*.md)"
        };
        let all_filter = if is_en {
            "All Files (*.*)"
        } else {
            "Alle Dateien (*.*)"
        };

        let mut dlg = rfd::FileDialog::new()
            .set_title(title)
            .add_filter(
                supported_filter,
                &[
                    "md", "markdown", "mdown", "mkd", "mdx", "txt", "json", "yaml", "yml",
                    "toml", "ini", "env", "csv", "tsv", "log",
                ],
            )
            .add_filter(md_filter, &["md", "markdown", "mdown", "mkd", "mdx"])
            .add_filter(all_filter, &["*"]);

        if let Some(dir) = start_dir {
            dlg = dlg.set_directory(dir);
        }

        let picked = dlg.pick_files().unwrap_or_default();
        let mut files = Vec::new();
        let mut errors = Vec::new();
        for path in picked {
            match read_text_file(&path) {
                Ok(payload) => {
                    state.allow_file_parent(&path);
                    files.push(payload);
                }
                Err(err) => {
                    let name = path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("Datei");
                    errors.push(format!("{name}: {err}"));
                }
            }
        }
        if files.is_empty() && !errors.is_empty() {
            responder.respond(err_json(StatusCode::BAD_REQUEST, errors.join(" | ")));
        } else {
            responder.respond(ok_json(&serde_json::json!({
                "files": files,
                "errors": errors
            })));
        }
    });
}

pub(super) fn handle_open_folder_dialog(
    body: &[u8],
    state: AppState,
    responder: ResponderGuard,
) {
    let req_lang = serde_json::from_slice::<DialogLangReq>(body)
        .ok()
        .and_then(|r| r.lang);
    let Some(dialog_guard) = DialogActiveGuard::try_acquire() else {
        responder.respond(err_json(
            StatusCode::CONFLICT,
            "Ein Dateidialog ist bereits geöffnet.",
        ));
        return;
    };
    let revision = state.begin_workspace_change();
    dialog_worker_pool().execute(move || {
        let _dialog_guard = dialog_guard;
        let is_en = req_lang.as_deref().unwrap_or(&state.get_language()) == "en";
        let start_dir = default_dialog_dir(&state, None);

        let title = if is_en {
            "Open Workspace Folder"
        } else {
            "Arbeitsordner öffnen"
        };
        let mut dlg = rfd::FileDialog::new().set_title(title);
        if let Some(dir) = start_dir {
            dlg = dlg.set_directory(dir);
        }

        if let Some(folder) = dlg.pick_folder() {
            match build_directory_tree(&folder, 5) {
                Ok(tree) => {
                    let tree = revision
                        .filter(|rev| state.finish_workspace_change(*rev, Path::new(&tree.path)))
                        .map(|_| tree);
                    responder.respond(ok_json(&serde_json::json!({ "tree": tree })));
                }
                Err(err) => responder.respond(err_json(StatusCode::BAD_REQUEST, err)),
            }
        } else {
            responder.respond(ok_json(&serde_json::json!({ "tree": null })));
        }
    });
}

pub(super) fn handle_save_file_dialog(
    body: &[u8],
    state: AppState,
    responder: ResponderGuard,
) {
    let Ok(req) = serde_json::from_slice::<SaveDialogReq>(body) else {
        responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige Speicher-Anfrage"));
        return;
    };
    let Some(dialog_guard) = DialogActiveGuard::try_acquire() else {
        responder.respond(err_json(
            StatusCode::CONFLICT,
            "Ein Dateidialog ist bereits geöffnet.",
        ));
        return;
    };
    dialog_worker_pool().execute(move || {
        let _dialog_guard = dialog_guard;
        let is_en = req.lang.as_deref().unwrap_or(&state.get_language()) == "en";
        let start_dir = default_dialog_dir(&state, req.default_dir.as_deref());

        let default_fallback = if is_en { "Untitled.md" } else { "Unbenannt.md" };
        let file_name = req
            .default_name
            .unwrap_or_else(|| default_fallback.to_string());

        let is_xml = Path::new(&file_name)
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("xml"));
        let (title, filter, extensions): (_, _, &[&str]) = match (is_xml, is_en) {
            (true, true) => ("Save XML File As", "XML Files (*.xml)", &["xml"]),
            (true, false) => ("XML-Datei speichern unter", "XML-Datei (*.xml)", &["xml"]),
            (false, true) => ("Save Markdown File As", "Markdown Files (*.md)", &["md", "markdown"]),
            (false, false) => ("Markdown-Datei speichern unter", "Markdown-Datei (*.md)", &["md", "markdown"]),
        };
        let txt_filter = if is_en {
            "Text Files (*.txt)"
        } else {
            "Textdatei (*.txt)"
        };

        let mut dlg = rfd::FileDialog::new()
            .set_title(title)
            .set_file_name(&file_name)
            .add_filter(filter, extensions)
            .add_filter(txt_filter, &["txt"]);

        if let Some(dir) = start_dir {
            dlg = dlg.set_directory(dir);
        }

        if let Some(chosen) = dlg.save_file() {
            let prefer_crlf = req
                .line_ending
                .as_deref()
                .map(|le| le.eq_ignore_ascii_case("CRLF"))
                .unwrap_or(true);
            match write_text_file(&chosen, &req.content, prefer_crlf) {
                Ok(saved_path) => {
                    let norm = normalize_existing_path(Path::new(&saved_path));
                    state.allow_file_parent(&norm);
                    let name = norm
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or(default_fallback)
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
                Err(err) => responder.respond(err_json(StatusCode::INTERNAL_SERVER_ERROR, err)),
            }
        } else {
            responder.respond(ok_json(&serde_json::json!({ "saved": false })));
        }
    });
}

pub(super) fn handle_export_html_dialog(
    body: &[u8],
    state: AppState,
    responder: ResponderGuard,
) {
    let Ok(req) = serde_json::from_slice::<ExportHtmlReq>(body) else {
        responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige Export-Anfrage"));
        return;
    };
    let Some(dialog_guard) = DialogActiveGuard::try_acquire() else {
        responder.respond(err_json(
            StatusCode::CONFLICT,
            "Ein Dateidialog ist bereits geöffnet.",
        ));
        return;
    };
    dialog_worker_pool().execute(move || {
        let _dialog_guard = dialog_guard;
        let is_en = req.lang.as_deref().unwrap_or(&state.get_language()) == "en";
        let default_stem = if is_en { "Document" } else { "Dokument" };
        let stem = Path::new(&req.title)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(default_stem);
        let html_name = format!("{stem}.html");
        let start_dir = default_dialog_dir(&state, req.default_dir.as_deref());

        let title = if is_en { "Export as HTML" } else { "Als HTML exportieren" };
        let filter = if is_en { "HTML Document (*.html)" } else { "HTML-Dokument (*.html)" };

        let mut dlg = rfd::FileDialog::new()
            .set_title(title)
            .set_file_name(&html_name)
            .add_filter(filter, &["html"]);

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
                    render_markdown_with_lang(&req.markdown, base, is_en).html
                }
            };
            let (self_contained_body, images) =
                inline_local_asset_images(&raw_body, is_en, |p| state.is_local_asset_allowed(p));
            let doc = build_standalone_html_document(
                stem,
                &self_contained_body,
                &req.markdown,
                is_en,
            );
            match write_text_file(&chosen, &doc, true) {
                Ok(saved_path) => responder.respond(ok_json(&serde_json::json!({
                    "exported": true,
                    "images": images,
                    "path": saved_path
                }))),
                Err(err) => responder.respond(err_json(StatusCode::INTERNAL_SERVER_ERROR, err)),
            }
        } else {
            responder.respond(ok_json(&serde_json::json!({ "exported": false })));
        }
    });
}

pub(super) fn handle_pick_pdf_target_dialog(
    body: &[u8],
    state: AppState,
    responder: ResponderGuard,
) {
    let Ok(req) = serde_json::from_slice::<PickPdfTargetReq>(body) else {
        responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige PDF-Export-Anfrage"));
        return;
    };
    let Some(dialog_guard) = DialogActiveGuard::try_acquire() else {
        responder.respond(err_json(
            StatusCode::CONFLICT,
            "Ein Dateidialog ist bereits geöffnet.",
        ));
        return;
    };
    dialog_worker_pool().execute(move || {
        let _dialog_guard = dialog_guard;
        let is_en = req.lang.as_deref().unwrap_or(&state.get_language()) == "en";
        let default_stem = if is_en { "Document" } else { "Dokument" };
        let stem = Path::new(&req.title)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(default_stem);
        let pdf_name = format!("{stem}.pdf");
        let start_dir = default_dialog_dir(&state, req.default_dir.as_deref());

        let title = if is_en { "Export as PDF" } else { "Als PDF exportieren" };
        let filter = if is_en { "PDF Document (*.pdf)" } else { "PDF-Dokument (*.pdf)" };

        let mut dlg = rfd::FileDialog::new()
            .set_title(title)
            .set_file_name(&pdf_name)
            .add_filter(filter, &["pdf"]);

        if let Some(dir) = start_dir {
            dlg = dlg.set_directory(dir);
        }

        if let Some(chosen) = dlg.save_file() {
            let cleaned = clean_windows_path(&chosen);
            match state.insert_pdf_export(cleaned) {
                Ok(token) => responder.respond(ok_json(&serde_json::json!({
                    "chosen": true,
                    "token": token
                }))),
                Err(err) => responder.respond(err_json(StatusCode::INTERNAL_SERVER_ERROR, err)),
            }
        } else {
            responder.respond(ok_json(&serde_json::json!({ "chosen": false })));
        }
    });
}

pub(super) fn handle_export_pdf(
    body: &[u8],
    state: AppState,
    responder: ResponderGuard,
) {
    let Ok(req) = serde_json::from_slice::<ExecutePdfExportReq>(body) else {
        responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige PDF-Export-Anfrage"));
        return;
    };
    ipc_worker_pool().execute(move || {
        let Some(cleaned) = state.take_pdf_export(req.token) else {
            responder.respond(err_json(
                StatusCode::FORBIDDEN,
                "Ungültiges oder bereits eingelöstes PDF-Export-Token.",
            ));
            return;
        };

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
                let final_path = normalize_existing_path(&cleaned).to_string_lossy().into_owned();
                responder.respond(ok_json(&serde_json::json!({
                    "exported": true,
                    "path": final_path
                })));
            }
            Ok(Err(err)) => responder.respond(err_json(StatusCode::INTERNAL_SERVER_ERROR, err)),
            Err(RecvTimeoutError::Disconnected) => responder.respond(err_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                "PDF-Export wurde unerwartet abgebrochen.",
            )),
            Err(RecvTimeoutError::Timeout) => responder.respond(err_json(
                StatusCode::GATEWAY_TIMEOUT,
                "Zeitüberschreitung beim Erstellen der PDF-Datei.",
            )),
        }
    });
}
