use super::normalize_existing_path;
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePayload {
    pub path: String,
    pub name: String,
    pub content: String,
    pub line_ending: String,
    pub encoding: String,
    pub parent_dir: Option<String>,
}

/// Windows-1252 (`0x80..=0x9F`) mapping table for legacy Windows text files without UTF-8 encoding.
const CP1252_HIGH: [char; 32] = [
    '\u{20AC}', '\u{FFFD}', '\u{201A}', '\u{0192}', '\u{201E}', '\u{2026}', '\u{2020}', '\u{2021}',
    '\u{02C6}', '\u{2030}', '\u{0160}', '\u{2039}', '\u{0152}', '\u{FFFD}', '\u{017D}', '\u{FFFD}',
    '\u{FFFD}', '\u{2018}', '\u{2019}', '\u{201C}', '\u{201D}', '\u{2022}', '\u{2013}', '\u{2014}',
    '\u{02DC}', '\u{2122}', '\u{0161}', '\u{203A}', '\u{0153}', '\u{FFFD}', '\u{017E}', '\u{0178}',
];

/// Decodes UTF-8, UTF-8 BOM, UTF-16 LE/BE BOM, or legacy Windows-1252 bytes losslessly into `String`.
pub fn decode_text_bytes(bytes: &[u8]) -> (String, &'static str) {
    if let Some(rest) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        if let Ok(s) = std::str::from_utf8(rest) {
            return (s.to_owned(), "UTF-8 BOM");
        }
    }

    if let Some(rest) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        let units: Vec<u16> = rest
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        return (String::from_utf16_lossy(&units), "UTF-16 LE");
    }

    if let Some(rest) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        let units: Vec<u16> = rest
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        return (String::from_utf16_lossy(&units), "UTF-16 BE");
    }

    if let Ok(utf8) = std::str::from_utf8(bytes) {
        return (utf8.to_owned(), "UTF-8");
    }

    // Fallback: decode as Windows-1252 so German umlauts, Euro sign, and typographic quotes stay intact
    let mut decoded = String::with_capacity(bytes.len());
    for &b in bytes {
        if b < 0x80 || b >= 0xA0 {
            decoded.push(b as char);
        } else {
            decoded.push(CP1252_HIGH[(b - 0x80) as usize]);
        }
    }
    (decoded, "Windows-1252")
}

pub fn read_text_file(path: &Path) -> Result<FilePayload, String> {
    let norm = normalize_existing_path(path);
    let bytes = fs::read(&norm).map_err(|e| format!("Datei konnte nicht gelesen werden: {e}"))?;

    let (raw_text, detected_encoding) = decode_text_bytes(&bytes);
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
        encoding: detected_encoding.to_string(),
        parent_dir,
    })
}

pub fn write_text_file_if_unchanged(
    path: &Path,
    content: &str,
    prefer_crlf: bool,
    expected_content: &str,
    expected_line_ending: Option<&str>,
) -> Result<Option<String>, String> {
    let _guard = lock_text_writes()?;
    match fs::read(path) {
        Ok(bytes) => {
            let (text, _) = decode_text_bytes(&bytes);
            let line_ending = if text.contains("\r\n") { "CRLF" } else { "LF" };
            if text.replace("\r\n", "\n") != expected_content
                || (text.contains('\n') && expected_line_ending.is_some_and(|expected| expected != line_ending))
            {
                return Ok(None);
            }
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("Datei konnte nicht gelesen werden: {err}")),
    }
    write_text_file_unlocked(path, content, prefer_crlf).map(Some)
}

pub(super) fn replace_text_file(
    path: &Path,
    content: &str,
    prefer_crlf: bool,
    expected_bytes: &[u8],
) -> Result<(), String> {
    let _guard = lock_text_writes()?;
    let current = fs::read(path).map_err(|err| format!("Datei konnte nicht gelesen werden: {err}"))?;
    if current != expected_bytes {
        return Err("Die Datei wurde während des Ersetzens geändert.".to_string());
    }
    write_text_file_unlocked(path, content, prefer_crlf).map(|_| ())
}

/// Writes UTF-8 text atomically via a sibling temporary file and rename.
pub fn write_text_file(path: &Path, content: &str, prefer_crlf: bool) -> Result<String, String> {
    let _guard = lock_text_writes()?;
    write_text_file_unlocked(path, content, prefer_crlf)
}

#[cfg(not(test))]
fn lock_text_writes() -> Result<fs::File, String> {
    // Keep the expected-content check and replacement together across Semyra windows.
    let lock = (|| -> std::io::Result<fs::File> {
        let dir = super::app_data_dir();
        fs::create_dir_all(&dir)?;
        let file = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(dir.join("text-writes.lock"))?;
        file.lock()?;
        Ok(file)
    })();
    lock.map_err(|e| format!("Dateizugriff konnte nicht synchronisiert werden: {e}"))
}

#[cfg(test)]
fn lock_text_writes() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    static TEXT_WRITES: std::sync::Mutex<()> = std::sync::Mutex::new(());
    TEXT_WRITES.lock().map_err(|e| e.to_string())
}

fn write_text_file_unlocked(path: &Path, content: &str, prefer_crlf: bool) -> Result<String, String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Ordner konnte nicht erstellt werden: {e}"))?;
        }
    }

    let normalized = content.replace("\r\n", "\n");
    let final_str = if prefer_crlf {
        normalized.replace('\n', "\r\n")
    } else {
        normalized
    };
    write_file_atomically(path, final_str.as_bytes())
        .map_err(|e| format!("Datei konnte nicht gespeichert werden: {e}"))?;
    let canon = normalize_existing_path(path);
    Ok(canon.to_string_lossy().into_owned())
}

pub(crate) fn write_file_atomically(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp_name = format!(".semyra-save-{}-{nanos:x}.tmp", std::process::id());
    let tmp_path = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
        .join(tmp_name);

    let mut file = fs::File::create_new(&tmp_path)?;
    let written = file.write_all(bytes);
    drop(file);
    let result = written.and_then(|()| fs::rename(&tmp_path, path));
    if result.is_err() {
        let _ = fs::remove_file(&tmp_path);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_utf16le_and_windows1252_cleanly() {
        let text = "Größe\r\n";
        let mut utf16_bytes = vec![0xFF, 0xFE];
        for u in text.encode_utf16() {
            utf16_bytes.extend_from_slice(&u.to_le_bytes());
        }
        let (decoded, enc) = decode_text_bytes(&utf16_bytes);
        assert_eq!(enc, "UTF-16 LE");
        assert_eq!(decoded, "Größe\r\n");

        let cp1252_bytes = [0x80u8, b' ', 0xFC, 0xDF];
        let (cp_decoded, cp_enc) = decode_text_bytes(&cp1252_bytes);
        assert_eq!(cp_enc, "Windows-1252");
        assert_eq!(cp_decoded, "€ üß");
    }

    #[test]
    fn guarded_save_keeps_external_edits_and_accepts_the_original_disk_version() {
        let path = std::env::temp_dir().join(format!("semyra-guarded-save-{}.md", std::process::id()));
        fs::write(&path, "External\r\n").unwrap();
        let result = write_text_file_if_unchanged(&path, "Local\n", true, "Original\n", Some("CRLF")).unwrap();
        assert!(result.is_none());
        let result = write_text_file_if_unchanged(&path, "Local\n", true, "External\n", Some("LF")).unwrap();
        assert!(result.is_none());
        assert_eq!(fs::read_to_string(&path).unwrap(), "External\r\n");
        let result = write_text_file_if_unchanged(&path, "Local\n", true, "External\n", Some("CRLF")).unwrap();
        assert!(result.is_some());
        assert_eq!(fs::read_to_string(&path).unwrap(), "Local\r\n");
        fs::remove_file(path).unwrap();
    }
}
