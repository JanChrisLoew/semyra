import { backend, type FilePayload } from './api';
import {
  buildAiContextBundle,
  InvalidXmlCharacter,
  isSensitiveAiContextPath,
  extractTemplateVariables,
  interpolateTemplateVariables,
  toWorkspaceRelativeLabel,
  type AiBundleOptions,
  type AiContextFormat,
} from './ai-bundle';
import { getLanguage, t } from './i18n';
import { buildCollapsedDiffItems, computeLineDiff, type DiffLine } from './line-diff';
import { estimateTokens } from './token-utils';

export interface AiBundleTabInfo {
  id: string;
  name: string;
  path: string | null;
  currentContent: string;
}

export interface AiBundleDialogDeps {
  tabs: AiBundleTabInfo[];
  workspaceRootPath: string | null;
  onShowToast: (msg: string) => void;
  onSaveBundle?: (bundleText: string, format: AiContextFormat) => Promise<string | null>;
}

export interface PromptVariablesDialogOptions {
  title: string;
  content: string;
  onCopy: (rendered: string) => Promise<void> | void;
}

export interface ExternalDiffDialogDeps {
  path: string;
  localContent: string;
  onKeepLocal: (payload: FilePayload) => void;
  onReloadDisk: () => Promise<void>;
  onError?: (err: unknown) => void;
}

export interface CompareDiffDialogOptions {
  title: string;
  subtitle?: string;
  leftLabel: string;
  rightLabel: string;
  leftContent: string;
  rightContent: string;
  readOnly?: boolean;
  onApplyRight?: () => Promise<void> | void;
}

const TOKEN_BUDGET_PRESETS = [
  { value: 8000, label: '8k' },
  { value: 32000, label: '32k' },
  { value: 128000, label: '128k' },
  { value: 200000, label: '200k' },
] as const;

export function bindDialogReturnValueReset(dialog: HTMLDialogElement): void {
  if (dialog.dataset.returnResetBound === '1') return;
  dialog.dataset.returnResetBound = '1';
  dialog.addEventListener('close', () => {
    dialog.returnValue = '';
  });
}

/**
 * Opens the Multi-File AI Context Bundler modal allowing selection, ordering,
 * filtering, formatting, and token-budget inspection of open tabs and workspace files.
 */
const aiBundleSessions = new WeakMap<HTMLDialogElement, symbol>();

export function openAiBundleDialogModal(deps: AiBundleDialogDeps): void {
  const dialog = document.getElementById('ai-bundle-dialog') as HTMLDialogElement | null;
  const listEl = document.getElementById('ai-bundle-list');
  const totalEl = document.getElementById('ai-bundle-token-total');
  const copyBtn = document.getElementById('btn-ai-bundle-copy') as HTMLButtonElement | null;
  const loadError = document.getElementById('ai-bundle-load-error');
  const loadAlert = document.getElementById('ai-bundle-load-alert');
  const retryBtn = document.getElementById('btn-ai-bundle-retry') as HTMLButtonElement | null;
  const actionError = document.getElementById('ai-bundle-action-error');
  const selectAllBtn = document.getElementById('btn-ai-bundle-select-all');
  const selectNoneBtn = document.getElementById('btn-ai-bundle-select-none');
  if (!dialog || dialog.open || !listEl || !totalEl || !copyBtn
      || !loadError || !loadAlert || !retryBtn || !actionError) return;

  const session = Symbol();
  aiBundleSessions.set(dialog, session);
  const isCurrent = () => dialog.open && aiBundleSessions.get(dialog) === session;
  loadError.hidden = true;
  loadAlert.textContent = '';
  actionError.hidden = true;
  actionError.textContent = '';
  let listing = false;
  let outputPending = false;

  bindDialogReturnValueReset(dialog);
  const isEn = getLanguage() === 'en';
  const locale = isEn ? 'en-US' : 'de-DE';

  const cardEl = dialog.querySelector<HTMLElement>('.modal-card') ?? dialog;
  const toolbarEl = dialog.querySelector<HTMLElement>('.ai-bundle-toolbar');
  const footerEl = dialog.querySelector<HTMLElement>('.ai-bundle-footer');

  // Ensure <search> filter bar exists
  let searchEl = dialog.querySelector<HTMLElement>('search.ai-bundle-search');
  let filterInput = document.getElementById('ai-bundle-filter') as HTMLInputElement | null;
  if (!searchEl) {
    searchEl = document.createElement('search');
    searchEl.className = 'ai-bundle-search';

    const filterLabel = document.createElement('label');
    filterLabel.className = 'visually-hidden';
    filterLabel.htmlFor = 'ai-bundle-filter';
    filterLabel.textContent = isEn ? 'Filter files' : 'Dateien filtern';

    filterInput = document.createElement('input');
    filterInput.id = 'ai-bundle-filter';
    filterInput.type = 'search';
    filterInput.className = 'ai-bundle-filter-input';
    filterInput.autocomplete = 'off';

    searchEl.append(filterLabel, filterInput);
    if (toolbarEl && toolbarEl.parentElement === cardEl) {
      cardEl.insertBefore(searchEl, toolbarEl);
    } else {
      cardEl.insertBefore(searchEl, listEl);
    }
  }
  if (filterInput) {
    filterInput.value = '';
    filterInput.placeholder = isEn ? 'Filter files…' : 'Dateien filtern…';
    const label = searchEl.querySelector('label');
    if (label) label.textContent = isEn ? 'Filter files' : 'Dateien filtern';
  }

  // Ensure format & stripping options bar exists
  let optionsEl = dialog.querySelector<HTMLElement>('.ai-bundle-options');
  if (!optionsEl) {
    optionsEl = document.createElement('div');
    optionsEl.className = 'ai-bundle-options';

    const formatGroup = document.createElement('div');
    formatGroup.className = 'ai-bundle-format-group';
    formatGroup.setAttribute('role', 'group');

    const mdBtn = document.createElement('button');
    mdBtn.type = 'button';
    mdBtn.id = 'btn-ai-bundle-format-md';
    mdBtn.className = 'ai-bundle-format-btn';
    mdBtn.textContent = 'Markdown';
    mdBtn.setAttribute('aria-pressed', 'true');

    const xmlBtn = document.createElement('button');
    xmlBtn.type = 'button';
    xmlBtn.id = 'btn-ai-bundle-format-xml';
    xmlBtn.className = 'ai-bundle-format-btn';
    xmlBtn.textContent = 'XML (<file>)';
    xmlBtn.setAttribute('aria-pressed', 'false');

    formatGroup.append(mdBtn, xmlBtn);

    const checksGroup = document.createElement('div');
    checksGroup.className = 'ai-bundle-checks';

    const fmLabel = document.createElement('label');
    fmLabel.className = 'ai-bundle-check-label';
    const fmCheck = document.createElement('input');
    fmCheck.type = 'checkbox';
    fmCheck.id = 'chk-ai-bundle-strip-fm';
    const fmText = document.createElement('span');
    fmText.id = 'lbl-ai-bundle-strip-fm';
    fmLabel.append(fmCheck, fmText);

    const cmLabel = document.createElement('label');
    cmLabel.className = 'ai-bundle-check-label';
    const cmCheck = document.createElement('input');
    cmCheck.type = 'checkbox';
    cmCheck.id = 'chk-ai-bundle-strip-comments';
    const cmText = document.createElement('span');
    cmText.id = 'lbl-ai-bundle-strip-comments';
    cmLabel.append(cmCheck, cmText);

    checksGroup.append(fmLabel, cmLabel);
    optionsEl.append(formatGroup, checksGroup);
    cardEl.insertBefore(optionsEl, listEl);
  }

  const formatGroup = optionsEl.querySelector<HTMLElement>('.ai-bundle-format-group');
  if (formatGroup) {
    formatGroup.setAttribute('aria-label', isEn ? 'Output format' : 'Ausgabeformat');
  }
  const mdBtn = document.getElementById('btn-ai-bundle-format-md') as HTMLButtonElement | null;
  const xmlBtn = document.getElementById('btn-ai-bundle-format-xml') as HTMLButtonElement | null;
  const fmCheck = document.getElementById('chk-ai-bundle-strip-fm') as HTMLInputElement | null;
  const cmCheck = document.getElementById('chk-ai-bundle-strip-comments') as HTMLInputElement | null;
  const fmText = document.getElementById('lbl-ai-bundle-strip-fm');
  const cmText = document.getElementById('lbl-ai-bundle-strip-comments');
  if (fmText) fmText.textContent = isEn ? 'Strip frontmatter' : 'Frontmatter entfernen';
  if (cmText) cmText.textContent = isEn ? 'Strip comments' : 'Kommentare entfernen';

  // Ensure token budget meter exists
  let budgetEl = dialog.querySelector<HTMLElement>('.ai-bundle-budget');
  if (!budgetEl) {
    budgetEl = document.createElement('div');
    budgetEl.className = 'ai-bundle-budget';

    const budgetHeader = document.createElement('div');
    budgetHeader.className = 'ai-bundle-budget-header';

    const budgetSelectWrap = document.createElement('div');
    budgetSelectWrap.className = 'ai-bundle-budget-select-wrap';
    const budgetLabel = document.createElement('label');
    budgetLabel.id = 'lbl-ai-bundle-budget';
    budgetLabel.htmlFor = 'ai-bundle-budget-select';
    const budgetSelect = document.createElement('select');
    budgetSelect.id = 'ai-bundle-budget-select';
    budgetSelect.className = 'ai-bundle-budget-select';
    for (const preset of TOKEN_BUDGET_PRESETS) {
      const opt = document.createElement('option');
      opt.value = String(preset.value);
      opt.textContent = `${preset.label} (${preset.value.toLocaleString('de-DE')})`;
      if (preset.value === 128000) opt.selected = true;
      budgetSelect.appendChild(opt);
    }
    budgetSelectWrap.append(budgetLabel, budgetSelect);

    const budgetStatus = document.createElement('span');
    budgetStatus.id = 'ai-bundle-budget-status';
    budgetStatus.className = 'ai-bundle-budget-status';

    budgetHeader.append(budgetSelectWrap, budgetStatus);

    const track = document.createElement('div');
    track.className = 'ai-bundle-budget-track';
    const fill = document.createElement('div');
    fill.id = 'ai-bundle-budget-fill';
    fill.className = 'ai-bundle-budget-fill';
    track.appendChild(fill);

    budgetEl.append(budgetHeader, track);
    cardEl.insertBefore(budgetEl, listEl);
  }

  const budgetLabel = document.getElementById('lbl-ai-bundle-budget');
  if (budgetLabel) budgetLabel.textContent = isEn ? 'Token budget:' : 'Token-Budget:';
  const budgetSelect = document.getElementById('ai-bundle-budget-select') as HTMLSelectElement | null;
  const budgetStatus = document.getElementById('ai-bundle-budget-status');
  const budgetFill = document.getElementById('ai-bundle-budget-fill');
  if (budgetSelect) {
    Array.from(budgetSelect.options).forEach((opt, idx) => {
      const preset = TOKEN_BUDGET_PRESETS[idx];
      if (preset) {
        opt.textContent = `${preset.label} (${preset.value.toLocaleString(locale)})`;
      }
    });
  }

  // Ensure "Save as file" button exists in footer
  let saveBtn = document.getElementById('btn-ai-bundle-save') as HTMLButtonElement | null;
  if (!saveBtn && footerEl) {
    saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.id = 'btn-ai-bundle-save';
    saveBtn.className = 'dialog-btn';
    footerEl.insertBefore(saveBtn, copyBtn);
  }
  if (saveBtn) {
    saveBtn.textContent = isEn ? 'Save as file' : 'Als Datei speichern';
    saveBtn.hidden = !deps.onSaveBundle;
  }

  let currentFormat: AiContextFormat = 'markdown';
  if (mdBtn && xmlBtn) {
    mdBtn.setAttribute('aria-pressed', 'true');
    xmlBtn.setAttribute('aria-pressed', 'false');
  }
  if (fmCheck) fmCheck.checked = false;
  if (cmCheck) cmCheck.checked = false;

  const getBundleOptions = (): AiBundleOptions => ({
    format: currentFormat,
    stripFrontmatter: Boolean(fmCheck?.checked),
    stripComments: Boolean(cmCheck?.checked),
  });

  type SelectableItem = {
    key: string;
    name: string;
    subtitle: string;
    content: string | null;
    filePath: string | null;
    checked: boolean;
    sensitive: boolean;
    tokensText: string;
  };

  const items: SelectableItem[] = deps.tabs.map((tab) => {
    const sensitive = isSensitiveAiContextPath(tab.path ?? tab.name);
    return {
      key: `tab:${tab.id}`,
      name: tab.name,
      subtitle: tab.path ?? (isEn ? 'Unsaved tab' : 'Ungespeicherter Tab'),
      content: tab.currentContent,
      filePath: tab.path,
      checked: !sensitive,
      sensitive,
      tokensText: `~${estimateTokens(tab.currentContent).toLocaleString(locale)} Tokens`,
    };
  });

  const getBundleLabel = (item: SelectableItem): string =>
    toWorkspaceRelativeLabel(item.filePath, deps.workspaceRootPath, item.name);

  const refreshSummary = () => {
    const selected = items.filter((item) => item.checked);
    const loadedSelected = selected.filter((item) => item.content !== null);
    let knownTokens: number;
    try {
      knownTokens = buildAiContextBundle(
        loadedSelected.map(item => ({ label: getBundleLabel(item), content: item.content ?? '' })),
        getBundleOptions(),
      ).totalTokens;
    } catch (err) {
      if (!(err instanceof InvalidXmlCharacter)) throw err;
      totalEl.textContent = t('aiBundle.invalidXml', { file: err.label });
      copyBtn.disabled = true;
      if (saveBtn) saveBtn.disabled = true;
      if (budgetFill) budgetFill.style.width = '0';
      if (budgetStatus) budgetStatus.textContent = '';
      return;
    }

    totalEl.textContent = t('aiBundle.totalSummary', {
      count: String(selected.length),
      tokens: knownTokens.toLocaleString(locale),
    });
    copyBtn.disabled = outputPending || selected.length === 0;
    if (saveBtn) saveBtn.disabled = copyBtn.disabled;

    // Update token budget meter (strictly neutral / Steel Blue / subtle Teal — never Amber)
    const budgetLimit = Number(budgetSelect?.value ?? 128000) || 128000;
    const rawPct = Math.round((knownTokens / budgetLimit) * 100);
    const clampedWidth = Math.min(100, Math.max(0, (knownTokens / budgetLimit) * 100));
    const isHigh = rawPct >= 85;
    const isOver = knownTokens > budgetLimit;

    if (budgetFill) {
      budgetFill.style.width = `${clampedWidth.toFixed(1)}%`;
      budgetFill.classList.toggle('is-high', isHigh);
    }
    if (budgetStatus) {
      budgetStatus.classList.toggle('is-high', isHigh);
      const overText = isOver
        ? isEn
          ? ' · over budget'
          : ' · Budget überschritten'
        : '';
      budgetStatus.textContent = `${knownTokens.toLocaleString(locale)} / ${budgetLimit.toLocaleString(locale)} (${rawPct}%${overText})`;
    }
  };

  const itemTokEls = new Map<string, HTMLElement>();

  const ensureItemTokens = async (item: SelectableItem) => {
    if (item.content !== null || !item.filePath) return;
    try {
      const file = await backend.readFile(item.filePath);
      if (!isCurrent()) return;
      item.content = file.content;
      item.tokensText = `~${estimateTokens(file.content).toLocaleString(locale)} Tokens`;
      const el = itemTokEls.get(item.key);
      if (el) el.textContent = item.tokensText;
      if (item.checked) refreshSummary();
    } catch {
      // Ignore unreadable files here; copy/save will report if still selected
    }
  };

  const getFilteredItems = (): SelectableItem[] => {
    const query = filterInput?.value.trim().toLowerCase() ?? '';
    if (!query) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        item.subtitle.toLowerCase().includes(query),
    );
  };

  const renderList = (focusKey?: { key: string; dir: 'up' | 'down' }) => {
    listEl.replaceChildren();
    itemTokEls.clear();

    const visibleItems = getFilteredItems();
    if (items.length === 0) {
      if (!loadError.hidden) return;
      const empty = document.createElement('p');
      empty.className = 'lint-empty-state';
      empty.textContent = t(listing ? 'aiBundle.loading' : 'aiBundle.empty');
      listEl.appendChild(empty);
      return;
    }

    if (visibleItems.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'lint-empty-state';
      empty.textContent = isEn ? 'No matching files.' : 'Keine passenden Dateien.';
      listEl.appendChild(empty);
      return;
    }

    for (const item of visibleItems) {
      const itemIndex = items.indexOf(item);
      const row = document.createElement('div');
      row.className = 'ai-bundle-item';

      const checkWrap = document.createElement('label');
      checkWrap.className = 'ai-bundle-item-check';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = item.checked;
      checkbox.addEventListener('change', () => {
        item.checked = checkbox.checked;
        refreshSummary();
        if (item.checked && item.content === null) {
          void ensureItemTokens(item);
        }
      });

      const meta = document.createElement('span');
      meta.className = 'ai-bundle-item-meta';
      const nameRow = document.createElement('span');
      nameRow.className = 'ai-bundle-item-name-row';
      const nameEl = document.createElement('span');
      nameEl.className = 'ai-bundle-item-name';
      nameEl.textContent = item.name;
      nameRow.appendChild(nameEl);
      if (item.sensitive) {
        const badge = document.createElement('span');
        badge.className = 'ai-bundle-sensitive-badge';
        badge.textContent = isEn ? 'Sensitive' : 'Sensibel';
        badge.title = isEn
          ? 'May contain secrets — excluded from automatic selection'
          : 'Kann Zugangsdaten enthalten — von automatischer Auswahl ausgeschlossen';
        nameRow.appendChild(badge);
      }
      const pathEl = document.createElement('span');
      pathEl.className = 'ai-bundle-item-path';
      pathEl.textContent = item.subtitle;
      meta.append(nameRow, pathEl);

      checkWrap.append(checkbox, meta);

      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'ai-bundle-item-actions';

      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'mini-icon-btn ai-bundle-move-btn';
      upBtn.textContent = '↑';
      upBtn.disabled = itemIndex <= 0;
      upBtn.setAttribute(
        'aria-label',
        isEn ? `Move ${item.name} up` : `${item.name} nach oben`,
      );
      upBtn.title = isEn ? 'Move up' : 'Nach oben';
      upBtn.addEventListener('click', () => {
        if (itemIndex <= 0) return;
        const prev = items[itemIndex - 1];
        items[itemIndex - 1] = item;
        items[itemIndex] = prev;
        renderList({ key: item.key, dir: 'up' });
      });

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'mini-icon-btn ai-bundle-move-btn';
      downBtn.textContent = '↓';
      downBtn.disabled = itemIndex >= items.length - 1;
      downBtn.setAttribute(
        'aria-label',
        isEn ? `Move ${item.name} down` : `${item.name} nach unten`,
      );
      downBtn.title = isEn ? 'Move down' : 'Nach unten';
      downBtn.addEventListener('click', () => {
        if (itemIndex >= items.length - 1) return;
        const next = items[itemIndex + 1];
        items[itemIndex + 1] = item;
        items[itemIndex] = next;
        renderList({ key: item.key, dir: 'down' });
      });

      const tokEl = document.createElement('span');
      tokEl.className = 'ai-bundle-item-tokens';
      tokEl.textContent = item.tokensText;
      itemTokEls.set(item.key, tokEl);

      actionsWrap.append(tokEl, upBtn, downBtn);
      row.append(checkWrap, actionsWrap);
      listEl.appendChild(row);

      if (focusKey && focusKey.key === item.key) {
        const targetBtn = focusKey.dir === 'up' ? upBtn : downBtn;
        const fallbackBtn = focusKey.dir === 'up' ? downBtn : upBtn;
        if (!targetBtn.disabled) {
          targetBtn.focus();
        } else if (!fallbackBtn.disabled) {
          fallbackBtn.focus();
        } else {
          checkbox.focus();
        }
      }
    }
  };

  if (filterInput) {
    filterInput.oninput = () => {
      renderList();
    };
  }

  if (mdBtn && xmlBtn) {
    mdBtn.onclick = () => {
      currentFormat = 'markdown';
      mdBtn.setAttribute('aria-pressed', 'true');
      xmlBtn.setAttribute('aria-pressed', 'false');
      refreshSummary();
    };
    xmlBtn.onclick = () => {
      currentFormat = 'xml';
      mdBtn.setAttribute('aria-pressed', 'false');
      xmlBtn.setAttribute('aria-pressed', 'true');
      refreshSummary();
    };
  }

  if (fmCheck) fmCheck.onchange = () => refreshSummary();
  if (cmCheck) cmCheck.onchange = () => refreshSummary();
  if (budgetSelect) budgetSelect.onchange = () => refreshSummary();

  if (selectAllBtn) {
    selectAllBtn.onclick = () => {
      const targetItems = getFilteredItems();
      targetItems.forEach((item) => {
        if (item.sensitive) return;
        item.checked = true;
        if (item.content === null) {
          void ensureItemTokens(item);
        }
      });
      renderList();
      refreshSummary();
    };
  }

  if (selectNoneBtn) {
    selectNoneBtn.onclick = () => {
      const targetItems = getFilteredItems();
      targetItems.forEach((item) => {
        item.checked = false;
      });
      renderList();
      refreshSummary();
    };
  }

  const buildSelectedBundle = async () => {
    const chosen = items.filter((item) => item.checked);
    const options = getBundleOptions();
    const entries = await Promise.all(
      chosen.map(async (item) => {
        const label = getBundleLabel(item);
        if (item.content !== null) {
          return { label, content: item.content };
        }
        if (item.filePath) {
          const payload = await backend.readFile(item.filePath);
          item.content = payload.content;
          return { label, content: payload.content };
        }
        return { label, content: '' };
      }),
    );
    return { ...buildAiContextBundle(entries, options), format: options.format ?? 'markdown' };
  };

  const loadWorkspaceFiles = async () => {
    const root = deps.workspaceRootPath;
    if (!root || listing || !isCurrent()) return;
    listing = true;
    if (document.activeElement === retryBtn) filterInput?.focus();
    loadError.hidden = true;
    loadAlert.textContent = '';
    listEl.setAttribute('aria-busy', 'true');
    renderList();
    try {
      const { files } = await backend.listWorkspaceFiles(root);
      if (!isCurrent()) return;
      const openPaths = new Set(items.map((item) => item.filePath?.toLowerCase()));
      for (const file of files) {
        if (openPaths.has(file.path.toLowerCase())) continue;
        items.push({
          key: `ws:${file.path}`,
          name: file.name,
          subtitle: file.relPath,
          content: null,
          filePath: file.path,
          checked: false,
          sensitive: isSensitiveAiContextPath(file.relPath || file.name),
          tokensText: isEn ? 'Workspace' : 'Ordner',
        });
      }
    } catch (err) {
      if (!isCurrent()) return;
      console.error('Could not list workspace files for AI context:', err);
      loadError.hidden = false;
      loadAlert.textContent = t('aiBundle.loadFailed');
    } finally {
      listing = false;
      if (isCurrent()) {
        listEl.removeAttribute('aria-busy');
        renderList();
        refreshSummary();
      }
    }
  };
  retryBtn.onclick = () => { void loadWorkspaceFiles(); };

  const runOutput = async (
    output: (bundle: Awaited<ReturnType<typeof buildSelectedBundle>>) => Promise<string | null>,
    outputErrorKey: string,
  ) => {
    if (outputPending || !items.some((item) => item.checked)) return;
    outputPending = true;
    actionError.hidden = true;
    actionError.textContent = '';
    refreshSummary();
    let errorKey = 'aiBundle.readFailed';
    try {
      const bundle = await buildSelectedBundle();
      if (!isCurrent()) return;
      errorKey = outputErrorKey;
      const message = await output(bundle);
      if (isCurrent() && message) {
        dialog.close();
        deps.onShowToast(message);
      }
    } catch (err) {
      if (!isCurrent()) return;
      console.error('Could not export AI context:', err);
      actionError.hidden = false;
      actionError.textContent = err instanceof InvalidXmlCharacter ? t('aiBundle.invalidXml', { file: err.label }) : t(errorKey);
    } finally {
      outputPending = false;
      if (isCurrent()) refreshSummary();
    }
  };

  copyBtn.onclick = () => runOutput(async (bundle) => {
    await navigator.clipboard.writeText(bundle.payload);
    return t('toast.bundleAiSuccess', {
      count: String(bundle.fileCount),
      tokens: bundle.totalTokens.toLocaleString(locale),
    });
  }, 'aiBundle.copyFailed');

  const saveBundle = deps.onSaveBundle;
  if (saveBtn) {
    saveBtn.onclick = saveBundle
      ? () => runOutput((bundle) => saveBundle(bundle.payload, bundle.format), 'aiBundle.saveFailed')
      : null;
  }

  listEl.removeAttribute('aria-busy');
  renderList();
  refreshSummary();
  try {
    dialog.showModal();
    const initialFocus =
      listEl.querySelector<HTMLElement>('input[type="checkbox"]:not(:disabled)') ??
      filterInput ??
      dialog.querySelector<HTMLElement>('button:not(:disabled)');
    initialFocus?.focus();
    void loadWorkspaceFiles();
  } catch {}
}

/**
 * Opens a modal dialog to fill in `{{variable}}` placeholders locally and copy
 * the interpolated prompt text.
 */
export async function openPromptVariablesDialogModal(
  options: PromptVariablesDialogOptions,
): Promise<void> {
  const isEn = getLanguage() === 'en';
  let dialog = document.getElementById('prompt-variables-dialog') as HTMLDialogElement | null;

  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'prompt-variables-dialog';
    dialog.className = 'modal-dialog lint-dialog';
    dialog.setAttribute('closedby', 'any');
    dialog.setAttribute('aria-labelledby', 'prompt-variables-title');
    document.body.appendChild(dialog);
  }

  bindDialogReturnValueReset(dialog);
  dialog.replaceChildren();

  const card = document.createElement('div');
  card.className = 'modal-card lint-card';

  const header = document.createElement('div');
  header.className = 'settings-header';

  const titleWrap = document.createElement('div');
  const titleEl = document.createElement('h3');
  titleEl.id = 'prompt-variables-title';
  titleEl.textContent = options.title;
  const subEl = document.createElement('p');
  subEl.className = 'lint-dialog-sub';
  subEl.textContent = isEn
    ? 'Fill in {{variable}} placeholders locally and copy the rendered prompt.'
    : 'Platzhalter ({{variable}}) lokal ausfüllen und das fertige Ergebnis kopieren.';
  titleWrap.append(titleEl, subEl);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'mini-icon-btn';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', isEn ? 'Close' : 'Schließen');
  closeBtn.addEventListener('click', () => dialog?.close());

  header.append(titleWrap, closeBtn);

  const form = document.createElement('form');
  form.className = 'prompt-vars-form';

  const body = document.createElement('div');
  body.className = 'prompt-vars-list scroller';

  const vars = extractTemplateVariables(options.content);
  const inputs: Array<{ name: string; input: HTMLInputElement }> = [];

  if (vars.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'lint-empty-state';
    empty.textContent = isEn
      ? 'No {{variable}} placeholders found. You can copy the text directly.'
      : 'Keine {{variable}}-Platzhalter gefunden. Der Text kann direkt kopiert werden.';
    body.appendChild(empty);
  } else {
    vars.forEach((varName, idx) => {
      const field = document.createElement('div');
      field.className = 'prompt-var-field';

      const label = document.createElement('label');
      label.className = 'prompt-var-label';
      label.htmlFor = `prompt-var-input-${idx}`;
      const code = document.createElement('code');
      code.textContent = `{{${varName}}}`;
      label.appendChild(code);

      const input = document.createElement('input');
      input.type = 'text';
      input.id = `prompt-var-input-${idx}`;
      input.className = 'prompt-var-input';
      input.placeholder = isEn ? `Value for ${varName}` : `Wert für ${varName}`;
      input.autocomplete = 'off';

      field.append(label, input);
      body.appendChild(field);
      inputs.push({ name: varName, input });
    });
  }

  const footer = document.createElement('div');
  footer.className = 'dialog-actions ai-bundle-footer';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'dialog-btn';
  cancelBtn.textContent = isEn ? 'Cancel' : 'Abbrechen';
  cancelBtn.addEventListener('click', () => dialog?.close());

  const copyBtn = document.createElement('button');
  copyBtn.type = 'submit';
  copyBtn.className = 'dialog-btn primary';
  copyBtn.textContent = isEn ? 'Copy prompt' : 'Prompt kopieren';

  footer.append(cancelBtn, copyBtn);
  form.append(body, footer);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values: Record<string, string> = {};
    for (const { name, input } of inputs) {
      if (input.value !== '') {
        values[name] = input.value;
      }
    }
    const rendered = interpolateTemplateVariables(options.content, values);
    await options.onCopy(rendered);
    dialog?.close();
  });

  card.append(header, form);
  dialog.appendChild(card);

  try {
    dialog.showModal();
    if (vars.length === 0) {
      copyBtn.focus();
    } else {
      inputs[0]?.input.focus();
    }
  } catch {}
}

function createDiffLineRow(line: DiffLine): HTMLDivElement {
  const row = document.createElement('div');
  row.className = `diff-line-row is-${line.kind}`;

  const localNum = document.createElement('span');
  localNum.className = 'diff-line-num';
  localNum.textContent = line.localLine !== null ? String(line.localLine) : '';

  const diskNum = document.createElement('span');
  diskNum.className = 'diff-line-num';
  diskNum.textContent = line.diskLine !== null ? String(line.diskLine) : '';

  const sign = document.createElement('span');
  sign.className = 'diff-line-sign';
  sign.textContent = line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' ';

  const text = document.createElement('span');
  text.className = 'diff-line-text';
  text.textContent = line.text || ' ';

  row.append(localNum, diskNum, sign, text);
  return row;
}

interface DiffNavControls {
  bar: HTMLElement;
  statusEl: HTMLElement;
  prevBtn: HTMLButtonElement;
  nextBtn: HTMLButtonElement;
}

function ensureDiffNavBar(listEl: HTMLElement): DiffNavControls {
  const existing = document.getElementById('diff-nav-bar');
  if (existing) {
    return {
      bar: existing,
      statusEl: existing.querySelector('.diff-nav-status') as HTMLElement,
      prevBtn: existing.querySelector('[data-diff-nav="prev"]') as HTMLButtonElement,
      nextBtn: existing.querySelector('[data-diff-nav="next"]') as HTMLButtonElement,
    };
  }

  const bar = document.createElement('div');
  bar.id = 'diff-nav-bar';
  bar.className = 'diff-nav-bar';

  const statusEl = document.createElement('span');
  statusEl.className = 'diff-nav-status';
  statusEl.setAttribute('aria-live', 'polite');

  const actions = document.createElement('div');
  actions.className = 'diff-nav-actions';

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'diff-nav-btn';
  prevBtn.dataset.diffNav = 'prev';

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'diff-nav-btn';
  nextBtn.dataset.diffNav = 'next';

  actions.append(prevBtn, nextBtn);
  bar.append(statusEl, actions);
  listEl.parentElement?.insertBefore(bar, listEl);

  return { bar, statusEl, prevBtn, nextBtn };
}

interface RenderDiffDialogParams {
  title: string;
  subtitle: string;
  emptyText: string;
  leftContent: string;
  rightContent: string;
  keepLabel: string;
  onKeep: () => void;
  applyLabel?: string;
  onApply?: () => Promise<void> | void;
}

function renderDiffDialog(params: RenderDiffDialogParams): void {
  const dialog = document.getElementById('external-diff-dialog') as HTMLDialogElement | null;
  const listEl = document.getElementById('external-diff-list');
  const keepBtn = document.getElementById('btn-diff-keep-local') as HTMLButtonElement | null;
  const reloadBtn = document.getElementById('btn-diff-reload-disk') as HTMLButtonElement | null;
  if (!dialog || !listEl || !keepBtn || !reloadBtn) return;

  bindDialogReturnValueReset(dialog);

  const titleEl = document.getElementById('external-diff-title');
  if (titleEl) titleEl.textContent = params.title;
  const subEl = dialog.querySelector('.lint-dialog-sub');
  if (subEl) subEl.textContent = params.subtitle;

  const isEn = getLanguage() === 'en';
  const nav = ensureDiffNavBar(listEl);
  nav.prevBtn.textContent = isEn ? '↑ Previous change' : '↑ Vorherige Änderung';
  nav.nextBtn.textContent = isEn ? '↓ Next change' : '↓ Nächste Änderung';

  const diff = computeLineDiff(params.leftContent, params.rightContent);
  const hasChanges = diff.some((d) => d.kind !== 'context');
  const hunks: HTMLElement[][] = [];

  listEl.replaceChildren();
  if (!hasChanges) {
    const empty = document.createElement('p');
    empty.className = 'lint-empty-state';
    empty.textContent = params.emptyText;
    listEl.appendChild(empty);
  } else {
    const items = buildCollapsedDiffItems(diff, 3);
    let currentHunk: HTMLElement[] | null = null;

    for (const item of items) {
      if (item.kind === 'collapsed') {
        currentHunk = null;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'diff-collapsed-row';
        btn.textContent = isEn
          ? `⋯ Show ${item.count} unchanged lines`
          : `⋯ ${item.count} unveränderte Zeilen anzeigen`;
        btn.addEventListener('click', () => {
          const frag = document.createDocumentFragment();
          let firstRow: HTMLElement | null = null;
          for (let idx = item.startIdx; idx <= item.endIdx; idx++) {
            const row = createDiffLineRow(diff[idx]);
            if (!firstRow) firstRow = row;
            frag.appendChild(row);
          }
          btn.replaceWith(frag);
          if (firstRow) {
            firstRow.tabIndex = -1;
            firstRow.focus({ preventScroll: true });
          } else {
            listEl.tabIndex = -1;
            listEl.focus({ preventScroll: true });
          }
        });
        listEl.appendChild(btn);
        continue;
      }

      const row = createDiffLineRow(item.line);
      if (item.line.kind !== 'context') {
        if (!currentHunk) {
          currentHunk = [];
          hunks.push(currentHunk);
        }
        currentHunk.push(row);
      } else {
        currentHunk = null;
      }
      listEl.appendChild(row);
    }
  }

  let activeHunkIndex = -1;
  const updateHunkNav = (): void => {
    for (let i = 0; i < hunks.length; i++) {
      const active = i === activeHunkIndex;
      for (const row of hunks[i]) {
        row.classList.toggle('is-active-hunk', active);
      }
    }

    if (hunks.length === 0) {
      nav.statusEl.textContent = isEn ? '0 changes' : '0 Änderungen';
      nav.prevBtn.disabled = true;
      nav.nextBtn.disabled = true;
      return;
    }

    nav.prevBtn.disabled = false;
    nav.nextBtn.disabled = false;
    nav.statusEl.textContent =
      activeHunkIndex >= 0
        ? isEn
          ? `Change ${activeHunkIndex + 1} of ${hunks.length}`
          : `Änderung ${activeHunkIndex + 1} von ${hunks.length}`
        : isEn
          ? hunks.length === 1
            ? '1 change'
            : `${hunks.length} changes`
          : hunks.length === 1
            ? '1 Änderung'
            : `${hunks.length} Änderungen`;
  };

  const jumpToHunk = (nextIdx: number): void => {
    if (hunks.length === 0) return;
    activeHunkIndex = (nextIdx + hunks.length) % hunks.length;
    updateHunkNav();
    hunks[activeHunkIndex][0]?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  };

  nav.prevBtn.onclick = () => {
    jumpToHunk(activeHunkIndex <= 0 ? hunks.length - 1 : activeHunkIndex - 1);
  };
  nav.nextBtn.onclick = () => {
    jumpToHunk(activeHunkIndex < 0 ? 0 : activeHunkIndex + 1);
  };
  updateHunkNav();

  const hasApply = Boolean(params.onApply && params.applyLabel);
  keepBtn.hidden = false;
  keepBtn.classList.toggle('primary', !hasApply);
  keepBtn.textContent = params.keepLabel;
  keepBtn.onclick = () => {
    params.onKeep();
    dialog.close();
  };

  if (hasApply && params.applyLabel) {
    reloadBtn.hidden = false;
    reloadBtn.textContent = params.applyLabel;
    reloadBtn.onclick = async () => {
      await params.onApply?.();
      dialog.close();
    };
  } else {
    reloadBtn.hidden = true;
    reloadBtn.onclick = null;
  }

  dialog.showModal();
  if (!nav.nextBtn.disabled) {
    nav.nextBtn.focus();
  } else if (!reloadBtn.hidden && !reloadBtn.disabled) {
    reloadBtn.focus();
  } else {
    keepBtn.focus();
  }
}

/**
 * Opens a general-purpose line-diff comparison modal (e.g. "Diff with Saved"
 * or "Compare Open Tabs") with collapsible unchanged context and hunk navigation.
 */
export function openCompareDiffDialogModal(options: CompareDiffDialogOptions): void {
  const isEn = getLanguage() === 'en';
  const subtitle =
    options.subtitle ??
    (isEn
      ? `− Removed: ${options.leftLabel} · + Added: ${options.rightLabel}`
      : `− Entfernt: ${options.leftLabel} · + Hinzugefügt: ${options.rightLabel}`);
  const emptyText = isEn
    ? `No line differences between ${options.leftLabel} and ${options.rightLabel}.`
    : `Keine Zeilenunterschiede zwischen ${options.leftLabel} und ${options.rightLabel}.`;
  const closeLabel = isEn ? 'Close' : 'Schließen';
  const applyLabel =
    !options.readOnly && options.onApplyRight
      ? isEn
        ? `Apply ${options.rightLabel}`
        : `${options.rightLabel} übernehmen`
      : undefined;

  renderDiffDialog({
    title: options.title,
    subtitle,
    emptyText,
    leftContent: options.leftContent,
    rightContent: options.rightContent,
    keepLabel: closeLabel,
    onKeep: () => {},
    applyLabel,
    onApply: !options.readOnly ? options.onApplyRight : undefined,
  });
}

/**
 * Opens the external file modification line-diff modal comparing local editor
 * content against the current file on disk.
 */
export async function openExternalDiffDialogModal(deps: ExternalDiffDialogDeps): Promise<void> {
  try {
    const payload = await backend.readFile(deps.path);
    renderDiffDialog({
      title: t('externalDiff.title'),
      subtitle: t('externalDiff.subtitle'),
      emptyText: t('externalDiff.identical'),
      leftContent: deps.localContent,
      rightContent: payload.content,
      keepLabel: t('externalDiff.keepLocal'),
      onKeep: () => deps.onKeepLocal(payload),
      applyLabel: t('externalDiff.reloadDisk'),
      onApply: deps.onReloadDisk,
    });
  } catch (err) {
    console.error('Externer Diff konnte nicht geladen werden:', err);
    deps.onError?.(err);
  }
}
