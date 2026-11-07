use super::encoding::{read_text_file, write_text_file, FilePayload};
use super::{
    clean_windows_path, is_image_path, is_markdown_path, is_supported_text_path,
    normalize_existing_path, IGNORED_DIRS,
};
use serde::Serialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileEntry {
    pub path: String,
    pub name: String,
    pub rel_path: String,
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
            let show_file = is_md || is_image_path(&path) || is_supported_text_path(&path);
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

/// Lists all Markdown/text files inside `root` for fast Quick-Open fuzzy switching (`Strg+E`).
pub fn list_workspace_markdown_files(root: &Path) -> Result<Vec<WorkspaceFileEntry>, String> {
    let norm_root = normalize_existing_path(root);
    if !norm_root.is_dir() {
        return Err("Ungültiger Arbeitsordner.".to_string());
    }
    let mut out = Vec::new();
    collect_markdown_files_recursive(&norm_root, &norm_root, 0, 7, &mut out);
    Ok(out)
}

fn collect_markdown_files_recursive(
    root: &Path,
    dir: &Path,
    depth: usize,
    max_depth: usize,
    out: &mut Vec<WorkspaceFileEntry>,
) {
    const MAX_FILES: usize = 3500;
    if depth >= max_depth || out.len() >= MAX_FILES {
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
        } else if ft.is_file() && (is_markdown_path(&path) || is_supported_text_path(&path)) {
            files.push(path);
        }
    }

    subdirs.sort();
    files.sort();

    for f in files {
        if out.len() >= MAX_FILES {
            return;
        }
        let norm = clean_windows_path(&f);
        let rel_path = norm
            .strip_prefix(root)
            .unwrap_or(&norm)
            .to_string_lossy()
            .replace('\\', "/");
        let name = norm
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Datei.md")
            .to_string();
        out.push(WorkspaceFileEntry {
            path: norm.to_string_lossy().into_owned(),
            name,
            rel_path,
        });
    }

    for sub in subdirs {
        if out.len() >= MAX_FILES {
            return;
        }
        collect_markdown_files_recursive(root, &sub, depth + 1, max_depth, out);
    }
}

pub fn create_new_markdown_file(parent_dir: &Path, file_name: &str) -> Result<FilePayload, String> {
    let trimmed = validate_entry_name(file_name)?;
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
    let ext = Path::new(&final_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    let initial = match ext.as_str() {
        "json" => "{\n  \n}\n".to_string(),
        "yaml" | "yml" => "# Konfiguration\n".to_string(),
        "toml" => "# Konfiguration\n".to_string(),
        "txt" | "log" | "env" | "ini" => String::new(),
        _ => format!("# {stem}\n\n"),
    };
    write_text_file(&full_path, &initial, true)?;
    read_text_file(&full_path)
}

fn validate_entry_name(name: &str) -> Result<&str, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err("Name darf nicht leer sein.".to_string());
    }
    if trimmed.ends_with('.') {
        return Err("Name darf unter Windows nicht mit einem Punkt enden.".to_string());
    }
    if trimmed.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
        return Err("Name enthält ungültige Zeichen.".to_string());
    }
    let stem = trimmed.split('.').next().unwrap_or(trimmed);
    let upper = stem.to_ascii_uppercase();
    if matches!(
        upper.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    ) {
        return Err(format!("'{stem}' ist ein reservierter Windows-Gerätename."));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_windows_entry_names() {
        assert!(validate_entry_name("").is_err());
        assert!(validate_entry_name("..").is_err());
        assert!(validate_entry_name("ordner/datei.md").is_err());
        assert!(validate_entry_name("ungueltig:name.md").is_err());
        assert!(validate_entry_name("con.md").is_err());
        assert!(validate_entry_name("LPT1").is_err());
        assert!(validate_entry_name("Notiz.").is_err());
        assert_eq!(validate_entry_name("  Kapitel 1.md  ").unwrap(), "Kapitel 1.md");
    }

    #[test]
    fn creates_clean_templates_for_different_file_types() {
        let temp = std::env::temp_dir().join(format!(
            "marklive_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&temp).unwrap();

        let json = create_new_markdown_file(&temp, "package.json").unwrap();
        assert!(json.content.contains("{\n"));

        let yaml = create_new_markdown_file(&temp, "config.yaml").unwrap();
        assert_eq!(yaml.content, "# Konfiguration\n");

        let md = create_new_markdown_file(&temp, "Notizen").unwrap();
        assert_eq!(md.name, "Notizen.md");
        assert!(md.content.starts_with("# Notizen\n\n"));

        let _ = fs::remove_dir_all(&temp);
    }
}
