use crate::drafts::DraftEntry;
use crate::fs_ops::encoding::write_text_file_if_unchanged;
use crate::fs_ops::{
    app_data_dir, build_directory_tree, build_standalone_html_document, clean_windows_path,
    create_ai_skill, create_new_folder, create_new_markdown_file, ensure_ai_library_tree,
    import_dropped_image, inline_local_asset_images, list_workspace_markdown_files,
    move_to_recycle_bin, normalize_existing_path, read_text_file, rename_fs_entry,
    replace_in_workspace_with_options, reveal_in_explorer, save_clipboard_image,
    search_workspace_with_options, write_text_file,
};
use crate::markdown::render_markdown;
use crate::state::{AppState, UserEvent};
use crate::window_prefs::UiSessionPrefs;
use http::{Response, StatusCode};
use percent_encoding::percent_decode_str;
use rust_embed::RustEmbed;
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use wry::RequestAsyncResponder;

#[derive(RustEmbed)]
#[folder = "frontend/dist"]
struct FrontendAssets;

type WorkerJob = Box<dyn FnOnce() + Send + 'static>;

/// Runs IPC jobs off the UI thread with a fixed number of workers and a FIFO queue.
struct WorkerPool {
    sender: Sender<WorkerJob>,
}

fn default_worker_count() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(4, 8)
}

impl WorkerPool {
    fn new(name: &str, size: usize) -> Self {
        let count = size.max(1);
        let (sender, receiver) = mpsc::channel::<WorkerJob>();
        let shared_rx = Arc::new(Mutex::new(receiver));

        for idx in 0..count {
            let rx = Arc::clone(&shared_rx);
            let _ = std::thread::Builder::new()
                .name(format!("semyra-ipc-{name}-{idx}"))
                .spawn(move || loop {
                    let job = {
                        let Ok(guard) = rx.lock() else {
                            break;
                        };
                        guard.recv()
                    };
                    match job {
                        Ok(task) => {
                            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(task));
                        }
                        Err(_) => break,
                    }
                });
        }

        Self { sender }
    }

    fn execute(&self, job: impl FnOnce() + Send + 'static) {
        let _ = self.sender.send(Box::new(job));
    }
}

fn ipc_worker_pool() -> &'static WorkerPool {
    static POOL: OnceLock<WorkerPool> = OnceLock::new();
    POOL.get_or_init(|| WorkerPool::new("general", default_worker_count()))
}

fn draft_worker_pool() -> &'static WorkerPool {
    static POOL: OnceLock<WorkerPool> = OnceLock::new();
    POOL.get_or_init(|| WorkerPool::new("drafts", 1))
}

fn render_worker_pool(doc_key: Option<&str>) -> &'static WorkerPool {
    if doc_key == Some("live") {
        static POOL: OnceLock<WorkerPool> = OnceLock::new();
        return POOL.get_or_init(|| WorkerPool::new("preview", 1));
    }
    ipc_worker_pool()
}

/// Tracks the latest queued revision token per document key so stale render jobs
/// can be skipped without running `pulldown-cmark` / `syntect`.
#[derive(Default)]
struct RenderCoalesceState {
    entries: HashMap<String, (u64, u64)>,
    next_touch: u64,
}

#[derive(Default)]
struct RenderCoalescer {
    state: Mutex<RenderCoalesceState>,
}

impl RenderCoalescer {
    const MAX_KEYS: usize = 256;

    fn register(&self, key: &str, client_revision: Option<u64>) -> u64 {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        state.next_touch = state.next_touch.saturating_add(1);
        let touch = state.next_touch;

        if !state.entries.contains_key(key) && state.entries.len() >= Self::MAX_KEYS {
            if let Some(oldest_key) = state
                .entries
                .iter()
                .min_by_key(|(_, (_, last_touch))| *last_touch)
                .map(|(k, _)| k.clone())
            {
                state.entries.remove(&oldest_key);
            }
        }

        let entry = state.entries.entry(key.to_string()).or_insert((0, touch));
        entry.1 = touch;
        match client_revision {
            Some(rev) if rev > entry.0 => {
                entry.0 = rev;
                rev
            }
            Some(rev) => rev,
            None => {
                entry.0 = entry.0.saturating_add(1);
                entry.0
            }
        }
    }

    fn is_superseded(&self, key: &str, token: u64) -> bool {
        let state = self
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        state
            .entries
            .get(key)
            .is_some_and(|&(latest, _)| latest > token)
    }
}

fn render_coalescer() -> &'static RenderCoalescer {
    static COALESCER: OnceLock<RenderCoalescer> = OnceLock::new();
    COALESCER.get_or_init(RenderCoalescer::default)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenderReq {
    markdown: String,
    base_dir: Option<String>,
    #[serde(default)]
    doc_key: Option<String>,
    #[serde(default)]
    revision: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SupersededDocStats {
    words: usize,
    chars: usize,
    lines: usize,
    reading_time_sec: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SupersededRenderResult {
    superseded: bool,
    html: &'static str,
    outline: [(); 0],
    stats: SupersededDocStats,
}

impl Default for SupersededRenderResult {
    fn default() -> Self {
        Self {
            superseded: true,
            html: "",
            outline: [],
            stats: SupersededDocStats {
                words: 0,
                chars: 0,
                lines: 0,
                reading_time_sec: 0,
            },
        }
    }
}

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
        ipc_worker_pool().execute(move || {
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
            let Ok(req) = serde_json::from_slice::<SavePrefsReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige Einstellungen"));
                return;
            };
            let Ok(mut guard) = state.inner.lock() else {
                responder.respond(err_json(StatusCode::INTERNAL_SERVER_ERROR, "Einstellungen sind nicht verfügbar."));
                return;
            };
            if req.revision > guard.ui_prefs_revision {
                guard.ui_prefs_revision = req.revision;
                guard.ui_prefs = req.prefs;
            }
            drop(guard);
            ipc_worker_pool().execute(move || {
                let result = crate::window_prefs::update_window_prefs(|disk| {
                    let guard = state.inner.lock()
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
                let result = state.drafts.lock().map_err(|e| e.to_string()).and_then(|mut store| {
                    store.as_mut().ok_or_else(|| "Entwurfswiederherstellung ist nicht verfügbar.".to_string())?
                        .save(req.revision, req.entries, req.recovery_restored)
                });
                match result {
                    Ok(()) => responder.respond(ok_json(&serde_json::json!({ "ok": true }))),
                    Err(err) => responder.respond(err_json(StatusCode::INTERNAL_SERVER_ERROR, err)),
                }
            });
        }

        "render" => {
            let Ok(req) = serde_json::from_slice::<RenderReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige Render-Anfrage"));
                return;
            };
            let doc_key = req.doc_key.as_deref().map(str::trim).filter(|key| !key.is_empty());
            let worker_pool = render_worker_pool(doc_key);
            let coalesce = doc_key.map(|key| {
                let token = render_coalescer().register(key, req.revision);
                (key.to_owned(), token)
            });
            worker_pool.execute(move || {
                if let Some((ref coalesce_key, token)) = coalesce {
                    if render_coalescer().is_superseded(coalesce_key, token) {
                        responder.respond(ok_json(&SupersededRenderResult::default()));
                        return;
                    }
                }
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
                    &p, &req.content, prefer_crlf, &req.expected_content,
                    req.expected_line_ending.as_deref(),
                ) {
                    Ok(Some(saved_path)) => {
                        let saved_p = Path::new(&saved_path);
                        state.allow_file_parent(saved_p);
                        responder.respond(ok_json(&serde_json::json!({ "saved": true })));
                    }
                    Ok(None) => responder.respond(ok_json(&serde_json::json!({ "saved": false }))),
                    Err(err) => {
                        responder.respond(err_json(StatusCode::INTERNAL_SERVER_ERROR, err))
                    }
                }
            });
        }

        "list-tree" => {
            let Ok(req) = serde_json::from_slice::<ListTreeReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültiger Ordnerpfad"));
                return;
            };
            let activate = req.activate_workspace.unwrap_or(true);
            let revision = if activate { state.begin_workspace_change() } else { None };
            ipc_worker_pool().execute(move || {
                let folder = PathBuf::from(&req.path);
                match build_directory_tree(&folder, 5) {
                    Ok(tree) => {
                        if activate {
                            let ai_lib_root = normalize_existing_path(&app_data_dir().join("ai-library"));
                            let root = Path::new(&tree.path);
                            if root == ai_lib_root {
                                state.allow_and_watch_root(root);
                            } else if !revision.is_some_and(|rev| state.finish_workspace_change(rev, root)) {
                                responder.respond(err_json(StatusCode::CONFLICT, "Die Auswahl des Arbeitsordners ist veraltet."));
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
            ipc_worker_pool().execute(move || {
                match search_workspace_with_options(
                    Path::new(&req.root),
                    &req.query,
                    req.case_sensitive,
                    req.use_regex,
                    req.whole_word,
                ) {
                    Ok(results) => {
                        responder.respond(ok_json(&serde_json::json!({ "results": results })))
                    }
                    Err(err) => responder.respond(err_json(StatusCode::BAD_REQUEST, err)),
                }
            });
        }

        "replace-workspace" => {
            let Ok(req) = serde_json::from_slice::<ReplaceWorkspaceReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige Ersetzen-Anfrage"));
                return;
            };
            ipc_worker_pool().execute(move || {
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
            ipc_worker_pool().execute(move || {
                match reveal_in_explorer(Path::new(&req.path)) {
                    Ok(()) => responder.respond(ok_json(&serde_json::json!({ "ok": true }))),
                    Err(err) => responder.respond(err_json(StatusCode::BAD_REQUEST, err)),
                }
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
            if req.url.starts_with("https://")
                || req.url.starts_with("http://")
                || req.url.starts_with("mailto:")
            {
                let _ = state.proxy.send_event(UserEvent::OpenExternalUrl(req.url));
            }
            responder.respond(ok_json(&serde_json::json!({ "ok": true })));
        }

        "dialog/open-files" => {
            let req_lang = serde_json::from_slice::<DialogLangReq>(&body)
                .ok()
                .and_then(|r| r.lang);
            ipc_worker_pool().execute(move || {
                let is_en = req_lang.as_deref().unwrap_or(&state.get_language()) == "en";
                let start_dir = state
                    .inner
                    .lock()
                    .ok()
                    .and_then(|g| g.workspace_folder.clone())
                    .or_else(dirs::document_dir);

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
                            "md", "markdown", "mdown", "mkd", "mdx", "txt", "json", "yaml",
                            "yml", "toml", "ini", "env", "csv", "tsv", "log",
                        ],
                    )
                    .add_filter(
                        md_filter,
                        &["md", "markdown", "mdown", "mkd", "mdx"],
                    )
                    .add_filter(all_filter, &["*"]);

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
            let req_lang = serde_json::from_slice::<DialogLangReq>(&body)
                .ok()
                .and_then(|r| r.lang);
            let revision = state.begin_workspace_change();
            ipc_worker_pool().execute(move || {
                let is_en = req_lang.as_deref().unwrap_or(&state.get_language()) == "en";
                let start_dir = state
                    .inner
                    .lock()
                    .ok()
                    .and_then(|g| g.workspace_folder.clone())
                    .or_else(dirs::document_dir);

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

        "dialog/save-file" => {
            let Ok(req) = serde_json::from_slice::<SaveDialogReq>(&body) else {
                responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige Speicher-Anfrage"));
                return;
            };
            ipc_worker_pool().execute(move || {
                let is_en = req.lang.as_deref().unwrap_or(&state.get_language()) == "en";
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

                let default_fallback = if is_en { "Untitled.md" } else { "Unbenannt.md" };
                let file_name = req
                    .default_name
                    .unwrap_or_else(|| default_fallback.to_string());

                let title = if is_en {
                    "Save Markdown File As"
                } else {
                    "Markdown-Datei speichern unter"
                };
                let md_filter = if is_en {
                    "Markdown Files (*.md)"
                } else {
                    "Markdown-Datei (*.md)"
                };
                let txt_filter = if is_en {
                    "Text Files (*.txt)"
                } else {
                    "Textdatei (*.txt)"
                };

                let mut dlg = rfd::FileDialog::new()
                    .set_title(title)
                    .set_file_name(&file_name)
                    .add_filter(md_filter, &["md", "markdown"])
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
            ipc_worker_pool().execute(move || {
                let is_en = req.lang.as_deref().unwrap_or(&state.get_language()) == "en";
                let default_stem = if is_en { "Document" } else { "Dokument" };
                let stem = Path::new(&req.title)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or(default_stem);
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
            ipc_worker_pool().execute(move || {
                let is_en = req.lang.as_deref().unwrap_or(&state.get_language()) == "en";
                let default_stem = if is_en { "Document" } else { "Dokument" };
                let stem = Path::new(&req.title)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or(default_stem);
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

            ipc_worker_pool().execute(move || {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::sync::atomic::{AtomicUsize, Ordering};
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
    fn draft_save_and_render_complete_while_general_workers_are_busy() {
        use crate::drafts::DraftStore;
        use std::time::{Duration, SystemTime, UNIX_EPOCH};

        let timeout = Duration::from_secs(5);
        let (started_tx, started_rx) = mpsc::channel();
        let mut release_workers = Vec::new();
        for _ in 0..default_worker_count() {
            let (release_tx, release_rx) = mpsc::channel::<()>();
            let started_tx = started_tx.clone();
            release_workers.push(release_tx);
            // Model search and modal dialog jobs holding their workers until released.
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

        // Occupy the single worker until we finish queueing the burst of render jobs.
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

        // Release the worker so the 3 queued render jobs run in order.
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

        // Adding one more key should evict only "doc-0", preserving "doc-1".."doc-255".
        coalescer.register("doc-new", Some(1));

        let state = coalescer.state.lock().unwrap();
        assert_eq!(state.entries.len(), RenderCoalescer::MAX_KEYS);
        assert!(!state.entries.contains_key("doc-0"));
        assert!(state.entries.contains_key("doc-1"));
        assert!(state.entries.contains_key("doc-new"));
        drop(state);

        // Superseding "doc-1" still works after "doc-0" was evicted.
        let doc1_t2 = coalescer.register("doc-1", Some(2));
        assert!(coalescer.is_superseded("doc-1", oldest_t1));
        assert!(!coalescer.is_superseded("doc-1", doc1_t2));
    }
}
