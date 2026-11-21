use base64::Engine;
use percent_encoding::percent_decode_str;
use std::fs;
use std::path::Path;

const MAX_INLINE_IMAGE_BYTES: u64 = 15 * 1024 * 1024;

#[derive(Default, serde::Serialize)]
pub struct ExportImages {
    pub embedded: usize,
    pub missing: usize,
    pub external: usize,
}

/// Resolve actual image elements in both the WebView snapshot and the native render fallback.
pub fn inline_local_asset_images<F>(html: &str, is_en: bool, is_allowed: F) -> (String, ExportImages)
where
    F: Fn(&Path) -> bool,
{
    let doc = dom_query::Document::fragment(html);
    let mut counts = ExportImages::default();
    doc.select("picture > source").remove();
    for img in doc.select("img").iter() {
        img.remove_attr("srcset");
        let src = img.attr("src").unwrap_or_default();
        let src = src.trim();
        if src.get(..11).is_some_and(|s| s.eq_ignore_ascii_case("data:image/")) {
            counts.embedded += 1;
            continue;
        }

        let local_path = extract_local_asset_query_path(src);
        if let Some(encoded) = local_path {
            if let Ok(path) = percent_decode_str(encoded).decode_utf8() {
                if let Some(data_uri) = try_encode_allowed_image(Path::new(path.as_ref()), &is_allowed) {
                    img.set_attr("src", &data_uri);
                    counts.embedded += 1;
                    continue;
                }
            }
        }

        let external = local_path.is_none() && (src.starts_with("//")
            || src.get(..7).is_some_and(|s| s.eq_ignore_ascii_case("http://"))
            || src.get(..8).is_some_and(|s| s.eq_ignore_ascii_case("https://")));
        let label = if external {
            counts.external += 1;
            if is_en { "External image omitted from offline export" } else { "Externes Bild im Offline-Export ausgelassen" }
        } else {
            counts.missing += 1;
            if is_en { "Local image unavailable" } else { "Lokales Bild nicht verfügbar" }
        };
        // Preserve the author's alternative text, escaping it as text in the placeholder.
        let alt = img.attr("alt").unwrap_or_default();
        let mut text = label.to_owned();
        if !alt.trim().is_empty() {
            text.push_str(" — ");
            text.push_str(&alt.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;"));
        }
        img.replace_with_html(format!("<span class=\"image-placeholder\">{text}</span>"));
    }
    (doc.html_root().inner_html().to_string(), counts)
}

fn extract_local_asset_query_path(url: &str) -> Option<&str> {
    let idx = url.find("/api/local-asset?")?;
    let prefix = &url[..idx];
    if !prefix.is_empty()
        && prefix != "https://semyra.localhost"
        && prefix != "http://semyra.localhost"
        && prefix != "semyra://localhost"
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
    use std::io::Read;
    let mime = mime_guess::from_path(candidate).first()?;
    if mime.type_().as_str() != "image" { return None; }
    let file = fs::File::open(candidate).ok()?;
    let meta = file.metadata().ok()?;
    if !meta.is_file() || meta.len() > MAX_INLINE_IMAGE_BYTES { return None; }
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    file.take(MAX_INLINE_IMAGE_BYTES + 1).read_to_end(&mut bytes).ok()?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_INLINE_IMAGE_BYTES { return None; }
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
      --fg: #202934;
      --muted: #506173;
      --border: #d6dde4;
      --surface: #f3f5f7;
      --accent: #426b91;
      --warning: #986c3d;
    }}
    @media (prefers-color-scheme: dark) {{
      :root {{
        --bg: #12161e;
        --fg: #edf2f5;
        --muted: #8292a2;
        --border: #323e4d;
        --surface: #1a212b;
        --accent: #83a5c6;
        --warning: #d0a774;
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
    blockquote {{ margin: 1.1rem 0; padding: 0.75rem 1.05rem; border-left: 3.5px solid var(--border); background: var(--surface); color: var(--fg); border-radius: 0 8px 8px 0; }}
    .gfm-alert {{ margin: 1.1rem 0; padding: 0.75rem 1.05rem; border-left: 4px solid var(--accent); background: var(--surface); border-radius: 0 8px 8px 0; }}
    blockquote > :last-child, .gfm-alert > :last-child {{ margin-bottom: 0; }}
    .gfm-alert-title {{ font-weight: 650; margin-bottom: 0.35rem; }}
    .gfm-alert-note {{ border-left-color: var(--accent); }}
    .gfm-alert-note .gfm-alert-title {{ color: var(--accent); }}
    .gfm-alert-tip {{ border-left-color: #63b9ac; }}
    .gfm-alert-tip .gfm-alert-title {{ color: #63b9ac; }}
    .gfm-alert-important {{ border-left-color: #8f7ce6; }}
    .gfm-alert-important .gfm-alert-title {{ color: #8f7ce6; }}
    .gfm-alert-warning {{ border-left-color: var(--warning); }}
    .gfm-alert-warning .gfm-alert-title {{ color: var(--warning); }}
    .gfm-alert-caution {{ border-left-color: #cf222e; }}
    .gfm-alert-caution .gfm-alert-title {{ color: #cf222e; }}
    .frontmatter-card {{ margin-bottom: 1.3rem; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); font-size: 0.9rem; overflow: hidden; }}
    .frontmatter-chips {{ display: flex; flex-wrap: wrap; gap: 6px; padding: 0.55rem 0.9rem; border-bottom: 1px solid var(--border); background: light-dark(#f8fafc, #171e28); }}
    .frontmatter-chip {{ display: inline-flex; align-items: center; max-width: 100%; border: 1px solid var(--border); border-radius: 5px; background: var(--bg); font-size: 0.78rem; line-height: 1.35; overflow: hidden; }}
    .frontmatter-chip-key {{ padding: 2px 7px; font-family: "Cascadia Code", "Cascadia Mono", Consolas, monospace; font-weight: 600; color: var(--muted); background: var(--surface); border-right: 1px solid var(--border); }}
    .frontmatter-chip-val {{ padding: 2px 8px; color: var(--fg); overflow-wrap: anywhere; }}
    .frontmatter-card > summary, .frontmatter-card details > summary {{ cursor: pointer; font-weight: 600; color: var(--muted); padding: 0.55rem 0.9rem; }}
    .frontmatter-card details[open] > summary {{ border-bottom: 1px solid var(--border); }}
    .prompt-tag-block {{ margin: 1.2rem 0; border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 8px; background: light-dark(#f8fafc, #171e28); overflow: hidden; }}
    .prompt-tag-label {{ padding: 5px 12px; font-family: "Cascadia Code", "Cascadia Mono", Consolas, monospace; font-size: 0.78rem; font-weight: 600; color: var(--accent); background: var(--surface); border-bottom: 1px solid var(--border); }}
    .prompt-tag-body {{ padding: 0.75rem 0.95rem; color: var(--fg); }}
    .prompt-tag-body > :first-child {{ margin-top: 0; }}
    .prompt-tag-body > :last-child {{ margin-bottom: 0; }}
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
    .image-placeholder {{ color: var(--muted); font-style: italic; }}
    img {{ max-width: 100%; height: auto; border-radius: 6px; }}
    a {{ color: var(--accent); text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}
    hr {{ border: 0; border-top: 1px solid var(--border); margin: 2rem 0; }}
    @media print {{
      h1, h2, h3, h4, h5, h6 {{ break-after: avoid; }}
      .frontmatter-card, .prompt-tag-block, .table-wrapper, .code-block-wrapper, .mermaid-wrapper, blockquote, tr {{ break-inside: avoid; }}
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
        let tmp = std::env::temp_dir().join(format!("semyra_html_inline_{}", std::process::id()));
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

        let oversized = tmp.join("oversized.png");
        fs::File::create(&oversized).unwrap().set_len(MAX_INLINE_IMAGE_BYTES + 1).unwrap();
        let large_enc = utf8_percent_encode(&oversized.to_string_lossy(), NON_ALPHANUMERIC).to_string();
        let input = format!("{input_html}<img src='/api/local-asset?path={large_enc}'><img src='/api/local-asset?path=absent.png'><img src='https://example.org/photo.png' alt='A &amp; B'><code>src=&quot;literal&quot;</code><math><mi>x</mi></math><svg viewBox='0 0 1 1'><path d='M0 0'/></svg>");
        let (result, images) = inline_local_asset_images(&input, false, |p| p != blocked_img);
        assert_eq!((images.embedded, images.missing, images.external), (1, 3, 1));
        assert!(result.contains("src=\"data:image/png;base64,iVBORw==\""));
        assert!(!result.contains("/api/local-asset"));
        assert!(!result.contains("example.org"));
        assert!(!result.contains(&blocked_enc));
        let parsed = dom_query::Document::fragment(result);
        assert_eq!(parsed.select("span.image-placeholder").length(), 4);
        assert!(parsed.select("span.image-placeholder").text().contains("A & B"));
        assert_eq!(parsed.select("math mi").text().as_ref(), "x");
        assert_eq!(parsed.select("svg path").length(), 1);
        assert_eq!(parsed.select("code").text().as_ref(), "src=\"literal\"");

        let _ = fs::remove_dir_all(&tmp);
    }
}
