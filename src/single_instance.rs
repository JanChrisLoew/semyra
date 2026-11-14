use crate::state::UserEvent;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tao::event_loop::EventLoopProxy;

const SINGLE_INSTANCE_MUTEX_NAME: &str = r"Local\Semyra_SingleInstance_v1";

static IS_PRIMARY_INSTANCE: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "windows")]
static PRIMARY_MUTEX: Mutex<Option<win32_mutex::NamedMutex>> = Mutex::new(None);

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

fn forward_once(files: &[PathBuf], folder: &Option<PathBuf>) -> Result<bool, ()> {
    let lock_path = lock_file_path();
    let Ok(bytes) = fs::read(&lock_path) else {
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

/// Attempts to forward CLI targets to an already running Semyra instance.
/// Returns `true` if another primary instance accepted the payload so this process can exit.
pub fn try_forward_to_running_instance(
    files: &[PathBuf],
    folder: &Option<PathBuf>,
) -> bool {
    #[cfg(target_os = "windows")]
    {
        match win32_mutex::try_acquire(SINGLE_INSTANCE_MUTEX_NAME) {
            win32_mutex::AcquireOutcome::Primary(mutex) => {
                if let Ok(mut guard) = PRIMARY_MUTEX.lock() {
                    *guard = Some(mutex);
                }
                IS_PRIMARY_INSTANCE.store(true, Ordering::SeqCst);
                let _ = fs::remove_file(lock_file_path());
                return false;
            }
            win32_mutex::AcquireOutcome::AlreadyExists => {
                // Another primary instance holds the Win32 mutex; wait briefly in case it is
                // still binding its localhost listener and writing `instance.json`.
                for _ in 0..25 {
                    if let Ok(true) = forward_once(files, folder) {
                        return true;
                    }
                    std::thread::sleep(Duration::from_millis(40));
                }
                return false;
            }
            win32_mutex::AcquireOutcome::Failed => {}
        }
    }

    match forward_once(files, folder) {
        Ok(accepted) => accepted,
        Err(()) => {
            let _ = fs::remove_file(lock_file_path());
            false
        }
    }
}

/// Starts a lightweight localhost listener that receives file/folder open requests from secondary launches.
pub fn start_primary_instance_listener(proxy: EventLoopProxy<UserEvent>) {
    #[cfg(target_os = "windows")]
    {
        if let Ok(mut guard) = PRIMARY_MUTEX.lock() {
            if guard.is_none() {
                if let win32_mutex::AcquireOutcome::Primary(mutex) =
                    win32_mutex::try_acquire(SINGLE_INSTANCE_MUTEX_NAME)
                {
                    *guard = Some(mutex);
                }
            }
        }
    }
    IS_PRIMARY_INSTANCE.store(true, Ordering::SeqCst);

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
    if let Some(parent) = lock_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(bytes) = serde_json::to_vec(&InstanceLockInfo {
        port: local_addr.port(),
        token: token.clone(),
    }) {
        let _ = crate::fs_ops::encoding::write_file_atomically(&lock_path, &bytes);
    }

    std::thread::spawn(move || {
        for incoming in listener.incoming().flatten() {
            let mut stream = incoming;
            let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
            let mut buf = Vec::with_capacity(512);
            if (&mut stream).take(65_536).read_to_end(&mut buf).is_ok() {
                if let Ok(msg) = serde_json::from_slice::<ForwardedArgs>(&buf) {
                    if msg.token == token {
                        let _ = stream.write_all(b"OK");
                        let _ = proxy.send_event(UserEvent::ActivateAndOpen {
                            files: msg.files,
                            folder: msg.folder,
                        });
                    }
                }
            }
        }
    });
}

pub fn cleanup_instance_lock() {
    if !IS_PRIMARY_INSTANCE.swap(false, Ordering::SeqCst) {
        return;
    }
    let _ = fs::remove_file(lock_file_path());
    #[cfg(target_os = "windows")]
    if let Ok(mut guard) = PRIMARY_MUTEX.lock() {
        *guard = None;
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::win32_mutex::{try_acquire, AcquireOutcome};

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
}
