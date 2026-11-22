use super::pool::{render_worker_pool, ResponderGuard};
use super::{err_json, ok_json};
use crate::markdown::render_markdown;
use http::StatusCode;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

/// Tracks the latest queued revision token per document key so stale render jobs
/// can be skipped without running `pulldown-cmark` / `syntect`.
#[derive(Default)]
pub(super) struct RenderCoalesceState {
    pub(super) entries: HashMap<String, (u64, u64)>,
    next_touch: u64,
}

#[derive(Default)]
pub(super) struct RenderCoalescer {
    pub(super) state: Mutex<RenderCoalesceState>,
}

impl RenderCoalescer {
    pub(super) const MAX_KEYS: usize = 256;

    pub(super) fn register(&self, key: &str, client_revision: Option<u64>) -> u64 {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        state.next_touch = state.next_touch.saturating_add(1);
        let touch = state.next_touch;

        if !state.entries.contains_key(key) && state.entries.len() >= Self::MAX_KEYS {
            if let Some(oldest_key) = state
                .entries
                .iter()
                .min_by_key(|(_, (_, last_touch))| *last_touch)
                .map(|(k, _)| k.clone())
            {
                state.entries.remove(&oldest_key);
            }
        }

        let entry = state.entries.entry(key.to_string()).or_insert((0, touch));
        entry.1 = touch;
        match client_revision {
            Some(rev) if rev > entry.0 => {
                entry.0 = rev;
                rev
            }
            Some(rev) => rev,
            None => {
                entry.0 = entry.0.saturating_add(1);
                entry.0
            }
        }
    }

    pub(super) fn is_superseded(&self, key: &str, token: u64) -> bool {
        let state = self
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        state
            .entries
            .get(key)
            .is_some_and(|&(latest, _)| latest > token)
    }
}

pub(super) fn render_coalescer() -> &'static RenderCoalescer {
    static COALESCER: OnceLock<RenderCoalescer> = OnceLock::new();
    COALESCER.get_or_init(RenderCoalescer::default)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenderReq {
    markdown: String,
    base_dir: Option<String>,
    #[serde(default)]
    doc_key: Option<String>,
    #[serde(default)]
    revision: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SupersededDocStats {
    pub(super) words: usize,
    pub(super) chars: usize,
    pub(super) lines: usize,
    pub(super) reading_time_sec: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SupersededRenderResult {
    pub(super) superseded: bool,
    pub(super) html: &'static str,
    pub(super) outline: [(); 0],
    pub(super) stats: SupersededDocStats,
}

impl Default for SupersededRenderResult {
    fn default() -> Self {
        Self {
            superseded: true,
            html: "",
            outline: [],
            stats: SupersededDocStats {
                words: 0,
                chars: 0,
                lines: 0,
                reading_time_sec: 0,
            },
        }
    }
}

pub(super) fn handle_render(body: &[u8], responder: ResponderGuard) {
    let Ok(req) = serde_json::from_slice::<RenderReq>(body) else {
        responder.respond(err_json(StatusCode::BAD_REQUEST, "Ungültige Render-Anfrage"));
        return;
    };
    let doc_key = req
        .doc_key
        .as_deref()
        .map(str::trim)
        .filter(|key| !key.is_empty());
    let worker_pool = render_worker_pool(doc_key);
    let coalesce = doc_key.map(|key| {
        let token = render_coalescer().register(key, req.revision);
        (key.to_owned(), token)
    });
    worker_pool.execute(move || {
        if let Some((ref coalesce_key, token)) = coalesce {
            if render_coalescer().is_superseded(coalesce_key, token) {
                responder.respond(ok_json(&SupersededRenderResult::default()));
                return;
            }
        }
        let base = req.base_dir.as_deref().map(Path::new);
        let result = render_markdown(&req.markdown, base);
        responder.respond(ok_json(&result));
    });
}
