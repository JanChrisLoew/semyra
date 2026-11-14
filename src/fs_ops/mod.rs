pub mod assets;
pub mod encoding;
pub mod html_export;
pub mod search;
pub mod workspace;

pub use assets::{import_dropped_image, save_clipboard_image};
pub use encoding::{read_text_file, write_text_file};
pub use html_export::{build_standalone_html_document, inline_local_asset_images};
#[cfg(test)]
pub use search::search_workspace_files;
pub use search::{replace_in_workspace_with_options, search_workspace_with_options};
pub use workspace::{
    build_directory_tree, create_ai_skill, create_new_folder, create_new_markdown_file,
    ensure_ai_library_tree, list_workspace_markdown_files, move_to_recycle_bin, rename_fs_entry,
};

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub(crate) const IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    ".vs",
    ".idea",
    "dist",
    "build",
    "__pycache__",
    ".next",
];

pub(crate) const ALLOWED_DOT_DIRS: &[&str] = &[".github", ".agents"];

pub(crate) const ALLOWED_DOT_FILES: &[&str] = &[
    ".cursorrules",
    ".gitignore",
    ".gitattributes",
    ".editorconfig",
    ".prettierignore",
];

/// Returns `true` if `name` is either not a dot-entry or is in the unified allowlist
/// (`.github`, `.agents`, `.cursorrules`, `.env*`, `.gitignore`, `.gitattributes`, `.editorconfig`, `.prettierignore`).
pub(crate) fn is_allowed_dot_entry(name: &str) -> bool {
    if !name.starts_with('.') {
        return true;
    }
    let lower = name.to_ascii_lowercase();
    lower.starts_with(".env")
        || ALLOWED_DOT_DIRS.contains(&lower.as_str())
        || ALLOWED_DOT_FILES.contains(&lower.as_str())
}

/// Strips the `\\?\` verbatim prefix produced by `fs::canonicalize` on Windows.
pub fn clean_windows_path(path: &Path) -> PathBuf {
    let raw = path.to_string_lossy();
    if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{stripped}"))
    } else if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path.to_path_buf()
    }
}

pub fn normalize_existing_path(path: &Path) -> PathBuf {
    match fs::canonicalize(path) {
        Ok(canon) => clean_windows_path(&canon),
        Err(_) => clean_windows_path(path),
    }
}

/// Returns the local application data directory (`%LOCALAPPDATA%\Semyra`).
pub fn app_data_dir() -> PathBuf {
    let base = dirs::data_local_dir().unwrap_or_else(std::env::temp_dir);
    base.join("Semyra")
}

pub fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "mdown" | "mkd" | "mdx" | "txt"
            )
        })
        .unwrap_or(false)
}

pub fn is_supported_text_path(path: &Path) -> bool {
    if is_markdown_path(path) {
        return true;
    }
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    if file_name.starts_with(".env")
        || ALLOWED_DOT_FILES.contains(&file_name.as_str())
        || file_name == "dockerfile"
        || file_name == "license"
    {
        return true;
    }
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "json"
                    | "yaml"
                    | "yml"
                    | "toml"
                    | "ini"
                    | "env"
                    | "csv"
                    | "tsv"
                    | "log"
                    | "xml"
            )
        })
        .unwrap_or(false)
}

pub fn is_image_path(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp"
            )
        })
        .unwrap_or(false)
}

pub fn reveal_in_explorer(target_path: &Path) -> Result<(), String> {
    let norm = normalize_existing_path(target_path);
    if !norm.exists() {
        return Err("Pfad existiert nicht auf der Festplatte.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        if norm.is_file() {
            Command::new("explorer.exe")
                .arg(format!("/select,{}", norm.display()))
                .spawn()
                .map_err(|e| format!("Explorer konnte nicht gestartet werden: {e}"))?;
        } else {
            Command::new("explorer.exe")
                .arg(norm.as_os_str())
                .spawn()
                .map_err(|e| format!("Explorer konnte nicht gestartet werden: {e}"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleans_windows_extended_length_prefixes() {
        assert_eq!(
            clean_windows_path(Path::new(r"\\?\C:\Projekte\Notiz.md")),
            PathBuf::from(r"C:\Projekte\Notiz.md")
        );
        assert_eq!(
            clean_windows_path(Path::new(r"\\?\UNC\Server\Freigabe\Notiz.md")),
            PathBuf::from(r"\\Server\Freigabe\Notiz.md")
        );
    }
}
