use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftEntry {
    pub name: String,
    pub path: Option<String>,
    pub parent_dir: Option<String>,
    pub content: String,
    pub saved_content: String,
    pub line_ending: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftSnapshot {
    pub entries: Vec<DraftEntry>,
}

fn recovery_file_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("MarkLive")
        .join("drafts")
        .join("recovery.json")
}

pub fn load_recovery_snapshot() -> Vec<DraftEntry> {
    let path = recovery_file_path();
    let Ok(bytes) = fs::read(&path) else {
        return Vec::new();
    };
    serde_json::from_slice::<DraftSnapshot>(&bytes)
        .map(|s| s.entries)
        .unwrap_or_default()
}

pub fn save_recovery_snapshot(entries: Vec<DraftEntry>) -> Result<(), String> {
    let path = recovery_file_path();
    if entries.is_empty() {
        let _ = fs::remove_file(&path);
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Entwurfsordner konnte nicht angelegt werden: {e}"))?;
    }
    let tmp_path = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(&DraftSnapshot { entries })
        .map_err(|e| format!("Serialisierungsfehler: {e}"))?;
    fs::write(&tmp_path, bytes)
        .map_err(|e| format!("Entwurf konnte nicht geschrieben werden: {e}"))?;
    fs::rename(&tmp_path, &path)
        .or_else(|_| {
            let res = fs::copy(&tmp_path, &path).map(|_| ());
            let _ = fs::remove_file(&tmp_path);
            res
        })
        .map_err(|e| format!("Entwurf konnte nicht aktualisiert werden: {e}"))
}

pub fn clear_recovery_snapshot() {
    let _ = fs::remove_file(recovery_file_path());
}
