use crate::state::UserEvent;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tao::event_loop::EventLoopProxy;

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

/// Attempts to forward CLI targets to an already running Semyra instance.
/// Returns `true` if another primary instance accepted the payload so this process can exit.
pub fn try_forward_to_running_instance(
    files: &[PathBuf],
    folder: &Option<PathBuf>,
) -> bool {
    let lock_path = lock_file_path();
    let Ok(bytes) = fs::read(&lock_path) else {
        return false;
    };
    let Ok(info) = serde_json::from_slice::<InstanceLockInfo>(&bytes) else {
        return false;
    };

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], info.port));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(250)) else {
        let _ = fs::remove_file(&lock_path);
        return false;
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
        return false;
    };
    if stream.write_all(&json).is_err() {
        return false;
    }
    let _ = stream.shutdown(std::net::Shutdown::Write);

    let mut ack = [0u8; 2];
    matches!(stream.read(&mut ack), Ok(2) if &ack == b"OK")
}

/// Starts a lightweight localhost listener that receives file/folder open requests from secondary launches.
pub fn start_primary_instance_listener(proxy: EventLoopProxy<UserEvent>) {
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
        let _ = fs::write(&lock_path, bytes);
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
    let _ = fs::remove_file(lock_file_path());
}
