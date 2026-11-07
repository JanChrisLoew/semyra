/// Shared procedural Windows 11 Fluent icon generator used by both `build.rs` (multi-DPI `.ico`)
/// and `src/main.rs` (runtime `tao::window::Icon`).

/// Renders the MarkLive rounded-badge icon into top-down `RGBA` bytes (`size * size * 4`).
pub fn render_marklive_rgba(size: u32) -> Vec<u8> {
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

            // Fluent Blue-Indigo diagonal gradient
            let t = ((dx + dy) / (2.0 * s)).clamp(0.0, 1.0);
            let mut r = 37.0 * (1.0 - t) + 99.0 * t;
            let mut g = 99.0 * (1.0 - t) + 102.0 * t;
            let mut b = 235.0 * (1.0 - t) + 241.0 * t;

            // Subtle top specular highlight
            if dy < s * 0.22 {
                let hl = (1.0 - dy / (s * 0.22)) * 0.14;
                r += (255.0 - r) * hl;
                g += (255.0 - g) * hl;
                b += (255.0 - b) * hl;
            }

            // Crisp white "M" + Markdown downward arrow in normalized [0..1] coords
            let nx = dx / s;
            let ny = dy / s;
            let mut fg = false;

            if (0.28..=0.72).contains(&ny) {
                if (0.20..=0.28).contains(&nx) || (0.50..=0.58).contains(&nx) {
                    fg = true;
                }
                let diag_y = (ny - 0.28) / 0.30;
                if (0.0..=1.0).contains(&diag_y) {
                    let tl = 0.24 + diag_y * 0.15;
                    let tr = 0.54 - diag_y * 0.15;
                    if (nx - tl).abs() < 0.044 || (nx - tr).abs() < 0.044 {
                        fg = true;
                    }
                }
            }

            if (0.30..=0.62).contains(&ny) && (0.70..=0.78).contains(&nx) {
                fg = true;
            }
            if (0.54..=0.72).contains(&ny) && (nx - 0.74).abs() <= (0.72 - ny) * 0.85 {
                fg = true;
            }

            if fg {
                r = 255.0;
                g = 255.0;
                b = 255.0;
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
        let rgba = render_marklive_rgba(size);
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
