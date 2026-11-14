use super::encoding::{decode_text_bytes, replace_text_file};
use super::{
    clean_windows_path, is_markdown_path, is_supported_text_path, normalize_existing_path,
    IGNORED_DIRS,
};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

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
    const MAX_TOTAL_MATCHES: usize = 300;
    const MAX_MATCHES_PER_FILE: usize = 40;

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

    let mut scan = WorkspaceScan::default();
    scan.collect_files(&norm_root, 0);

    let mut results = Vec::new();
    let mut total_matches = 0usize;

    for file_path in scan.files {
        if total_matches >= MAX_TOTAL_MATCHES {
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
                    .find(&needle)
                    .map(|byte_pos| raw_line[..byte_pos].chars().count() + 1)
            } else {
                let h_lower = raw_line.to_lowercase();
                h_lower
                    .find(&needle)
                    .map(|byte_pos| h_lower[..byte_pos].chars().count() + 1)
            };

            if let Some(col) = found_col {
                let trimmed_preview: String = raw_line.trim().chars().take(140).collect();
                file_matches.push(SearchMatchItem {
                    line: idx + 1,
                    column: col,
                    preview: trimmed_preview,
                });
                total_matches += 1;
                if file_matches.len() >= MAX_MATCHES_PER_FILE || total_matches >= MAX_TOTAL_MATCHES
                {
                    break;
                }
            }
        }

        if !file_matches.is_empty() {
            let norm = clean_windows_path(&file_path);
            let rel_path = norm
                .strip_prefix(&norm_root)
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

    Ok(results)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceReplaceResult {
    pub files_updated: usize,
    pub total_replacements: usize,
    pub updated_paths: Vec<String>,
    pub failures: Vec<WorkspaceReplaceFailure>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceReplaceFailure {
    path: String,
    error: String,
}

#[derive(Default)]
struct WorkspaceScan {
    files: Vec<PathBuf>,
    failures: Vec<WorkspaceReplaceFailure>,
}

impl WorkspaceScan {
    fn report(&mut self, path: &Path, error: String) {
        self.failures.push(WorkspaceReplaceFailure {
            path: clean_windows_path(path).to_string_lossy().into_owned(),
            error,
        });
    }

    fn collect_files(&mut self, dir: &Path, depth: usize) {
        if depth >= 6 {
            return;
        }
        let entries = match fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(err) => {
                self.report(dir, format!("Ordner konnte nicht gelesen werden: {err}"));
                return;
            }
        };
        let mut subdirs = Vec::new();
        let mut files = Vec::new();
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(err) => {
                    self.report(dir, format!("Ordnereintrag konnte nicht gelesen werden: {err}"));
                    continue;
                }
            };
            let path = entry.path();
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with('.') {
                continue;
            }
            let kind = match entry.file_type() {
                Ok(kind) => kind,
                Err(err) => {
                    self.report(&path, format!("Dateityp konnte nicht ermittelt werden: {err}"));
                    continue;
                }
            };
            if kind.is_dir() {
                if !IGNORED_DIRS.iter().any(|ignored| name.eq_ignore_ascii_case(ignored)) {
                    subdirs.push(path);
                }
            } else if kind.is_file() && (is_markdown_path(&path) || is_supported_text_path(&path)) {
                files.push(path);
            }
        }
        files.sort();
        subdirs.sort();
        self.files.extend(files);
        for subdir in subdirs {
            self.collect_files(&subdir, depth + 1);
        }
    }
}

/// Replaces all occurrences of `query` with `replacement` across Markdown/text files in `root`.
/// Preserves each file's detected line-ending style via atomic `write_text_file`.
pub fn replace_in_workspace_files(
    root: &Path,
    query: &str,
    replacement: &str,
    case_sensitive: bool,
) -> Result<WorkspaceReplaceResult, String> {
    if query.is_empty() {
        return Err("Suchbegriff darf nicht leer sein.".to_string());
    }
    let norm_root = normalize_existing_path(root);
    if !norm_root.is_dir() {
        return Err("Ungültiger Arbeitsordner.".to_string());
    }

    let mut scan = WorkspaceScan::default();
    scan.collect_files(&norm_root, 0);

    let mut files_updated = 0usize;
    let mut total_replacements = 0usize;
    let mut updated_paths = Vec::new();
    let mut failures = scan.failures;

    for file_path in scan.files {
        if let Ok(meta) = fs::metadata(&file_path) {
            if meta.len() > 5 * 1024 * 1024 {
                continue;
            }
        }
        let path = clean_windows_path(&file_path).to_string_lossy().into_owned();
        let bytes = match fs::read(&file_path) {
            Ok(bytes) => bytes,
            Err(err) => {
                failures.push(WorkspaceReplaceFailure {
                    path,
                    error: format!("Datei konnte nicht gelesen werden: {err}"),
                });
                continue;
            }
        };
        let (content, _) = decode_text_bytes(&bytes);
        let prefer_crlf = content.contains("\r\n");

        let (updated, count) = replace_text_occurrences(&content, query, replacement, case_sensitive);
        if count > 0 && updated != content {
            match replace_text_file(&file_path, &updated, prefer_crlf, &bytes) {
                Ok(()) => {
                    files_updated += 1;
                    total_replacements += count;
                    updated_paths.push(path);
                }
                Err(error) => failures.push(WorkspaceReplaceFailure { path, error }),
            }
        }
    }

    Ok(WorkspaceReplaceResult {
        files_updated,
        total_replacements,
        updated_paths,
        failures,
    })
}

fn replace_text_occurrences(
    haystack: &str,
    query: &str,
    replacement: &str,
    case_sensitive: bool,
) -> (String, usize) {
    if case_sensitive {
        let count = haystack.matches(query).count();
        if count == 0 {
            return (String::new(), 0);
        }
        return (haystack.replace(query, replacement), count);
    }

    if query.is_empty() {
        return (String::new(), 0);
    }

    let query_lower = query.to_lowercase();
    if query_lower.is_empty() {
        return (String::new(), 0);
    }

    // Fast path for pure ASCII: byte offsets in `to_ascii_lowercase()` match `haystack` 1:1.
    if haystack.is_ascii() && query.is_ascii() {
        let hay_lower = haystack.to_ascii_lowercase();
        let mut out = String::with_capacity(haystack.len());
        let mut last = 0usize;
        let mut count = 0usize;
        for (idx, _) in hay_lower.match_indices(&query_lower) {
            if idx < last {
                continue;
            }
            out.push_str(&haystack[last..idx]);
            out.push_str(replacement);
            last = idx + query_lower.len();
            count += 1;
        }
        if count == 0 {
            return (String::new(), 0);
        }
        out.push_str(&haystack[last..]);
        return (out, count);
    }

    // Unicode-safe case-insensitive matching: map each byte of `hay_lower` back to
    // the original `(char_start, char_end)` byte span in `haystack`.
    let mut hay_lower = String::with_capacity(haystack.len());
    let mut byte_map: Vec<(usize, usize)> = Vec::with_capacity(haystack.len());
    let mut utf8_buf = [0u8; 4];
    for (orig_start, ch) in haystack.char_indices() {
        let orig_end = orig_start + ch.len_utf8();
        for lc in ch.to_lowercase() {
            let encoded = lc.encode_utf8(&mut utf8_buf);
            hay_lower.push_str(encoded);
            for _ in 0..encoded.len() {
                byte_map.push((orig_start, orig_end));
            }
        }
    }

    let mut out = String::with_capacity(haystack.len());
    let mut last_orig = 0usize;
    let mut last_lower = 0usize;
    let mut count = 0usize;

    for (l_start, matched) in hay_lower.match_indices(&query_lower) {
        if l_start < last_lower {
            continue;
        }
        let l_end = l_start + matched.len();
        if l_end == l_start {
            continue;
        }
        // Ensure we do not split a single original character's multi-char lowercase expansion.
        if l_start > 0 && byte_map[l_start].0 == byte_map[l_start - 1].0 {
            continue;
        }
        if l_end < byte_map.len() && byte_map[l_end].1 == byte_map[l_end - 1].1 {
            continue;
        }

        let orig_start = byte_map[l_start].0;
        let orig_end = byte_map[l_end - 1].1;
        if orig_start < last_orig {
            continue;
        }

        out.push_str(&haystack[last_orig..orig_start]);
        out.push_str(replacement);
        last_orig = orig_end;
        last_lower = l_end;
        count += 1;
    }

    if count == 0 {
        return (String::new(), 0);
    }
    out.push_str(&haystack[last_orig..]);
    (out, count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_records_an_unreadable_path_and_still_collects_other_files() {
        let dir = std::env::temp_dir().join(format!("semyra_scan_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let missing = dir.join("missing");
        let document = dir.join("available.md");
        fs::write(&document, "original").unwrap();

        let mut scan = WorkspaceScan::default();
        scan.collect_files(&missing, 1);
        scan.collect_files(&dir, 0);

        assert_eq!(scan.files, [document]);
        assert_eq!(scan.failures.len(), 1);
        assert_eq!(scan.failures[0].path, missing.to_string_lossy());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn replaces_across_files_preserving_crlf() {
        let dir = std::env::temp_dir().join(format!(
            "semyra_replace_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let file_a = dir.join("a.md");
        fs::write(&file_a, "Hello MarkLive\r\nmarklive rocks\r\n").unwrap();

        let res = replace_in_workspace_files(&dir, "MarkLive", "Semyra", false).unwrap();
        assert_eq!(res.files_updated, 1);
        assert_eq!(res.total_replacements, 2);

        let after = fs::read_to_string(&file_a).unwrap();
        assert_eq!(after, "Hello Semyra\r\nSemyra rocks\r\n");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn replaces_unicode_case_folding_safely() {
        // Capital sharp S ('ẞ', 3 bytes -> "ss", 2 bytes) and Turkish dotted I ('İ', 2 bytes -> 3 bytes)
        // must not panic or corrupt subsequent match byte offsets.
        let input = "GROẞE Straße İSTANBUL MarkLive und marklive Ende";
        let (out, count) = replace_text_occurrences(input, "marklive", "Semyra", false);
        assert_eq!(count, 2);
        assert_eq!(out, "GROẞE Straße İSTANBUL Semyra und Semyra Ende");

        // Case-insensitive match spanning 'ẞ' -> "ss"
        let (out2, count2) = replace_text_occurrences("GROẞE Straße", "große", "kleine", false);
        assert_eq!(count2, 1);
        assert_eq!(out2, "kleine Straße");
    }

    #[cfg(windows)]
    #[test]
    fn reports_locked_file_and_continues_replacing_other_files() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = std::env::temp_dir().join(format!(
            "semyra_replace_locked_{}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        for name in ["a.md", "b.md", "c.md"] {
            fs::write(dir.join(name), "old").unwrap();
        }
        let blocked = dir.join("b.md");
        // Allow reads of the target while denying replacement of the open file.
        let lock = fs::OpenOptions::new().read(true).share_mode(1).open(&blocked).unwrap();
        let result = replace_in_workspace_files(&dir, "old", "new", true).unwrap();
        assert_eq!(result.files_updated, 2);
        assert_eq!(result.total_replacements, 2);
        assert_eq!(result.updated_paths.len(), 2);
        assert_eq!(result.failures.len(), 1);
        assert!(result.failures[0].path.ends_with("b.md"));
        assert_eq!(fs::read_to_string(dir.join("c.md")).unwrap(), "new");
        assert_eq!(fs::read_to_string(blocked).unwrap(), "old");
        drop(lock);
        fs::remove_dir_all(dir).unwrap();
    }
}
