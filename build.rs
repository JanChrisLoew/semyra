use std::env;
use std::fs;
use std::path::{Path, PathBuf};

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

    // Generate crisp multi-DPI Semyra icon (16, 32, 48, 256 px) into OUT_DIR
    let ico_bytes = icon_gen::generate_multi_size_ico(&[16, 32, 48, 256]);
    let out_dir = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR muss von Cargo gesetzt sein"));
    let out_icon_path = out_dir.join("icon.ico");
    fs::write(&out_icon_path, &ico_bytes).expect("OUT_DIR/icon.ico konnte nicht geschrieben werden");

    // Keep assets/icon.ico in sync for installer/Semyra.iss without writing when unchanged
    let assets_dir = Path::new("assets");
    let repo_icon_path = assets_dir.join("icon.ico");
    let repo_needs_update = match fs::read(&repo_icon_path) {
        Ok(existing) => existing != ico_bytes,
        Err(_) => true,
    };
    if repo_needs_update {
        fs::create_dir_all(assets_dir).expect("assets-Verzeichnis konnte nicht erstellt werden");
        fs::write(&repo_icon_path, &ico_bytes).expect("assets/icon.ico konnte nicht geschrieben werden");
    }

    #[cfg(windows)]
    {
        let mut res = winresource::WindowsResource::new();
        res.set_icon(&out_icon_path.to_string_lossy());
        res.set("ProductName", "Semyra");
        res.set("FileDescription", "Semyra – Markdown for the AI era");
        res.set("LegalCopyright", "Copyright © 2026");
        if let Err(err) = res.compile() {
            println!("cargo:warning=Could not compile Windows resource: {err}");
        }
    }
}
