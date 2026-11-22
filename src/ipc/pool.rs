use super::err_json;
use http::{Response, StatusCode};
use std::borrow::Cow;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use wry::RequestAsyncResponder;

type WorkerJob = Box<dyn FnOnce() + Send + 'static>;

/// Runs IPC jobs off the UI thread with a fixed number of workers and a FIFO queue.
pub(super) struct WorkerPool {
    sender: Sender<WorkerJob>,
}

pub(super) fn default_worker_count() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(4, 8)
}

impl WorkerPool {
    pub(super) fn new(name: &str, size: usize) -> Self {
        let count = size.max(1);
        let (sender, receiver) = mpsc::channel::<WorkerJob>();
        let shared_rx = Arc::new(Mutex::new(receiver));
        let mut spawned = 0usize;

        for idx in 0..count {
            let rx = Arc::clone(&shared_rx);
            let pool_name = name.to_owned();
            match std::thread::Builder::new()
                .name(format!("semyra-ipc-{name}-{idx}"))
                .spawn(move || loop {
                    let job = {
                        let Ok(guard) = rx.lock() else {
                            break;
                        };
                        guard.recv()
                    };
                    match job {
                        Ok(task) => {
                            if std::panic::catch_unwind(std::panic::AssertUnwindSafe(task)).is_err()
                            {
                                eprintln!("IPC-Worker-Panik in Pool '{pool_name}' abgefangen.");
                            }
                        }
                        Err(_) => break,
                    }
                }) {
                Ok(_) => spawned += 1,
                Err(err) => {
                    eprintln!("Worker-Thread {idx} für Pool '{name}' konnte nicht gestartet werden: {err}");
                }
            }
        }

        if spawned == 0 {
            crate::show_fatal_error_and_exit(
                "Semyra – Thread-Pool-Fehler",
                &format!("Kein Worker-Thread für IPC-Pool '{name}' verfügbar."),
            );
        }
        Self { sender }
    }

    pub(super) fn execute(&self, job: impl FnOnce() + Send + 'static) {
        if let Err(err) = self.sender.send(Box::new(job)) {
            eprintln!("IPC-Job konnte nicht eingereiht werden: {err}");
        }
    }
}

pub(super) fn ipc_worker_pool() -> &'static WorkerPool {
    static POOL: OnceLock<WorkerPool> = OnceLock::new();
    POOL.get_or_init(|| WorkerPool::new("general", default_worker_count()))
}

pub(crate) fn spawn_background(job: impl FnOnce() + Send + 'static) {
    ipc_worker_pool().execute(job);
}

pub(super) fn draft_worker_pool() -> &'static WorkerPool {
    static POOL: OnceLock<WorkerPool> = OnceLock::new();
    POOL.get_or_init(|| WorkerPool::new("drafts", 1))
}

pub(super) fn dialog_worker_pool() -> &'static WorkerPool {
    static POOL: OnceLock<WorkerPool> = OnceLock::new();
    POOL.get_or_init(|| WorkerPool::new("dialogs", 1))
}

pub(super) fn search_worker_pool() -> &'static WorkerPool {
    static POOL: OnceLock<WorkerPool> = OnceLock::new();
    POOL.get_or_init(|| WorkerPool::new("search", 2))
}

pub(super) fn render_worker_pool(doc_key: Option<&str>) -> &'static WorkerPool {
    if doc_key == Some("live") {
        static POOL: OnceLock<WorkerPool> = OnceLock::new();
        return POOL.get_or_init(|| WorkerPool::new("preview", 1));
    }
    ipc_worker_pool()
}

pub(super) struct ResponderGuard(Option<RequestAsyncResponder>);

impl ResponderGuard {
    pub(super) fn new(responder: RequestAsyncResponder) -> Self {
        Self(Some(responder))
    }

    pub(super) fn respond(mut self, response: Response<Cow<'static, [u8]>>) {
        if let Some(responder) = self.0.take() {
            responder.respond(response);
        }
    }
}

impl Drop for ResponderGuard {
    fn drop(&mut self) {
        if let Some(responder) = self.0.take() {
            responder.respond(err_json(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Interner Serverfehler bei der Verarbeitung der Anfrage.",
            ));
        }
    }
}

static DIALOG_ACTIVE: AtomicBool = AtomicBool::new(false);

pub(crate) fn is_dialog_active() -> bool {
    DIALOG_ACTIVE.load(Ordering::SeqCst)
}

pub(super) struct DialogActiveGuard;

impl DialogActiveGuard {
    pub(super) fn try_acquire() -> Option<Self> {
        DIALOG_ACTIVE
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .ok()
            .map(|_| Self)
    }
}

impl Drop for DialogActiveGuard {
    fn drop(&mut self) {
        DIALOG_ACTIVE.store(false, Ordering::SeqCst);
    }
}
