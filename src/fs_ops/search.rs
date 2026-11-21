use super::encoding::{decode_text_bytes, replace_text_file};
use super::{
    clean_windows_path, is_allowed_dot_entry, is_markdown_path, is_supported_text_path,
    normalize_existing_path, IGNORED_DIRS,
};
use regex::{NoExpand, Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::collections::HashMap;
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
    pub occurrence_count: usize,
    pub matching_lines: usize,
    pub content_version: String,
}

#[derive(Deserialize)]
#[serde(untagged)]
pub enum ReplaceTarget {
    Versioned {
        path: String,
        #[serde(rename = "contentVersion")]
        content_version: String,
    },
    Path(String),
}

fn content_version(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn build_search_regex(
    query: &str,
    case_sensitive: bool,
    use_regex: bool,
    whole_word: bool,
) -> Result<Option<Regex>, String> {
    if !use_regex && !whole_word {
        return Ok(None);
    }

    if use_regex && !whole_word {
        return RegexBuilder::new(query)
            .case_insensitive(!case_sensitive)
            .multi_line(true)
            .build()
            .map(Some)
            .map_err(|err| format!("Ungültiger regulärer Ausdruck: {err}"));
    }

    if use_regex {
        // Validate the user pattern first so syntax errors report against the original input.
        if let Err(err) = RegexBuilder::new(query)
            .case_insensitive(!case_sensitive)
            .multi_line(true)
            .build()
        {
            return Err(format!("Ungültiger regulärer Ausdruck: {err}"));
        }
    }

    let pattern = if use_regex {
        format!(r"\b(?:{query})\b")
    } else {
        format!(r"\b(?:{})\b", regex::escape(query))
    };

    RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .multi_line(true)
        .build()
        .map(Some)
        .map_err(|err| format!("Ungültiger regulärer Ausdruck: {err}"))
}

#[cfg(test)]
pub fn search_workspace_files(
    root: &Path,
    query: &str,
    case_sensitive: bool,
) -> Result<Vec<SearchFileResult>, String> {
    search_workspace_with_options(root, query, case_sensitive, false, false)
}

pub fn search_workspace_with_options(
    root: &Path,
    query: &str,
    case_sensitive: bool,
    use_regex: bool,
    whole_word: bool,
) -> Result<Vec<SearchFileResult>, String> {
    const MAX_PREVIEW_LINES: usize = 300;
    const MAX_PREVIEW_LINES_PER_FILE: usize = 40;

    let trimmed_q = query.trim();
    if trimmed_q.is_empty() {
        return Ok(Vec::new());
    }
    let norm_root = normalize_existing_path(root);
    if !norm_root.is_dir() {
        return Err("Ungültiger Arbeitsordner.".to_string());
    }

    let active_query = if use_regex { query } else { trimmed_q };
    let compiled_regex = build_search_regex(active_query, case_sensitive, use_regex, whole_word)?;

    let mut scan = WorkspaceScan::default();
    scan.collect_files(&norm_root, 0);

    let mut results = Vec::new();
    let mut preview_lines = 0usize;

    for file_path in scan.files {
        if let Ok(meta) = fs::metadata(&file_path) {
            if meta.len() > 5 * 1024 * 1024 {
                continue;
            }
        }
        let Ok(bytes) = fs::read(&file_path) else {
            continue;
        };
        let (content, _) = decode_text_bytes(&bytes);

        let text = search_text(&content, compiled_regex.is_some());
        let preview_limit = MAX_PREVIEW_LINES_PER_FILE.min(MAX_PREVIEW_LINES - preview_lines);
        let mut file_matches = Vec::new();
        let mut occurrence_count = 0;
        let mut matching_lines = 0;
        let mut line = 1;
        let mut start = 0;
        let mut end = text.find('\n').unwrap_or(text.len());
        let mut previous_match_line = 0;
        let mut record = |offset: usize| {
            occurrence_count += 1;
            while offset > end {
                line += 1;
                start = end + 1;
                end = text[start..].find('\n').map_or(text.len(), |pos| start + pos);
            }
            if previous_match_line == line {
                return;
            }
            previous_match_line = line;
            matching_lines += 1;
            if file_matches.len() < preview_limit {
                file_matches.push(SearchMatchItem {
                    line,
                    column: text[start..offset].chars().count() + 1,
                    preview: text[start..end].trim().chars().take(140).collect(),
                });
            }
        };
        if let Some(re) = &compiled_regex {
            for found in re.find_iter(&text) {
                record(found.start());
            }
        } else {
            visit_literal_matches(&text, active_query, case_sensitive, |from, _| record(from));
        }
        preview_lines += file_matches.len();

        if occurrence_count > 0 {
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
                occurrence_count,
                matching_lines,
                content_version: content_version(&bytes),
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
            if !is_allowed_dot_entry(&name) {
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
#[cfg(test)]
pub fn replace_in_workspace_files(
    root: &Path,
    query: &str,
    replacement: &str,
    case_sensitive: bool,
) -> Result<WorkspaceReplaceResult, String> {
    replace_in_workspace_with_options(root, query, replacement, case_sensitive, false, false, None)
}

/// Replaces occurrences of `query` with `replacement` across workspace files with regex,
/// whole-word, and optional `include_files` filtering.
pub fn replace_in_workspace_with_options(
    root: &Path,
    query: &str,
    replacement: &str,
    case_sensitive: bool,
    use_regex: bool,
    whole_word: bool,
    include_files: Option<Vec<ReplaceTarget>>,
) -> Result<WorkspaceReplaceResult, String> {
    if query.is_empty() {
        return Err("Suchbegriff darf nicht leer sein.".to_string());
    }
    let norm_root = normalize_existing_path(root);
    if !norm_root.is_dir() {
        return Err("Ungültiger Arbeitsordner.".to_string());
    }

    let compiled_regex = build_search_regex(query, case_sensitive, use_regex, whole_word)?;
    let mut targets: Option<HashMap<PathBuf, Option<String>>> = include_files.map(|files| {
        files
            .into_iter()
            .map(|target| {
                let (path, version) = match target {
                    ReplaceTarget::Versioned { path, content_version } => (path, Some(content_version)),
                    ReplaceTarget::Path(path) => (path, None),
                };
                (normalize_existing_path(Path::new(&path)), version)
            })
            .collect()
    });

    let mut scan = WorkspaceScan::default();
    scan.collect_files(&norm_root, 0);

    let mut files_updated = 0usize;
    let mut total_replacements = 0usize;
    let mut updated_paths = Vec::new();
    let mut failures = scan.failures;

    for file_path in scan.files {
        let clean_path = clean_windows_path(&file_path);
        let expected = match &mut targets {
            Some(targets) => match targets.remove(&file_path) {
                Some(version) => version,
                None => continue,
            },
            None => None,
        };
        let path = clean_path.to_string_lossy().into_owned();
        if fs::metadata(&file_path).is_ok_and(|meta| meta.len() > 5 * 1024 * 1024) {
            if expected.is_some() {
                failures.push(WorkspaceReplaceFailure {
                    path,
                    error: "Datei ist für die Ordnersuche zu groß geworden.".into(),
                });
            }
            continue;
        }
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
        if expected.is_some_and(|version| version != content_version(&bytes)) {
            failures.push(WorkspaceReplaceFailure {
                path,
                error: "Datei wurde seit der Suche geändert.".into(),
            });
            continue;
        }
        let (content, encoding) = decode_text_bytes(&bytes);
        let prefer_crlf = content.contains("\r\n");

        let (updated, count, changed) = if let Some(ref re) = compiled_regex {
            let normalized = search_text(&content, true);
            let count = re.find_iter(&normalized).count();
            if count == 0 {
                (String::new(), 0, false)
            } else {
                let replaced = if use_regex {
                    re.replace_all(&normalized, replacement).into_owned()
                } else {
                    re.replace_all(&normalized, NoExpand(replacement)).into_owned()
                };
                let changed = replaced != *normalized;
                (replaced, count, changed)
            }
        } else {
            let (replaced, count) =
                replace_text_occurrences(&content, query, replacement, case_sensitive);
            let changed = count > 0 && replaced != content;
            (replaced, count, changed)
        };
        if changed {
            match replace_text_file(&file_path, &updated, prefer_crlf, &bytes, encoding) {
                Ok(()) => {
                    files_updated += 1;
                    total_replacements += count;
                    updated_paths.push(path);
                }
                Err(error) => failures.push(WorkspaceReplaceFailure { path, error }),
            }
        }
    }

    if let Some(targets) = targets {
        for (path, version) in targets {
            if version.is_some() {
                failures.push(WorkspaceReplaceFailure {
                    path: clean_windows_path(&path).to_string_lossy().into_owned(),
                    error: "Datei wurde im Arbeitsordner nicht mehr gefunden.".into(),
                });
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
    let mut out = String::new();
    let mut last = 0;
    let mut count = 0;
    visit_literal_matches(haystack, query, case_sensitive, |start, end| {
        out.push_str(&haystack[last..start]);
        out.push_str(replacement);
        last = end;
        count += 1;
    });
    if count > 0 {
        out.push_str(&haystack[last..]);
    }
    (out, count)
}

fn search_text(content: &str, normalize_crlf: bool) -> Cow<'_, str> {
    if normalize_crlf && content.contains("\r\n") {
        Cow::Owned(content.replace("\r\n", "\n"))
    } else {
        Cow::Borrowed(content)
    }
}

fn visit_literal_matches(
    haystack: &str,
    query: &str,
    case_sensitive: bool,
    mut visit: impl FnMut(usize, usize),
) {
    if query.is_empty() {
        return;
    }
    if case_sensitive {
        for (start, matched) in haystack.match_indices(query) {
            visit(start, start + matched.len());
        }
        return;
    }
    let query_lower = query.to_lowercase();
    if haystack.is_ascii() && query.is_ascii() {
        for (start, matched) in haystack.to_ascii_lowercase().match_indices(&query_lower) {
            visit(start, start + matched.len());
        }
        return;
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

    for (l_start, matched) in hay_lower.match_indices(&query_lower) {
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
        visit(orig_start, orig_end);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_limits_do_not_limit_occurrences_or_selected_replacements() {
        let dir = std::env::temp_dir().join(format!("semyra_search_counts_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        for index in 0..9 {
            fs::write(dir.join(format!("{index}.md")), "alpha alpha\r\n".repeat(50)).unwrap();
        }
        let results = search_workspace_files(&dir, "alpha", false).unwrap();
        assert_eq!(results.len(), 9);
        assert_eq!(results[0].matches.len(), 40);
        assert!(results[8].matches.is_empty());
        assert_eq!(results.iter().map(|file| file.matches.len()).sum::<usize>(), 300);
        assert!(results.iter().all(|file| file.occurrence_count == 100 && file.matching_lines == 50));
        let selected = &results[0];
        let target = ReplaceTarget::Versioned {
            path: selected.path.clone(),
            content_version: selected.content_version.clone(),
        };
        let replaced = replace_in_workspace_with_options(
            &dir, "alpha", "beta", false, false, false, Some(vec![target]),
        ).unwrap();
        assert_eq!(replaced.total_replacements, selected.occurrence_count);
        assert_eq!(fs::read_to_string(&selected.path).unwrap(), "beta beta\r\n".repeat(50));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn search_and_replace_share_multiline_and_unicode_match_boundaries() {
        let dir = std::env::temp_dir().join(format!("semyra_match_boundaries_{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("document.md");
        for (input, query, regex, expected) in [
            ("one\r\ntwo\r\none\r\ntwo", r"one\ntwo", true, 2),
            ("İ i", "i", false, 1),
            ("x\r\n", "$", true, 2),
        ] {
            fs::write(&path, input).unwrap();
            let found = search_workspace_with_options(&dir, query, false, regex, false).unwrap();
            assert_eq!(found[0].occurrence_count, expected);
            let replaced = replace_in_workspace_with_options(&dir, query, "!", false, regex, false, None).unwrap();
            assert_eq!(replaced.total_replacements, expected);
        }
        fs::remove_dir_all(dir).unwrap();
    }

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

    #[test]
    fn dotfile_parity_between_explorer_quick_open_and_search() {
        let dir = std::env::temp_dir().join(format!(
            "semyra_dotfile_parity_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(dir.join(".github")).unwrap();
        fs::create_dir_all(dir.join(".agents").join("skills").join("demo")).unwrap();
        fs::create_dir_all(dir.join(".git")).unwrap();
        fs::create_dir_all(dir.join(".vscode")).unwrap();

        fs::write(dir.join(".github").join("AGENTS.md"), "needle in github\n").unwrap();
        fs::write(
            dir.join(".agents").join("skills").join("demo").join("SKILL.md"),
            "needle in agents\n",
        )
        .unwrap();
        fs::write(dir.join(".cursorrules"), "needle in cursorrules\n").unwrap();
        fs::write(dir.join(".env.local"), "KEY=needle\n").unwrap();
        fs::write(dir.join(".git").join("notes.md"), "needle in git\n").unwrap();
        fs::write(dir.join(".vscode").join("notes.md"), "needle in vscode\n").unwrap();

        let tree = crate::fs_ops::build_directory_tree(&dir, 6).unwrap();
        let root_children = tree.children.unwrap();
        let names: Vec<&str> = root_children.iter().map(|n| n.name.as_str()).collect();
        assert!(names.contains(&".github"));
        assert!(names.contains(&".agents"));
        assert!(names.contains(&".cursorrules"));
        assert!(names.contains(&".env.local"));
        assert!(!names.contains(&".git"));
        assert!(!names.contains(&".vscode"));

        let quick_open = crate::fs_ops::list_workspace_markdown_files(&dir).unwrap();
        let rels: Vec<&str> = quick_open.iter().map(|e| e.rel_path.as_str()).collect();
        assert!(rels.contains(&".github/AGENTS.md"));
        assert!(rels.contains(&".agents/skills/demo/SKILL.md"));
        assert!(rels.contains(&".cursorrules"));
        assert!(rels.contains(&".env.local"));
        assert!(!rels.iter().any(|r| r.starts_with(".git/") || r.starts_with(".vscode/")));

        let search_hits = search_workspace_files(&dir, "needle", true).unwrap();
        let hit_rels: Vec<String> = search_hits
            .iter()
            .map(|r| r.rel_path.replace('\\', "/"))
            .collect();
        assert!(hit_rels.contains(&".github/AGENTS.md".to_string()));
        assert!(hit_rels.contains(&".agents/skills/demo/SKILL.md".to_string()));
        assert!(hit_rels.contains(&".cursorrules".to_string()));
        assert!(hit_rels.contains(&".env.local".to_string()));
        assert!(!hit_rels.iter().any(|r| r.starts_with(".git/") || r.starts_with(".vscode/")));

        let replaced = replace_in_workspace_files(&dir, "needle", "updated", true).unwrap();
        assert_eq!(replaced.files_updated, 4);
        assert!(fs::read_to_string(dir.join(".github").join("AGENTS.md"))
            .unwrap()
            .contains("updated in github"));
        assert!(fs::read_to_string(dir.join(".cursorrules"))
            .unwrap()
            .contains("updated in cursorrules"));
        assert!(fs::read_to_string(dir.join(".git").join("notes.md"))
            .unwrap()
            .contains("needle in git"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_and_replace_support_regex_and_report_invalid_patterns() {
        let dir = std::env::temp_dir().join(format!(
            "semyra_regex_search_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let file_a = dir.join("notes.md");
        fs::write(&file_a, "v1.2.0 released\nv10.0.1 draft\n").unwrap();

        let err = search_workspace_with_options(&dir, "(unclosed", true, true, false).unwrap_err();
        assert!(err.contains("Ungültiger regulärer Ausdruck"));

        let hits = search_workspace_with_options(&dir, r"v(\d+)\.\d+\.\d+", true, true, false).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].matches.len(), 2);

        let replaced = replace_in_workspace_with_options(
            &dir,
            r"v(\d+)\.\d+\.\d+",
            "major-$1",
            true,
            true,
            false,
            None,
        )
        .unwrap();
        assert_eq!(replaced.files_updated, 1);
        assert_eq!(replaced.total_replacements, 2);
        assert_eq!(
            fs::read_to_string(&file_a).unwrap(),
            "major-1 released\nmajor-10 draft\n"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_and_replace_whole_word_ignores_substrings_and_literal_dollars() {
        let dir = std::env::temp_dir().join(format!(
            "semyra_whole_word_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let file_a = dir.join("words.md");
        fs::write(&file_a, "cat caterpillar Cat scatter\n").unwrap();

        let hits = search_workspace_with_options(&dir, "cat", false, false, true).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].matches.len(), 1);
        assert_eq!(hits[0].matches[0].column, 1);

        let replaced = replace_in_workspace_with_options(
            &dir,
            "cat",
            "$1-dog",
            false,
            false,
            true,
            None,
        )
        .unwrap();
        assert_eq!(replaced.files_updated, 1);
        assert_eq!(replaced.total_replacements, 2);
        assert_eq!(
            fs::read_to_string(&file_a).unwrap(),
            "$1-dog caterpillar $1-dog scatter\n"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn replace_skips_files_changed_or_removed_after_search() {
        let dir = std::env::temp_dir().join(format!(
            "semyra_replace_versions_{}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        let unchanged = dir.join("unchanged.md");
        let changed = dir.join("changed.md");
        let removed = dir.join("removed.md");
        for path in [&unchanged, &changed, &removed] {
            fs::write(path, "needle\n").unwrap();
        }
        let targets = search_workspace_files(&dir, "needle", true)
            .unwrap()
            .into_iter()
            .map(|result| ReplaceTarget::Versioned {
                path: result.path,
                content_version: result.content_version,
            })
            .collect();
        fs::write(&changed, "needle\nnew needle\n").unwrap();
        fs::remove_file(&removed).unwrap();

        let result =
            replace_in_workspace_with_options(&dir, "needle", "updated", true, false, false, Some(targets))
                .unwrap();
        assert_eq!(result.files_updated, 1);
        assert_eq!(result.total_replacements, 1);
        assert_eq!(result.failures.len(), 2);
        assert_eq!(fs::read_to_string(&unchanged).unwrap(), "updated\n");
        assert_eq!(fs::read_to_string(&changed).unwrap(), "needle\nnew needle\n");
        assert!(!removed.exists());
        fs::remove_file(unchanged).unwrap();
        fs::remove_file(changed).unwrap();
        fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn replace_respects_include_files_filter() {
        let dir = std::env::temp_dir().join(format!(
            "semyra_include_files_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let file_a = dir.join("a.md");
        let file_b = dir.join("b.md");
        fs::write(&file_a, "alpha beta\n").unwrap();
        fs::write(&file_b, "alpha gamma\n").unwrap();

        let empty_res = replace_in_workspace_with_options(
            &dir,
            "alpha",
            "omega",
            true,
            false,
            false,
            Some(Vec::new()),
        )
        .unwrap();
        assert_eq!(empty_res.files_updated, 0);
        assert_eq!(empty_res.total_replacements, 0);

        let selected = vec![ReplaceTarget::Path(clean_windows_path(&file_a).to_string_lossy().into_owned())];
        let res = replace_in_workspace_with_options(
            &dir,
            "alpha",
            "omega",
            true,
            false,
            false,
            Some(selected),
        )
        .unwrap();
        assert_eq!(res.files_updated, 1);
        assert_eq!(res.total_replacements, 1);
        assert_eq!(fs::read_to_string(&file_a).unwrap(), "omega beta\n");
        assert_eq!(fs::read_to_string(&file_b).unwrap(), "alpha gamma\n");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn regex_search_and_replace_match_line_anchors_consistently() {
        let dir = std::env::temp_dir().join(format!(
            "semyra_regex_multiline_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let lf_file = dir.join("lf.md");
        let crlf_file = dir.join("crlf.md");
        fs::write(&lf_file, "foo\nbar foo\nbaz\n").unwrap();
        fs::write(&crlf_file, "foo\r\nbar foo\r\nbaz\r\n").unwrap();

        let hits = search_workspace_with_options(&dir, r"^foo$", true, true, false).unwrap();
        assert_eq!(hits.len(), 2);
        assert!(hits.iter().all(|file| file.matches.len() == 1 && file.matches[0].line == 1));

        let res = replace_in_workspace_with_options(
            &dir,
            r"^foo$",
            "qux",
            true,
            true,
            false,
            None,
        )
        .unwrap();
        assert_eq!(res.files_updated, 2);
        assert_eq!(res.total_replacements, 2);
        assert_eq!(fs::read_to_string(&lf_file).unwrap(), "qux\nbar foo\nbaz\n");
        assert_eq!(
            fs::read_to_string(&crlf_file).unwrap(),
            "qux\r\nbar foo\r\nbaz\r\n"
        );

        let _ = fs::remove_dir_all(&dir);
    }
}
