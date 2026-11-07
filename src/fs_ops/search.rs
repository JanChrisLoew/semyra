use super::encoding::decode_text_bytes;
use super::{clean_windows_path, is_markdown_path, normalize_existing_path, IGNORED_DIRS};
use serde::Serialize;
use std::fs;
use std::path::Path;

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
        if let Ok(meta) = fs::metadata(&file_path) {
            if meta.len() > 5 * 1024 * 1024 {
                continue;
            }
        }
        let Ok(bytes) = fs::read(&file_path) else {
            continue;
        };
        let (content, _) = decode_text_bytes(&bytes);

        let mut file_matches = Vec::new();
        for (idx, raw_line) in content.lines().enumerate() {
            let found_col = if case_sensitive {
                raw_line
                    .find(needle)
                    .map(|byte_pos| raw_line[..byte_pos].chars().count() + 1)
            } else {
                let h_lower = raw_line.to_lowercase();
                h_lower
                    .find(needle)
                    .map(|byte_pos| h_lower[..byte_pos].chars().count() + 1)
            };

            if let Some(col) = found_col {
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
