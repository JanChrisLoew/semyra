use super::normalize_existing_path;
use base64::Engine;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static ASSET_SEQ: AtomicU64 = AtomicU64::new(0);

fn current_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn create_unique_asset_file(
    dir: &Path,
    stem: &str,
    ext: &str,
    try_plain_first: bool,
) -> io::Result<(PathBuf, fs::File)> {
    if try_plain_first {
        let plain_name = if ext.is_empty() {
            stem.to_string()
        } else {
            format!("{stem}.{ext}")
        };
        let plain_path = dir.join(plain_name);
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&plain_path)
        {
            Ok(file) => return Ok((plain_path, file)),
            Err(err) if err.kind() == io::ErrorKind::AlreadyExists => {}
            Err(err) => return Err(err),
        }
    }

    let millis = current_millis();
    for _ in 0..64 {
        let seq = ASSET_SEQ.fetch_add(1, Ordering::Relaxed);
        let name = if ext.is_empty() {
            format!("{stem}-{millis}-{seq}")
        } else {
            format!("{stem}-{millis}-{seq}.{ext}")
        };
        let candidate = dir.join(name);
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => return Ok((candidate, file)),
            Err(err) if err.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(err),
        }
    }

    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "Eindeutiger Asset-Dateiname konnte nicht erzeugt werden.",
    ))
}

fn format_markdown_image(alt: &str, dest: &str) -> String {
    let mut safe_alt = String::with_capacity(alt.len());
    for ch in alt.chars() {
        match ch {
            '[' | ']' => {
                safe_alt.push('\\');
                safe_alt.push(ch);
            }
            '\r' | '\n' => safe_alt.push(' '),
            _ => safe_alt.push(ch),
        }
    }
    let mut safe_dest = String::with_capacity(dest.len());
    for ch in dest.chars() {
        match ch {
            ' ' => safe_dest.push_str("%20"),
            '#' => safe_dest.push_str("%23"),
            '?' => safe_dest.push_str("%3F"),
            '(' => safe_dest.push_str("%28"),
            ')' => safe_dest.push_str("%29"),
            '[' => safe_dest.push_str("%5B"),
            ']' => safe_dest.push_str("%5D"),
            '<' => safe_dest.push_str("%3C"),
            '>' => safe_dest.push_str("%3E"),
            _ => safe_dest.push(ch),
        }
    }
    format!("![{safe_alt}]({safe_dest})")
}

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

    let (assets_dir, use_relative) = if let Some(doc_dir) = base_dir.filter(|d| d.is_dir()) {
        (doc_dir.join("assets"), true)
    } else {
        let fallback = super::app_data_dir().join("pasted-assets");
        (fallback, false)
    };

    fs::create_dir_all(&assets_dir)
        .map_err(|e| format!("Asset-Ordner konnte nicht erstellt werden: {e}"))?;

    let (saved_file, mut file) = create_unique_asset_file(&assets_dir, "img", ext, false)
        .map_err(|e| format!("Bild konnte nicht gespeichert werden: {e}"))?;
    if let Err(e) = file.write_all(&bytes) {
        drop(file);
        let _ = fs::remove_file(&saved_file);
        return Err(format!("Bild konnte nicht gespeichert werden: {e}"));
    }

    let norm_file = normalize_existing_path(&saved_file);
    let filename = norm_file
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("img.png");
    let md_snippet = if use_relative {
        format_markdown_image("Screenshot", &format!("assets/{filename}"))
    } else {
        let forward_path = norm_file.to_string_lossy().replace('\\', "/");
        format_markdown_image("Screenshot", &format!("file:///{forward_path}"))
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
            return Ok((norm_src, format_markdown_image(&alt_raw, &rel_fwd)));
        }

        let assets_dir = norm_doc_dir.join("assets");
        fs::create_dir_all(&assets_dir)
            .map_err(|e| format!("Asset-Ordner konnte nicht erstellt werden: {e}"))?;
        let stem = norm_src
            .file_stem()
            .and_then(|s| s.to_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("bild");
        let ext = norm_src
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("png");
        let (dest, mut dst_file) = create_unique_asset_file(&assets_dir, stem, ext, true)
            .map_err(|e| format!("Bild konnte nicht kopiert werden: {e}"))?;
        let copy_res = fs::File::open(&norm_src).and_then(|mut src_file| io::copy(&mut src_file, &mut dst_file));
        if let Err(e) = copy_res {
            drop(dst_file);
            let _ = fs::remove_file(&dest);
            return Err(format!("Bild konnte nicht kopiert werden: {e}"));
        }
        let norm_dest = normalize_existing_path(&dest);
        let final_name = norm_dest
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("bild.png");
        return Ok((
            norm_dest.clone(),
            format_markdown_image(&alt_raw, &format!("assets/{final_name}")),
        ));
    }

    let forward_path = norm_src.to_string_lossy().replace('\\', "/");
    Ok((
        norm_src.clone(),
        format_markdown_image(&alt_raw, &format!("file:///{forward_path}")),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fs_ops::{list_workspace_markdown_files, search_workspace_files, write_text_file};

    #[test]
    fn searches_markdown_files_and_saves_clipboard_png() {
        let tmp = std::env::temp_dir().join(format!("semyra_test_{}", std::process::id()));
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

        // Rapid pastes produce unique files without overwriting
        let (img2, _) = save_clipboard_image(Some(&tmp), "image/png", tiny_png).unwrap();
        let (img3, _) = save_clipboard_image(Some(&tmp), "image/png", tiny_png).unwrap();
        assert_ne!(img2, img3);

        // Filenames with spaces, parentheses, and brackets escape cleanly in Markdown snippets
        let outside_tmp = std::env::temp_dir().join(format!("semyra_outside_{}", std::process::id()));
        let _ = fs::remove_dir_all(&outside_tmp);
        fs::create_dir_all(&outside_tmp).unwrap();
        let special_src = outside_tmp.join("Foto (1) [Entwurf].png");
        fs::write(&special_src, b"png").unwrap();
        let (_, special_snippet) = import_dropped_image(Some(&tmp), &special_src).unwrap();
        assert_eq!(
            special_snippet,
            "![Foto (1) \\[Entwurf\\]](assets/Foto%20%281%29%20%5BEntwurf%5D.png)"
        );

        let hash_src = outside_tmp.join("foto #1.png");
        fs::write(&hash_src, b"png").unwrap();
        let (_, hash_snippet) = import_dropped_image(Some(&tmp), &hash_src).unwrap();
        assert_eq!(hash_snippet, "![foto #1](assets/foto%20%231.png)");
        assert_eq!(
            format_markdown_image("foto #1?v=2", "assets/foto #1?v=2.png"),
            "![foto #1?v=2](assets/foto%20%231%3Fv=2.png)"
        );

        let _ = fs::remove_dir_all(&outside_tmp);
        let _ = fs::remove_dir_all(&tmp);
    }
}
