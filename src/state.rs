use crate::drafts::{DraftEntry, DraftStore};
use crate::fs_ops::{clean_windows_path, normalize_existing_path};
use crate::window_prefs::UiSessionPrefs;
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tao::event_loop::EventLoopProxy;

#[derive(Debug, Clone)]
pub enum UserEvent {
    SetWindowTitle(String),
    SetWindowTheme(Option<tao::window::Theme>),
    SetFullscreen(bool),
    ForceCloseWindow,
    FinishCloseWindow,
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
    pub ui_prefs_revision: u64,
    pub workspace_folder: Option<PathBuf>,
    pub allowed_roots: HashSet<PathBuf>,
    pub watched_paths: HashSet<PathBuf>,
    pub pending_pdf_exports: HashMap<u64, PathBuf>,
    pub next_pdf_token: u64,
    pub watcher: Option<RecommendedWatcher>,
}

#[derive(Clone)]
pub struct AppState {
    pub inner: Arc<Mutex<AppStateInner>>,
    pub proxy: EventLoopProxy<UserEvent>,
    pub drafts: Arc<Mutex<Option<DraftStore>>>,
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

        let (drafts, recovered_drafts) =
            match DraftStore::open(&crate::fs_ops::app_data_dir().join("drafts")) {
                Ok((store, entries)) => (Some(store), entries),
                Err(err) => {
                    eprintln!("Entwurfswiederherstellung konnte nicht geöffnet werden: {err}");
                    (None, Vec::new())
                }
            };
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
            ui_prefs_revision: 0,
            workspace_folder: initial_folder.clone(),
            allowed_roots,
            watched_paths: HashSet::new(),
            pending_pdf_exports: HashMap::new(),
            next_pdf_token: 1,
            watcher: None,
        }));

        let watcher_proxy = proxy.clone();
        let watcher_inner = Arc::clone(&inner);
        let watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    if event.kind.is_modify() || event.kind.is_create() || event.kind.is_remove() {
                        let watched_roots: Vec<PathBuf> = watcher_inner
                            .lock()
                            .ok()
                            .map(|guard| {
                                guard
                                    .watched_paths
                                    .iter()
                                    .map(|p| clean_windows_path(p))
                                    .collect()
                            })
                            .unwrap_or_default();
                        // Let the frontend compare the disk contents after any pending save.
                        // A time filter would also hide genuine external changes to the same file.
                        let paths = event.paths.iter()
                            .filter(|path| !is_ignored_watch_path(path, &watched_roots))
                            .map(|path| clean_windows_path(path).to_string_lossy().into_owned())
                            .collect::<Vec<_>>();
                        if !paths.is_empty() {
                            let _ = watcher_proxy.send_event(UserEvent::FsChanged { paths });
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

        let state = Self { inner, proxy, drafts: Arc::new(Mutex::new(drafts)) };

        if let Some(ref folder) = initial_folder {
            state.watch_path(folder, true);
        }
        for file in &initial_files {
            state.watch_path(file, false);
        }

        state
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

    /// Registers an auxiliary root (such as the persistent AI Library) for asset
    /// access and filesystem watching without overwriting the user's active workfolder.
    pub fn allow_and_watch_root(&self, root_path: &Path) {
        let norm = normalize_existing_path(root_path);
        if let Ok(mut guard) = self.inner.lock() {
            guard.allowed_roots.insert(norm.clone());
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

pub(crate) fn is_ignored_watch_path(path: &Path, watched_roots: &[PathBuf]) -> bool {
    let clean_path = clean_windows_path(path);
    let mut best_rel: Option<&Path> = None;
    let mut best_root_depth = 0usize;

    for root in watched_roots {
        if let Ok(rel) = clean_path.strip_prefix(root) {
            let depth = root.components().count();
            if best_rel.is_none() || depth >= best_root_depth {
                best_rel = Some(rel);
                best_root_depth = depth;
            }
        }
    }

    let Some(rel) = best_rel else {
        return false;
    };

    rel.components().any(|component| match component {
        std::path::Component::Normal(part) => {
            let Some(name) = part.to_str() else {
                return false;
            };
            crate::fs_ops::IGNORED_DIRS
                .iter()
                .any(|ignored| name.eq_ignore_ascii_case(ignored))
        }
        _ => false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_ignored_directories_from_watcher_paths() {
        let roots = vec![PathBuf::from(r"C:\repo")];
        assert!(is_ignored_watch_path(Path::new(r"C:\repo\.git\index"), &roots));
        assert!(is_ignored_watch_path(Path::new(r"C:\repo\node_modules\pkg\README.md"), &roots));
        assert!(is_ignored_watch_path(Path::new(r"C:\repo\TARGET\debug\Semyra.exe"), &roots));
        assert!(is_ignored_watch_path(Path::new(r"C:\repo\dist\bundle.js"), &roots));
        assert!(is_ignored_watch_path(Path::new(r"C:\repo\__pycache__\mod.pyc"), &roots));

        assert!(!is_ignored_watch_path(Path::new(r"C:\repo\README.md"), &roots));
        assert!(!is_ignored_watch_path(Path::new(r"C:\repo\.github\AGENTS.md"), &roots));
        assert!(!is_ignored_watch_path(Path::new(r"C:\repo\.agents\skills\demo\SKILL.md"), &roots));
        assert!(!is_ignored_watch_path(Path::new(r"C:\repo\docs\target-audience.md"), &roots));
    }

    #[test]
    fn does_not_ignore_workspace_under_ignored_ancestor_directory() {
        let roots = vec![PathBuf::from(r"C:\build\dist\target\my-workspace")];
        assert!(!is_ignored_watch_path(
            Path::new(r"C:\build\dist\target\my-workspace\README.md"),
            &roots
        ));
        assert!(is_ignored_watch_path(
            Path::new(r"C:\build\dist\target\my-workspace\target\debug\app.exe"),
            &roots
        ));
    }
}
