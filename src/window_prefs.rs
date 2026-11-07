use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPrefs {
    pub width: f64,
    pub height: f64,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub maximized: bool,
    pub last_workspace_folder: Option<String>,
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
        }
    }
}

fn prefs_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("MarkLive")
        .join("window_prefs.json")
}

pub fn load_window_prefs() -> WindowPrefs {
    let path = prefs_path();
    let Ok(bytes) = fs::read(path) else {
        return WindowPrefs::default();
    };
    serde_json::from_slice::<WindowPrefs>(&bytes).unwrap_or_default()
}

pub fn save_window_prefs(prefs: &WindowPrefs) {
    let path = prefs_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(bytes) = serde_json::to_vec_pretty(prefs) {
        let _ = fs::write(path, bytes);
    }
}
