/// Shared procedural Windows 11 Fluent icon generator used by both `build.rs` (multi-DPI `.ico`)
/// and `src/main.rs` (runtime `tao::window::Icon`).

/// Renders the Semyra rounded-badge icon (Midnight background with geometric S-monogram and Steel Blue accent)
/// into top-down `RGBA` bytes (`size * size * 4`).
pub fn render_semyra_rgba(size: u32) -> Vec<u8> {
    let mut rgba = vec![0u8; (size * size * 4) as usize];
    let s = size as f32;

    for y in 0..size {
        for x in 0..size {
            let dx = x as f32 + 0.5;
            let dy = y as f32 + 0.5;

            let margin = s * 0.06;
            let radius = s * 0.22;
            let half = (s * 0.5) - margin;
            let cx = dx - s * 0.5;
            let cy = dy - s * 0.5;

            let qx = cx.abs() - (half - radius);
            let qy = cy.abs() - (half - radius);
            let dist = (qx.max(0.0).powi(2) + qy.max(0.0).powi(2)).sqrt()
                + qx.min(qy.max(0.0)).min(0.0)
                - radius;

            let alpha = (0.5 - dist).clamp(0.0, 1.0);
            if alpha <= 0.0 {
                continue;
            }

            // Semyra Midnight-to-Slate subtle gradient (#151A22 to #1D2633)
            let t = ((dx + dy) / (2.0 * s)).clamp(0.0, 1.0);
            let mut r = 21.0 * (1.0 - t) + 29.0 * t;
            let mut g = 26.0 * (1.0 - t) + 38.0 * t;
            let mut b = 34.0 * (1.0 - t) + 51.0 * t;

            // Subtle top specular highlight (Windows 11 Fluent)
            if dy < s * 0.22 {
                let hl = (1.0 - dy / (s * 0.22)) * 0.16;
                r += (255.0 - r) * hl;
                g += (255.0 - g) * hl;
                b += (255.0 - b) * hl;
            }

            // Geometric "S" Monogram in normalized coords [0..1]
            // Composed of structured Markdown-inspired segments:
            // Top bar, upper-left stem, middle bar, lower-right stem, bottom bar
            let nx = dx / s;
            let ny = dy / s;

            let mut is_fg = false;
            let mut is_accent = false;

            // 1. Top bar: ny in [0.26, 0.35], nx in [0.30, 0.63]
            if (0.26..=0.35).contains(&ny) && (0.30..=0.63).contains(&nx) {
                is_fg = true;
            }
            // 2. Steel-Blue Accent block at upper right: ny in [0.26, 0.35], nx in [0.64..0.72]
            if (0.26..=0.35).contains(&ny) && (0.64..=0.72).contains(&nx) {
                is_accent = true;
            }
            // 3. Upper-left vertical spine: ny in [0.33, 0.52], nx in [0.30, 0.40]
            if (0.33..=0.52).contains(&ny) && (0.30..=0.40).contains(&nx) {
                is_fg = true;
            }
            // 4. Middle horizontal bar: ny in [0.46, 0.55], nx in [0.30, 0.72]
            if (0.46..=0.55).contains(&ny) && (0.30..=0.72).contains(&nx) {
                is_fg = true;
            }
            // 5. Lower-right vertical spine: ny in [0.49, 0.68], nx in [0.62, 0.72]
            if (0.49..=0.68).contains(&ny) && (0.62..=0.72).contains(&nx) {
                is_fg = true;
            }
            // 6. Bottom bar: ny in [0.65, 0.74], nx in [0.30, 0.72]
            if (0.65..=0.74).contains(&ny) && (0.30..=0.72).contains(&nx) {
                is_fg = true;
            }

            if is_accent {
                // Semyra Steel Blue (#83A5C6 / RGB 131, 165, 198)
                r = 131.0;
                g = 165.0;
                b = 198.0;
            } else if is_fg {
                // Crisp Ice White (#EEF3F7 / RGB 238, 243, 247)
                r = 238.0;
                g = 243.0;
                b = 247.0;
            }

            let idx = ((y * size + x) * 4) as usize;
            rgba[idx] = r.round() as u8;
            rgba[idx + 1] = g.round() as u8;
            rgba[idx + 2] = b.round() as u8;
            rgba[idx + 3] = (alpha * 255.0).round() as u8;
        }
    }

    rgba
}

/// Builds a multi-resolution Windows `.ico` container (`16, 32, 48, 256` px) with 32-bit BGRA DIB frames.
#[allow(dead_code)]
pub fn generate_multi_size_ico(sizes: &[u32]) -> Vec<u8> {
    let mut frames: Vec<(u32, Vec<u8>)> = Vec::with_capacity(sizes.len());

    for &size in sizes {
        let rgba = render_semyra_rgba(size);
        let mut bgra_bottom_up = vec![0u8; rgba.len()];
        for y in 0..size {
            let src_row = (size - 1 - y) as usize;
            for x in 0..size as usize {
                let s_idx = (src_row * size as usize + x) * 4;
                let d_idx = (y as usize * size as usize + x) * 4;
                bgra_bottom_up[d_idx] = rgba[s_idx + 2];
                bgra_bottom_up[d_idx + 1] = rgba[s_idx + 1];
                bgra_bottom_up[d_idx + 2] = rgba[s_idx];
                bgra_bottom_up[d_idx + 3] = rgba[s_idx + 3];
            }
        }

        let and_mask_row_bytes = size.div_ceil(32) * 4;
        let and_mask_size = and_mask_row_bytes * size;
        let dib_header_size = 40u32;
        let frame_len = dib_header_size + (bgra_bottom_up.len() as u32) + and_mask_size;

        let mut frame = Vec::with_capacity(frame_len as usize);
        frame.extend_from_slice(&dib_header_size.to_le_bytes());
        frame.extend_from_slice(&(size as i32).to_le_bytes());
        frame.extend_from_slice(&((size * 2) as i32).to_le_bytes());
        frame.extend_from_slice(&1u16.to_le_bytes());
        frame.extend_from_slice(&32u16.to_le_bytes());
        frame.extend_from_slice(&0u32.to_le_bytes());
        frame.extend_from_slice(&(bgra_bottom_up.len() as u32).to_le_bytes());
        frame.extend_from_slice(&0i32.to_le_bytes());
        frame.extend_from_slice(&0i32.to_le_bytes());
        frame.extend_from_slice(&0u32.to_le_bytes());
        frame.extend_from_slice(&0u32.to_le_bytes());
        frame.extend_from_slice(&bgra_bottom_up);
        frame.resize(frame_len as usize, 0u8);

        frames.push((size, frame));
    }

    let count = frames.len() as u16;
    let header_bytes = 6 + (frames.len() * 16);
    let total_payload: usize = frames.iter().map(|(_, f)| f.len()).sum();
    let mut ico = Vec::with_capacity(header_bytes + total_payload);

    // ICONDIR
    ico.extend_from_slice(&0u16.to_le_bytes());
    ico.extend_from_slice(&1u16.to_le_bytes());
    ico.extend_from_slice(&count.to_le_bytes());

    let mut current_offset = header_bytes as u32;
    for (size, frame) in &frames {
        let dim_byte = if *size >= 256 { 0u8 } else { *size as u8 };
        ico.push(dim_byte);
        ico.push(dim_byte);
        ico.push(0);
        ico.push(0);
        ico.extend_from_slice(&1u16.to_le_bytes());
        ico.extend_from_slice(&32u16.to_le_bytes());
        ico.extend_from_slice(&(frame.len() as u32).to_le_bytes());
        ico.extend_from_slice(&current_offset.to_le_bytes());
        current_offset += frame.len() as u32;
    }

    for (_, frame) in frames {
        ico.extend_from_slice(&frame);
    }

    ico
}
