---
name: semyra-codebase-review
description: >-
  Use when auditing the Semyra codebase for oversized or low-cohesion files,
  clean-code issues, stability/concurrency risks, dead code, or violations of
  Rust, TypeScript, WebView2, and Semyra architecture/security best practices.
---

# Semyra Codebase Review

Perform a structured, read-only health check of `src/` and `frontend/src/`. Do **not** edit application files unless the user explicitly asks to apply fixes.

## 1. Quantitative Inventory & Static Checks

Run a quick line-count inventory (ignoring `frontend/dist`, `node_modules`, `target`, and `frontend/src/__tests__`) plus static checks:

```powershell
Get-ChildItem src, frontend\src -Recurse -File |
  Where-Object { $_.FullName -notmatch '\\__tests__\\' -and $_.Extension -in '.rs','.ts','.css' } |
  ForEach-Object { [PSCustomObject]@{ Lines = (Get-Content $_.FullName).Count; Path = $_.FullName.Replace("$PWD\", '') } } |
  Sort-Object Lines -Descending | Select-Object -First 15
```

Also check for compiler/type warnings:
- Run frontend typecheck and build before a Rust compile check. Follow the [build order in AGENTS.md](../../../AGENTS.md#build-and-verify).

## 2. Cohesion & Modularity Audit

Use file size to identify review candidates. Judge modules by cohesion and testability:
- Are unrelated domain concerns mixed in one file (e.g., pure business/parsing logic coupled with Win32/DOM/IPC glue instead of being unit-tested separately)?
- Is there duplicated logic across modules that should share a helper?
- Are functions overly long or deeply nested where early returns or small helpers would clarify intent?

## 3. Tech-Stack & Semyra-Invariant Audit

Spot-check with targeted searches (`rg` / `Select-String`):
- **Rust (`src/`)**:
  - Heavy CPU and disk routes in `src/ipc.rs` must stay off the Win32 UI thread. Verify routing through the existing worker pools, especially for preview and drafts.
  - No `fs::remove_file` / `fs::remove_dir_all` on user documents (must use `trash::delete`).
  - Canonicalized paths shown in UI or passed to Explorer must go through `clean_windows_path`.
  - Local asset reads must remain gated by `state.is_local_asset_allowed(&target)`.
  - Flag risky `.unwrap()` / `.expect()` in non-test production paths.
- **TypeScript / WebView2 (`frontend/src/`)**:
  - No raw `.innerHTML =` on live DOM elements (preview must use `safeSetMarkdownHTML`).
  - No `content-visibility: auto` on `.markdown-body`.
  - Theme colors should use CSS tokens from `frontend/src/styles/tokens.css` (`light-dark()`) rather than ad-hoc hex colors in component styles.
  - Modern HTML/A11y patterns (`<dialog>`, `<search>`, `.tab-slot` sibling close buttons) remain intact.

## 4. Stability, Concurrency & Error-Handling Audit

Check high-risk runtime paths for subtle regressions:
- **Async Race Conditions**: Verify sequence/generation guards on debounced or async flows (live preview render, workspace search, tab switching, file reloads) so stale responses cannot overwrite newer state.
- **Error Handling**: Inspect empty `catch {}` or `let _ =` blocks — ensure user-triggered actions (save, open, export, delete) surface errors via toast/status instead of failing silently.
- **Resource & Lifecycle Cleanup**: Check `setTimeout` / `setInterval` clearing, `notify` watcher / `EventLoopProxy` error paths, and single-instance / WebView2 profile lock cleanup.
- **Verification**: Run the relevant unit and Playwright tests using the build order above. Say which findings were reproduced and which are based on static review.

## 5. Prioritized Report Format

Present actionable findings first, with clickable workspace links and line numbers. Prioritize by impact:
1. **P1 – Security, Data-Safety & Correctness**
2. **P2 – Architecture, Cohesion & Separation of Concerns**
3. **P3 – Clean Code, Modern Stack & Testability**

For each finding, explain the impact and suggest a concrete next step.
