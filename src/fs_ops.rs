use base64::Engine;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatchItem {
    pub line: usize,
    pub column: usize,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFileResult {
    pub path: String,
    pub name: String,
    pub rel_path: String,
    pub matches: Vec<SearchMatchItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_markdown: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileTreeNode>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePayload {
    pub path: String,
    pub name: String,
    pub content: String,
    pub line_ending: String,
    pub parent_dir: Option<String>,
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

pub fn read_text_file(path: &Path) -> Result<FilePayload, String> {
    let norm = normalize_existing_path(path);
    let bytes = fs::read(&norm).map_err(|e| format!("Datei konnte nicht gelesen werden: {e}"))?;

    // Handle optional UTF-8 BOM gracefully
    let slice = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &bytes[3..]
    } else {
        &bytes[..]
    };

    let raw_text = String::from_utf8_lossy(slice).into_owned();
    let line_ending = if raw_text.contains("\r\n") {
        "CRLF".to_string()
    } else {
        "LF".to_string()
    };

    // Normalize to \n for CodeMirror editing while remembering original line ending
    let content = raw_text.replace("\r\n", "\n");
    let name = norm
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unbenannt.md")
        .to_string();
    let parent_dir = norm.parent().map(|p| p.to_string_lossy().into_owned());

    Ok(FilePayload {
        path: norm.to_string_lossy().into_owned(),
        name,
        content,
        line_ending,
        parent_dir,
    })
}

pub fn write_text_file(path: &Path, content: &str, prefer_crlf: bool) -> Result<String, String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Ordner konnte nicht erstellt werden: {e}"))?;
        }
    }

    let normalized = content.replace("\r\n", "\n");
    let final_bytes = if prefer_crlf {
        normalized.replace('\n', "\r\n")
    } else {
        normalized
    };

    fs::write(path, final_bytes.as_bytes())
        .map_err(|e| format!("Datei konnte nicht gespeichert werden: {e}"))?;

    let canon = normalize_existing_path(path);
    Ok(canon.to_string_lossy().into_owned())
}

const IGNORED_DIRS: &[&str] = &[
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

pub fn build_directory_tree(root: &Path, max_depth: usize) -> Result<FileTreeNode, String> {
    let norm_root = normalize_existing_path(root);
    if !norm_root.is_dir() {
        return Err("Der angegebene Pfad ist kein gültiger Ordner.".to_string());
    }
    let root_name = norm_root
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| norm_root.to_string_lossy().into_owned());

    let children = scan_dir_children(&norm_root, 0, max_depth, &mut 0);

    Ok(FileTreeNode {
        name: root_name,
        path: norm_root.to_string_lossy().into_owned(),
        is_dir: true,
        is_markdown: false,
        children: Some(children),
    })
}

fn scan_dir_children(
    dir: &Path,
    depth: usize,
    max_depth: usize,
    entry_budget: &mut usize,
) -> Vec<FileTreeNode> {
    const MAX_TOTAL_ENTRIES: usize = 2500;
    if depth >= max_depth || *entry_budget >= MAX_TOTAL_ENTRIES {
        return Vec::new();
    }

    let Ok(read_dir) = fs::read_dir(dir) else {
        return Vec::new();
    };

    let mut dirs = Vec::new();
    let mut files = Vec::new();

    for entry in read_dir.flatten() {
        if *entry_budget >= MAX_TOTAL_ENTRIES {
            break;
        }
        let path = entry.path();
        let Some(name_str) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name_str.starts_with('.') && name_str != ".github" {
            continue;
        }

        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        if file_type.is_dir() {
            if IGNORED_DIRS
                .iter()
                .any(|ignored| name_str.eq_ignore_ascii_case(ignored))
            {
                continue;
            }
            *entry_budget += 1;
            let sub = scan_dir_children(&path, depth + 1, max_depth, entry_budget);
            dirs.push(FileTreeNode {
                name: name_str.to_string(),
                path: clean_windows_path(&path).to_string_lossy().into_owned(),
                is_dir: true,
                is_markdown: false,
                children: Some(sub),
            });
        } else if file_type.is_file() {
            let is_md = is_markdown_path(&path);
            // Show Markdown/text files primarily, plus common doc/config files for context
            let show_file = is_md
                || path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|ext| {
                        matches!(
                            ext.to_ascii_lowercase().as_str(),
                            "json" | "toml" | "yaml" | "yml" | "png" | "jpg" | "jpeg" | "svg" | "webp"
                        )
                    })
                    .unwrap_or(false);
            if show_file {
                *entry_budget += 1;
                files.push(FileTreeNode {
                    name: name_str.to_string(),
                    path: clean_windows_path(&path).to_string_lossy().into_owned(),
                    is_dir: false,
                    is_markdown: is_md,
                    children: None,
                });
            }
        }
    }

    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    dirs.extend(files);
    dirs
}

pub fn create_new_markdown_file(parent_dir: &Path, file_name: &str) -> Result<FilePayload, String> {
    let trimmed = file_name.trim();
    if trimmed.is_empty() {
        return Err("Dateiname darf nicht leer sein.".to_string());
    }
    if trimmed.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
        return Err("Dateiname enthält ungültige Zeichen.".to_string());
    }
    let final_name = if Path::new(trimmed).extension().is_some() {
        trimmed.to_string()
    } else {
        format!("{trimmed}.md")
    };

    let full_path = parent_dir.join(&final_name);
    if full_path.exists() {
        return Err(format!("Die Datei '{final_name}' existiert bereits."));
    }

    let stem = Path::new(&final_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Neues Dokument");
    let initial = format!("# {stem}\n\n");
    write_text_file(&full_path, &initial, true)?;
    read_text_file(&full_path)
}

fn validate_entry_name(name: &str) -> Result<&str, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err("Name darf nicht leer sein.".to_string());
    }
    if trimmed.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
        return Err("Name enthält ungültige Zeichen.".to_string());
    }
    Ok(trimmed)
}

pub fn create_new_folder(parent_dir: &Path, folder_name: &str) -> Result<String, String> {
    let valid = validate_entry_name(folder_name)?;
    let full = parent_dir.join(valid);
    if full.exists() {
        return Err(format!("Der Ordner '{valid}' existiert bereits."));
    }
    fs::create_dir_all(&full)
        .map_err(|e| format!("Ordner konnte nicht erstellt werden: {e}"))?;
    Ok(normalize_existing_path(&full).to_string_lossy().into_owned())
}

pub fn rename_fs_entry(target_path: &Path, new_name: &str) -> Result<(String, String), String> {
    let valid = validate_entry_name(new_name)?;
    let norm = normalize_existing_path(target_path);
    let Some(parent) = norm.parent() else {
        return Err("Stammverzeichnis kann nicht umbenannt werden.".to_string());
    };
    let dest = parent.join(valid);
    if dest.exists() && normalize_existing_path(&dest) != norm {
        return Err(format!("'{valid}' existiert bereits im selben Ordner."));
    }
    fs::rename(&norm, &dest)
        .map_err(|e| format!("Umbenennen fehlgeschlagen: {e}"))?;
    let canon = normalize_existing_path(&dest);
    let final_name = canon
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(valid)
        .to_string();
    Ok((canon.to_string_lossy().into_owned(), final_name))
}

pub fn move_to_recycle_bin(target_path: &Path) -> Result<(), String> {
    let norm = normalize_existing_path(target_path);
    if !norm.exists() {
        return Err("Datei oder Ordner existiert nicht mehr.".to_string());
    }
    trash::delete(&norm)
        .map_err(|e| format!("Konnte nicht in den Papierkorb verschoben werden: {e}"))
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

pub fn search_workspace_files(
    root: &Path,
    query: &str,
    case_sensitive: bool,
) -> Result<Vec<SearchFileResult>, String> {
    let trimmed_q = query.trim();
    if trimmed_q.is_empty() {
        return Ok(Vec::new());
    }
    let norm_root = normalize_existing_path(root);
    if !norm_root.is_dir() {
        return Err("Ungültiger Arbeitsordner.".to_string());
    }

    let needle = if case_sensitive {
        trimmed_q.to_string()
    } else {
        trimmed_q.to_lowercase()
    };

    let mut results = Vec::new();
    let mut total_matches = 0usize;
    search_dir_recursive(
        &norm_root,
        &norm_root,
        &needle,
        case_sensitive,
        0,
        6,
        &mut total_matches,
        &mut results,
    );
    Ok(results)
}

#[allow(clippy::too_many_arguments)]
fn search_dir_recursive(
    root: &Path,
    dir: &Path,
    needle: &str,
    case_sensitive: bool,
    depth: usize,
    max_depth: usize,
    total_matches: &mut usize,
    results: &mut Vec<SearchFileResult>,
) {
    const MAX_TOTAL_MATCHES: usize = 300;
    const MAX_MATCHES_PER_FILE: usize = 40;
    if depth >= max_depth || *total_matches >= MAX_TOTAL_MATCHES {
        return;
    }

    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    let mut subdirs = Vec::new();
    let mut files = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name_str) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name_str.starts_with('.') {
            continue;
        }
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if ft.is_dir() {
            if !IGNORED_DIRS
                .iter()
                .any(|ig| name_str.eq_ignore_ascii_case(ig))
            {
                subdirs.push(path);
            }
        } else if ft.is_file() && is_markdown_path(&path) {
            files.push(path);
        }
    }

    subdirs.sort();
    files.sort();

    for file_path in files {
        if *total_matches >= MAX_TOTAL_MATCHES {
            break;
        }
        // Skip unusually large files (> 5 MB)
        if let Ok(meta) = fs::metadata(&file_path) {
            if meta.len() > 5 * 1024 * 1024 {
                continue;
            }
        }
        let Ok(bytes) = fs::read(&file_path) else {
            continue;
        };
        let Ok(content) = std::str::from_utf8(&bytes) else {
            continue;
        };

        let mut file_matches = Vec::new();
        for (idx, raw_line) in content.lines().enumerate() {
            let found_byte = if case_sensitive {
                raw_line.find(needle)
            } else {
                raw_line.to_lowercase().find(needle)
            };

            if let Some(byte_pos) = found_byte {
                let col = raw_line
                    .get(..byte_pos)
                    .map(|s| s.chars().count() + 1)
                    .unwrap_or(1);
                let trimmed_preview: String = raw_line.trim().chars().take(140).collect();
                file_matches.push(SearchMatchItem {
                    line: idx + 1,
                    column: col,
                    preview: trimmed_preview,
                });
                *total_matches += 1;
                if file_matches.len() >= MAX_MATCHES_PER_FILE || *total_matches >= MAX_TOTAL_MATCHES
                {
                    break;
                }
            }
        }

        if !file_matches.is_empty() {
            let norm = clean_windows_path(&file_path);
            let rel_path = norm
                .strip_prefix(root)
                .unwrap_or(&norm)
                .to_string_lossy()
                .into_owned();
            let name = norm
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Datei.md")
                .to_string();
            results.push(SearchFileResult {
                path: norm.to_string_lossy().into_owned(),
                name,
                rel_path,
                matches: file_matches,
            });
        }
    }

    for sub in subdirs {
        if *total_matches >= MAX_TOTAL_MATCHES {
            break;
        }
        search_dir_recursive(
            root,
            &sub,
            needle,
            case_sensitive,
            depth + 1,
            max_depth,
            total_matches,
            results,
        );
    }
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

pub fn build_standalone_html_document(title: &str, rendered_body_html: &str) -> String {
    let mut escaped_title = String::new();
    for ch in title.chars() {
        match ch {
            '&' => escaped_title.push_str("&amp;"),
            '<' => escaped_title.push_str("&lt;"),
            '>' => escaped_title.push_str("&gt;"),
            '"' => escaped_title.push_str("&quot;"),
            _ => escaped_title.push(ch),
        }
    }

    format!(
        r#"<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>{escaped_title}</title>
  <style>
    :root {{
      color-scheme: light dark;
      --bg: #ffffff;
      --fg: #1f2328;
      --muted: #59636e;
      --border: #d1d9e0;
      --surface: #f6f8fa;
      --accent: #0969da;
    }}
    @media (prefers-color-scheme: dark) {{
      :root {{
        --bg: #0d1117;
        --fg: #e6edf3;
        --muted: #8b949e;
        --border: #30363d;
        --surface: #161b22;
        --accent: #4493f8;
      }}
    }}
    body {{
      max-width: 860px;
      margin: 2.5rem auto;
      padding: 0 1.5rem;
      font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
      line-height: 1.68;
      background: var(--bg);
      color: var(--fg);
    }}
    h1, h2, h3, h4, h5, h6 {{ line-height: 1.3; margin-top: 1.6em; margin-bottom: 0.6em; }}
    h1, h2 {{ border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }}
    code, pre {{ font-family: "Cascadia Code", Consolas, monospace; font-size: 0.9em; }}
    code {{ background: var(--surface); padding: 0.15em 0.4em; border-radius: 5px; }}
    pre {{ background: var(--surface); padding: 1rem; border-radius: 8px; overflow-x: auto; border: 1px solid var(--border); }}
    pre code {{ background: none; padding: 0; }}
    .code-block-header {{ display: flex; justify-content: space-between; font-size: 0.78rem; color: var(--muted); margin-bottom: 0.35rem; }}
    .copy-code-btn {{ display: none; }}
    .hl-comment {{ color: #6e7781; font-style: italic; }}
    .hl-keyword, .hl-storage {{ color: #cf222e; font-weight: 500; }}
    .hl-string {{ color: #0a3069; }}
    .hl-constant, .hl-numeric {{ color: #0550ae; }}
    .hl-entity.hl-name.hl-function, .hl-support.hl-function {{ color: #8250df; }}
    .hl-entity.hl-name.hl-type, .hl-entity.hl-name.hl-class, .hl-entity.hl-name.hl-struct {{ color: #953800; }}
    @media (prefers-color-scheme: dark) {{
      .hl-comment {{ color: #8b949e; }}
      .hl-keyword, .hl-storage {{ color: #ff7b72; }}
      .hl-string {{ color: #a5d6ff; }}
      .hl-constant, .hl-numeric {{ color: #79c0ff; }}
      .hl-entity.hl-name.hl-function, .hl-support.hl-function {{ color: #d2a8ff; }}
      .hl-entity.hl-name.hl-type, .hl-entity.hl-name.hl-class, .hl-entity.hl-name.hl-struct {{ color: #ffa657; }}
    }}
    blockquote, .gfm-alert {{ margin: 1rem 0; padding: 0.75rem 1rem; border-left: 4px solid var(--accent); background: var(--surface); border-radius: 0 8px 8px 0; }}
    .gfm-alert-title {{ font-weight: 600; margin-bottom: 0.35rem; }}
    .gfm-alert-note {{ border-left-color: #2f81f7; }}
    .gfm-alert-tip {{ border-left-color: #2da44e; }}
    .gfm-alert-important {{ border-left-color: #8250df; }}
    .gfm-alert-warning {{ border-left-color: #d29922; }}
    .gfm-alert-caution {{ border-left-color: #cf222e; }}
    .frontmatter-card {{ margin-bottom: 1.2rem; padding: 0.6rem 0.9rem; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }}
    table {{ width: 100%; border-collapse: collapse; margin: 1rem 0; }}
    th, td {{ border: 1px solid var(--border); padding: 0.55rem 0.8rem; text-align: left; }}
    th {{ background: var(--surface); }}
    img {{ max-width: 100%; border-radius: 6px; }}
    a {{ color: var(--accent); }}
    hr {{ border: 0; border-top: 1px solid var(--border); margin: 2rem 0; }}
  </style>
</head>
<body>
{rendered_body_html}
</body>
</html>
"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

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

        // 1x1 transparent PNG in base64
        let tiny_png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
        let (saved_img, snippet) = save_clipboard_image(Some(&tmp), "image/png", tiny_png).unwrap();
        assert!(saved_img.exists());
        assert!(snippet.starts_with("![Screenshot](assets/img-"));

        let _ = fs::remove_dir_all(&tmp);
    }
}
