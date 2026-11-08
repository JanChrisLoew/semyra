use crate::drafts::{load_recovery_snapshot, DraftEntry};
use crate::fs_ops::{clean_windows_path, normalize_existing_path};
use crate::window_prefs::UiSessionPrefs;
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tao::event_loop::EventLoopProxy;

#[derive(Debug, Clone)]
pub enum UserEvent {
    SetWindowTitle(String),
    SetWindowTheme(Option<tao::window::Theme>),
    SetFullscreen(bool),
    ForceCloseWindow,
    FsChanged { paths: Vec<String> },
    FrontendEvent { name: String, payload_json: String },
    OpenExternalUrl(String),
    ActivateAndOpen {
        files: Vec<String>,
        folder: Option<String>,
    },
    ExportPdf {
        target_path: PathBuf,
        done_tx: std::sync::mpsc::SyncSender<Result<(), String>>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupPayload {
    pub initial_files: Vec<String>,
    pub initial_folder: Option<String>,
    pub recovered_drafts: Vec<DraftEntry>,
    pub ui_prefs: UiSessionPrefs,
}

pub struct AppStateInner {
    pub startup: StartupPayload,
    pub ui_prefs: UiSessionPrefs,
    pub workspace_folder: Option<PathBuf>,
    pub allowed_roots: HashSet<PathBuf>,
    pub watched_paths: HashSet<PathBuf>,
    pub recent_self_writes: HashMap<PathBuf, Instant>,
    pub pending_pdf_exports: HashMap<u64, PathBuf>,
    pub next_pdf_token: u64,
    pub has_unsaved_changes: bool,
    pub watcher: Option<RecommendedWatcher>,
}

#[derive(Clone)]
pub struct AppState {
    pub inner: Arc<Mutex<AppStateInner>>,
    pub proxy: EventLoopProxy<UserEvent>,
}

impl AppState {
    pub fn new(
        initial_files: Vec<PathBuf>,
        initial_folder: Option<PathBuf>,
        ui_prefs: UiSessionPrefs,
        proxy: EventLoopProxy<UserEvent>,
    ) -> Self {
        let mut allowed_roots = HashSet::new();

        for file in &initial_files {
            if let Some(parent) = file.parent() {
                allowed_roots.insert(normalize_existing_path(parent));
            }
        }
        for session_file in &ui_prefs.session_files {
            if let Some(parent) = Path::new(session_file).parent() {
                allowed_roots.insert(normalize_existing_path(parent));
            }
        }
        if let Some(ref folder) = initial_folder {
            allowed_roots.insert(normalize_existing_path(folder));
        }

        let pasted_assets_dir = crate::fs_ops::app_data_dir().join("pasted-assets");
        allowed_roots.insert(normalize_existing_path(&pasted_assets_dir));

        let recovered_drafts = load_recovery_snapshot();
        for draft in &recovered_drafts {
            if let Some(ref parent) = draft.parent_dir {
                allowed_roots.insert(normalize_existing_path(Path::new(parent)));
            }
        }

        let startup = StartupPayload {
            initial_files: initial_files
                .iter()
                .map(|p| normalize_existing_path(p).to_string_lossy().into_owned())
                .collect(),
            initial_folder: initial_folder
                .as_ref()
                .map(|p| normalize_existing_path(p).to_string_lossy().into_owned()),
            recovered_drafts,
            ui_prefs: ui_prefs.clone(),
        };

        let inner = Arc::new(Mutex::new(AppStateInner {
            startup,
            ui_prefs,
            workspace_folder: initial_folder.clone(),
            allowed_roots,
            watched_paths: HashSet::new(),
            recent_self_writes: HashMap::new(),
            pending_pdf_exports: HashMap::new(),
            next_pdf_token: 1,
            has_unsaved_changes: false,
            watcher: None,
        }));

        let watcher_proxy = proxy.clone();
        let watcher_inner = inner.clone();
        let watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    if event.kind.is_modify() || event.kind.is_create() || event.kind.is_remove() {
                        let now = Instant::now();
                        let mut filtered = Vec::new();
                        if let Ok(mut guard) = watcher_inner.lock() {
                            guard.recent_self_writes.retain(|_, ts| {
                                now.duration_since(*ts) < Duration::from_millis(1200)
                            });
                            for p in &event.paths {
                                let norm = normalize_existing_path(p);
                                if !guard.recent_self_writes.contains_key(&norm) {
                                    filtered.push(clean_windows_path(p).to_string_lossy().into_owned());
                                }
                            }
                        }
                        if !filtered.is_empty() {
                            let _ = watcher_proxy.send_event(UserEvent::FsChanged { paths: filtered });
                        }
                    }
                }
            },
            Config::default(),
        )
        .ok();

        if let Ok(mut guard) = inner.lock() {
            guard.watcher = watcher;
        }

        let state = Self { inner, proxy };

        if let Some(ref folder) = initial_folder {
            state.watch_path(folder, true);
        }
        for file in &initial_files {
            state.watch_path(file, false);
        }

        state
    }

    pub fn record_self_write(&self, file_path: &Path) {
        let norm = normalize_existing_path(file_path);
        if let Ok(mut guard) = self.inner.lock() {
            guard.recent_self_writes.insert(norm, Instant::now());
        }
    }

    pub fn allow_file_parent(&self, file_path: &Path) {
        let norm = normalize_existing_path(file_path);
        if let Some(parent) = norm.parent() {
            let parent_norm = normalize_existing_path(parent);
            if let Ok(mut guard) = self.inner.lock() {
                guard.allowed_roots.insert(parent_norm);
            }
        }
        self.watch_path(&norm, false);
    }

    pub fn set_workspace_folder(&self, folder_path: &Path) {
        let norm = normalize_existing_path(folder_path);
        if let Ok(mut guard) = self.inner.lock() {
            if let Some(prev) = guard.workspace_folder.take() {
                if prev != norm {
                    if let Some(ref mut watcher) = guard.watcher {
                        let _ = watcher.unwatch(&prev);
                    }
                    guard.watched_paths.remove(&prev);
                }
            }
            guard.allowed_roots.insert(norm.clone());
            guard.workspace_folder = Some(norm.clone());
        }
        self.watch_path(&norm, true);
    }

    pub fn watch_path(&self, path: &Path, recursive: bool) {
        let norm = normalize_existing_path(path);
        if !norm.exists() {
            return;
        }
        if let Ok(mut guard) = self.inner.lock() {
            if guard.watched_paths.contains(&norm) {
                return;
            }
            let mode = if recursive {
                RecursiveMode::Recursive
            } else {
                RecursiveMode::NonRecursive
            };
            if let Some(ref mut watcher) = guard.watcher {
                if watcher.watch(&norm, mode).is_ok() {
                    guard.watched_paths.insert(norm);
                }
            }
        }
    }

    pub fn is_local_asset_allowed(&self, candidate: &Path) -> bool {
        let norm = normalize_existing_path(candidate);
        let Ok(guard) = self.inner.lock() else {
            return false;
        };
        guard
            .allowed_roots
            .iter()
            .any(|root| norm.starts_with(root))
    }

    pub fn get_language(&self) -> String {
        self.inner
            .lock()
            .ok()
            .map(|g| g.ui_prefs.language.clone())
            .unwrap_or_else(|| "de".to_string())
    }
}
