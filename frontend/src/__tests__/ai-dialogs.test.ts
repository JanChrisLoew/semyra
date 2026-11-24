import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openAiBundleDialogModal } from '../ai-dialogs';
import { setLanguage } from '../i18n';

describe('openAiBundleDialogModal sensitive file protection', () => {
  beforeEach(() => {
    setLanguage('de', false);
    document.body.innerHTML = `
      <dialog id="ai-bundle-dialog">
        <div class="modal-card">
          <div class="ai-bundle-toolbar">
            <button type="button" id="btn-ai-bundle-select-all">Alle</button>
            <button type="button" id="btn-ai-bundle-select-none">Keine</button>
            <span id="ai-bundle-token-total"></span>
          </div>
          <div id="ai-bundle-list"></div>
          <div id="ai-bundle-load-error" hidden>
            <p id="ai-bundle-load-alert"></p>
            <button type="button" id="btn-ai-bundle-retry">Retry</button>
          </div>
          <p id="ai-bundle-action-error" hidden></p>
          <div class="ai-bundle-footer">
            <button type="button" id="btn-ai-bundle-copy">Kopieren</button>
          </div>
        </div>
      </dialog>
    `;
    const dialog = document.getElementById('ai-bundle-dialog') as HTMLDialogElement;
    dialog.showModal = vi.fn(() => {
      dialog.setAttribute('open', '');
    });
    dialog.close = vi.fn(() => {
      dialog.removeAttribute('open');
    });
  });

  it('starts sensitive tabs unchecked, renders warning badge, and skips them on Select All', () => {
    openAiBundleDialogModal({
      tabs: [
        { id: '1', name: 'README.md', path: 'C:\\Repo\\README.md', currentContent: '# Hello' },
        { id: '2', name: '.env.local', path: 'C:\\Repo\\.env.local', currentContent: 'API_KEY=secret' },
      ],
      workspaceRootPath: null,
      onShowToast: vi.fn(),
    });

    const checkboxes = Array.from(
      document.querySelectorAll<HTMLInputElement>('#ai-bundle-list input[type="checkbox"]'),
    );
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false);

    const badges = document.querySelectorAll('.ai-bundle-sensitive-badge');
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe('Sensibel');

    // Select None then Select All: README.md is selected, .env.local stays skipped
    document.getElementById('btn-ai-bundle-select-none')!.click();
    document.getElementById('btn-ai-bundle-select-all')!.click();

    const updatedCheckboxes = Array.from(
      document.querySelectorAll<HTMLInputElement>('#ai-bundle-list input[type="checkbox"]'),
    );
    expect(updatedCheckboxes[0].checked).toBe(true);
    expect(updatedCheckboxes[1].checked).toBe(false);

    // Explicit manual opt-in still works
    updatedCheckboxes[1].checked = true;
    updatedCheckboxes[1].dispatchEvent(new Event('change'));
    expect(updatedCheckboxes[1].checked).toBe(true);
  });
});
