use base64::Engine;
use percent_encoding::percent_decode_str;
use std::fs;
use std::path::Path;

const MAX_INLINE_IMAGE_BYTES: u64 = 15 * 1024 * 1024;

/// Replaces `/api/local-asset?path=...` image sources in rendered HTML with self-contained
/// `data:<mime>;base64,...` URIs, strictly enforcing `is_allowed` per Security Invariant #1.
pub fn inline_local_asset_images<F>(html: &str, is_allowed: F) -> String
where
    F: Fn(&Path) -> bool,
{
    let mut out = String::with_capacity(html.len());
    let mut rest = html;

    while let Some(src_idx) = rest.find("src=\"") {
        let after_attr = src_idx + 5;
        out.push_str(&rest[..after_attr]);
        rest = &rest[after_attr..];

        let Some(end_quote) = rest.find('"') else {
            out.push_str(rest);
            return out;
        };

        let raw_url = &rest[..end_quote];
        if let Some(local_path_encoded) = extract_local_asset_query_path(raw_url) {
            let decoded = percent_decode_str(local_path_encoded)
                .decode_utf8_lossy()
                .into_owned();
            let candidate = Path::new(&decoded);
            if let Some(data_uri) = try_encode_allowed_image(candidate, &is_allowed) {
                out.push_str(&data_uri);
            } else {
                out.push_str(raw_url);
            }
        } else {
            out.push_str(raw_url);
        }

        out.push('"');
        rest = &rest[end_quote + 1..];
    }

    out.push_str(rest);
    out
}

fn extract_local_asset_query_path(url: &str) -> Option<&str> {
    let idx = url.find("/api/local-asset?")?;
    let prefix = &url[..idx];
    if !prefix.is_empty()
        && prefix != "https://marklive.localhost"
        && prefix != "http://marklive.localhost"
        && prefix != "marklive://localhost"
    {
        return None;
    }
    let query = &url[idx + "/api/local-asset?".len()..];
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        if parts.next() == Some("path") {
            return parts.next();
        }
    }
    None
}

fn try_encode_allowed_image<F>(candidate: &Path, is_allowed: &F) -> Option<String>
where
    F: Fn(&Path) -> bool,
{
    if !is_allowed(candidate) {
        return None;
    }
    let meta = fs::metadata(candidate).ok()?;
    if !meta.is_file() || meta.len() > MAX_INLINE_IMAGE_BYTES {
        return None;
    }
    let bytes = fs::read(candidate).ok()?;
    let mime = mime_guess::from_path(candidate)
        .first_or_octet_stream()
        .to_string();
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some(format!("data:{mime};base64,{encoded}"))
}

pub fn build_standalone_html_document(title: &str, rendered_body_html: &str) -> String {
    let mut escaped_title = String::new();
    for ch in title.chars() {
        match ch {
            '&' => escaped_title.push_str("&amp;"),
            '<' => escaped_title.push_str("&lt;"),
            '>' => escaped_title.push_str("&gt;"),
            '"' => escaped_title.push_str("&quot;"),
            _ => escaped_title.push(ch),
        }
    }

    format!(
        r#"<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>{escaped_title}</title>
  <style>
    :root {{
      color-scheme: light dark;
      --bg: #ffffff;
      --fg: #181c24;
      --muted: #59636e;
      --border: #d1d9e0;
      --surface: #f6f8fa;
      --accent: #005fb8;
    }}
    @media (prefers-color-scheme: dark) {{
      :root {{
        --bg: #0d1117;
        --fg: #e6edf3;
        --muted: #8b949e;
        --border: #30363d;
        --surface: #161b22;
        --accent: #60cdff;
      }}
    }}
    *, *::before, *::after {{ box-sizing: border-box; }}
    body {{
      max-width: 860px;
      margin: 2.5rem auto;
      padding: 0 1.5rem 4rem;
      font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
      font-size: 16px;
      line-height: 1.72;
      background: var(--bg);
      color: var(--fg);
      word-wrap: break-word;
    }}
    h1, h2, h3, h4, h5, h6 {{ line-height: 1.28; margin-top: 1.55em; margin-bottom: 0.55em; font-weight: 650; }}
    h1, h2 {{ border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }}
    p, ul, ol, blockquote {{ margin-top: 0; margin-bottom: 1em; }}
    li + li {{ margin-top: 0.28em; }}
    input.task-checkbox {{ width: 15px; height: 15px; vertical-align: -2px; margin-right: 6px; }}
    code, pre {{ font-family: "Cascadia Code", "Cascadia Mono", Consolas, monospace; font-size: 0.88em; }}
    code {{ background: var(--surface); padding: 0.16em 0.42em; border-radius: 5px; }}
    .code-block-wrapper {{ margin: 1.15em 0; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); overflow: hidden; }}
    .code-block-header {{ display: flex; justify-content: space-between; padding: 5px 12px; border-bottom: 1px solid var(--border); font-size: 0.78rem; color: var(--muted); }}
    .copy-code-btn {{ display: none !important; }}
    pre {{ margin: 0; background: var(--surface); padding: 0.95rem 1.1rem; overflow-x: auto; }}
    .code-block-wrapper pre {{ border: 0; }}
    pre code {{ background: none; padding: 0; font-size: 13.5px; line-height: 1.55; }}
    .hl-comment {{ color: #6e7781; font-style: italic; }}
    .hl-keyword, .hl-storage {{ color: #cf222e; font-weight: 500; }}
    .hl-string {{ color: #0a3069; }}
    .hl-constant, .hl-numeric {{ color: #0550ae; }}
    .hl-entity.hl-name.hl-function, .hl-support.hl-function {{ color: #8250df; }}
    .hl-entity.hl-name.hl-type, .hl-entity.hl-name.hl-class, .hl-entity.hl-name.hl-struct {{ color: #953800; }}
    @media (prefers-color-scheme: dark) {{
      .hl-comment {{ color: #8b949e; }}
      .hl-keyword, .hl-storage {{ color: #ff7b72; }}
      .hl-string {{ color: #a5d6ff; }}
      .hl-constant, .hl-numeric {{ color: #79c0ff; }}
      .hl-entity.hl-name.hl-function, .hl-support.hl-function {{ color: #d2a8ff; }}
      .hl-entity.hl-name.hl-type, .hl-entity.hl-name.hl-class, .hl-entity.hl-name.hl-struct {{ color: #ffa657; }}
    }}
    blockquote, .gfm-alert {{ margin: 1.1rem 0; padding: 0.75rem 1.05rem; border-left: 4px solid var(--accent); background: var(--surface); border-radius: 0 8px 8px 0; }}
    blockquote > :last-child, .gfm-alert > :last-child {{ margin-bottom: 0; }}
    .gfm-alert-title {{ font-weight: 650; margin-bottom: 0.35rem; }}
    .gfm-alert-note {{ border-left-color: #2f81f7; }}
    .gfm-alert-note .gfm-alert-title {{ color: #2f81f7; }}
    .gfm-alert-tip {{ border-left-color: #2da44e; }}
    .gfm-alert-tip .gfm-alert-title {{ color: #2da44e; }}
    .gfm-alert-important {{ border-left-color: #8250df; }}
    .gfm-alert-important .gfm-alert-title {{ color: #8250df; }}
    .gfm-alert-warning {{ border-left-color: #d29922; }}
    .gfm-alert-warning .gfm-alert-title {{ color: #d29922; }}
    .gfm-alert-caution {{ border-left-color: #cf222e; }}
    .gfm-alert-caution .gfm-alert-title {{ color: #cf222e; }}
    .frontmatter-card {{ margin-bottom: 1.3rem; padding: 0.65rem 0.95rem; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); font-size: 0.9rem; }}
    .frontmatter-card > summary {{ cursor: pointer; font-weight: 600; color: var(--muted); }}
    .table-wrapper {{ overflow-x: auto; margin: 1.2em 0; border: 1px solid var(--border); border-radius: 8px; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 0.92rem; }}
    th, td {{ border-bottom: 1px solid var(--border); border-right: 1px solid var(--border); padding: 0.55rem 0.85rem; text-align: left; }}
    th:last-child, td:last-child {{ border-right: 0; }}
    tbody tr:last-child td {{ border-bottom: 0; }}
    th {{ background: var(--surface); font-weight: 600; }}
    .align-left {{ text-align: left !important; }}
    .align-center {{ text-align: center !important; }}
    .align-right {{ text-align: right !important; }}
    .katex-html {{ display: none !important; }}
    .math-display {{ margin: 1.1em 0; padding: 0.6em 0; overflow-x: auto; text-align: center; }}
    .math-display math, math[display="block"] {{ display: block; font-size: 1.12em; }}
    .mermaid-wrapper {{ margin: 1.2em 0; padding: 1rem; border: 1px solid var(--border); border-radius: 8px; background: #ffffff; color: #181c24; text-align: center; overflow-x: auto; }}
    .mermaid-wrapper svg {{ max-width: 100%; height: auto; }}
    img {{ max-width: 100%; height: auto; border-radius: 6px; }}
    a {{ color: var(--accent); text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}
    hr {{ border: 0; border-top: 1px solid var(--border); margin: 2rem 0; }}
    @media print {{
      h1, h2, h3, h4, h5, h6 {{ break-after: avoid; }}
      .frontmatter-card, .table-wrapper, .code-block-wrapper, .mermaid-wrapper, blockquote, tr {{ break-inside: avoid; }}
    }}
  </style>
</head>
<body>
<article class="markdown-body">
{rendered_body_html}
</article>
</body>
</html>
"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};

    #[test]
    fn escapes_html_title_safely() {
        let doc = build_standalone_html_document("<script>\"Test\" & Co</script>", "<p>Inhalt</p>");
        assert!(doc.contains("<title>&lt;script&gt;&quot;Test&quot; &amp; Co&lt;/script&gt;</title>"));
        assert!(doc.contains("<p>Inhalt</p>"));
    }

    #[test]
    fn inlines_allowed_local_assets_and_blocks_disallowed_paths() {
        let tmp = std::env::temp_dir().join(format!("marklive_html_inline_{}", std::process::id()));
        let _ = fs::create_dir_all(&tmp);
        let allowed_img = tmp.join("diagram.png");
        let blocked_img = tmp.join("secret.png");
        let tiny_png: [u8; 4] = [0x89, b'P', b'N', b'G'];
        fs::write(&allowed_img, tiny_png).unwrap();
        fs::write(&blocked_img, tiny_png).unwrap();

        let allowed_enc = utf8_percent_encode(&allowed_img.to_string_lossy(), NON_ALPHANUMERIC).to_string();
        let blocked_enc = utf8_percent_encode(&blocked_img.to_string_lossy(), NON_ALPHANUMERIC).to_string();

        let input_html = format!(
            "<p><img src=\"/api/local-asset?path={allowed_enc}\" alt=\"ok\"><img src=\"/api/local-asset?path={blocked_enc}\" alt=\"nope\"></p>"
        );

        let result = inline_local_asset_images(&input_html, |p| p == allowed_img.as_path());
        assert!(result.contains("src=\"data:image/png;base64,iVBORw==\""));
        assert!(result.contains(&format!("src=\"/api/local-asset?path={blocked_enc}\"")));

        let _ = fs::remove_dir_all(&tmp);
    }
}
