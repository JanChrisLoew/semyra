use crate::drafts::{DraftEntry, DraftStore};
use crate::fs_ops::{clean_windows_path, normalize_existing_path};
use crate::window_prefs::UiSessionPrefs;
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tao::event_loop::EventLoopProxy;

const PDF_TOKEN_TTL: Duration = Duration::from_secs(600);
const MAX_PENDING_PDF_EXPORTS: usize = 32;

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

#[derive(Default)]
struct WatcherManager {
    watcher: Option<RecommendedWatcher>,
    watched_paths: HashSet<PathBuf>,
    workspace_folder: Option<PathBuf>,
    workspace_revision: u64,
}

impl WatcherManager {
    fn watch_path(&mut self, path: PathBuf, recursive: bool) {
        if self.watched_paths.contains(&path) {
            return;
        }
        let mode = if recursive {
            RecursiveMode::Recursive
        } else {
            RecursiveMode::NonRecursive
        };
        if let Some(watcher) = &mut self.watcher {
            if watcher.watch(&path, mode).is_ok() {
                self.watched_paths.insert(path);
            }
        }
    }

    fn apply_workspace_change(&mut self, revision: u64, folder: PathBuf) {
        if revision < self.workspace_revision {
            return;
        }
        self.workspace_revision = revision;
        if let Some(previous) = self.workspace_folder.replace(folder.clone()) {
            if previous != folder {
                if let Some(watcher) = &mut self.watcher {
                    let _ = watcher.unwatch(&previous);
                }
                self.watched_paths.remove(&previous);
            }
        }
        self.watch_path(folder, true);
    }
}

pub struct AppStateInner {
    pub startup: StartupPayload,
    pub ui_prefs: UiSessionPrefs,
    pub ui_prefs_revision: u64,
    pub workspace_folder: Option<PathBuf>,
    workspace_change_revision: u64,
    additional_asset_roots: HashSet<PathBuf>,
    pending_pdf_exports: HashMap<u64, (PathBuf, Instant)>,
    next_pdf_token: u64,
}

impl AppStateInner {
    #[cfg(test)]
    fn begin_workspace_change(&mut self) -> u64 {
        self.workspace_change_revision += 1;
        self.workspace_change_revision
    }

    #[cfg(test)]
    fn finish_workspace_change(&mut self, revision: u64, folder: PathBuf) -> bool {
        if revision != self.workspace_change_revision {
            return false;
        }
        self.workspace_folder = Some(folder);
        true
    }

    fn finish_workspace_change_seq(&mut self, revision: u64, latest_seq: u64, folder: PathBuf) -> bool {
        if revision != latest_seq || revision <= self.workspace_change_revision {
            return false;
        }
        self.workspace_change_revision = revision;
        self.workspace_folder = Some(folder);
        true
    }

    fn insert_pdf_export(&mut self, path: PathBuf) -> u64 {
        let now = Instant::now();
        self.pending_pdf_exports
            .retain(|_, (_, created)| now.saturating_duration_since(*created) < PDF_TOKEN_TTL);
        while self.pending_pdf_exports.len() >= MAX_PENDING_PDF_EXPORTS {
            if let Some(oldest_token) = self
                .pending_pdf_exports
                .iter()
                .min_by_key(|(_, (_, created))| *created)
                .map(|(token, _)| *token)
            {
                self.pending_pdf_exports.remove(&oldest_token);
            } else {
                break;
            }
        }
        let token = self.next_pdf_token;
        self.next_pdf_token = self.next_pdf_token.wrapping_add(1);
        self.pending_pdf_exports.insert(token, (path, now));
        token
    }

    fn take_pdf_export(&mut self, token: u64) -> Option<PathBuf> {
        let now = Instant::now();
        self.pending_pdf_exports
            .remove(&token)
            .filter(|(_, created)| now.saturating_duration_since(*created) < PDF_TOKEN_TTL)
            .map(|(path, _)| path)
    }

    fn is_local_asset_allowed(&self, path: &Path) -> bool {
        self.workspace_folder
            .iter()
            .chain(&self.additional_asset_roots)
            .any(|root| path.starts_with(root))
    }
}

#[derive(Clone)]
pub struct AppState {
    pub inner: Arc<Mutex<AppStateInner>>,
    pub proxy: EventLoopProxy<UserEvent>,
    pub drafts: Arc<Mutex<Option<DraftStore>>>,
    watcher: Arc<Mutex<WatcherManager>>,
    frontend_ready: Arc<AtomicBool>,
    workspace_revision_seq: Arc<AtomicU64>,
}

impl AppState {
    pub fn new(
        initial_files: Vec<PathBuf>,
        initial_folder: Option<PathBuf>,
        ui_prefs: UiSessionPrefs,
        proxy: EventLoopProxy<UserEvent>,
    ) -> Self {
        let mut additional_asset_roots = HashSet::new();
        let initial_folder = initial_folder.as_deref().map(normalize_existing_path);

        for file in &initial_files {
            if let Some(parent) = file.parent() {
                additional_asset_roots.insert(normalize_existing_path(parent));
            }
        }
        for session_file in &ui_prefs.session_files {
            if let Some(parent) = Path::new(session_file).parent() {
                additional_asset_roots.insert(normalize_existing_path(parent));
            }
        }
        let pasted_assets_dir = crate::fs_ops::app_data_dir().join("pasted-assets");
        additional_asset_roots.insert(normalize_existing_path(&pasted_assets_dir));

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
                additional_asset_roots.insert(normalize_existing_path(Path::new(parent)));
            }
        }

        let startup = StartupPayload {
            initial_files: initial_files
                .iter()
                .map(|p| normalize_existing_path(p).to_string_lossy().into_owned())
                .collect(),
            initial_folder: initial_folder
                .as_ref()
                .map(|p| p.to_string_lossy().into_owned()),
            recovered_drafts,
            ui_prefs: ui_prefs.clone(),
        };

        let inner = Arc::new(Mutex::new(AppStateInner {
            startup,
            ui_prefs,
            ui_prefs_revision: 0,
            workspace_folder: initial_folder.clone(),
            workspace_change_revision: 0,
            additional_asset_roots,
            pending_pdf_exports: HashMap::new(),
            next_pdf_token: 1,
        }));

        let watcher_mgr = Arc::new(Mutex::new(WatcherManager {
            workspace_folder: initial_folder.clone(),
            ..WatcherManager::default()
        }));

        let watcher_proxy = proxy.clone();
        let watcher_state = Arc::clone(&watcher_mgr);
        let watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    if event.kind.is_modify() || event.kind.is_create() || event.kind.is_remove() {
                        let watched_roots: Vec<PathBuf> = watcher_state
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
                        let paths = event
                            .paths
                            .iter()
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

        if let Ok(mut guard) = watcher_mgr.lock() {
            guard.watcher = watcher;
        }

        let state = Self {
            inner,
            proxy,
            drafts: Arc::new(Mutex::new(drafts)),
            watcher: watcher_mgr,
            frontend_ready: Arc::new(AtomicBool::new(false)),
            workspace_revision_seq: Arc::new(AtomicU64::new(0)),
        };

        if let Some(ref folder) = initial_folder {
            state.watch_path(folder, true);
        }
        for file in &initial_files {
            state.watch_path(file, false);
        }

        state
    }

    pub fn mark_frontend_ready(&self) {
        self.frontend_ready.store(true, Ordering::SeqCst);
    }

    pub fn is_frontend_ready(&self) -> bool {
        self.frontend_ready.load(Ordering::SeqCst)
    }

    pub fn insert_pdf_export(&self, path: PathBuf) -> Result<u64, String> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "Interner Status für PDF-Export gesperrt.".to_string())?;
        Ok(guard.insert_pdf_export(path))
    }

    pub fn take_pdf_export(&self, token: u64) -> Option<PathBuf> {
        self.inner
            .lock()
            .ok()
            .and_then(|mut g| g.take_pdf_export(token))
    }

    pub fn allow_file_parent(&self, file_path: &Path) {
        let norm = normalize_existing_path(file_path);
        if let Some(parent) = norm.parent() {
            let parent_norm = normalize_existing_path(parent);
            if let Ok(mut guard) = self.inner.lock() {
                guard.additional_asset_roots.insert(parent_norm);
            }
        }
        self.watch_path(&norm, false);
    }

    pub fn set_workspace_folder(&self, folder_path: &Path) {
        if let Some(revision) = self.begin_workspace_change() {
            self.finish_workspace_change(revision, folder_path);
        }
    }

    pub fn begin_workspace_change(&self) -> Option<u64> {
        Some(self.workspace_revision_seq.fetch_add(1, Ordering::SeqCst) + 1)
    }

    pub fn finish_workspace_change(&self, revision: u64, folder_path: &Path) -> bool {
        if revision != self.workspace_revision_seq.load(Ordering::SeqCst) {
            return false;
        }
        let norm = normalize_existing_path(folder_path);
        let latest_seq = self.workspace_revision_seq.load(Ordering::SeqCst);
        let accepted = self.inner.lock().ok().is_some_and(|mut guard| {
            guard.finish_workspace_change_seq(revision, latest_seq, norm.clone())
        });
        if accepted && norm.exists() {
            if let Ok(mut watcher_guard) = self.watcher.lock() {
                watcher_guard.apply_workspace_change(revision, norm);
            }
        }
        accepted
    }

    /// Registers an auxiliary root (such as the persistent AI Library) for asset
    /// access and filesystem watching without overwriting the user's active workfolder.
    pub fn allow_and_watch_root(&self, root_path: &Path) {
        let norm = normalize_existing_path(root_path);
        if let Ok(mut guard) = self.inner.lock() {
            guard.additional_asset_roots.insert(norm.clone());
        }
        self.watch_path(&norm, true);
    }

    pub fn watch_path(&self, path: &Path, recursive: bool) {
        let norm = normalize_existing_path(path);
        if !norm.exists() {
            return;
        }
        if let Ok(mut guard) = self.watcher.lock() {
            guard.watch_path(norm, recursive);
        }
    }

    pub fn is_local_asset_allowed(&self, candidate: &Path) -> bool {
        let norm = normalize_existing_path(candidate);
        let Ok(guard) = self.inner.lock() else {
            return false;
        };
        guard.is_local_asset_allowed(&norm)
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

    fn state_for_workspace(workspace: &str, additional_roots: &[&str]) -> AppStateInner {
        AppStateInner {
            startup: StartupPayload {
                initial_files: Vec::new(),
                initial_folder: Some(workspace.into()),
                recovered_drafts: Vec::new(),
                ui_prefs: UiSessionPrefs::default(),
            },
            ui_prefs: UiSessionPrefs::default(),
            ui_prefs_revision: 0,
            workspace_folder: Some(PathBuf::from(workspace)),
            workspace_change_revision: 0,
            additional_asset_roots: additional_roots.iter().map(PathBuf::from).collect(),
            pending_pdf_exports: HashMap::new(),
            next_pdf_token: 1,
        }
    }

    #[test]
    fn workspace_switch_revokes_only_the_workspace_asset_grant() {
        let mut state = state_for_workspace(r"C:\old", &[r"C:\old\document", r"C:\ai-library"]);
        let old_asset = Path::new(r"C:\old\images\cover.png");
        let new_asset = Path::new(r"C:\new\images\cover.png");
        assert!(state.is_local_asset_allowed(old_asset));
        assert!(!state.is_local_asset_allowed(new_asset));

        let revision = state.begin_workspace_change();
        assert!(state.finish_workspace_change(revision, PathBuf::from(r"C:\new")));

        assert!(!state.is_local_asset_allowed(old_asset));
        assert!(state.is_local_asset_allowed(new_asset));
        assert!(state.is_local_asset_allowed(Path::new(r"C:\old\document\image.png")));
        assert!(state.is_local_asset_allowed(Path::new(r"C:\ai-library\image.png")));
        assert!(!state.is_local_asset_allowed(Path::new(r"C:\new-other\image.png")));
    }

    #[test]
    fn late_workspace_selection_cannot_restore_an_old_asset_grant() {
        let mut state = state_for_workspace(r"C:\old", &[]);
        let pending = state.begin_workspace_change();
        let latest = state.begin_workspace_change();

        assert!(state.finish_workspace_change(latest, PathBuf::from(r"C:\new")));
        assert!(!state.finish_workspace_change(pending, PathBuf::from(r"C:\old")));
        assert!(!state.is_local_asset_allowed(Path::new(r"C:\old\image.png")));
        assert!(state.is_local_asset_allowed(Path::new(r"C:\new\image.png")));
    }

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

    #[test]
    fn pending_pdf_exports_prune_expired_and_cap_total_entries() {
        let mut state = state_for_workspace(r"C:\repo", &[]);
        state.pending_pdf_exports.insert(
            999,
            (
                PathBuf::from(r"C:\repo\expired.pdf"),
                Instant::now() - PDF_TOKEN_TTL - Duration::from_secs(5),
            ),
        );

        let mut tokens = Vec::new();
        for idx in 0..(MAX_PENDING_PDF_EXPORTS + 4) {
            tokens.push(state.insert_pdf_export(PathBuf::from(format!(r"C:\repo\doc-{idx}.pdf"))));
        }

        assert!(state.take_pdf_export(999).is_none());
        assert_eq!(state.pending_pdf_exports.len(), MAX_PENDING_PDF_EXPORTS);
        assert!(state.take_pdf_export(tokens[0]).is_none());
        assert_eq!(
            state.take_pdf_export(*tokens.last().unwrap()),
            Some(PathBuf::from(format!(r"C:\repo\doc-{}.pdf", MAX_PENDING_PDF_EXPORTS + 3)))
        );
    }
}
