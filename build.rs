use std::env;
use std::fs;
use std::path::Path;

#[path = "src/icon_gen.rs"]
mod icon_gen;

fn main() {
    println!("cargo:rerun-if-changed=frontend/dist");
    println!("cargo:rerun-if-changed=src/icon_gen.rs");

    let profile = env::var("PROFILE").unwrap_or_default();
    let dist_dir = Path::new("frontend/dist");
    let dist_assets = dist_dir.join("assets");

    // Guard release builds against missing or placeholder frontend bundles
    if profile == "release" && !dist_assets.exists() {
        panic!(
            "frontend/dist/assets fehlt für den Release-Build! \
             Bitte zuerst 'cd frontend && npm run build' oder '.\\scripts\\Build-Release.ps1' ausführen."
        );
    }

    // Ensure frontend/dist exists so RustEmbed compiles cleanly during initial `cargo check` / `cargo test`
    if !dist_dir.exists() {
        let _ = fs::create_dir_all(dist_dir);
        let placeholder = dist_dir.join("index.html");
        if !placeholder.exists() {
            let _ = fs::write(
                placeholder,
                "<!doctype html><html><body>Building frontend...</body></html>",
            );
        }
    }

    // Generate crisp multi-DPI Windows 11 icon (16, 32, 48, 256 px) when missing or legacy single-frame
    let assets_dir = Path::new("assets");
    let icon_path = assets_dir.join("icon.ico");
    let needs_regen = match fs::metadata(&icon_path) {
        Ok(meta) => meta.len() < 30_000,
        Err(_) => true,
    };
    if needs_regen {
        let _ = fs::create_dir_all(assets_dir);
        let ico_bytes = icon_gen::generate_multi_size_ico(&[16, 32, 48, 256]);
        let _ = fs::write(&icon_path, ico_bytes);
    }

    #[cfg(windows)]
    {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("assets/icon.ico");
        res.set("ProductName", "MarkLive");
        res.set("FileDescription", "MarkLive – Windows 11 Markdown Live-Editor");
        res.set("LegalCopyright", "Copyright © 2026");
        if let Err(err) = res.compile() {
            println!("cargo:warning=Could not compile Windows resource: {err}");
        }
    }
}
