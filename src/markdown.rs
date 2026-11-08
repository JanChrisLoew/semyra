use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use pulldown_cmark::{
    Alignment, BlockQuoteKind, CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd,
};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;
use syntect::html::{ClassStyle, ClassedHTMLGenerator};
use syntect::parsing::SyntaxSet;
use syntect::util::LinesWithEndings;

static SYNTAX_SET: OnceLock<SyntaxSet> = OnceLock::new();

fn syntax_set() -> &'static SyntaxSet {
    SYNTAX_SET.get_or_init(SyntaxSet::load_defaults_newlines)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadingItem {
    pub level: u8,
    pub text: String,
    pub slug: String,
    pub line: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocStats {
    pub words: usize,
    pub chars: usize,
    pub lines: usize,
    pub reading_time_sec: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderResult {
    pub html: String,
    pub outline: Vec<HeadingItem>,
    pub stats: DocStats,
}

struct LineIndex {
    line_starts: Vec<usize>,
}

impl LineIndex {
    fn new(src: &str) -> Self {
        let mut line_starts = vec![0];
        for (idx, b) in src.bytes().enumerate() {
            if b == b'\n' {
                line_starts.push(idx + 1);
            }
        }
        Self { line_starts }
    }

    /// Returns 1-based line number for a given byte offset.
    fn line_of(&self, byte_offset: usize) -> usize {
        match self.line_starts.binary_search(&byte_offset) {
            Ok(idx) => idx + 1,
            Err(idx) => idx.max(1),
        }
    }

    fn total_lines(&self) -> usize {
        self.line_starts.len()
    }
}

fn escape_html(out: &mut String, s: &str) {
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(ch),
        }
    }
}

fn slugify(text: &str, counts: &mut HashMap<String, usize>) -> String {
    let mut base = String::new();
    let mut prev_dash = false;
    for ch in text.chars() {
        if ch.is_alphanumeric() {
            for lc in ch.to_lowercase() {
                base.push(lc);
            }
            prev_dash = false;
        } else if (ch.is_whitespace() || ch == '-' || ch == '_') && !base.is_empty() && !prev_dash
        {
            base.push('-');
            prev_dash = true;
        }
    }
    while base.ends_with('-') {
        base.pop();
    }
    if base.is_empty() {
        base.push_str("abschnitt");
    }
    let counter = counts.entry(base.clone()).or_insert(0);
    let slug = if *counter == 0 {
        base
    } else {
        format!("{base}-{counter}")
    };
    *counter += 1;
    slug
}

fn resolve_asset_url(raw_url: &str, base_dir: Option<&Path>) -> String {
    let trimmed = raw_url.trim();
    if trimmed.is_empty()
        || trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("data:")
        || trimmed.starts_with("mailto:")
        || trimmed.starts_with('#')
    {
        return trimmed.to_string();
    }

    // Handle file:// or file:/// URLs
    let stripped_file = trimmed
        .strip_prefix("file:///")
        .or_else(|| trimmed.strip_prefix("file://"));
    if let Some(stripped) = stripped_file {
        let normalized = stripped.replace('/', "\\");
        let encoded = utf8_percent_encode(&normalized, NON_ALPHANUMERIC).to_string();
        return format!("/api/local-asset?path={encoded}");
    }

    // Handle absolute paths (e.g. C:\... or C:/...) regardless of whether base_dir is present
    let candidate = Path::new(trimmed);
    if candidate.is_absolute() {
        let path_str = candidate.to_string_lossy();
        let encoded = utf8_percent_encode(&path_str, NON_ALPHANUMERIC).to_string();
        return format!("/api/local-asset?path={encoded}");
    }

    if let Some(dir) = base_dir {
        let full = dir.join(candidate);
        let path_str = full.to_string_lossy();
        let encoded = utf8_percent_encode(&path_str, NON_ALPHANUMERIC).to_string();
        return format!("/api/local-asset?path={encoded}");
    }

    trimmed.to_string()
}

fn highlight_code(lang: &str, code: &str) -> String {
    let ss = syntax_set();
    let lower_lang = lang.to_ascii_lowercase();
    let token = match lower_lang.as_str() {
        "ts" | "tsx" | "typescript" => "js",
        "jsx" => "js",
        "ps1" | "powershell" | "pwsh" => "sh",
        "shell" | "zsh" | "console" => "bash",
        "yml" => "yaml",
        "toml" | "ini" | "cfg" => "yaml",
        "dockerfile" => "sh",
        "csharp" => "cs",
        other => other,
    };

    let syntax = if token.is_empty() {
        ss.find_syntax_plain_text()
    } else {
        ss.find_syntax_by_token(token)
            .unwrap_or_else(|| ss.find_syntax_plain_text())
    };

    let mut generator = ClassedHTMLGenerator::new_with_class_style(
        syntax,
        ss,
        ClassStyle::SpacedPrefixed { prefix: "hl-" },
    );

    for line in LinesWithEndings::from(code) {
        if generator
            .parse_html_for_line_which_includes_newline(line)
            .is_err()
        {
            let mut fallback = String::with_capacity(code.len() + 16);
            escape_html(&mut fallback, code);
            return fallback;
        }
    }

    generator.finalize()
}

fn heading_level_num(level: HeadingLevel) -> u8 {
    match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

pub fn render_markdown(markdown: &str, base_dir: Option<&Path>) -> RenderResult {
    let line_index = LineIndex::new(markdown);

    let words = markdown.split_whitespace().count();
    let chars = markdown.chars().count();
    let lines = line_index.total_lines();
    // ~220 words per minute average reading speed
    let reading_time_sec = if words == 0 {
        0
    } else {
        ((words as f64 / 220.0) * 60.0).ceil() as usize
    };

    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_GFM);
    options.insert(Options::ENABLE_MATH);
    options.insert(Options::ENABLE_HEADING_ATTRIBUTES);
    options.insert(Options::ENABLE_YAML_STYLE_METADATA_BLOCKS);

    let parser = Parser::new_ext(markdown, options).into_offset_iter();

    let mut html = String::with_capacity(markdown.len() * 2 + 256);
    let mut outline: Vec<HeadingItem> = Vec::new();
    let mut slug_counts: HashMap<String, usize> = HashMap::new();

    // State tracking during event traversal
    let mut in_heading: Option<(u8, usize, Option<String>, String, String)> = None; // (level, line, custom_id, plain_text, inner_html)
    let mut in_code_block: Option<(String, usize, String)> = None; // (lang, line, buffer)
    let mut in_metadata: Option<(usize, String)> = None; // (line, raw_yaml)
    let mut in_image: Option<(String, String, String)> = None; // (resolved_src, title, alt_buffer)
    let mut table_alignments: Vec<Alignment> = Vec::new();
    let mut in_table_head = false;
    let mut current_cell_idx = 0usize;
    let mut current_item_line = 1usize;

    for (event, range) in parser {
        let line = line_index.line_of(range.start);

        if let Some((meta_line, ref mut yaml_buf)) = in_metadata {
            match event {
                Event::End(TagEnd::MetadataBlock(_)) => {
                    let highlighted = highlight_code("yaml", yaml_buf.trim_end());
                    html.push_str(&format!(
                        "<details class=\"frontmatter-card\" data-line=\"{meta_line}\"><summary>Frontmatter (YAML)</summary><pre tabindex=\"0\"><code class=\"hl-code\">{highlighted}</code></pre></details>\n"
                    ));
                    in_metadata = None;
                }
                Event::Text(t) => yaml_buf.push_str(&t),
                _ => {}
            }
            continue;
        }

        // If inside an image tag, collect alt text until TagEnd::Image
        if let Some((ref src, ref title, ref mut alt_buf)) = in_image {
            match event {
                Event::End(TagEnd::Image) => {
                    let target = if let Some((_, _, _, _, ref mut h_html)) = in_heading {
                        h_html
                    } else {
                        &mut html
                    };
                    target.push_str("<img src=\"");
                    escape_html(target, src);
                    target.push_str("\" alt=\"");
                    escape_html(target, alt_buf);
                    target.push('"');
                    if !title.is_empty() {
                        target.push_str(" title=\"");
                        escape_html(target, title);
                        target.push('"');
                    }
                    target.push_str(" loading=\"lazy\">");
                    in_image = None;
                }
                Event::Text(t) | Event::Code(t) => {
                    alt_buf.push_str(&t);
                }
                Event::SoftBreak | Event::HardBreak => {
                    alt_buf.push(' ');
                }
                _ => {}
            }
            continue;
        }

        // If inside a code block, accumulate raw code until TagEnd::CodeBlock
        if let Some((ref lang, code_line, ref mut buf)) = in_code_block {
            match event {
                Event::End(TagEnd::CodeBlock) => {
                    let trimmed_lang = lang
                        .split_whitespace()
                        .next()
                        .unwrap_or("")
                        .trim()
                        .to_string();

                    if trimmed_lang.eq_ignore_ascii_case("mermaid") {
                        html.push_str(&format!(
                            "<div class=\"mermaid-wrapper\" data-line=\"{code_line}\" data-mermaid=\""
                        ));
                        escape_html(&mut html, buf);
                        html.push_str("\"><pre class=\"mermaid-source\"><code>");
                        escape_html(&mut html, buf);
                        html.push_str("</code></pre></div>\n");
                    } else {
                        let highlighted = highlight_code(&trimmed_lang, buf);
                        let lang_label = if trimmed_lang.is_empty() {
                            "text"
                        } else {
                            trimmed_lang.as_str()
                        };
                        html.push_str(&format!(
                            "<div class=\"code-block-wrapper\" data-line=\"{code_line}\" data-lang=\""
                        ));
                        escape_html(&mut html, lang_label);
                        html.push_str("\"><div class=\"code-block-header\"><span class=\"code-lang-badge\">");
                        escape_html(&mut html, lang_label);
                        html.push_str("</span><button type=\"button\" class=\"copy-code-btn\" data-i18n=\"preview.copy\" aria-label=\"Code kopieren\" data-i18n-aria=\"preview.copyAria\">Kopieren</button></div><pre tabindex=\"0\"><code class=\"hl-code\">");
                        html.push_str(&highlighted);
                        html.push_str("</code></pre></div>\n");
                    }
                    in_code_block = None;
                }
                Event::Text(t) => {
                    buf.push_str(&t);
                }
                _ => {}
            }
            continue;
        }

        // Helper target buffer (either heading inner HTML or main document HTML)
        match event {
            Event::Start(tag) => match tag {
                Tag::Heading { level, id, .. } => {
                    let lvl = heading_level_num(level);
                    in_heading = Some((
                        lvl,
                        line,
                        id.map(|s| s.into_string()),
                        String::new(),
                        String::new(),
                    ));
                }
                Tag::Paragraph => {
                    html.push_str(&format!("<p data-line=\"{line}\">"));
                }
                Tag::BlockQuote(kind) => {
                    if let Some(alert_kind) = kind {
                        let (cls, title) = match alert_kind {
                            BlockQuoteKind::Note => ("note", "Hinweis"),
                            BlockQuoteKind::Tip => ("tip", "Tipp"),
                            BlockQuoteKind::Important => ("important", "Wichtig"),
                            BlockQuoteKind::Warning => ("warning", "Warnung"),
                            BlockQuoteKind::Caution => ("caution", "Vorsicht"),
                        };
                        html.push_str(&format!(
                            "<div class=\"gfm-alert gfm-alert-{cls}\" data-line=\"{line}\"><div class=\"gfm-alert-title\">{title}</div>"
                        ));
                    } else {
                        html.push_str(&format!("<blockquote data-line=\"{line}\">"));
                    }
                }
                Tag::CodeBlock(kind) => {
                    let lang = match kind {
                        CodeBlockKind::Fenced(l) => l.into_string(),
                        CodeBlockKind::Indented => String::new(),
                    };
                    in_code_block = Some((lang, line, String::new()));
                }
                Tag::List(start_num) => {
                    if let Some(start) = start_num {
                        if start == 1 {
                            html.push_str(&format!("<ol data-line=\"{line}\">"));
                        } else {
                            html.push_str(&format!("<ol start=\"{start}\" data-line=\"{line}\">"));
                        }
                    } else {
                        html.push_str(&format!("<ul data-line=\"{line}\">"));
                    }
                }
                Tag::Item => {
                    current_item_line = line;
                    html.push_str(&format!("<li data-line=\"{line}\">"));
                }
                Tag::Table(alignments) => {
                    table_alignments = alignments;
                    html.push_str(&format!(
                        "<div tabindex=\"0\" role=\"region\" aria-label=\"Markdown-Tabelle\" class=\"table-wrapper\" data-line=\"{line}\"><table>"
                    ));
                }
                Tag::TableHead => {
                    in_table_head = true;
                    current_cell_idx = 0;
                    html.push_str("<thead><tr>");
                }
                Tag::TableRow => {
                    current_cell_idx = 0;
                    html.push_str(&format!("<tr data-line=\"{line}\">"));
                }
                Tag::TableCell => {
                    let align_attr = match table_alignments
                        .get(current_cell_idx)
                        .copied()
                        .unwrap_or(Alignment::None)
                    {
                        Alignment::None => "",
                        Alignment::Left => " class=\"align-left\"",
                        Alignment::Center => " class=\"align-center\"",
                        Alignment::Right => " class=\"align-right\"",
                    };
                    if in_table_head {
                        html.push_str(&format!("<th scope=\"col\"{align_attr}>"));
                    } else {
                        html.push_str(&format!("<td{align_attr}>"));
                    }
                    current_cell_idx += 1;
                }
                Tag::Emphasis => {
                    let target = if let Some((_, _, _, _, ref mut h_html)) = in_heading {
                        h_html
                    } else {
                        &mut html
                    };
                    target.push_str("<em>");
                }
                Tag::Strong => {
                    let target = if let Some((_, _, _, _, ref mut h_html)) = in_heading {
                        h_html
                    } else {
                        &mut html
                    };
                    target.push_str("<strong>");
                }
                Tag::Strikethrough => {
                    let target = if let Some((_, _, _, _, ref mut h_html)) = in_heading {
                        h_html
                    } else {
                        &mut html
                    };
                    target.push_str("<del>");
                }
                Tag::Link {
                    dest_url, title, ..
                } => {
                    let target = if let Some((_, _, _, _, ref mut h_html)) = in_heading {
                        h_html
                    } else {
                        &mut html
                    };
                    target.push_str("<a href=\"");
                    escape_html(target, &dest_url);
                    target.push('"');
                    if !title.is_empty() {
                        target.push_str(" title=\"");
                        escape_html(target, &title);
                        target.push('"');
                    }
                    target.push('>');
                }
                Tag::Image {
                    dest_url, title, ..
                } => {
                    let resolved = resolve_asset_url(&dest_url, base_dir);
                    in_image = Some((resolved, title.into_string(), String::new()));
                }
                Tag::FootnoteDefinition(name) => {
                    html.push_str(&format!(
                        "<div class=\"footnote-definition\" data-line=\"{line}\" id=\"fn-"
                    ));
                    escape_html(&mut html, &name);
                    html.push_str("\"><span class=\"footnote-label\">[");
                    escape_html(&mut html, &name);
                    html.push_str("]</span>");
                }
                Tag::MetadataBlock(_) => {
                    in_metadata = Some((line, String::new()));
                }
                Tag::HtmlBlock
                | Tag::DefinitionList
                | Tag::DefinitionListTitle
                | Tag::DefinitionListDefinition => {}
            },

            Event::End(tag_end) => match tag_end {
                TagEnd::Heading(_) => {
                    if let Some((lvl, h_line, custom_id, plain_text, inner_html)) =
                        in_heading.take()
                    {
                        let slug = custom_id
                            .unwrap_or_else(|| slugify(&plain_text, &mut slug_counts));
                        outline.push(HeadingItem {
                            level: lvl,
                            text: plain_text.trim().to_string(),
                            slug: slug.clone(),
                            line: h_line,
                        });
                        html.push_str(&format!("<h{lvl} id=\""));
                        escape_html(&mut html, &slug);
                        html.push_str(&format!("\" data-line=\"{h_line}\"><a class=\"heading-anchor\" href=\"#"));
                        escape_html(&mut html, &slug);
                        html.push_str("\" aria-label=\"Abschnitt verlinken\">#</a>");
                        html.push_str(&format!("{inner_html}</h{lvl}>\n"));
                    }
                }
                TagEnd::Paragraph => html.push_str("</p>\n"),
                TagEnd::BlockQuote(kind) => {
                    if kind.is_some() {
                        html.push_str("</div>\n");
                    } else {
                        html.push_str("</blockquote>\n");
                    }
                }
                TagEnd::List(ordered) => {
                    if ordered {
                        html.push_str("</ol>\n");
                    } else {
                        html.push_str("</ul>\n");
                    }
                }
                TagEnd::Item => html.push_str("</li>\n"),
                TagEnd::Table => {
                    table_alignments.clear();
                    html.push_str("</tbody></table></div>\n");
                }
                TagEnd::TableHead => {
                    in_table_head = false;
                    html.push_str("</tr></thead><tbody>\n");
                }
                TagEnd::TableRow => html.push_str("</tr>\n"),
                TagEnd::TableCell => {
                    if in_table_head {
                        html.push_str("</th>");
                    } else {
                        html.push_str("</td>");
                    }
                }
                TagEnd::Emphasis => {
                    let target = if let Some((_, _, _, _, ref mut h_html)) = in_heading {
                        h_html
                    } else {
                        &mut html
                    };
                    target.push_str("</em>");
                }
                TagEnd::Strong => {
                    let target = if let Some((_, _, _, _, ref mut h_html)) = in_heading {
                        h_html
                    } else {
                        &mut html
                    };
                    target.push_str("</strong>");
                }
                TagEnd::Strikethrough => {
                    let target = if let Some((_, _, _, _, ref mut h_html)) = in_heading {
                        h_html
                    } else {
                        &mut html
                    };
                    target.push_str("</del>");
                }
                TagEnd::Link => {
                    let target = if let Some((_, _, _, _, ref mut h_html)) = in_heading {
                        h_html
                    } else {
                        &mut html
                    };
                    target.push_str("</a>");
                }
                TagEnd::FootnoteDefinition => html.push_str("</div>\n"),
                TagEnd::CodeBlock
                | TagEnd::Image
                | TagEnd::HtmlBlock
                | TagEnd::MetadataBlock(_)
                | TagEnd::DefinitionList
                | TagEnd::DefinitionListTitle
                | TagEnd::DefinitionListDefinition => {}
            },

            Event::Text(text) => {
                if let Some((_, _, _, ref mut plain, ref mut h_html)) = in_heading {
                    plain.push_str(&text);
                    escape_html(h_html, &text);
                } else {
                    escape_html(&mut html, &text);
                }
            }

            Event::Code(code) => {
                if let Some((_, _, _, ref mut plain, ref mut h_html)) = in_heading {
                    plain.push_str(&code);
                    h_html.push_str("<code>");
                    escape_html(h_html, &code);
                    h_html.push_str("</code>");
                } else {
                    html.push_str("<code>");
                    escape_html(&mut html, &code);
                    html.push_str("</code>");
                }
            }

            Event::InlineMath(math) => {
                let target = if let Some((_, _, _, ref mut plain, ref mut h_html)) = in_heading {
                    plain.push_str(&math);
                    h_html
                } else {
                    &mut html
                };
                target.push_str("<span class=\"math-inline\" data-math=\"");
                escape_html(target, &math);
                target.push_str("\">$");
                escape_html(target, &math);
                target.push_str("$</span>");
            }

            Event::DisplayMath(math) => {
                html.push_str(&format!(
                    "<div class=\"math-display\" data-line=\"{line}\" data-math=\""
                ));
                escape_html(&mut html, &math);
                html.push_str("\">$$");
                escape_html(&mut html, &math);
                html.push_str("$$</div>");
            }

            Event::TaskListMarker(checked) => {
                let task_line = line.max(current_item_line);
                if checked {
                    html.push_str(&format!(
                        "<input type=\"checkbox\" class=\"task-checkbox\" data-task-line=\"{task_line}\" checked aria-label=\"Aufgabe erledigt\"> "
                    ));
                } else {
                    html.push_str(&format!(
                        "<input type=\"checkbox\" class=\"task-checkbox\" data-task-line=\"{task_line}\" aria-label=\"Aufgabe offen\"> "
                    ));
                }
            }

            Event::FootnoteReference(name) => {
                html.push_str("<sup class=\"footnote-ref\"><a href=\"#fn-");
                escape_html(&mut html, &name);
                html.push_str("\">[");
                escape_html(&mut html, &name);
                html.push_str("]</a></sup>");
            }

            Event::SoftBreak => {
                let target = if let Some((_, _, _, ref mut plain, ref mut h_html)) = in_heading {
                    plain.push(' ');
                    h_html
                } else {
                    &mut html
                };
                target.push('\n');
            }

            Event::HardBreak => {
                let target = if let Some((_, _, _, ref mut plain, ref mut h_html)) = in_heading {
                    plain.push(' ');
                    h_html
                } else {
                    &mut html
                };
                target.push_str("<br>\n");
            }

            Event::Rule => {
                html.push_str(&format!("<hr data-line=\"{line}\">\n"));
            }

            Event::Html(raw) | Event::InlineHtml(raw) => {
                // Pass raw HTML to client-side Sanitizer (which safely strips scripts/event handlers)
                let target = if let Some((_, _, _, _, ref mut h_html)) = in_heading {
                    h_html
                } else {
                    &mut html
                };
                target.push_str(&raw);
            }
        }
    }

    RenderResult {
        html,
        outline,
        stats: DocStats {
            words,
            chars,
            lines,
            reading_time_sec,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_headings_outline_and_lines() {
        let md = "# Hallo Welt\n\nEin Absatz.\n\n## Zweiter Punkt\n- [x] Fertig\n- [ ] Offen\n";
        let res = render_markdown(md, None);
        assert_eq!(res.outline.len(), 2);
        assert_eq!(res.outline[0].text, "Hallo Welt");
        assert_eq!(res.outline[0].slug, "hallo-welt");
        assert_eq!(res.outline[0].line, 1);
        assert_eq!(res.outline[1].line, 5);
        assert!(res.html.contains("data-task-line=\"6\""));
        assert!(res.html.contains("data-task-line=\"7\""));
    }

    #[test]
    fn renders_gfm_alerts_and_tables() {
        let md = "> [!NOTE]\n> Wichtig!\n\n| Name | Wert |\n| --- | ---: |\n| Test | 42 |\n";
        let res = render_markdown(md, None);
        assert!(res.html.contains("gfm-alert-note"));
        assert!(res.html.contains("class=\"table-wrapper\""));
        assert!(res.html.contains("class=\"align-right\""));
    }

    #[test]
    fn renders_syntax_highlighting_and_mermaid() {
        let md = "```rust\nfn main() {}\n```\n\n```mermaid\ngraph TD\nA-->B\n```\n";
        let res = render_markdown(md, None);
        assert!(res.html.contains("hl-"));
        assert!(res.html.contains("class=\"mermaid-wrapper\""));
    }

    #[test]
    fn renders_yaml_frontmatter_and_local_images() {
        let md = "---\ntitle: Testdokument\ntags: [rust, win11]\n---\n\n# Titel\n\n![Logo](./logo.png)\n";
        let res = render_markdown(md, Some(Path::new(r"C:\Docs")));
        assert!(res.html.contains("class=\"frontmatter-card\""));
        assert!(res.html.contains("/api/local-asset?path="));
        assert_eq!(res.outline.len(), 1);
        assert_eq!(res.outline[0].slug, "titel");
    }

    #[test]
    fn resolves_absolute_and_file_protocol_images_without_base_dir() {
        let md = "![Absolut](C:/Bilder/foto.png)\n\n![FileProto](file:///C:/Bilder/foto2.png)\n\n![TwoSlashes](file://C:/Bilder/foto3.png)\n";
        let res = render_markdown(md, None);
        assert!(res.html.contains("/api/local-asset?path="));
        assert_eq!(res.html.matches("/api/local-asset?path=").count(), 3);
    }
}
