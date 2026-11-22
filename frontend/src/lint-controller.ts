import { toWorkspaceRelativeLabel } from './ai-bundle';
import { bindDialogReturnValueReset } from './ai-dialogs';
import { t } from './i18n';
import { lintMarkdownDocument, type LintIssue, type LintOptions } from './markdown-lint';

export interface LintControllerDeps {
  badgeBtn: HTMLButtonElement | null;
  dialogEl: HTMLDialogElement | null;
  listEl: HTMLElement | null;
  getWorkspaceRoot: () => string | null;
  getWorkspaceFiles: () => Promise<Array<{ relPath: string }> | null>;
  getActiveDocument: () => { currentContent: string; path: string | null } | undefined;
  onJumpToLine: (line: number) => void;
}

export class LintController {
  private currentIssues: LintIssue[] = [];
  private cachedWorkspaceRoot: string | null = null;
  private cachedWorkspaceRelPaths: string[] | null = null;
  private refreshInFlightRoot: string | null = null;
  private lintTimer: number | undefined;

  constructor(private readonly deps: LintControllerDeps) {
    this.deps.badgeBtn?.addEventListener('click', () => {
      this.renderDialogList();
    });
    if (this.deps.dialogEl) {
      bindDialogReturnValueReset(this.deps.dialogEl);
    }
  }

  public invalidateWorkspaceCache(): void {
    this.cachedWorkspaceRoot = null;
    this.cachedWorkspaceRelPaths = null;
  }

  public scheduleUpdate(delayMs = 350): void {
    window.clearTimeout(this.lintTimer);
    this.lintTimer = window.setTimeout(() => {
      const doc = this.deps.getActiveDocument();
      if (doc) {
        this.updateStatus(doc.currentContent, doc.path);
      }
    }, delayMs);
  }

  private async refreshWorkspaceFiles(workspaceRoot: string): Promise<void> {
    if (this.deps.getWorkspaceRoot() !== workspaceRoot) return;
    if (this.refreshInFlightRoot === workspaceRoot) return;
    this.refreshInFlightRoot = workspaceRoot;
    try {
      const files = await this.deps.getWorkspaceFiles();
      if (!files || this.deps.getWorkspaceRoot() !== workspaceRoot) return;
      this.cachedWorkspaceRoot = workspaceRoot;
      this.cachedWorkspaceRelPaths = files.map((f) => f.relPath);
      const doc = this.deps.getActiveDocument();
      if (doc) {
        this.updateStatus(doc.currentContent, doc.path);
        if (this.deps.dialogEl?.open) {
          this.renderDialogList();
        }
      }
    } finally {
      if (this.refreshInFlightRoot === workspaceRoot) {
        this.refreshInFlightRoot = null;
      }
    }
  }

  public updateStatus(content: string, filePath: string | null): void {
    const workspaceRoot = this.deps.getWorkspaceRoot();
    let lintOptions: LintOptions | undefined;

    if (workspaceRoot) {
      if (this.cachedWorkspaceRoot !== workspaceRoot || this.cachedWorkspaceRelPaths === null) {
        void this.refreshWorkspaceFiles(workspaceRoot);
      } else if (filePath) {
        const rel = toWorkspaceRelativeLabel(filePath, workspaceRoot, '');
        const isInsideWorkspace =
          rel.length > 0 && !/^[A-Za-z]:[\\/]/.test(rel) && !rel.startsWith('/');
        if (isInsideWorkspace) {
          lintOptions = {
            knownWorkspaceFiles: this.cachedWorkspaceRelPaths,
            currentFileRelPath: rel,
          };
        }
      }
    }

    const result = lintMarkdownDocument(content, filePath, lintOptions);
    this.currentIssues = result.issues;
    const btn = this.deps.badgeBtn;
    if (!btn) return;

    const errors = result.issues.filter((i) => i.severity === 'error').length;
    const warnings = result.issues.length - errors;
    btn.classList.remove('is-ok', 'is-warning', 'is-error');

    if (errors > 0) {
      btn.classList.add('is-error');
      btn.textContent = t('lint.badgeErrors', { count: errors });
    } else if (warnings > 0) {
      btn.classList.add('is-warning');
      btn.textContent = t('lint.badgeWarnings', { count: warnings });
    } else {
      btn.classList.add('is-ok');
      btn.textContent = result.isSkillFile ? t('lint.badgeSkillOk') : t('lint.badgeOk');
    }
  }

  public renderDialogList(): void {
    const listEl = this.deps.listEl;
    if (!listEl) return;

    const doc = this.deps.getActiveDocument();
    if (doc) {
      this.updateStatus(doc.currentContent, doc.path);
    }

    listEl.replaceChildren();
    if (this.currentIssues.length === 0) {
      const p = document.createElement('p');
      p.className = 'lint-empty-state';
      p.textContent = t('lint.noIssues');
      listEl.appendChild(p);
      return;
    }

    for (const issue of this.currentIssues) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `lint-issue-row is-${issue.severity}`;

      const sev = document.createElement('span');
      sev.className = 'lint-issue-severity';
      sev.textContent =
        issue.severity === 'error' ? t('lint.severityError') : t('lint.severityWarning');

      const lineSpan = document.createElement('span');
      lineSpan.className = 'lint-issue-line';
      lineSpan.textContent = t('lint.lineLabel', { line: issue.line });

      const msgSpan = document.createElement('span');
      msgSpan.className = 'lint-issue-msg';
      msgSpan.textContent = issue.message;

      row.append(sev, lineSpan, msgSpan);
      row.addEventListener('click', () => {
        this.deps.dialogEl?.close();
        this.deps.onJumpToLine(issue.line);
      });
      listEl.appendChild(row);
    }
  }

  public openDialog(): void {
    this.renderDialogList();
    if (this.deps.dialogEl && !this.deps.dialogEl.open) {
      this.deps.dialogEl.showModal();
    }
  }
}
