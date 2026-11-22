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

const PROMPT_TAGS: &[&str] = &[
    "role",
    "context",
    "instructions",
    "output_format",
    "constraints",
    "examples",
];

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

fn is_ascii_drive_prefix(s: &str) -> bool {
    let bytes = s.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'/' || bytes[2] == b'\\')
}

fn extract_explicit_scheme(raw: &str) -> Option<String> {
    let mut scheme = String::new();
    for ch in raw.chars() {
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

fn sanitize_link_url(raw_url: &str) -> &str {
    let trimmed = raw_url.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("/api/local-asset?") {
        return trimmed;
    }
    if let Some(scheme) = extract_explicit_scheme(trimmed) {
        if !matches!(scheme.as_str(), "http" | "https" | "mailto") {
            return "#";
        }
    }
    trimmed
}

fn encode_local_asset_path(path: &Path) -> String {
    let path_str = path.to_string_lossy();
    let encoded = utf8_percent_encode(&path_str, NON_ALPHANUMERIC).to_string();
    format!("/api/local-asset?path={encoded}")
}

fn strip_query_and_fragment(url: &str) -> &str {
    let before_frag = url.split('#').next().unwrap_or(url);
    before_frag.split('?').next().unwrap_or(before_frag)
}

fn resolve_asset_url(raw_url: &str, base_dir: Option<&Path>) -> String {
    let trimmed = raw_url.trim();
    if trimmed.is_empty()
        || trimmed.starts_with('#')
        || trimmed.get(..7).is_some_and(|s| s.eq_ignore_ascii_case("http://"))
        || trimmed.get(..8).is_some_and(|s| s.eq_ignore_ascii_case("https://"))
        || trimmed.get(..11).is_some_and(|s| s.eq_ignore_ascii_case("data:image/"))
        || trimmed.get(..7).is_some_and(|s| s.eq_ignore_ascii_case("mailto:"))
        || trimmed.starts_with("/api/local-asset?")
    {
        return trimmed.to_string();
    }

    // Handle file:// or file:/// URLs (case-insensitive)
    if trimmed.get(..7).is_some_and(|s| s.eq_ignore_ascii_case("file://")) {
        let mut rest = &trimmed[7..];
        let is_unc = if let Some(after_slash) = rest.strip_prefix('/') {
            rest = after_slash;
            false
        } else if rest
            .get(..10)
            .is_some_and(|s| s.eq_ignore_ascii_case("localhost/"))
        {
            rest = &rest[10..];
            false
        } else {
            !is_ascii_drive_prefix(rest)
        };
        let path_part = strip_query_and_fragment(rest);
        let decoded = percent_encoding::percent_decode_str(path_part).decode_utf8_lossy();
        let mut normalized = decoded.replace('/', "\\");
        if is_unc && !normalized.starts_with(r"\\") {
            normalized = format!(r"\\{normalized}");
        }
        return encode_local_asset_path(Path::new(&normalized));
    }

    let path_part = strip_query_and_fragment(trimmed);
    let decoded = percent_encoding::percent_decode_str(path_part).decode_utf8_lossy();
    let candidate = Path::new(decoded.as_ref());
    if candidate.is_absolute() {
        return encode_local_asset_path(candidate);
    }

    if let Some(dir) = base_dir {
        let full = dir.join(candidate);
        return encode_local_asset_path(&full);
    }

    if extract_explicit_scheme(trimmed).is_some() {
        return "#".to_string();
    }

    trimmed.to_string()
}

const MAX_HIGHLIGHT_BYTES: usize = 128 * 1024;
const MAX_HIGHLIGHT_LINE_CHARS: usize = 4_000;

fn highlight_code(lang: &str, code: &str) -> String {
    if code.len() > MAX_HIGHLIGHT_BYTES
        || code
            .lines()
            .any(|line| line.len() > MAX_HIGHLIGHT_LINE_CHARS && line.chars().count() > MAX_HIGHLIGHT_LINE_CHARS)
    {
        let mut fallback = String::with_capacity(code.len() + 16);
        escape_html(&mut fallback, code);
        return fallback;
    }

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

/// Parses top-level scalar `key: value` pairs from YAML frontmatter.
fn parse_frontmatter_chips(yaml: &str) -> Vec<(String, String)> {
    let mut chips = Vec::new();
    for line in yaml.lines() {
        if line.starts_with(' ') || line.starts_with('\t') {
            continue;
        }
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with('#')
            || trimmed == "---"
            || trimmed == "..."
            || trimmed == "-"
            || trimmed.starts_with("- ")
        {
            continue;
        }
        let Some((raw_key, raw_val)) = trimmed.split_once(':') else {
            continue;
        };
        if !raw_val.is_empty() && !raw_val.starts_with(' ') && !raw_val.starts_with('\t') {
            continue;
        }
        let key = raw_key.trim();
        if key.is_empty() || key.starts_with('{') || key.starts_with('[') {
            continue;
        }
        let mut val = raw_val.trim();
        if val.is_empty()
            || matches!(val, "|" | "|-" | "|+" | ">" | ">-" | ">+")
            || val.starts_with('[')
            || val.starts_with('{')
        {
            continue;
        }
        if val.starts_with('"') && val.len() >= 2 {
            if let Some(end_q) = val[1..].find('"').map(|idx| idx + 1) {
                let trailing = val[end_q + 1..].trim_start();
                if trailing.is_empty() || trailing.starts_with('#') {
                    val = &val[1..end_q];
                }
            }
        } else if val.starts_with('\'') && val.len() >= 2 {
            if let Some(end_q) = val[1..].find('\'').map(|idx| idx + 1) {
                let trailing = val[end_q + 1..].trim_start();
                if trailing.is_empty() || trailing.starts_with('#') {
                    val = &val[1..end_q];
                }
            }
        } else if let Some(comment_idx) = val.find(" #").or_else(|| val.find("\t#")) {
            val = val[..comment_idx].trim_end();
        }
        if val.is_empty() {
            continue;
        }
        chips.push((key.to_string(), val.to_string()));
    }
    chips
}

struct LineSpan<'a> {
    line_num: usize,
    start: usize,
    end: usize,
    text: &'a str,
}

fn split_line_spans(src: &str) -> Vec<LineSpan<'_>> {
    let mut spans = Vec::new();
    let mut start = 0usize;
    let mut line_num = 1usize;
    for (idx, b) in src.bytes().enumerate() {
        if b == b'\n' {
            let end = idx + 1;
            let raw = &src[start..idx];
            let text = raw.strip_suffix('\r').unwrap_or(raw);
            spans.push(LineSpan {
                line_num,
                start,
                end,
                text,
            });
            start = end;
            line_num += 1;
        }
    }
    if start < src.len() {
        let raw = &src[start..];
        let text = raw.strip_suffix('\r').unwrap_or(raw);
        spans.push(LineSpan {
            line_num,
            start,
            end: src.len(),
            text,
        });
    }
    spans
}

fn update_fence_state(line: &str, fence: &mut Option<(char, usize)>) {
    let trimmed = line.trim_start();
    if let Some((fence_char, fence_len)) = *fence {
        let count = trimmed.bytes().take_while(|&b| b as char == fence_char).count();
        if count >= fence_len && trimmed[count..].trim().is_empty() {
            *fence = None;
        }
        return;
    }

    let leading_spaces = line.len() - trimmed.len();
    if leading_spaces >= 4 || line.starts_with('\t') {
        return;
    }
    if let Some(first) = trimmed.chars().next() {
        if first == '`' || first == '~' {
            let count = trimmed.bytes().take_while(|&b| b as char == first).count();
            if count >= 3 {
                let info = &trimmed[count..];
                if first == '`' && info.contains('`') {
                    return;
                }
                *fence = Some((first, count));
            }
        }
    }
}

fn match_prompt_tag_open(line: &str) -> Option<(&'static str, Option<&str>)> {
    if line.starts_with('\t') {
        return None;
    }
    let leading_spaces = line.len() - line.trim_start_matches(' ').len();
    if leading_spaces >= 4 {
        return None;
    }
    let trimmed = line.trim();
    for &tag in PROMPT_TAGS {
        if let Some(after_open) = trimmed
            .strip_prefix('<')
            .and_then(|s| s.strip_prefix(tag))
            .and_then(|s| s.strip_prefix('>'))
        {
            if after_open.is_empty() {
                return Some((tag, None));
            }
            if let Some(inner) = after_open
                .strip_suffix('>')
                .and_then(|s| s.strip_suffix(tag))
                .and_then(|s| s.strip_suffix("</"))
            {
                let close_tag = format!("</{tag}>");
                if !inner.contains(&close_tag) {
                    return Some((tag, Some(inner)));
                }
            }
        }
    }
    None
}

const MAX_PROMPT_TAG_DEPTH: usize = 16;

fn compute_prompt_tag_matches(lines: &[LineSpan<'_>], start_idx: usize) -> Vec<Option<usize>> {
    let mut matches = vec![None; lines.len()];
    let mut stacks: [Vec<usize>; PROMPT_TAGS.len()] = Default::default();
    let mut fence: Option<(char, usize)> = None;

    for (idx, line) in lines.iter().enumerate().skip(start_idx) {
        let was_in_fence = fence.is_some();
        update_fence_state(line.text, &mut fence);
        if was_in_fence || fence.is_some() {
            continue;
        }
        if line.text.starts_with('\t')
            || (line.text.len() - line.text.trim_start_matches(' ').len()) >= 4
        {
            continue;
        }
        let trimmed = line.text.trim();
        if let Some((tag, None)) = match_prompt_tag_open(line.text) {
            if let Some(tag_idx) = PROMPT_TAGS.iter().position(|&t| t == tag) {
                stacks[tag_idx].push(idx);
            }
        } else if let Some(inner_close) = trimmed.strip_prefix("</").and_then(|s| s.strip_suffix('>'))
        {
            if let Some(tag_idx) = PROMPT_TAGS.iter().position(|&t| t == inner_close) {
                if let Some(open_idx) = stacks[tag_idx].pop() {
                    matches[open_idx] = Some(idx);
                }
            }
        }
    }

    matches
}

fn yaml_frontmatter_end_byte(src: &str) -> Option<usize> {
    let first_nl = src.find('\n')?;
    let mut pos = first_nl + 1;
    let mut candidate_end = None;
    while pos < src.len() {
        let next_nl = src[pos..].find('\n').map(|idx| pos + idx);
        let line_end = next_nl.unwrap_or(src.len());
        let line_text = src[pos..line_end].strip_suffix('\r').unwrap_or(&src[pos..line_end]).trim();
        if line_text == "---" || line_text == "..." {
            candidate_end = Some(next_nl.map_or(src.len(), |nl| nl + 1));
            break;
        }
        pos = match next_nl {
            Some(nl) => nl + 1,
            None => break,
        };
    }
    let slice = &src[..candidate_end?];
    let mut parser =
        Parser::new_ext(slice, Options::ENABLE_YAML_STYLE_METADATA_BLOCKS).into_offset_iter();
    if !matches!(parser.next(), Some((Event::Start(Tag::MetadataBlock(_)), _))) {
        return None;
    }
    for (event, range) in parser {
        if matches!(event, Event::End(TagEnd::MetadataBlock(_))) {
            return Some(range.end);
        }
    }
    None
}

/// Reads the language declared in the leading YAML frontmatter.
pub fn document_language(markdown: &str) -> Option<String> {
    let mut parser = Parser::new_ext(
        markdown.strip_prefix('\u{feff}').unwrap_or(markdown),
        Options::ENABLE_YAML_STYLE_METADATA_BLOCKS,
    );
    if !matches!(parser.next(), Some(Event::Start(Tag::MetadataBlock(_)))) {
        return None;
    }
    let mut yaml = String::new();
    for event in parser {
        match event {
            Event::Text(text) => yaml.push_str(&text),
            Event::End(TagEnd::MetadataBlock(_)) => break,
            _ => {}
        }
    }
    let language = parse_frontmatter_chips(&yaml)
        .into_iter()
        .find(|(key, _)| key == "lang")
        .map(|(_, value)| value)?;
    // Accept language tags such as en, en-GB and zh-Hant-TW.
    let mut subtags = language.split('-');
    let primary = subtags.next()?;
    let valid = (1..=8).contains(&primary.len())
        && primary.bytes().all(|byte| byte.is_ascii_alphabetic())
        && subtags.all(|part| {
            (1..=8).contains(&part.len()) && part.bytes().all(|byte| byte.is_ascii_alphanumeric())
        });
    valid.then_some(language)
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

    let mut html = String::with_capacity(markdown.len() * 2 + 256);
    let mut outline: Vec<HeadingItem> = Vec::new();
    let mut slug_counts: HashMap<String, usize> = HashMap::new();

    render_markdown_fragment(
        markdown,
        base_dir,
        0,
        true,
        0,
        &mut outline,
        &mut slug_counts,
        &mut html,
    );

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

#[allow(clippy::too_many_arguments)]
fn render_markdown_fragment(
    src: &str,
    base_dir: Option<&Path>,
    line_offset: usize,
    is_document_start: bool,
    depth: usize,
    outline: &mut Vec<HeadingItem>,
    slug_counts: &mut HashMap<String, usize>,
    html: &mut String,
) {
    if src.is_empty() {
        return;
    }
    if depth >= MAX_PROMPT_TAG_DEPTH {
        render_markdown_pulldown(
            src,
            base_dir,
            line_offset,
            is_document_start,
            outline,
            slug_counts,
            html,
        );
        return;
    }

    let lines = split_line_spans(src);
    let mut i = 0usize;
    let mut slice_start = 0usize;
    let mut slice_line_offset = line_offset;
    let mut slice_is_doc_start = is_document_start;

    // Skip YAML frontmatter at document start so prompt tags inside comments/values aren't split
    if is_document_start && !lines.is_empty() && lines[0].text.trim() == "---" {
        if let Some(meta_end) = yaml_frontmatter_end_byte(src) {
            while i < lines.len() && lines[i].start < meta_end {
                i += 1;
            }
        }
    }

    let closing_matches = compute_prompt_tag_matches(&lines, i);
    let mut fence: Option<(char, usize)> = None;
    while i < lines.len() {
        let was_in_fence = fence.is_some();
        update_fence_state(lines[i].text, &mut fence);
        if was_in_fence || fence.is_some() {
            i += 1;
            continue;
        }

        if let Some((tag, inline_inner)) = match_prompt_tag_open(lines[i].text) {
            if let Some(inner) = inline_inner {
                let before = &src[slice_start..lines[i].start];
                if !before.is_empty() {
                    render_markdown_pulldown(
                        before,
                        base_dir,
                        slice_line_offset,
                        slice_is_doc_start,
                        outline,
                        slug_counts,
                        html,
                    );
                }
                let abs_line = line_offset + lines[i].line_num;
                html.push_str(&format!(
                    "<section class=\"prompt-tag-block\" data-prompt-tag=\"{tag}\" data-line=\"{abs_line}\"><div class=\"prompt-tag-label\">&lt;{tag}&gt;</div><div class=\"prompt-tag-body\">"
                ));
                let trimmed_inner = inner.trim();
                if !trimmed_inner.is_empty() {
                    render_markdown_fragment(
                        trimmed_inner,
                        base_dir,
                        abs_line - 1,
                        false,
                        depth + 1,
                        outline,
                        slug_counts,
                        html,
                    );
                }
                html.push_str("</div></section>\n");
                slice_start = lines[i].end;
                slice_line_offset = line_offset + lines[i].line_num;
                slice_is_doc_start = false;
                i += 1;
                continue;
            }

            if let Some(close_idx) = closing_matches[i] {
                let before = &src[slice_start..lines[i].start];
                if !before.is_empty() {
                    render_markdown_pulldown(
                        before,
                        base_dir,
                        slice_line_offset,
                        slice_is_doc_start,
                        outline,
                        slug_counts,
                        html,
                    );
                }
                let abs_line = line_offset + lines[i].line_num;
                html.push_str(&format!(
                    "<section class=\"prompt-tag-block\" data-prompt-tag=\"{tag}\" data-line=\"{abs_line}\"><div class=\"prompt-tag-label\">&lt;{tag}&gt;</div><div class=\"prompt-tag-body\">"
                ));
                if i + 1 < close_idx {
                    let inner_slice = &src[lines[i + 1].start..lines[close_idx].start];
                    if !inner_slice.trim().is_empty() {
                        render_markdown_fragment(
                            inner_slice,
                            base_dir,
                            line_offset + lines[i + 1].line_num - 1,
                            false,
                            depth + 1,
                            outline,
                            slug_counts,
                            html,
                        );
                    }
                }
                html.push_str("</div></section>\n");
                slice_start = lines[close_idx].end;
                slice_line_offset = line_offset + lines[close_idx].line_num;
                slice_is_doc_start = false;
                i = close_idx + 1;
                continue;
            }
        }

        i += 1;
    }

    let rest = &src[slice_start..];
    if !rest.is_empty() {
        render_markdown_pulldown(
            rest,
            base_dir,
            slice_line_offset,
            slice_is_doc_start,
            outline,
            slug_counts,
            html,
        );
    }
}

fn render_markdown_pulldown(
    markdown: &str,
    base_dir: Option<&Path>,
    line_offset: usize,
    allow_yaml_frontmatter: bool,
    outline: &mut Vec<HeadingItem>,
    mut slug_counts: &mut HashMap<String, usize>,
    mut html: &mut String,
) {
    let line_index = LineIndex::new(markdown);

    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_GFM);
    options.insert(Options::ENABLE_MATH);
    options.insert(Options::ENABLE_HEADING_ATTRIBUTES);
    if allow_yaml_frontmatter {
        options.insert(Options::ENABLE_YAML_STYLE_METADATA_BLOCKS);
    }

    let parser = Parser::new_ext(markdown, options).into_offset_iter();

    // State tracking during event traversal
    let mut in_heading: Option<(u8, usize, Option<String>, String, String)> = None; // (level, line, custom_id, plain_text, inner_html)
    let mut in_code_block: Option<(String, usize, String)> = None; // (lang, line, buffer)
    let mut in_metadata: Option<(usize, String)> = None; // (line, raw_yaml)
    let mut in_image: Option<(String, String, String, usize)> = None; // (resolved_src, title, alt_buffer, nested_depth)
    let mut table_alignments: Vec<Alignment> = Vec::new();
    let mut in_table_head = false;
    let mut current_cell_idx = 0usize;
    let mut current_item_line = 1usize + line_offset;

    for (event, range) in parser {
        let line = line_index.line_of(range.start) + line_offset;

        if let Some((meta_line, ref mut yaml_buf)) = in_metadata {
            match event {
                Event::End(TagEnd::MetadataBlock(_)) => {
                    let chips = parse_frontmatter_chips(yaml_buf);
                    let highlighted = highlight_code("yaml", yaml_buf.trim_end());
                    html.push_str(&format!(
                        "<div class=\"frontmatter-card\" data-line=\"{meta_line}\">"
                    ));
                    if !chips.is_empty() {
                        html.push_str("<div class=\"frontmatter-chips\">");
                        for (k, v) in &chips {
                            html.push_str(
                                "<span class=\"frontmatter-chip\"><span class=\"frontmatter-chip-key\">",
                            );
                            escape_html(html, k);
                            html.push_str("</span><span class=\"frontmatter-chip-val\">");
                            escape_html(html, v);
                            html.push_str("</span></span>");
                        }
                        html.push_str("</div>");
                    }
                    html.push_str(&format!(
                        "<details><summary>Frontmatter (YAML)</summary><pre tabindex=\"0\"><code class=\"hl-code\">{highlighted}</code></pre></details></div>\n"
                    ));
                    in_metadata = None;
                }
                Event::Text(t) => yaml_buf.push_str(&t),
                _ => {}
            }
            continue;
        }

        // If inside an image tag, collect alt text until matching TagEnd::Image
        if let Some((ref src, ref title, ref mut alt_buf, ref mut nested_depth)) = in_image {
            match event {
                Event::Start(Tag::Image { .. }) => {
                    *nested_depth += 1;
                }
                Event::End(TagEnd::Image) => {
                    if *nested_depth > 0 {
                        *nested_depth -= 1;
                        continue;
                    }
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
                    let safe_href = sanitize_link_url(&dest_url);
                    target.push_str("<a href=\"");
                    escape_html(target, safe_href);
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
                    in_image = Some((resolved, title.into_string(), String::new(), 0));
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
                        let slug = match custom_id {
                            Some(id) => {
                                let count = slug_counts.entry(id.clone()).or_insert(0);
                                *count += 1;
                                id
                            }
                            None => slugify(&plain_text, &mut slug_counts),
                        };
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
                let target = if let Some((_, _, _, _, ref mut h_html)) = in_heading {
                    h_html
                } else {
                    &mut html
                };
                target.push_str("<sup class=\"footnote-ref\"><a href=\"#fn-");
                escape_html(target, &name);
                target.push_str("\">[");
                escape_html(target, &name);
                target.push_str("]</a></sup>");
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

    #[test]
    fn renders_frontmatter_chips_above_details_with_escaping() {
        let md = "---\ntitle: \"Prompt <v1> & Demo\"\nmodel: gpt-5 # primary\ntags: [ai, rust]\nnested:\n  key: ignored\n---\n\n# Body\n";
        let res = render_markdown(md, None);
        assert!(res.html.contains("<div class=\"frontmatter-card\" data-line=\"1\">"));
        assert!(res.html.contains("<div class=\"frontmatter-chips\">"));
        assert!(res.html.contains("<span class=\"frontmatter-chip-key\">title</span><span class=\"frontmatter-chip-val\">Prompt &lt;v1&gt; &amp; Demo</span>"));
        assert!(res.html.contains("<span class=\"frontmatter-chip-key\">model</span><span class=\"frontmatter-chip-val\">gpt-5</span>"));
        assert!(!res.html.contains("<span class=\"frontmatter-chip-key\">tags</span>"));
        assert!(!res.html.contains("<span class=\"frontmatter-chip-key\">nested</span>"));
        let chips_pos = res.html.find("class=\"frontmatter-chips\"").unwrap();
        let details_pos = res.html.find("<details><summary>Frontmatter (YAML)</summary>").unwrap();
        assert!(chips_pos < details_pos);
    }

    #[test]
    fn renders_prompt_tag_blocks_and_preserves_fenced_code_blocks() {
        let md = "# Intro\n\n<role>\nYou are a **Rust** assistant.\n- Follow rules\n</role>\n\n<output_format>JSON only</output_format>\n\n```xml\n<context>Should stay code</context>\n```\n";
        let res = render_markdown(md, None);
        assert!(res.html.contains("<section class=\"prompt-tag-block\" data-prompt-tag=\"role\" data-line=\"3\">"));
        assert!(res.html.contains("<div class=\"prompt-tag-label\">&lt;role&gt;</div>"));
        assert!(res.html.contains("<p data-line=\"4\">You are a <strong>Rust</strong> assistant.</p>"));
        assert!(res.html.contains("<li data-line=\"5\">Follow rules</li>"));
        assert!(res.html.contains("<section class=\"prompt-tag-block\" data-prompt-tag=\"output_format\" data-line=\"8\">"));
        assert!(res.html.contains("<p data-line=\"8\">JSON only</p>"));
        assert!(!res.html.contains("data-prompt-tag=\"context\""));
        assert!(res.html.contains("data-lang=\"xml\""));
    }

    #[test]
    fn match_prompt_tag_open_handles_multibyte_utf8_safely() {
        assert_eq!(match_prompt_tag_open("<role>🦀äöü>"), None);
        assert_eq!(match_prompt_tag_open("<role>🦀aaa>"), None);
        assert_eq!(
            match_prompt_tag_open("<role>🦀äöü</role>"),
            Some(("role", Some("🦀äöü")))
        );

        let res = render_markdown("<role>🦀äöü>\n\n<role>🦀äöü</role>\n", None);
        assert!(res.html.contains("data-prompt-tag=\"role\""));
        assert!(res.html.contains("🦀äöü"));
    }

    #[test]
    fn hardens_links_prompt_depth_footnotes_and_asset_urls() {
        // Unsafe link schemes neutralized while safe links and data:image/ remain intact
        let links = render_markdown(
            "[x](javascript:alert(1)) [y](java\tscript:alert(2)) [z](data:text/html,<script>1</script>) [f](file:///C:/secret.txt) [ok](https://example.com) ![bad](data:text/html,<script>1</script>) ![ok](data:image/png;base64,iVBORw==)",
            None,
        );
        assert!(!links.html.contains("javascript:"));
        assert!(!links.html.contains("data:text/html"));
        assert!(!links.html.contains("file:///C:/secret.txt"));
        assert!(links.html.contains("href=\"#\""));
        assert!(links.html.contains("href=\"https://example.com\""));
        assert!(links.html.contains("src=\"data:image/png;base64,iVBORw==\""));

        // Deeply nested prompt tags cap safely without stack overflow
        let deep = format!(
            "{}\nhello\n{}",
            "<role>\n".repeat(40),
            "</role>\n".repeat(40)
        );
        let deep_res = render_markdown(&deep, None);
        assert!(deep_res.html.contains("hello"));

        // HR at line 0 does not swallow prompt tags before closing ---
        let hr_doc = "---\n\n<role>\nInside\n</role>\n\n---";
        let hr_res = render_markdown(hr_doc, None);
        assert!(hr_res.html.contains("data-prompt-tag=\"role\""));

        // Multiple inline prompt tags on one line don't merge into one prompt-tag-block
        let multi_inline = render_markdown("<role>a</role> <role>b</role>", None);
        assert!(!multi_inline.html.contains("data-prompt-tag"));

        // Footnote inside heading renders inside <h1>
        let fn_heading = render_markdown("# Titel[^1]\n\n[^1]: Note", None);
        let h1_start = fn_heading.html.find("<h1 ").unwrap();
        let fn_pos = fn_heading.html.find("class=\"footnote-ref\"").unwrap();
        assert!(fn_pos > h1_start);

        // Nested image inside alt text doesn't close outer image early
        let nested_img = render_markdown("![outer ![inner](b.png)](a.png)", Some(Path::new(r"C:\Docs")));
        assert_eq!(nested_img.html.matches("<img ").count(), 1);

        // Frontmatter quoted value with inline comment and custom heading id collision avoidance
        let fm = "---\ntitle: \"Demo\" # comment\n---\n\n# A {#dup}\n\n# dup\n";
        let fm_res = render_markdown(fm, None);
        assert!(fm_res.html.contains("<span class=\"frontmatter-chip-val\">Demo</span>"));
        assert_eq!(fm_res.outline[0].slug, "dup");
        assert_eq!(fm_res.outline[1].slug, "dup-1");

        // Asset URL edge cases: case-insensitive schemes, passthrough, percent-decoding, query/frag, UNC
        assert_eq!(resolve_asset_url("HTTPS://example.com/a.png", Some(Path::new(r"C:\Docs"))), "HTTPS://example.com/a.png");
        assert_eq!(resolve_asset_url("/api/local-asset?path=abc", Some(Path::new(r"C:\Docs"))), "/api/local-asset?path=abc");
        let space_img = resolve_asset_url("my%20img.png?v=1#dark", Some(Path::new(r"C:\Docs")));
        assert!(!space_img.contains("%2520"));
        assert!(!space_img.contains("dark"));
        let unc = resolve_asset_url("file://server/share/img.png", None);
        assert!(unc.starts_with("/api/local-asset?path=%5C%5Cserver"));

        // Oversized code block skips syntect span expansion
        let long_line = "a".repeat(MAX_HIGHLIGHT_LINE_CHARS + 50);
        let highlighted = highlight_code("rust", &long_line);
        assert!(!highlighted.contains("hl-"));
        assert_eq!(highlighted.len(), long_line.len());
    }
}
