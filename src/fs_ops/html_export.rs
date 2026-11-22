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

const DANGEROUS_ELEMENTS_SELECTOR: &str = "script, iframe, frame, frameset, object, embed, applet, form, meta, base, link, title, head, noscript, template, portal, textarea, select, option, svg animate, svg set, svg animatetransform, svg animatemotion, svg mpath, svg handler, svg listener";

fn normalized_uri_scheme(value: &str) -> Option<String> {
    let mut scheme = String::new();
    for ch in value.chars() {
        if ch.is_ascii_whitespace() || ch.is_ascii_control() {
            continue;
        }
        if ch == ':' {
            return (!scheme.is_empty()).then_some(scheme.to_ascii_lowercase());
        }
        if matches!(ch, '/' | '?' | '#') {
            return None;
        }
        if scheme.len() < 32 {
            scheme.push(ch);
        }
    }
    None
}

fn is_safe_data_image_uri(value: &str) -> bool {
    let compact: String = value
        .chars()
        .filter(|ch| !ch.is_ascii_whitespace() && !ch.is_ascii_control())
        .collect();
    let lower = compact.to_ascii_lowercase();
    [
        "data:image/png",
        "data:image/jpeg",
        "data:image/jpg",
        "data:image/gif",
        "data:image/webp",
        "data:image/bmp",
        "data:image/svg+xml",
        "data:image/x-icon",
        "data:image/avif",
    ]
    .iter()
    .any(|prefix| {
        lower
            .strip_prefix(prefix)
            .is_some_and(|rest| rest.starts_with(';') || rest.starts_with(','))
    })
}

fn is_safe_export_uri(tag_name: &str, attr_name: &str, value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('/') {
        return true;
    }
    let Some(scheme) = normalized_uri_scheme(trimmed) else {
        return true;
    };
    match scheme.as_str() {
        "http" | "https" | "mailto" | "tel" => true,
        "data" => matches!(tag_name, "img" | "source") && attr_name == "src" && is_safe_data_image_uri(trimmed),
        _ => false,
    }
}

fn is_safe_mermaid_style(css: &str) -> bool {
    let lower = css.to_ascii_lowercase();
    let compact: String = lower
        .chars()
        .filter(|ch| !ch.is_ascii_whitespace() && !ch.is_ascii_control())
        .collect();
    !lower.contains("@import")
        && !compact.contains("javascript:")
        && !compact.contains("expression(")
        && !compact.contains("</style")
        && !compact.contains("url(")
        && !css.contains('\\')
}

fn sanitize_export_document(doc: &dom_query::Document) {
    doc.select(DANGEROUS_ELEMENTS_SELECTOR).remove();

    for input in doc.select("input").iter() {
        let is_checkbox = input
            .attr("type")
            .is_some_and(|t| t.eq_ignore_ascii_case("checkbox"));
        let has_task_class = input
            .attr("class")
            .is_some_and(|c| c.split_whitespace().any(|cls| cls == "task-checkbox"));
        if !(is_checkbox && has_task_class) {
            input.remove();
        }
    }

    for btn in doc.select("button").iter() {
        let allowed = btn.attr("class").is_some_and(|c| {
            c.split_whitespace()
                .any(|cls| cls == "copy-code-btn" || cls == "mermaid-action-btn")
        });
        if !allowed {
            btn.remove();
        }
    }

    for style in doc.select("style").iter() {
        let in_mermaid_svg = style.ancestors(None).iter().any(|anc| {
            anc.nodes()
                .first()
                .and_then(|n| n.node_name())
                .is_some_and(|n| n.eq_ignore_ascii_case("svg"))
        }) && style.ancestors(None).iter().any(|anc| {
            anc.attr("class")
                .is_some_and(|c| c.split_whitespace().any(|cls| cls == "mermaid-wrapper"))
        });
        let is_export_theme_style = style
            .attr("data-semyra-export-theme")
            .is_some_and(|theme| matches!(theme.as_ref(), "light" | "dark"));
        if !(in_mermaid_svg || is_export_theme_style) || !is_safe_mermaid_style(&style.text()) {
            style.remove();
        }
    }

    for el in doc.select("*").iter() {
        let tag_name = el
            .nodes()
            .first()
            .and_then(|n| n.node_name())
            .map(|n| n.as_ref().to_ascii_lowercase())
            .unwrap_or_default();
        let attrs = el.attrs();
        for attr in attrs {
            let name_lower = attr.name.local.as_ref().to_ascii_lowercase();
            if name_lower.starts_with("on")
                || matches!(
                    name_lower.as_str(),
                    "srcdoc" | "formaction" | "dynsrc" | "lowsrc"
                )
            {
                el.remove_attr(&attr.name.local);
                continue;
            }
            if matches!(
                name_lower.as_str(),
                "href" | "xlink:href" | "src" | "action" | "poster" | "background" | "data" | "cite" | "longdesc"
            ) && !is_safe_export_uri(&tag_name, &name_lower, &attr.value)
            {
                el.remove_attr(&attr.name.local);
            }
        }
    }
}

pub fn sanitize_export_html(html: &str) -> String {
    let doc = dom_query::Document::fragment(html);
    sanitize_export_document(&doc);
    doc.html_root().inner_html().to_string()
}

/// Resolve actual image elements in both the WebView snapshot and the native render fallback.
pub fn inline_local_asset_images<F>(html: &str, is_en: bool, is_allowed: F) -> (String, ExportImages)
where
    F: Fn(&Path) -> bool,
{
    let doc = dom_query::Document::fragment(html);
    sanitize_export_document(&doc);
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
    let url_no_frag = url.split('#').next().unwrap_or(url);
    let idx = url_no_frag.find("/api/local-asset?")?;
    let prefix = &url_no_frag[..idx];
    if !prefix.is_empty()
        && !prefix.eq_ignore_ascii_case("https://semyra.localhost")
        && !prefix.eq_ignore_ascii_case("http://semyra.localhost")
        && !prefix.eq_ignore_ascii_case("semyra://localhost")
    {
        return None;
    }
    let query = &url_no_frag[idx + "/api/local-asset?".len()..];
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

pub fn build_standalone_html_document(
    title: &str,
    rendered_body_html: &str,
    markdown: &str,
    is_en: bool,
) -> String {
    let sanitized_body_html = sanitize_export_html(rendered_body_html);
    let language = crate::markdown::document_language(markdown)
        .unwrap_or_else(|| if is_en { "en".into() } else { "de".into() });
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
<html lang="{language}">
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
{sanitized_body_html}
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
        let doc = build_standalone_html_document("<script>\"Test\" & Co</script>", "<p>Inhalt</p>", "", false);
        assert!(doc.contains("<title>&lt;script&gt;&quot;Test&quot; &amp; Co&lt;/script&gt;</title>"));
        assert!(doc.contains("<p>Inhalt</p>"));
    }

    #[test]
    fn exports_frontmatter_language_or_application_language() {
        for (source, is_en, expected) in [
            ("---\nlang: 'en-GB'\n---\n# Heading", false, "en-GB"),
            ("\u{feff}---\r\nlang: zh-Hant-TW\r\n---\r\n# Heading", false, "zh-Hant-TW"),
            ("---\nlang: bad_tag\n---\n# Heading", true, "en"),
            ("# Heading\n\nlang: fr", false, "de"),
        ] {
            let html = build_standalone_html_document("Example", "<p>Text</p>", source, is_en);
            assert!(html.contains(&format!("<html lang=\"{expected}\">")), "{source:?}");
        }
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

    #[test]
    fn sanitizes_xss_payloads_while_preserving_mermaid_and_math_export_markup() {
        let dirty = concat!(
            "<p>Safe</p>",
            "<script>alert(1)</script>",
            "<iframe src=\"https://evil.example\"></iframe>",
            "<object data=\"evil.swf\"></object>",
            "<embed src=\"evil.swf\">",
            "<form action=\"https://evil.example\"><input type=\"text\"><button>Send</button></form>",
            "<meta http-equiv=\"refresh\" content=\"0;url=evil\">",
            "<base href=\"https://evil.example/\">",
            "<style>body{display:none}</style>",
            "<svg onload=\"alert(1)\"><script>alert(2)</script><path d=\"M0 0\"/></svg>",
            "<a href=\"javascript:alert(3)\" onclick=\"alert(4)\">Click</a>",
            "<a href=\"java&#x09;script:alert(5)\">Click2</a>",
            "<img src=\"data:text/html,<script>alert(6)</script>\" onerror=\"alert(7)\">",
            "<input type=\"checkbox\" class=\"task-checkbox\" checked>",
            "<div class=\"mermaid-wrapper\"><svg viewBox=\"0 0 10 10\"><style>.node{fill:#fff;}</style><path d=\"M0 0\"/></svg></div>",
            "<div class=\"mermaid-wrapper\"><svg viewBox=\"0 0 10 10\"><style>.bad{background:url(https://evil.example/a.png);}</style><a xlink:href=\"javascript:alert(8)\">x</a></svg></div>",
            "<math><mi>x</mi></math>"
        );
        let doc = build_standalone_html_document("Test", dirty, "", false);
        assert!(!doc.contains("<script>"));
        assert!(!doc.contains("<iframe"));
        assert!(!doc.contains("<object"));
        assert!(!doc.contains("<embed"));
        assert!(!doc.contains("<form"));
        assert!(!doc.contains("<base "));
        assert!(!doc.contains("http-equiv=\"refresh\""));
        assert!(!doc.contains("body{display:none}"));
        assert!(!doc.contains("https://evil.example/a.png"));
        assert!(!doc.contains("onload="));
        assert!(!doc.contains("onerror="));
        assert!(!doc.contains("onclick="));
        assert!(!doc.contains("javascript:"));
        assert!(!doc.contains("data:text/html"));
        assert!(doc.contains("input type=\"checkbox\" class=\"task-checkbox\""));
        assert!(doc.contains(".node{fill:#fff;}"));
        assert!(doc.contains("<math><mi>x</mi></math>"));
    }

    #[test]
    fn extracts_local_asset_query_with_extra_params_fragment_and_case_insensitive_origin() {
        assert_eq!(
            extract_local_asset_query_path("HTTPS://SEMYRA.LOCALHOST/api/local-asset?v=1&path=C%3A%5Cimg.png&t=2#frag"),
            Some("C%3A%5Cimg.png")
        );
        assert_eq!(
            extract_local_asset_query_path("https://evil.example/api/local-asset?path=C%3A%5Cimg.png"),
            None
        );
    }

    #[test]
    fn preserves_safe_export_theme_style_and_strips_unsafe_styles() {
        let valid_dark = "<style data-semyra-export-theme=\"dark\">:root { color-scheme: dark !important; }</style><p>Hi</p>";
        let valid_doc = build_standalone_html_document("Theme", valid_dark, "", false);
        assert!(valid_doc.contains("<style data-semyra-export-theme=\"dark\">:root { color-scheme: dark !important; }</style>"));
        assert!(valid_doc.contains("<p>Hi</p>"));

        let fragment = dom_query::Document::fragment(valid_dark);
        sanitize_export_document(&fragment);
        assert!(fragment.html_root().inner_html().contains("<style data-semyra-export-theme=\"dark\">:root { color-scheme: dark !important; }</style>"));

        let unsafe_styles = concat!(
            "<style data-semyra-export-theme=\"dark\">@import url(https://evil.test);</style>",
            "<style>body{background:url(x)}</style>",
            "<p>Safe</p>"
        );
        let cleaned = build_standalone_html_document("Unsafe", unsafe_styles, "", false);
        assert!(!cleaned.contains("https://evil.test"));
        assert!(!cleaned.contains("background:url(x)"));
        assert!(cleaned.contains("<p>Safe</p>"));
    }
}
