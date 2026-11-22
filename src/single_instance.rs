use crate::state::UserEvent;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tao::event_loop::EventLoopProxy;

const SINGLE_INSTANCE_MUTEX_NAME: &str = r"Local\Semyra_SingleInstance_v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartupRole {
    Forwarded,
    Primary,
    Secondary,
}

struct PrimaryOwnership {
    is_primary: AtomicBool,
    #[cfg(target_os = "windows")]
    mutex: Mutex<Option<win32_mutex::NamedMutex>>,
}

impl PrimaryOwnership {
    const fn new() -> Self {
        Self {
            is_primary: AtomicBool::new(false),
            #[cfg(target_os = "windows")]
            mutex: Mutex::new(None),
        }
    }

    fn owns_primary_lock(&self) -> bool {
        if !self.is_primary.load(Ordering::SeqCst) {
            return false;
        }
        #[cfg(target_os = "windows")]
        {
            self.mutex
                .lock()
                .ok()
                .is_some_and(|guard| guard.is_some())
        }
        #[cfg(not(target_os = "windows"))]
        {
            true
        }
    }
}

static PRIMARY_OWNERSHIP: PrimaryOwnership = PrimaryOwnership::new();

#[cfg(target_os = "windows")]
mod win32_mutex {
    use std::ffi::c_void;

    const ERROR_ALREADY_EXISTS: u32 = 183;

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateMutexW(
            lp_mutex_attributes: *const c_void,
            b_initial_owner: i32,
            lp_name: *const u16,
        ) -> *mut c_void;
        fn GetLastError() -> u32;
        fn CloseHandle(h_object: *mut c_void) -> i32;
    }

    pub(crate) struct NamedMutex {
        handle: *mut c_void,
    }

    // SAFETY: Win32 named mutex handles are kernel objects that can be closed from any thread
    // when synchronized by `PRIMARY_MUTEX`.
    unsafe impl Send for NamedMutex {}
    unsafe impl Sync for NamedMutex {}

    impl Drop for NamedMutex {
        fn drop(&mut self) {
            if !self.handle.is_null() {
                unsafe {
                    CloseHandle(self.handle);
                }
                self.handle = std::ptr::null_mut();
            }
        }
    }

    pub(crate) enum AcquireOutcome {
        Primary(NamedMutex),
        AlreadyExists,
        Failed,
    }

    pub(crate) fn try_acquire(name: &str) -> AcquireOutcome {
        let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        unsafe {
            let handle = CreateMutexW(std::ptr::null(), 0, wide.as_ptr());
            if handle.is_null() {
                return AcquireOutcome::Failed;
            }
            if GetLastError() == ERROR_ALREADY_EXISTS {
                CloseHandle(handle);
                return AcquireOutcome::AlreadyExists;
            }
            AcquireOutcome::Primary(NamedMutex { handle })
        }
    }
}

#[derive(Serialize, Deserialize)]
struct InstanceLockInfo {
    port: u16,
    token: String,
}

#[derive(Serialize, Deserialize)]
pub struct ForwardedArgs {
    token: String,
    pub files: Vec<String>,
    pub folder: Option<String>,
}

fn lock_file_path() -> PathBuf {
    crate::fs_ops::app_data_dir().join("instance.json")
}

fn forward_once_to(lock_path: &Path, files: &[PathBuf], folder: &Option<PathBuf>) -> Result<bool, ()> {
    let Ok(bytes) = fs::read(lock_path) else {
        return Err(());
    };
    let Ok(info) = serde_json::from_slice::<InstanceLockInfo>(&bytes) else {
        return Err(());
    };

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], info.port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(250)) else {
        return Err(());
    };
    let _ = stream.set_write_timeout(Some(Duration::from_millis(400)));
    let _ = stream.set_read_timeout(Some(Duration::from_millis(400)));

    let payload = ForwardedArgs {
        token: info.token,
        files: files
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect(),
        folder: folder
            .as_ref()
            .map(|p| p.to_string_lossy().into_owned()),
    };

    let Ok(json) = serde_json::to_vec(&payload) else {
        return Ok(false);
    };
    if stream.write_all(&json).is_err() {
        return Err(());
    }
    let _ = stream.shutdown(std::net::Shutdown::Write);

    let mut ack = [0u8; 2];
    Ok(matches!(stream.read(&mut ack), Ok(2) if &ack == b"OK"))
}

fn negotiate_with(
    ownership: &PrimaryOwnership,
    mutex_name: &str,
    lock_path: &Path,
    files: &[PathBuf],
    folder: &Option<PathBuf>,
    force_new_window: bool,
    retry_attempts: usize,
) -> StartupRole {
    if force_new_window {
        return StartupRole::Secondary;
    }

    #[cfg(target_os = "windows")]
    {
        match win32_mutex::try_acquire(mutex_name) {
            win32_mutex::AcquireOutcome::Primary(mutex) => {
                if let Ok(mut guard) = ownership.mutex.lock() {
                    *guard = Some(mutex);
                }
                ownership.is_primary.store(true, Ordering::SeqCst);
                let _ = fs::remove_file(lock_path);
                return StartupRole::Primary;
            }
            win32_mutex::AcquireOutcome::AlreadyExists => {
                // Another primary instance holds the Win32 mutex; wait briefly in case it is
                // still binding its localhost listener and writing `instance.json`.
                for _ in 0..retry_attempts.max(1) {
                    if let Ok(true) = forward_once_to(lock_path, files, folder) {
                        return StartupRole::Forwarded;
                    }
                    std::thread::sleep(Duration::from_millis(40));
                }
                eprintln!(
                    "Primäre Instanz antwortete nicht rechtzeitig; starte als sekundäres Fenster."
                );
                return StartupRole::Secondary;
            }
            win32_mutex::AcquireOutcome::Failed => {
                if let Ok(true) = forward_once_to(lock_path, files, folder) {
                    return StartupRole::Forwarded;
                }
                return StartupRole::Secondary;
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (mutex_name, retry_attempts);
        match forward_once_to(lock_path, files, folder) {
            Ok(true) => StartupRole::Forwarded,
            _ => {
                let _ = fs::remove_file(lock_path);
                ownership.is_primary.store(true, Ordering::SeqCst);
                StartupRole::Primary
            }
        }
    }
}

/// Negotiates single-instance ownership and forwards CLI targets when another primary is running.
pub fn negotiate_single_instance(
    files: &[PathBuf],
    folder: &Option<PathBuf>,
    force_new_window: bool,
) -> StartupRole {
    negotiate_with(
        &PRIMARY_OWNERSHIP,
        SINGLE_INSTANCE_MUTEX_NAME,
        &lock_file_path(),
        files,
        folder,
        force_new_window,
        25,
    )
}

fn write_instance_lock_file(
    ownership: &PrimaryOwnership,
    lock_path: &Path,
    port: u16,
    token: &str,
) -> bool {
    if !ownership.owns_primary_lock() {
        return false;
    }
    if let Some(parent) = lock_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(bytes) = serde_json::to_vec(&InstanceLockInfo {
        port,
        token: token.to_owned(),
    }) {
        return crate::fs_ops::encoding::write_file_atomically(lock_path, &bytes).is_ok();
    }
    false
}

/// Starts a lightweight localhost listener that receives file/folder open requests from secondary launches.
pub fn start_primary_instance_listener(proxy: EventLoopProxy<UserEvent>) {
    if !PRIMARY_OWNERSHIP.owns_primary_lock() {
        return;
    }

    let Ok(listener) = TcpListener::bind(("127.0.0.1", 0)) else {
        return;
    };
    let Ok(local_addr) = listener.local_addr() else {
        return;
    };

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let token = format!("{}-{nanos:x}", std::process::id());

    let lock_path = lock_file_path();
    if !write_instance_lock_file(&PRIMARY_OWNERSHIP, &lock_path, local_addr.port(), &token) {
        return;
    }

    std::thread::spawn(move || {
        for incoming in listener.incoming().flatten() {
            let mut stream = incoming;
            let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
            let mut buf = Vec::with_capacity(512);
            if (&mut stream).take(65_536).read_to_end(&mut buf).is_ok() {
                if let Ok(msg) = serde_json::from_slice::<ForwardedArgs>(&buf) {
                    if msg.token == token
                        && proxy
                            .send_event(UserEvent::ActivateAndOpen {
                                files: msg.files,
                                folder: msg.folder,
                            })
                            .is_ok()
                    {
                        let _ = stream.write_all(b"OK");
                    }
                }
            }
        }
    });
}

fn cleanup_with(ownership: &PrimaryOwnership, lock_path: &Path) {
    if !ownership.is_primary.swap(false, Ordering::SeqCst) {
        return;
    }
    let _ = fs::remove_file(lock_path);
    #[cfg(target_os = "windows")]
    if let Ok(mut guard) = ownership.mutex.lock() {
        *guard = None;
    }
}

pub fn cleanup_instance_lock() {
    cleanup_with(&PRIMARY_OWNERSHIP, &lock_file_path());
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::win32_mutex::{try_acquire, AcquireOutcome};
    use super::*;

    #[test]
    fn win32_named_mutex_enforces_single_primary_until_dropped() {
        let name = format!(r"Local\Semyra_Test_Mutex_{}", std::process::id());
        let first = match try_acquire(&name) {
            AcquireOutcome::Primary(guard) => guard,
            _ => panic!("expected first acquire to become primary"),
        };
        assert!(matches!(try_acquire(&name), AcquireOutcome::AlreadyExists));
        drop(first);
        assert!(matches!(try_acquire(&name), AcquireOutcome::Primary(_)));
    }

    #[test]
    fn timed_out_secondary_does_not_overwrite_or_delete_primary_instance_lock() {
        let dir = std::env::temp_dir().join(format!("semyra-single-inst-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let lock_path = dir.join("instance.json");
        let mutex_name = format!(r"Local\Semyra_Test_Ownership_{}", std::process::id());

        let primary = PrimaryOwnership::new();
        let role_primary = negotiate_with(&primary, &mutex_name, &lock_path, &[], &None, false, 1);
        assert_eq!(role_primary, StartupRole::Primary);
        assert!(write_instance_lock_file(&primary, &lock_path, 45678, "primary-token"));

        let secondary = PrimaryOwnership::new();
        let role_secondary = negotiate_with(&secondary, &mutex_name, &lock_path, &[], &None, false, 1);
        assert_eq!(role_secondary, StartupRole::Secondary);
        assert!(!secondary.owns_primary_lock());
        assert!(!write_instance_lock_file(&secondary, &lock_path, 11111, "hijack-token"));

        let on_disk: InstanceLockInfo = serde_json::from_slice(&fs::read(&lock_path).unwrap()).unwrap();
        assert_eq!(on_disk.port, 45678);
        assert_eq!(on_disk.token, "primary-token");

        cleanup_with(&secondary, &lock_path);
        assert!(lock_path.exists(), "secondary cleanup must not delete primary instance.json");

        cleanup_with(&primary, &lock_path);
        assert!(!lock_path.exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
