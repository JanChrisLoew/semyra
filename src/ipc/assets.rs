use super::pool::{ipc_worker_pool, ResponderGuard};
use super::{err_json, query_param};
use crate::state::AppState;
use http::{Response, StatusCode};
use std::borrow::Cow;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_LOCAL_ASSET_BYTES: u64 = 50 * 1024 * 1024;

pub(super) struct LocalAssetHeaders {
    pub(super) content_type: String,
    pub(super) csp: Option<&'static str>,
    pub(super) content_disposition: Option<&'static str>,
}

pub(super) fn classify_local_asset_headers(mime: &mime_guess::Mime) -> LocalAssetHeaders {
    let essence = mime.essence_str();
    let is_safe_raster_or_media = matches!(
        essence,
        "image/png"
            | "image/jpeg"
            | "image/gif"
            | "image/webp"
            | "image/bmp"
            | "image/x-icon"
            | "image/vnd.microsoft.icon"
            | "image/avif"
    ) || mime.type_() == "video"
        || mime.type_() == "audio";

    if is_safe_raster_or_media {
        LocalAssetHeaders {
            content_type: mime.to_string(),
            csp: None,
            content_disposition: None,
        }
    } else if essence == "image/svg+xml" {
        LocalAssetHeaders {
            content_type: "image/svg+xml".to_string(),
            csp: Some("sandbox"),
            content_disposition: None,
        }
    } else {
        LocalAssetHeaders {
            content_type: "application/octet-stream".to_string(),
            csp: Some("sandbox"),
            content_disposition: Some("attachment"),
        }
    }
}

pub(super) fn read_bounded_local_asset(
    target: &Path,
    max_bytes: u64,
) -> Result<Vec<u8>, (StatusCode, &'static str)> {
    use std::io::Read;

    let file = match fs::File::open(target) {
        Ok(file) => file,
        Err(_) if target.is_dir() => {
            return Err((
                StatusCode::BAD_REQUEST,
                "Pfad verweist nicht auf eine Datei.",
            ));
        }
        Err(_) => return Err((StatusCode::NOT_FOUND, "Bilddatei nicht gefunden.")),
    };
    let meta = file
        .metadata()
        .map_err(|_| (StatusCode::NOT_FOUND, "Bilddatei nicht gefunden."))?;
    if !meta.is_file() {
        return Err((
            StatusCode::BAD_REQUEST,
            "Pfad verweist nicht auf eine Datei.",
        ));
    }
    if meta.len() > max_bytes {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            "Lokale Ressource überschreitet das Größenlimit von 50 MB.",
        ));
    }
    let mut bytes = Vec::with_capacity((meta.len() as usize).min(1024 * 1024));
    file.take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|_| (StatusCode::NOT_FOUND, "Bilddatei nicht gefunden."))?;
    if bytes.len() as u64 > max_bytes {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            "Lokale Ressource überschreitet das Größenlimit von 50 MB.",
        ));
    }
    Ok(bytes)
}

pub(super) fn handle_local_asset(
    query: Option<&str>,
    state: AppState,
    responder: ResponderGuard,
) {
    let Some(raw_path) = query_param(query, "path") else {
        responder.respond(err_json(StatusCode::BAD_REQUEST, "Fehlender Pfadparameter."));
        return;
    };
    ipc_worker_pool().execute(move || {
        let target = PathBuf::from(&raw_path);
        if !state.is_local_asset_allowed(&target) {
            responder.respond(err_json(
                StatusCode::FORBIDDEN,
                "Zugriff auf lokale Ressource außerhalb geöffneter Ordner verweigert.",
            ));
            return;
        }
        match read_bounded_local_asset(&target, MAX_LOCAL_ASSET_BYTES) {
            Ok(bytes) => {
                let mime = mime_guess::from_path(&target).first_or_octet_stream();
                let headers = classify_local_asset_headers(&mime);
                let mut builder = Response::builder()
                    .status(StatusCode::OK)
                    .header("Content-Type", headers.content_type)
                    .header("X-Content-Type-Options", "nosniff")
                    .header("Cache-Control", "no-cache");
                if let Some(csp) = headers.csp {
                    builder = builder.header("Content-Security-Policy", csp);
                }
                if let Some(disp) = headers.content_disposition {
                    builder = builder.header("Content-Disposition", disp);
                }
                let resp = builder.body(Cow::Owned(bytes)).unwrap();
                responder.respond(resp);
            }
            Err((status, msg)) => {
                responder.respond(err_json(status, msg));
            }
        }
    });
}
