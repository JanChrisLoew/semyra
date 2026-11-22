use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftEntry {
    pub name: String,
    pub path: Option<String>,
    pub parent_dir: Option<String>,
    pub content: String,
    pub saved_content: String,
    pub line_ending: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub saved_line_ending: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftSnapshot {
    pub entries: Vec<DraftEntry>,
}

struct RecoveryFile {
    path: PathBuf,
    lock: Option<fs::File>,
}

impl RecoveryFile {
    fn lock(path: PathBuf) -> Result<Self, String> {
        let lock = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path.with_extension("lock"))
            .map_err(|e| e.to_string())?;
        lock.try_lock().map_err(|e| e.to_string())?;
        Ok(Self { path, lock: Some(lock) })
    }

    fn clear_snapshot(&self) -> std::io::Result<()> {
        match fs::remove_file(&self.path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            result => result,
        }
    }

    fn remove(&mut self) -> std::io::Result<()> {
        let res = self.clear_snapshot();
        if res.is_ok() {
            drop(self.lock.take());
            let _ = fs::remove_file(self.path.with_extension("lock"));
        }
        res
    }
}

impl Drop for RecoveryFile {
    fn drop(&mut self) {
        drop(self.lock.take());
        if !self.path.exists() {
            let _ = fs::remove_file(self.path.with_extension("lock"));
        }
    }
}

fn quarantine_corrupt_recovery_file(file: &mut RecoveryFile) {
    let mut corrupt_os = file.path.as_os_str().to_os_string();
    corrupt_os.push(".corrupt");
    let corrupt_path = PathBuf::from(corrupt_os);
    if let Err(err) = fs::rename(&file.path, &corrupt_path) {
        eprintln!(
            "Defekte Entwurfsdatei '{}' konnte nicht verschoben werden: {err}",
            file.path.display()
        );
    } else {
        drop(file.lock.take());
        let _ = fs::remove_file(file.path.with_extension("lock"));
    }
}

pub struct DraftStore {
    current: RecoveryFile,
    recovered: Vec<RecoveryFile>,
    last_revision: u64,
    closed: bool,
}

impl DraftStore {
    pub fn open(dir: &Path) -> Result<(Self, Vec<DraftEntry>), String> {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
        let current = RecoveryFile::lock(dir.join(format!("recovery-{}-{timestamp}.json", std::process::id())))?;
        let current_lock_path = current.path.with_extension("lock");
        let mut recovered = Vec::new();
        let mut entries = Vec::new();
        for entry in fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
            let path = entry.path();
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if (name == "recovery.lock" || (name.starts_with("recovery-") && name.ends_with(".lock")))
                && path != current_lock_path
            {
                let json_path = path.with_extension("json");
                if !json_path.exists() {
                    if let Ok(mut orphan) = RecoveryFile::lock(json_path) {
                        let _ = orphan.remove();
                    }
                }
                continue;
            }
            if !(name == "recovery.json" || (name.starts_with("recovery-") && name.ends_with(".json"))) {
                continue;
            }
            let Ok(mut file) = RecoveryFile::lock(path) else { continue };
            let Ok(bytes) = fs::read(&file.path) else { continue };
            match serde_json::from_slice::<DraftSnapshot>(&bytes) {
                Ok(snapshot) => {
                    entries.extend(snapshot.entries);
                    recovered.push(file);
                }
                Err(err) => {
                    eprintln!(
                        "Defekte Entwurfsdatei '{}' wird isoliert: {err}",
                        file.path.display()
                    );
                    quarantine_corrupt_recovery_file(&mut file);
                }
            }
        }
        Ok((Self { current, recovered, last_revision: 0, closed: false }, entries))
    }

    pub fn save(&mut self, revision: u64, entries: Vec<DraftEntry>, recovery_restored: bool) -> Result<(), String> {
        if self.closed || revision <= self.last_revision {
            return Ok(());
        }
        if entries.is_empty() {
            self.current.clear_snapshot().map_err(|e| e.to_string())?;
        } else {
            let bytes = serde_json::to_vec(&DraftSnapshot { entries }).map_err(|e| e.to_string())?;
            crate::fs_ops::encoding::write_file_atomically(&self.current.path, &bytes)
                .map_err(|e| format!("Entwurf konnte nicht gespeichert werden: {e}"))?;
        }
        self.last_revision = revision;
        if recovery_restored {
            self.remove_recovered();
        }
        Ok(())
    }

    pub fn close(&mut self, recovery_restored: bool) {
        self.closed = true;
        let _ = self.current.remove();
        if recovery_restored {
            self.remove_recovered();
        }
    }

    fn remove_recovered(&mut self) {
        self.recovered.retain_mut(|file| file.remove().is_err());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{self, Read};
    use std::process::{Child, Command, Stdio};
    use std::time::{Duration, Instant};

    const RECOVERY_TEST_PROFILE: &str = "SEMYRA_TEST_RECOVERY_PROFILE";
    const RECOVERY_TEST_ROLE: &str = "SEMYRA_TEST_RECOVERY_ROLE";
    const UNSAVED_TEXT: &str = "# Ungespeicherter Entwurf\n\nGrüße aus Semyra 📝\n";

    fn draft(content: &str) -> DraftEntry {
        DraftEntry {
            name: "Draft.md".to_string(),
            path: None,
            parent_dir: None,
            content: content.to_string(),
            saved_content: String::new(),
            line_ending: "LF".to_string(),
            saved_line_ending: None,
        }
    }

    fn recovery_process(profile: &Path, role: &str) -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args(["--ignored", "--exact", "drafts::tests::recovery_subprocess"])
            .env(RECOVERY_TEST_PROFILE, profile)
            .env(RECOVERY_TEST_ROLE, role);
        command
    }

    fn wait_until_saved(writer: &mut Child, ready_file: &Path) -> Result<(), String> {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if ready_file.is_file() {
                return Ok(());
            }
            if let Some(status) = writer.try_wait().map_err(|err| err.to_string())? {
                return Err(format!("draft writer exited before saving: {status}"));
            }
            if Instant::now() >= deadline {
                return Err("draft writer did not confirm the save within 10 seconds".into());
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn recovers_exact_draft_after_writer_process_is_killed() {
        let profile = std::env::temp_dir().join(format!(
            "semyra-recovery-crash-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir(&profile).unwrap();

        let mut writer = recovery_process(&profile, "write")
            .stdin(Stdio::piped())
            .spawn()
            .expect("start draft writer");
        let saved = wait_until_saved(&mut writer, &profile.join("saved"));

        // Keep the writer's stdin open so only terminating the process releases its draft lock.
        let terminated = writer.kill();
        let status = writer.wait().expect("wait for terminated draft writer");
        saved.expect("writer must publish a persisted draft before termination");
        terminated.expect("terminate the draft writer without a clean shutdown");
        assert!(!status.success(), "draft writer must have exited abnormally");

        let reader = recovery_process(&profile, "read")
            .output()
            .expect("start draft reader in a separate process");
        fs::remove_dir_all(&profile).unwrap();
        assert!(
            reader.status.success(),
            "draft reader failed: {}\n{}",
            String::from_utf8_lossy(&reader.stdout),
            String::from_utf8_lossy(&reader.stderr),
        );
    }

    #[test]
    #[ignore = "subprocess entry point for recovers_exact_draft_after_writer_process_is_killed"]
    fn recovery_subprocess() {
        let Some(profile) = std::env::var_os(RECOVERY_TEST_PROFILE).map(PathBuf::from) else {
            return;
        };
        let mut expected = draft(UNSAVED_TEXT);
        expected.path = Some(profile.join("Draft.md").to_string_lossy().into_owned());
        expected.parent_dir = Some(profile.to_string_lossy().into_owned());
        expected.saved_content = "# Gespeicherter Stand\n".into();
        expected.line_ending = "CRLF".into();
        expected.saved_line_ending = Some("LF".into());

        let (mut store, recovered) = DraftStore::open(&profile).unwrap();
        match std::env::var(RECOVERY_TEST_ROLE).as_deref() {
            Ok("write") => {
                assert!(recovered.is_empty());
                store.save(1, vec![expected], true).unwrap();
                fs::write(profile.join("saved"), []).unwrap();
                // The parent keeps this pipe open until after it has terminated us.
                let _ = io::stdin().read(&mut [0]).unwrap();
                store.close(true);
            }
            Ok("read") => {
                assert_eq!(
                    serde_json::to_value(&recovered).unwrap(),
                    serde_json::to_value([expected]).unwrap(),
                );
                store.close(true);
            }
            role => panic!("unexpected recovery test role: {role:?}"),
        }
    }

    #[test]
    fn closing_one_window_keeps_the_others_drafts_and_ignores_stale_updates() {
        let dir = std::env::temp_dir().join(format!(
            "semyra-recovery-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let (mut first, _) = DraftStore::open(&dir).unwrap();
        first.save(1, vec![draft("first window")], true).unwrap();
        let (mut second, recovered) = DraftStore::open(&dir).unwrap();
        assert!(recovered.is_empty());
        second.save(2, vec![draft("latest draft")], true).unwrap();
        second.save(1, vec![draft("stale draft")], true).unwrap();
        first.close(true);
        first.save(2, vec![draft("late write after close")], true).unwrap();
        drop(first);
        drop(second); // Simulate losing the process without a clean close.

        let (mut restarted, recovered) = DraftStore::open(&dir).unwrap();
        assert_eq!(recovered.iter().map(|d| d.content.as_str()).collect::<Vec<_>>(), ["latest draft"]);
        restarted.save(1, recovered, true).unwrap();
        restarted.close(true);
        drop(restarted);
        let (last, recovered) = DraftStore::open(&dir).unwrap();
        assert!(recovered.is_empty());
        drop(last);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn close_removes_lock_files_and_open_prunes_orphan_locks() {
        let dir = std::env::temp_dir().join(format!(
            "semyra-draft-locks-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let orphan_lock = dir.join("recovery-99999-orphan.lock");
        fs::write(&orphan_lock, b"").unwrap();

        let (mut store, recovered) = DraftStore::open(&dir).unwrap();
        assert!(recovered.is_empty());
        assert!(!orphan_lock.exists(), "orphan lock without json should be pruned on open");

        store.save(1, vec![draft("unsaved")], true).unwrap();
        store.close(true);

        let remaining_locks: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|ext| ext == "lock"))
            .collect();
        assert!(remaining_locks.is_empty(), "close() must unlock and remove lock files");
        drop(store);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn open_quarantines_corrupt_recovery_file_without_blocking_other_drafts() {
        let dir = std::env::temp_dir().join(format!(
            "semyra-draft-corrupt-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let bad_path = dir.join("recovery-100-bad.json");
        let good_path = dir.join("recovery-101-good.json");
        fs::write(&bad_path, b"{broken json").unwrap();
        let good_bytes = serde_json::to_vec(&DraftSnapshot {
            entries: vec![draft("valid draft")],
        })
        .unwrap();
        fs::write(&good_path, good_bytes).unwrap();

        let (mut store, recovered) = DraftStore::open(&dir).unwrap();
        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0].content, "valid draft");
        assert!(!bad_path.exists(), "corrupt recovery json should be moved aside");
        assert!(dir.join("recovery-100-bad.json.corrupt").exists());
        assert!(!dir.join("recovery-100-bad.lock").exists());

        store.close(true);
        drop(store);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn saving_empty_drafts_retains_lock_for_later_edits_until_close() {
        let dir = std::env::temp_dir().join(format!(
            "semyra-draft-retain-lock-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let (mut first, _) = DraftStore::open(&dir).unwrap();
        first.save(1, vec![], false).unwrap();
        first.save(2, vec![draft("live")], false).unwrap();

        let (mut second, recovered) = DraftStore::open(&dir).unwrap();
        assert!(
            recovered.is_empty(),
            "second window must not steal live draft after empty save"
        );
        second.close(false);
        drop(second);

        first.close(false);
        let remaining: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(
            remaining.is_empty(),
            "close() must remove both json and lock files, found: {remaining:?}"
        );
        drop(first);
        fs::remove_dir_all(dir).unwrap();
    }
}
