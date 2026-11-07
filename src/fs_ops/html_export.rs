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
      --fg: #1f2328;
      --muted: #59636e;
      --border: #d1d9e0;
      --surface: #f6f8fa;
      --accent: #0969da;
    }}
    @media (prefers-color-scheme: dark) {{
      :root {{
        --bg: #0d1117;
        --fg: #e6edf3;
        --muted: #8b949e;
        --border: #30363d;
        --surface: #161b22;
        --accent: #4493f8;
      }}
    }}
    body {{
      max-width: 860px;
      margin: 2.5rem auto;
      padding: 0 1.5rem;
      font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
      line-height: 1.68;
      background: var(--bg);
      color: var(--fg);
    }}
    h1, h2, h3, h4, h5, h6 {{ line-height: 1.3; margin-top: 1.6em; margin-bottom: 0.6em; }}
    h1, h2 {{ border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }}
    code, pre {{ font-family: "Cascadia Code", Consolas, monospace; font-size: 0.9em; }}
    code {{ background: var(--surface); padding: 0.15em 0.4em; border-radius: 5px; }}
    pre {{ background: var(--surface); padding: 1rem; border-radius: 8px; overflow-x: auto; border: 1px solid var(--border); }}
    pre code {{ background: none; padding: 0; }}
    .code-block-header {{ display: flex; justify-content: space-between; font-size: 0.78rem; color: var(--muted); margin-bottom: 0.35rem; }}
    .copy-code-btn {{ display: none; }}
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
    blockquote, .gfm-alert {{ margin: 1rem 0; padding: 0.75rem 1rem; border-left: 4px solid var(--accent); background: var(--surface); border-radius: 0 8px 8px 0; }}
    .gfm-alert-title {{ font-weight: 600; margin-bottom: 0.35rem; }}
    .gfm-alert-note {{ border-left-color: #2f81f7; }}
    .gfm-alert-tip {{ border-left-color: #2da44e; }}
    .gfm-alert-important {{ border-left-color: #8250df; }}
    .gfm-alert-warning {{ border-left-color: #d29922; }}
    .gfm-alert-caution {{ border-left-color: #cf222e; }}
    .frontmatter-card {{ margin-bottom: 1.2rem; padding: 0.6rem 0.9rem; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); }}
    table {{ width: 100%; border-collapse: collapse; margin: 1rem 0; }}
    th, td {{ border: 1px solid var(--border); padding: 0.55rem 0.8rem; text-align: left; }}
    th {{ background: var(--surface); }}
    img {{ max-width: 100%; border-radius: 6px; }}
    a {{ color: var(--accent); }}
    hr {{ border: 0; border-top: 1px solid var(--border); margin: 2rem 0; }}
  </style>
</head>
<body>
{rendered_body_html}
</body>
</html>
"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_html_title_safely() {
        let doc = build_standalone_html_document("<script>\"Test\" & Co</script>", "<p>Inhalt</p>");
        assert!(doc.contains("<title>&lt;script&gt;&quot;Test&quot; &amp; Co&lt;/script&gt;</title>"));
        assert!(doc.contains("<p>Inhalt</p>"));
    }
}
