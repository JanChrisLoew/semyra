use super::normalize_existing_path;
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
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
    '\u{20AC}', '\u{0081}', '\u{201A}', '\u{0192}', '\u{201E}', '\u{2026}', '\u{2020}', '\u{2021}',
    '\u{02C6}', '\u{2030}', '\u{0160}', '\u{2039}', '\u{0152}', '\u{008D}', '\u{017D}', '\u{008F}',
    '\u{0090}', '\u{2018}', '\u{2019}', '\u{201C}', '\u{201D}', '\u{2022}', '\u{2013}', '\u{2014}',
    '\u{02DC}', '\u{2122}', '\u{0161}', '\u{203A}', '\u{0153}', '\u{009D}', '\u{017E}', '\u{0178}',
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

pub const ENCODING_CONVERSION_REQUIRED: &str = "encoding_conversion_required";

fn encode_text(text: &str, encoding: &str) -> Result<Vec<u8>, String> {
    match encoding {
        "UTF-8" => Ok(text.as_bytes().to_vec()),
        "UTF-8 BOM" => Ok([&[0xEF, 0xBB, 0xBF][..], text.as_bytes()].concat()),
        "UTF-16 LE" | "UTF-16 BE" => {
            let little = encoding == "UTF-16 LE";
            let mut bytes = Vec::new();
            for unit in std::iter::once(0xFEFF).chain(text.encode_utf16()) {
                let pair = if little { unit.to_le_bytes() } else { unit.to_be_bytes() };
                bytes.extend_from_slice(&pair);
            }
            Ok(bytes)
        }
        "Windows-1252" => text.chars().map(|ch| {
            if ch.is_ascii() || ('\u{a0}'..='\u{ff}').contains(&ch) {
                Ok(ch as u8)
            } else {
                CP1252_HIGH.iter().position(|&entry| entry == ch)
                    .map(|index| 0x80 + index as u8)
                    .ok_or_else(|| ENCODING_CONVERSION_REQUIRED.to_owned())
            }
        }).collect(),
        _ => Err(format!("Unbekannte Dateikodierung: {encoding}")),
    }
}

pub const MAX_TEXT_FILE_BYTES: u64 = 25 * 1024 * 1024;

pub fn read_text_file(path: &Path) -> Result<FilePayload, String> {
    let norm = normalize_existing_path(path);
    let meta = fs::metadata(&norm)
        .map_err(|e| format!("Datei konnte nicht gelesen werden: {e}"))?;
    if meta.len() > MAX_TEXT_FILE_BYTES {
        let size_mb = meta.len() as f64 / (1024.0 * 1024.0);
        let limit_mb = MAX_TEXT_FILE_BYTES / (1024 * 1024);
        return Err(format!(
            "Datei ist zu groß ({size_mb:.1} MB). Maximal erlaubte Dateigröße: {limit_mb} MB."
        ));
    }
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

fn read_checked_bytes(path: &Path) -> std::io::Result<Result<Vec<u8>, String>> {
    let meta = fs::metadata(path)?;
    if meta.len() > MAX_TEXT_FILE_BYTES {
        let size_mb = meta.len() as f64 / (1024.0 * 1024.0);
        let limit_mb = MAX_TEXT_FILE_BYTES / (1024 * 1024);
        return Ok(Err(format!(
            "Datei ist zu groß ({size_mb:.1} MB). Maximal erlaubte Dateigröße: {limit_mb} MB."
        )));
    }
    fs::read(path).map(Ok)
}

pub fn write_text_file_if_unchanged(
    path: &Path,
    content: &str,
    prefer_crlf: bool,
    expected_content: &str,
    expected_line_ending: Option<&str>,
    prefer_windows1252: bool,
    convert_windows1252: bool,
) -> Result<Option<(String, &'static str)>, String> {
    let _guard = lock_text_writes()?;
    let encoding = match read_checked_bytes(path) {
        Ok(Ok(bytes)) => {
            let (text, encoding) = decode_text_bytes(&bytes);
            let line_ending = if text.contains("\r\n") { "CRLF" } else { "LF" };
            if text.replace("\r\n", "\n") != expected_content
                || (text.contains('\n') && expected_line_ending.is_some_and(|expected| expected != line_ending))
            {
                return Ok(None);
            }
            if prefer_windows1252 && encoding == "UTF-8" && bytes.is_ascii() {
                "Windows-1252"
            } else {
                encoding
            }
        }
        Ok(Err(size_err)) => return Err(size_err),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => return Err(format!("Datei konnte nicht gelesen werden: {err}")),
    };
    let encoding = if convert_windows1252 && encoding == "Windows-1252" { "UTF-8" } else { encoding };
    write_text_file_unlocked(path, content, prefer_crlf, encoding).map(|path| Some((path, encoding)))
}

pub(super) fn replace_text_file(
    path: &Path,
    content: &str,
    prefer_crlf: bool,
    expected_bytes: &[u8],
    encoding: &str,
) -> Result<(), String> {
    let _guard = lock_text_writes()?;
    let current = match read_checked_bytes(path) {
        Ok(Ok(bytes)) => bytes,
        Ok(Err(size_err)) => return Err(size_err),
        Err(err) => return Err(format!("Datei konnte nicht gelesen werden: {err}")),
    };
    if current != expected_bytes {
        return Err("Die Datei wurde während des Ersetzens geändert.".to_string());
    }
    write_text_file_unlocked(path, content, prefer_crlf, encoding).map(|_| ())
}

/// Creates a brand-new UTF-8 file atomically (`create_new(true)`), failing if it already exists.
pub fn create_new_text_file(
    path: &Path,
    content: &str,
    prefer_crlf: bool,
    already_exists_msg: &str,
) -> Result<String, String> {
    use std::io::Write;
    let _guard = lock_text_writes()?;
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
    let bytes = encode_text(&final_str, "UTF-8")?;
    let mut file = match fs::OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(f) => f,
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err(already_exists_msg.to_string());
        }
        Err(err) => return Err(format!("Datei konnte nicht erstellt werden: {err}")),
    };
    if let Err(err) = file.write_all(&bytes).and_then(|()| file.sync_data()) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(format!("Datei konnte nicht gespeichert werden: {err}"));
    }
    Ok(normalize_existing_path(path).to_string_lossy().into_owned())
}

/// Writes UTF-8 text atomically via a sibling temporary file and rename.
pub fn write_text_file(path: &Path, content: &str, prefer_crlf: bool) -> Result<String, String> {
    let _guard = lock_text_writes()?;
    write_text_file_unlocked(path, content, prefer_crlf, "UTF-8")
}

#[cfg(not(test))]
pub(super) fn lock_text_writes() -> Result<fs::File, String> {
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
pub(super) fn lock_text_writes() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    static TEXT_WRITES: std::sync::Mutex<()> = std::sync::Mutex::new(());
    TEXT_WRITES.lock().map_err(|e| e.to_string())
}

fn resolve_symlink_target(path: &Path) -> std::path::PathBuf {
    if !fs::symlink_metadata(path).is_ok_and(|meta| meta.file_type().is_symlink()) {
        return path.to_path_buf();
    }
    if let Ok(canon) = fs::canonicalize(path) {
        return super::clean_windows_path(&canon);
    }
    if let Ok(link_target) = fs::read_link(path) {
        let resolved = if link_target.is_absolute() {
            link_target
        } else {
            path.parent()
                .filter(|p| !p.as_os_str().is_empty())
                .unwrap_or_else(|| Path::new("."))
                .join(link_target)
        };
        return super::clean_windows_path(&resolved);
    }
    path.to_path_buf()
}

fn write_text_file_unlocked(path: &Path, content: &str, prefer_crlf: bool, encoding: &str) -> Result<String, String> {
    let target_path = resolve_symlink_target(path);

    if let Some(parent) = target_path.parent() {
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
    write_file_atomically(&target_path, &encode_text(&final_str, encoding)?)
        .map_err(|e| format!("Datei konnte nicht gespeichert werden: {e}"))?;
    let canon = normalize_existing_path(&target_path);
    Ok(canon.to_string_lossy().into_owned())
}

static ATOMIC_TMP_SEQ: AtomicU64 = AtomicU64::new(0);

pub(crate) fn write_file_atomically(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = ATOMIC_TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp_name = format!(".semyra-save-{}-{nanos:x}-{seq}.tmp", std::process::id());
    let tmp_path = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
        .join(tmp_name);

    let mut file = fs::File::create_new(&tmp_path)?;
    let written = file.write_all(bytes).and_then(|()| file.sync_data());
    drop(file);
    let result = written.and_then(|()| {
        let mut attempts = 0;
        loop {
            match fs::rename(&tmp_path, path) {
                Ok(()) => return Ok(()),
                Err(err)
                    if err.kind() == std::io::ErrorKind::PermissionDenied && attempts < 3 =>
                {
                    attempts += 1;
                    std::thread::sleep(std::time::Duration::from_millis(15));
                }
                Err(err) => return Err(err),
            }
        }
    });
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
    fn saves_and_replaces_in_each_original_encoding() {
        let dir = std::env::temp_dir().join(format!("semyra-encoding-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("example.md");
        for (encoding, prefix, euro, newline) in [
            ("UTF-8", &[][..], &[0xe2, 0x82, 0xac][..], &[13, 10][..]),
            ("UTF-8 BOM", &[0xef, 0xbb, 0xbf], &[0xe2, 0x82, 0xac], &[13, 10]),
            ("UTF-16 LE", &[0xff, 0xfe], &[0xac, 0x20], &[13, 0, 10, 0]),
            ("UTF-16 BE", &[0xfe, 0xff], &[0x20, 0xac], &[0, 13, 0, 10]),
            ("Windows-1252", &[], &[0x80], &[13, 10]),
        ] {
            let original = [prefix, euro, newline].concat();
            fs::write(&path, &original).unwrap();
            let saved = write_text_file_if_unchanged(&path, "€€\n", true, "€\n", Some("CRLF"), false, false)
                .unwrap().unwrap();
            assert_eq!(saved.1, encoding);
            assert_eq!(fs::read(&path).unwrap(), [prefix, euro, euro, newline].concat());
            let result = super::super::search::replace_in_workspace_files(&dir, "€€", "€", true).unwrap();
            assert_eq!(result.files_updated, 1);
            assert_eq!(fs::read(&path).unwrap(), original);
        }
        let result = super::super::search::replace_in_workspace_files(&dir, "€", "猫", true).unwrap();
        assert_eq!(result.files_updated, 0);
        assert_eq!(result.failures.len(), 1);
        assert_eq!(write_text_file_if_unchanged(&path, "猫", false, "€\n", None, false, false).unwrap_err(),
            ENCODING_CONVERSION_REQUIRED);
        assert_eq!(fs::read(&path).unwrap(), &[0x80, 13, 10]);
        write_text_file_if_unchanged(&path, "猫", false, "€\n", None, false, true).unwrap().unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "猫");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn guarded_save_keeps_external_edits_and_accepts_the_original_disk_version() {
        let path = std::env::temp_dir().join(format!("semyra-guarded-save-{}.md", std::process::id()));
        fs::write(&path, "External\r\n").unwrap();
        let result = write_text_file_if_unchanged(&path, "Local\n", true, "Original\n", Some("CRLF"), false, false).unwrap();
        assert!(result.is_none());
        let result = write_text_file_if_unchanged(&path, "Local\n", true, "External\n", Some("LF"), false, false).unwrap();
        assert!(result.is_none());
        assert_eq!(fs::read_to_string(&path).unwrap(), "External\r\n");
        let result = write_text_file_if_unchanged(&path, "Local\n", true, "External\n", Some("CRLF"), false, false).unwrap();
        assert!(result.is_some());
        assert_eq!(fs::read_to_string(&path).unwrap(), "Local\r\n");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn rejects_files_exceeding_max_size() {
        let path = std::env::temp_dir().join(format!("semyra-oversize-{}.log", std::process::id()));
        let file = fs::File::create(&path).unwrap();
        file.set_len(MAX_TEXT_FILE_BYTES + 1).unwrap();
        drop(file);

        let err = read_text_file(&path).unwrap_err();
        assert!(err.contains("zu groß"), "unexpected error: {err}");
        assert!(err.contains("25 MB"), "unexpected error: {err}");

        let guarded_err =
            write_text_file_if_unchanged(&path, "small", false, "small", None, false, false)
                .unwrap_err();
        assert!(guarded_err.contains("zu groß"), "unexpected error: {guarded_err}");

        fs::remove_file(path).unwrap();
    }
}
