use std::fs;
use std::path::Path;

fn main() {
    println!("cargo:rerun-if-changed=frontend/dist");
    println!("cargo:rerun-if-changed=assets/icon.ico");

    // Ensure frontend/dist exists so RustEmbed compiles even during initial cargo check
    let dist_dir = Path::new("frontend/dist");
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

    // Generate a clean Windows 11 multi-resolution icon if not yet present
    let assets_dir = Path::new("assets");
    let icon_path = assets_dir.join("icon.ico");
    if !icon_path.exists() {
        let _ = fs::create_dir_all(assets_dir);
        let ico_bytes = generate_marklive_ico(64);
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

/// Generates a crisp 32-bit BGRA ICO image with a Windows 11 Fluent gradient badge and "M" glyph.
fn generate_marklive_ico(size: u32) -> Vec<u8> {
    let mut pixels = vec![0u8; (size * size * 4) as usize];
    let s = size as f32;

    for y in 0..size {
        for x in 0..size {
            // Note: BMP inside ICO is stored bottom-up!
            let draw_y = (size - 1 - y) as f32;
            let draw_x = x as f32;

            // Rounded rectangle SDF
            let margin = s * 0.06;
            let radius = s * 0.22;
            let half = (s * 0.5) - margin;
            let cx = draw_x - s * 0.5;
            let cy = draw_y - s * 0.5;

            let qx = cx.abs() - (half - radius);
            let qy = cy.abs() - (half - radius);
            let dist = (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt()
                + qx.min(qy.max(0.0)).min(0.0)
                - radius;

            let alpha = (0.5 - dist).clamp(0.0, 1.0);
            if alpha <= 0.0 {
                continue;
            }

            // Fluent Blue-Indigo diagonal gradient
            let t = ((draw_x + draw_y) / (2.0 * s)).clamp(0.0, 1.0);
            let mut r = 37.0 * (1.0 - t) + 99.0 * t;
            let mut g = 99.0 * (1.0 - t) + 102.0 * t;
            let mut b = 235.0 * (1.0 - t) + 241.0 * t;

            // Subtle top highlight
            if draw_y < s * 0.22 {
                let hl = (1.0 - draw_y / (s * 0.22)) * 0.14;
                r = r + (255.0 - r) * hl;
                g = g + (255.0 - g) * hl;
                b = b + (255.0 - b) * hl;
            }

            // Crisp white "M" + down-arrow Markdown motif in normalized [0..1] coords
            let nx = draw_x / s;
            let ny = draw_y / s;
            let mut fg = false;

            // Left & middle-V & right strokes of 'M' (x in 0.20..0.58, y in 0.28..0.72)
            if (0.28..=0.72).contains(&ny) {
                // Left vertical bar
                if (0.20..=0.28).contains(&nx) {
                    fg = true;
                }
                // Right vertical bar of M
                if (0.50..=0.58).contains(&nx) {
                    fg = true;
                }
                // Left diagonal of M
                let diag_y = (ny - 0.28) / 0.30; // 0..1
                if (0.0..=1.0).contains(&diag_y) {
                    let target_x_l = 0.24 + diag_y * 0.15;
                    let target_x_r = 0.54 - diag_y * 0.15;
                    if (nx - target_x_l).abs() < 0.042 || (nx - target_x_r).abs() < 0.042 {
                        fg = true;
                    }
                }
            }

            // Downward arrow on the right (x around 0.74, y in 0.30..0.72)
            if (0.30..=0.62).contains(&ny) && (0.70..=0.78).contains(&nx) {
                fg = true;
            }
            if (0.54..=0.72).contains(&ny) {
                let arrow_w = (0.72 - ny) * 0.85;
                if (nx - 0.74).abs() <= arrow_w {
                    fg = true;
                }
            }

            if fg {
                r = 255.0;
                g = 255.0;
                b = 255.0;
            }

            let idx = ((y * size + x) * 4) as usize;
            pixels[idx] = b.round() as u8;
            pixels[idx + 1] = g.round() as u8;
            pixels[idx + 2] = r.round() as u8;
            pixels[idx + 3] = (alpha * 255.0).round() as u8;
        }
    }

    let and_mask_row_bytes = ((size + 31) / 32) * 4;
    let and_mask_size = and_mask_row_bytes * size;
    let dib_header_size = 40u32;
    let image_data_size = dib_header_size + (pixels.len() as u32) + and_mask_size;

    let mut ico = Vec::with_capacity(22 + image_data_size as usize);
    // ICONDIR
    ico.extend_from_slice(&0u16.to_le_bytes()); // reserved
    ico.extend_from_slice(&1u16.to_le_bytes()); // type = 1 (ICO)
    ico.extend_from_slice(&1u16.to_le_bytes()); // count = 1

    // ICONDIRENTRY
    ico.push(if size >= 256 { 0 } else { size as u8 });
    ico.push(if size >= 256 { 0 } else { size as u8 });
    ico.push(0); // palette
    ico.push(0); // reserved
    ico.extend_from_slice(&1u16.to_le_bytes()); // color planes
    ico.extend_from_slice(&32u16.to_le_bytes()); // bits per pixel
    ico.extend_from_slice(&image_data_size.to_le_bytes());
    ico.extend_from_slice(&22u32.to_le_bytes()); // offset

    // BITMAPINFOHEADER
    ico.extend_from_slice(&dib_header_size.to_le_bytes());
    ico.extend_from_slice(&(size as i32).to_le_bytes());
    ico.extend_from_slice(&((size * 2) as i32).to_le_bytes()); // height * 2 for XOR + AND mask
    ico.extend_from_slice(&1u16.to_le_bytes()); // planes
    ico.extend_from_slice(&32u16.to_le_bytes()); // bitcount
    ico.extend_from_slice(&0u32.to_le_bytes()); // BI_RGB
    ico.extend_from_slice(&(pixels.len() as u32).to_le_bytes());
    ico.extend_from_slice(&0i32.to_le_bytes());
    ico.extend_from_slice(&0i32.to_le_bytes());
    ico.extend_from_slice(&0u32.to_le_bytes());
    ico.extend_from_slice(&0u32.to_le_bytes());

    ico.extend_from_slice(&pixels);
    ico.extend(std::iter::repeat(0u8).take(and_mask_size as usize));
    ico
}
