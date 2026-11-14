use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

fn default_true() -> bool {
    true
}

fn default_split_ratio() -> f64 {
    50.0
}

fn default_split_orientation() -> String {
    "vertical".to_string()
}

fn default_zoom_percent() -> u16 {
    100
}

fn default_language() -> String {
    "de".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiSessionPrefs {
    #[serde(default = "default_split_ratio")]
    pub split_ratio: f64,
    #[serde(default = "default_split_orientation")]
    pub split_orientation: String,
    #[serde(default = "default_zoom_percent")]
    pub zoom_percent: u16,
    #[serde(default = "default_true")]
    pub sync_scroll: bool,
    #[serde(default)]
    pub auto_save: bool,
    #[serde(default = "default_true")]
    pub word_wrap: bool,
    #[serde(default)]
    pub spellcheck: bool,
    #[serde(default = "default_true")]
    pub format_bar_visible: bool,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default)]
    pub recent_files: Vec<String>,
    #[serde(default)]
    pub recent_folders: Vec<String>,
    #[serde(default)]
    pub session_files: Vec<String>,
    #[serde(default)]
    pub pinned_session_files: Vec<String>,
    #[serde(default)]
    pub active_session_file: Option<String>,
}

impl Default for UiSessionPrefs {
    fn default() -> Self {
        Self {
            split_ratio: default_split_ratio(),
            split_orientation: default_split_orientation(),
            zoom_percent: default_zoom_percent(),
            sync_scroll: true,
            auto_save: false,
            word_wrap: true,
            spellcheck: false,
            format_bar_visible: true,
            language: default_language(),
            recent_files: Vec::new(),
            recent_folders: Vec::new(),
            session_files: Vec::new(),
            pinned_session_files: Vec::new(),
            active_session_file: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPrefs {
    pub width: f64,
    pub height: f64,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub maximized: bool,
    pub last_workspace_folder: Option<String>,
    #[serde(default)]
    pub ui: UiSessionPrefs,
}

impl Default for WindowPrefs {
    fn default() -> Self {
        Self {
            width: 1360.0,
            height: 860.0,
            x: None,
            y: None,
            maximized: false,
            last_workspace_folder: None,
            ui: UiSessionPrefs::default(),
        }
    }
}

fn prefs_path() -> PathBuf {
    crate::fs_ops::app_data_dir().join("window_prefs.json")
}

pub fn load_window_prefs() -> WindowPrefs {
    let Ok(mut prefs) = read_prefs(&prefs_path()) else {
        return WindowPrefs::default();
    };
    prefs.ui.split_ratio = prefs.ui.split_ratio.clamp(20.0, 80.0);
    prefs.ui.zoom_percent = prefs.ui.zoom_percent.clamp(75, 175);
    prefs.ui.recent_files.retain(|p| PathBuf::from(p).is_file());
    prefs.ui.recent_files.truncate(12);
    prefs.ui.recent_folders.retain(|p| PathBuf::from(p).is_dir());
    prefs.ui.recent_folders.truncate(8);
    prefs.ui.session_files.retain(|p| PathBuf::from(p).is_file());
    prefs
}

fn read_prefs(path: &Path) -> std::io::Result<WindowPrefs> {
    match fs::read(path) {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes).unwrap_or_default()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(WindowPrefs::default()),
        Err(err) => Err(err),
    }
}

pub fn update_window_prefs(
    update: impl FnOnce(&mut WindowPrefs) -> std::io::Result<bool>,
) -> std::io::Result<()> {
    update_prefs_file(&prefs_path(), update)
}

fn update_prefs_file(
    path: &Path,
    update: impl FnOnce(&mut WindowPrefs) -> std::io::Result<bool>,
) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path.with_extension("lock"))?;
    lock.lock()?;
    let mut prefs = read_prefs(path)?;
    if !update(&mut prefs)? {
        return Ok(());
    }
    let bytes = serde_json::to_vec_pretty(&prefs)?;
    crate::fs_ops::encoding::write_file_atomically(path, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concurrent_updates_preserve_ui_and_window_geometry() {
        let dir = std::env::temp_dir().join(format!("semyra-prefs-test-{}", std::process::id()));
        let path = dir.join("window_prefs.json");
        let worker_path = path.clone();
        let worker = std::thread::spawn(move || {
            update_prefs_file(&worker_path, |prefs| {
                prefs.ui.auto_save = true;
                Ok(true)
            })
        });
        update_prefs_file(&path, |prefs| {
            prefs.width = 1120.0;
            prefs.x = Some(32);
            Ok(true)
        })
        .unwrap();
        worker.join().unwrap().unwrap();

        let prefs = read_prefs(&path).unwrap();
        assert_eq!(prefs.width, 1120.0);
        assert_eq!(prefs.x, Some(32));
        assert!(prefs.ui.auto_save);
        fs::remove_dir_all(dir).unwrap();
    }
}
