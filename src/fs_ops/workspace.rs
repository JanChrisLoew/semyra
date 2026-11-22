use super::encoding::{create_new_text_file, read_text_file, FilePayload};
use super::{
    app_data_dir, clean_windows_path, is_image_path, is_markdown_path, is_supported_text_path,
    normalize_entry_path_preserving_link, normalize_existing_path, visit_filtered_dir_entries,
};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

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

    let mut raw_dirs = Vec::new();
    let mut raw_files = Vec::new();
    visit_filtered_dir_entries(
        dir,
        |_, _| {},
        |d| raw_dirs.push(d),
        |f| raw_files.push(f),
    );

    let mut dirs = Vec::new();
    for path in raw_dirs {
        if *entry_budget >= MAX_TOTAL_ENTRIES {
            break;
        }
        let Some(name_str) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        *entry_budget += 1;
        let sub = scan_dir_children(&path, depth + 1, max_depth, entry_budget);
        dirs.push(FileTreeNode {
            name: name_str.to_string(),
            path: clean_windows_path(&path).to_string_lossy().into_owned(),
            is_dir: true,
            is_markdown: false,
            children: Some(sub),
        });
    }

    let mut files = Vec::new();
    for path in raw_files {
        if *entry_budget >= MAX_TOTAL_ENTRIES {
            break;
        }
        let Some(name_str) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
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

    let mut subdirs = Vec::new();
    let mut files = Vec::new();

    visit_filtered_dir_entries(
        dir,
        |_, _| {},
        |d| subdirs.push(d),
        |f| {
            if is_markdown_path(&f) || is_supported_text_path(&f) {
                files.push(f);
            }
        },
    );

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
    let final_name = if Path::new(trimmed).extension().is_some()
        || (trimmed.starts_with('.') && trimmed.len() > 1)
    {
        trimmed.to_string()
    } else {
        format!("{trimmed}.md")
    };

    let full_path = parent_dir.join(&final_name);
    let exists_err = format!("Die Datei '{final_name}' existiert bereits.");
    if fs::symlink_metadata(&full_path).is_ok() {
        return Err(exists_err);
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

    let lower_name = final_name.to_ascii_lowercase();
    let lower_stem = stem.to_ascii_lowercase();

    let initial = if lower_name == "skill.md" || (lower_stem == "skill" && ext == "md") {
        format!(
            "---\nname: {stem}\ndescription: Beschreibe hier die F\u{e4}higkeit und wann sie genutzt werden soll.\n---\n\n# {stem}\n\n## Anweisungen\n- Schritt 1\n- Schritt 2\n"
        )
    } else if (matches!(
        lower_stem.as_str(),
        "prompt" | "system-prompt" | "system_prompt" | "instructions"
    ) || lower_name == "prompt.md"
        || lower_name == "system-prompt.md"
        || lower_name == "instructions.md")
        && ext == "md"
    {
        format!(
            "# System-Prompt: {stem}\n\n## Rolle & Ziel\nDu bist ein spezialisierter Assistent f\u{fc}r...\n\n## Richtlinien & Einschr\u{e4}nkungen\n- Pr\u{e4}zise und direkte Antworten\n- Schritt-f\u{fc}r-Schritt-Vorgehen bei komplexen Aufgaben\n\n## Kontext & Beispiele\n"
        )
    } else if lower_name == ".cursorrules" {
        "# Cursor & KI-Regeln\n\n- Bevorzuge TypeScript und Rust\n- Halte UI-Komponenten modular und barrierefrei\n\n## Architektur\n".to_string()
    } else {
        match ext.as_str() {
            "json" => "{\n  \n}\n".to_string(),
            "yaml" | "yml" => "# Konfiguration\n".to_string(),
            "toml" => "# Konfiguration\n".to_string(),
            "txt" | "log" | "env" | "ini" => String::new(),
            _ => format!("# {stem}\n\n"),
        }
    };
    create_new_text_file(&full_path, &initial, true, &exists_err)?;
    read_text_file(&full_path)
}

/// Ensures `%LOCALAPPDATA%\Semyra\ai-library` with `prompts/` and `skills/`
/// subdirectories exists and returns its root path and directory tree.
pub fn ensure_ai_library_tree() -> Result<(PathBuf, FileTreeNode), String> {
    let root = app_data_dir().join("ai-library");
    fs::create_dir_all(root.join("prompts"))
        .map_err(|e| format!("Prompts-Ordner konnte nicht erstellt werden: {e}"))?;
    fs::create_dir_all(root.join("skills"))
        .map_err(|e| format!("Skills-Ordner konnte nicht erstellt werden: {e}"))?;
    let tree = build_directory_tree(&root, 5)?;
    Ok((root, tree))
}

fn normalize_skill_slug(raw: &str) -> Result<String, String> {
    let trimmed = validate_entry_name(raw)?;
    let mut slug = String::with_capacity(trimmed.len());
    let mut prev_hyphen = true;
    for ch in trimmed.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            prev_hyphen = false;
        } else if (ch == '-' || ch == '_' || ch == ' ') && !prev_hyphen {
            slug.push('-');
            prev_hyphen = true;
        }
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        return Err("Skill-Name muss mindestens ein alphanumerisches Zeichen enthalten.".to_string());
    }
    validate_entry_name(&slug)?;
    Ok(slug)
}

/// Creates a standard-compliant `<skill-name>/SKILL.md` folder and file.
pub fn create_ai_skill(skills_dir: &Path, raw_skill_name: &str) -> Result<FilePayload, String> {
    let slug = normalize_skill_slug(raw_skill_name)?;
    let skill_dir = skills_dir.join(&slug);
    let skill_file = skill_dir.join("SKILL.md");
    let exists_err = format!("Der Skill '{slug}' existiert bereits.");
    if fs::symlink_metadata(&skill_file).is_ok() {
        return Err(exists_err);
    }
    fs::create_dir_all(&skill_dir)
        .map_err(|e| format!("Skill-Ordner konnte nicht erstellt werden: {e}"))?;
    let initial = format!(
        "---\nname: {slug}\ndescription: Beschreibe hier präzise, was dieser Skill tut und wann er verwendet werden soll.\n---\n\n# {slug}\n\n## Ziel\n\n## Schritte\n- Schritt 1\n- Schritt 2\n"
    );
    create_new_text_file(&skill_file, &initial, true, &exists_err)?;
    read_text_file(&skill_file)
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
    let stem = trimmed.split('.').find(|s| !s.is_empty()).unwrap_or(trimmed);
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
    if fs::symlink_metadata(&full).is_ok() {
        return Err(format!("Der Ordner '{valid}' existiert bereits."));
    }
    fs::create_dir_all(&full)
        .map_err(|e| format!("Ordner konnte nicht erstellt werden: {e}"))?;
    Ok(normalize_existing_path(&full).to_string_lossy().into_owned())
}

pub fn rename_fs_entry(target_path: &Path, new_name: &str) -> Result<(String, String), String> {
    let valid = validate_entry_name(new_name)?;
    let _guard = super::encoding::lock_text_writes()?;
    let norm = normalize_entry_path_preserving_link(target_path);
    if fs::symlink_metadata(&norm).is_err() {
        return Err("Datei oder Ordner existiert nicht mehr.".to_string());
    }
    let Some(parent) = norm.parent() else {
        return Err("Stammverzeichnis kann nicht umbenannt werden.".to_string());
    };
    let dest = parent.join(valid);
    let same_entry_case_folded = norm
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|old_name| old_name.to_lowercase() == valid.to_lowercase());
    if fs::symlink_metadata(&dest).is_ok() && !same_entry_case_folded {
        return Err(format!("'{valid}' existiert bereits im selben Ordner."));
    }
    fs::rename(&norm, &dest)
        .map_err(|e| format!("Umbenennen fehlgeschlagen: {e}"))?;
    let canon = normalize_entry_path_preserving_link(&dest);
    let final_name = canon
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(valid)
        .to_string();
    Ok((canon.to_string_lossy().into_owned(), final_name))
}

pub fn move_to_recycle_bin(target_path: &Path) -> Result<(), String> {
    let norm = normalize_entry_path_preserving_link(target_path);
    if fs::symlink_metadata(&norm).is_err() {
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
            "semyra_test_{}",
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

        let skill = create_new_markdown_file(&temp, "SKILL.md").unwrap();
        assert_eq!(skill.name, "SKILL.md");
        assert!(skill.content.starts_with("---\nname: SKILL\n"));
        assert!(skill.content.contains("## Anweisungen\n"));

        let prompt = create_new_markdown_file(&temp, "system-prompt.md").unwrap();
        assert_eq!(prompt.name, "system-prompt.md");
        assert!(prompt.content.starts_with("# System-Prompt: system-prompt\n"));
        assert!(prompt.content.contains("## Rolle & Ziel\n"));

        let cursor = create_new_markdown_file(&temp, ".cursorrules").unwrap();
        assert_eq!(cursor.name, ".cursorrules");
        assert!(cursor.content.starts_with("# Cursor & KI-Regeln\n"));

        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn creates_agent_standard_skill_folder_and_file() {
        let temp = std::env::temp_dir().join(format!(
            "semyra_skill_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let skills_root = temp.join("skills");
        fs::create_dir_all(&skills_root).unwrap();

        let created = create_ai_skill(&skills_root, "Mein Neuer_Skill").unwrap();
        assert_eq!(created.name, "SKILL.md");
        assert!(created.path.ends_with("mein-neuer-skill\\SKILL.md"));
        assert!(created.content.starts_with("---\nname: mein-neuer-skill\ndescription:"));

        assert!(create_ai_skill(&skills_root, "mein-neuer-skill").is_err());

        // Case-only rename succeeds and existing-target rename fails
        let doc_a = temp.join("alpha.md");
        let doc_b = temp.join("beta.md");
        fs::write(&doc_a, "A").unwrap();
        fs::write(&doc_b, "B").unwrap();
        let (renamed_path, renamed_name) = rename_fs_entry(&doc_a, "Alpha.md").unwrap();
        assert_eq!(renamed_name, "Alpha.md");
        assert!(rename_fs_entry(Path::new(&renamed_path), "beta.md").is_err());

        let _ = fs::remove_dir_all(&temp);
    }
}
