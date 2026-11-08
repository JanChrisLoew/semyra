use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

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
    let path = prefs_path();
    let Ok(bytes) = fs::read(path) else {
        return WindowPrefs::default();
    };
    let mut prefs: WindowPrefs = serde_json::from_slice(&bytes).unwrap_or_default();
    prefs.ui.split_ratio = prefs.ui.split_ratio.clamp(20.0, 80.0);
    prefs.ui.zoom_percent = prefs.ui.zoom_percent.clamp(75, 175);
    prefs.ui.recent_files.retain(|p| PathBuf::from(p).is_file());
    prefs.ui.recent_files.truncate(12);
    prefs.ui.recent_folders.retain(|p| PathBuf::from(p).is_dir());
    prefs.ui.recent_folders.truncate(8);
    prefs.ui.session_files.retain(|p| PathBuf::from(p).is_file());
    prefs
}

pub fn save_window_prefs(prefs: &WindowPrefs) {
    let path = prefs_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let Ok(bytes) = serde_json::to_vec_pretty(prefs) else {
        return;
    };
    let tmp = path.with_extension("json.tmp");
    if fs::write(&tmp, &bytes).is_ok() {
        if fs::rename(&tmp, &path).is_err() {
            let _ = fs::write(&path, &bytes);
            let _ = fs::remove_file(&tmp);
        }
    } else {
        let _ = fs::write(&path, &bytes);
    }
}
