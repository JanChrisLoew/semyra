use super::normalize_existing_path;
use base64::Engine;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn save_clipboard_image(
    base_dir: Option<&Path>,
    mime_type: &str,
    data_base64: &str,
) -> Result<(PathBuf, String), String> {
    let payload = data_base64
        .split_once(',')
        .map(|(_, b64)| b64)
        .unwrap_or(data_base64);

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload.trim())
        .map_err(|e| format!("Ungültige Bilddaten aus Zwischenablage: {e}"))?;

    if bytes.is_empty() {
        return Err("Zwischenablage-Bild ist leer.".to_string());
    }

    let ext = match mime_type.to_ascii_lowercase().as_str() {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "png",
    };

    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let filename = format!("img-{millis}.{ext}");

    let (assets_dir, use_relative) = if let Some(doc_dir) = base_dir.filter(|d| d.is_dir()) {
        (doc_dir.join("assets"), true)
    } else {
        let fallback = dirs::data_local_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("MarkLive")
            .join("pasted-assets");
        (fallback, false)
    };

    fs::create_dir_all(&assets_dir)
        .map_err(|e| format!("Asset-Ordner konnte nicht erstellt werden: {e}"))?;

    let saved_file = assets_dir.join(&filename);
    fs::write(&saved_file, &bytes)
        .map_err(|e| format!("Bild konnte nicht gespeichert werden: {e}"))?;

    let norm_file = normalize_existing_path(&saved_file);
    let md_snippet = if use_relative {
        format!("![Screenshot](assets/{filename})")
    } else {
        let forward_path = norm_file.to_string_lossy().replace('\\', "/");
        format!("![Screenshot](file:///{forward_path})")
    };

    Ok((norm_file, md_snippet))
}

/// Imports or references a dragged-and-dropped image file and returns `(resolved_file_path, markdown_snippet)`.
pub fn import_dropped_image(
    base_dir: Option<&Path>,
    source_image: &Path,
) -> Result<(PathBuf, String), String> {
    let norm_src = normalize_existing_path(source_image);
    if !norm_src.is_file() {
        return Err("Abgelegte Bilddatei existiert nicht.".to_string());
    }
    let alt_raw = norm_src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Bild")
        .replace('_', "-");

    if let Some(doc_dir) = base_dir.filter(|d| d.is_dir()) {
        let norm_doc_dir = normalize_existing_path(doc_dir);
        if let Ok(rel) = norm_src.strip_prefix(&norm_doc_dir) {
            let rel_fwd = rel.to_string_lossy().replace('\\', "/");
            return Ok((norm_src, format!("![{alt_raw}]({rel_fwd})")));
        }

        let assets_dir = norm_doc_dir.join("assets");
        fs::create_dir_all(&assets_dir)
            .map_err(|e| format!("Asset-Ordner konnte nicht erstellt werden: {e}"))?;
        let orig_name = norm_src
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("bild.png");
        let mut dest = assets_dir.join(orig_name);
        if dest.exists() {
            let ext = norm_src
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("png");
            let millis = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0);
            dest = assets_dir.join(format!("{alt_raw}-{millis}.{ext}"));
        }
        fs::copy(&norm_src, &dest)
            .map_err(|e| format!("Bild konnte nicht kopiert werden: {e}"))?;
        let final_name = dest
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(orig_name);
        let norm_dest = normalize_existing_path(&dest);
        return Ok((norm_dest, format!("![{alt_raw}](assets/{final_name})")));
    }

    let forward_path = norm_src.to_string_lossy().replace('\\', "/");
    Ok((norm_src, format!("![{alt_raw}](file:///{forward_path})")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fs_ops::{list_workspace_markdown_files, search_workspace_files, write_text_file};

    #[test]
    fn searches_markdown_files_and_saves_clipboard_png() {
        let tmp = std::env::temp_dir().join(format!("marklive_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).unwrap();

        let md_file = tmp.join("notiz.md");
        write_text_file(&md_file, "# Architektur\nRust und Windows 11 rocken!\n", true).unwrap();

        let hits = search_workspace_files(&tmp, "windows 11", false).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].matches[0].line, 2);

        let all_files = list_workspace_markdown_files(&tmp).unwrap();
        assert_eq!(all_files.len(), 1);
        assert_eq!(all_files[0].rel_path, "notiz.md");

        let tiny_png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
        let (saved_img, snippet) = save_clipboard_image(Some(&tmp), "image/png", tiny_png).unwrap();
        assert!(saved_img.exists());
        assert!(snippet.starts_with("![Screenshot](assets/img-"));

        let (_, rel_snippet) = import_dropped_image(Some(&tmp), &saved_img).unwrap();
        assert!(rel_snippet.contains("(assets/img-"));

        let _ = fs::remove_dir_all(&tmp);
    }
}
