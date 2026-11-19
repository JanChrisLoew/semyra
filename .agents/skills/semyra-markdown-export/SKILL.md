---
name: semyra-markdown-export
description: >-
  Use when adding or changing Markdown syntax, preview rendering, sanitization,
  scroll-sync, or HTML/Rich-Text/PDF exports across src/markdown.rs,
  frontend/src/sanitizer.ts, frontend/src/sync-scroll.ts,
  src/fs_ops/html_export.rs, or frontend/src/export-utils.ts.
---

# Semyra Markdown, Sanitizer & Export Pipeline

Check the layers affected by the change.

## 1. Pipeline Touchpoints

1. **Rust Parser (`src/markdown.rs`)**:
   - `pulldown-cmark` + `syntect` GFM output.
   - Preserve `data-line` anchors on block elements (required for scroll-sync) and `data-task-line` on task checkboxes.
   - Keep math (`$...$`, `$$...$$`) and Mermaid code blocks in their expected placeholder structure.
2. **Sanitizer & DOM Reconciler (`frontend/src/sanitizer.ts`)**:
   - Never assign raw HTML directly to `innerHTML` on live DOM; route through `safeSetMarkdownHTML`.
   - Ensure any new tags/attributes/classes are allowed by both native `setHTML` and `DOMPurify` fallback.
   - Verify KaTeX / Mermaid post-processing and `reconcileChildren` (preserving `<details>` open state).
3. **Scroll Sync (`frontend/src/sync-scroll.ts`)**:
   - Verify `[data-line]` elements remain measurable and ordered; avoid CSS that collapses or estimates offscreen block heights.
4. **1-File HTML Export (`src/fs_ops/html_export.rs`)**:
   - Ensure new styles, rendered MathML/Mermaid SVGs, and allowed local images (base64-inlined) work in standalone Light/Dark HTML exports.
5. **Rich-Text Clipboard Export (`frontend/src/export-utils.ts`)**:
   - Ensure Office/Teams/Outlook clipboard output includes inline structural styles for any new Markdown elements.
6. **Export orchestration (`frontend/src/document-export.ts`)**:
   - Preserve the document snapshot across tab switches. Trace native PDF export through `src/ipc.rs` and `src/main.rs` when changing that path.

## 2. Security Invariant

- Any local image or asset resolution in exports or preview (`/api/local-asset`) must remain gated by `state.is_local_asset_allowed(&target)`.

## 3. Verification

- Follow the [build order in AGENTS.md](../../../AGENTS.md#build-and-verify).
- Run the relevant cases in `sanitizer.test.ts`, `sync-scroll.test.ts`, `export-utils.test.ts`, and `src/markdown.rs`. For changes to the export flow, check the relevant Playwright tests.
