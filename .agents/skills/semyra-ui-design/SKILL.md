---
name: semyra-ui-design
description: >-
  Use when modifying Semyra's frontend UI, CSS tokens, themes, dialogs,
  accessibility, or German UI copy in frontend/src/ or frontend/index.html.
---

# Semyra UI, Theme & Accessibility Checklist

## 1. Design Authority & Tokens

- Consult `docs/PRODUCT_CONTEXT.md` before changing colors, spacing, or typography.
- Reuse canonical CSS custom properties from `frontend/src/styles/tokens.css` via `light-dark(...)`:
  - Primary interaction accent: Steel Blue (`--semyra-accent-light: #426b91`, `--semyra-accent-dark: #83a5c6`).
  - Unsaved indicator only: Amber (`--semyra-unsaved-dot-light: #986c3d`, `--semyra-unsaved-dot-dark: #d0a774`). Never repurpose Amber for generic highlights.
  - Keep Markdown preview typography neutral-first.

## 2. Dual-Theme & Win32 Synchronization

- Maintain `:root { color-scheme: light dark; }` and synchronize `<meta name="color-scheme">` + Win32 titlebar via `frontend/src/theme.ts`.
- Verify both Light and Dark surfaces remain opaque and readable (contrast >= WCAG AA).

## 3. WebView2 & HTML/A11y Invariants

- **Never** add `content-visibility: auto` to `.markdown-body` blocks (breaks `SyncScrollController` pixel height interpolation).
- Use native `<dialog>` (`closedby="any"` or `closedby="none"` with `cancel` guard, resetting `dialog.returnValue = ''` on `close`) without redundant `role="dialog"` or `aria-modal`.
- Show failures inside an open dialog because the app suppresses global toasts while a dialog is open. Preserve the user's input and selection when a retry is possible.
- Use declarative Invoker Commands (`command="show-modal" commandfor="..."`) for static modal triggers.
- Wrap search inputs in `<search>` with an explicit `<label class="visually-hidden">`.
- Keep tab close buttons as siblings of `<button role="tab">` inside `.tab-slot` (never nested inside `[role="tab"]`) and preserve roving `tabindex` in `frontend/src/navigation-a11y.ts`.
- Keep all user-facing labels, tooltips, dialogs, and messages in **idiomatic German** (`<html lang="de">`).

## 4. Verification

```powershell
cd frontend
npm run typecheck
npm test
```

- Confirm `src/__tests__/layout-css.test.ts` passes.
- If Playwright / `@axe-core/playwright` is needed for major layout or A11y changes, run `npm run test:e2e`.
