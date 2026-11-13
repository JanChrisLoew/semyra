import { backend } from './api';
import { buildAiContextBundle } from './ai-bundle';
import { getLanguage, t } from './i18n';
import { computeLineDiff } from './line-diff';
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
}

export interface ExternalDiffDialogDeps {
  path: string;
  localContent: string;
  onKeepLocal: () => void;
  onReloadDisk: () => Promise<void>;
}

/**
 * Opens the Multi-File AI Context Bundler modal allowing selection of open tabs
 * and (optionally) unopened workspace Markdown files.
 */
export async function openAiBundleDialogModal(deps: AiBundleDialogDeps): Promise<void> {
  const dialog = document.getElementById('ai-bundle-dialog') as HTMLDialogElement | null;
  const listEl = document.getElementById('ai-bundle-list');
  const totalEl = document.getElementById('ai-bundle-token-total');
  const copyBtn = document.getElementById('btn-ai-bundle-copy') as HTMLButtonElement | null;
  const selectAllBtn = document.getElementById('btn-ai-bundle-select-all');
  const selectNoneBtn = document.getElementById('btn-ai-bundle-select-none');
  if (!dialog || !listEl || !totalEl || !copyBtn) return;

  listEl.replaceChildren();
  const locale = getLanguage() === 'en' ? 'en-US' : 'de-DE';

  type SelectableItem = {
    key: string;
    name: string;
    subtitle: string;
    content: string | null;
    filePath: string | null;
    checked: boolean;
    tokensText: string;
  };

  const items: SelectableItem[] = deps.tabs.map((tab) => ({
    key: `tab:${tab.id}`,
    name: tab.name,
    subtitle: tab.path ?? (getLanguage() === 'en' ? 'Unsaved tab' : 'Ungespeicherter Tab'),
    content: tab.currentContent,
    filePath: tab.path,
    checked: true,
    tokensText: `~${estimateTokens(tab.currentContent).toLocaleString(locale)} Tokens`,
  }));

  if (deps.workspaceRootPath) {
    try {
      const openPaths = new Set(
        deps.tabs.map((tab) => tab.path?.toLowerCase()).filter((p): p is string => Boolean(p)),
      );
      const { files: wsFiles } = await backend.listWorkspaceFiles(deps.workspaceRootPath);
      for (const wf of wsFiles) {
        if (openPaths.has(wf.path.toLowerCase())) continue;
        items.push({
          key: `ws:${wf.path}`,
          name: wf.name,
          subtitle: wf.relPath,
          content: null,
          filePath: wf.path,
          checked: false,
          tokensText: getLanguage() === 'en' ? 'Workspace' : 'Ordner',
        });
      }
    } catch {
      // Non-fatal: continue with open tabs only
    }
  }

  const refreshSummary = () => {
    const selected = items.filter((item) => item.checked);
    const knownTokens = selected.reduce(
      (acc, item) => acc + (item.content !== null ? estimateTokens(item.content) : 0),
      0,
    );
    totalEl.textContent = t('aiBundle.totalSummary', {
      count: String(selected.length),
      tokens: knownTokens.toLocaleString(locale),
    });
    copyBtn.disabled = selected.length === 0;
  };

  const itemTokEls = new Map<string, HTMLElement>();

  const ensureItemTokens = async (item: (typeof items)[number]) => {
    if (item.content !== null || !item.filePath) return;
    try {
      const file = await backend.readFile(item.filePath);
      item.content = file.content;
      item.tokensText = `~${estimateTokens(file.content).toLocaleString(locale)} Tokens`;
      const el = itemTokEls.get(item.key);
      if (el) el.textContent = item.tokensText;
      if (item.checked) refreshSummary();
    } catch {
      // Ignore unreadable files here; copy will report if still selected
    }
  };

  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'lint-empty-state';
    empty.textContent = t('aiBundle.empty');
    listEl.appendChild(empty);
  } else {
    for (const item of items) {
      const row = document.createElement('label');
      row.className = 'ai-bundle-item';

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
      const nameEl = document.createElement('span');
      nameEl.className = 'ai-bundle-item-name';
      nameEl.textContent = item.name;
      const pathEl = document.createElement('span');
      pathEl.className = 'ai-bundle-item-path';
      pathEl.textContent = item.subtitle;
      meta.append(nameEl, pathEl);

      const tokEl = document.createElement('span');
      tokEl.className = 'ai-bundle-item-tokens';
      tokEl.textContent = item.tokensText;
      itemTokEls.set(item.key, tokEl);

      row.append(checkbox, meta, tokEl);
      listEl.appendChild(row);
    }
  }

  if (selectAllBtn) {
    selectAllBtn.onclick = () => {
      items.forEach((item) => {
        item.checked = true;
        if (item.content === null) {
          void ensureItemTokens(item);
        }
      });
      listEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
        cb.checked = true;
      });
      refreshSummary();
    };
  }

  if (selectNoneBtn) {
    selectNoneBtn.onclick = () => {
      items.forEach((item) => {
        item.checked = false;
      });
      listEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
        cb.checked = false;
      });
      refreshSummary();
    };
  }

  copyBtn.onclick = async () => {
    const chosen = items.filter((item) => item.checked);
    if (chosen.length === 0) return;
    try {
      const entries = await Promise.all(
        chosen.map(async (item) => {
          if (item.content !== null) {
            return { label: item.filePath ?? item.name, content: item.content };
          }
          if (item.filePath) {
            const payload = await backend.readFile(item.filePath);
            return { label: item.subtitle || item.name, content: payload.content };
          }
          return { label: item.name, content: '' };
        }),
      );
      const bundle = buildAiContextBundle(entries);
      await navigator.clipboard.writeText(bundle.payload);
      dialog.close();
      deps.onShowToast(
        t('toast.bundleAiSuccess', {
          count: String(bundle.fileCount),
          tokens: bundle.totalTokens.toLocaleString(locale),
        }),
      );
    } catch (err) {
      console.error('KI-Kontext-Bundle konnte nicht kopiert werden:', err);
      deps.onShowToast(t('toast.copyFailed'));
    }
  };

  refreshSummary();
  try {
    dialog.showModal();
  } catch {}
}

/**
 * Opens the external file modification line-diff modal comparing local editor
 * content against the current file on disk.
 */
export async function openExternalDiffDialogModal(deps: ExternalDiffDialogDeps): Promise<void> {
  const dialog = document.getElementById('external-diff-dialog') as HTMLDialogElement | null;
  const listEl = document.getElementById('external-diff-list');
  const keepBtn = document.getElementById('btn-diff-keep-local');
  const reloadBtn = document.getElementById('btn-diff-reload-disk');
  if (!dialog || !listEl || !keepBtn || !reloadBtn) return;

  try {
    const payload = await backend.readFile(deps.path);
    const diff = computeLineDiff(deps.localContent, payload.content);
    const hasChanges = diff.some((d) => d.kind !== 'context');

    listEl.replaceChildren();
    if (!hasChanges) {
      const empty = document.createElement('p');
      empty.className = 'lint-empty-state';
      empty.textContent = t('externalDiff.identical');
      listEl.appendChild(empty);
    } else {
      for (const line of diff) {
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
        listEl.appendChild(row);
      }
    }

    keepBtn.onclick = () => {
      deps.onKeepLocal();
      dialog.close();
    };
    reloadBtn.onclick = async () => {
      await deps.onReloadDisk();
      dialog.close();
    };

    dialog.showModal();
  } catch (err) {
    console.error('Externer Diff konnte nicht geladen werden:', err);
  }
}
