/**
 * Progressive enhancement fallbacks for modern HTML features (`popover`,
 * Invoker Commands `commandfor`/`command`, `focusgroup="menu"`, and
 * `<dialog closedby="any">`) so Semyra works identically in WebView2 and
 * standards-based test environments (`jsdom`).
 */
export function installProgressiveEnhancements(): void {
  if (!('popover' in HTMLElement.prototype)) {
    void import('@oddbird/popover-polyfill');
  }

  if (!('commandForElement' in HTMLButtonElement.prototype)) {
    void import('invokers-polyfill');
    document.addEventListener('click', (e) => {
      const btn = (e.target as Element | null)?.closest?.(
        'button[command="close"][commandfor]',
      ) as HTMLButtonElement | null;
      if (!btn) return;
      const targetId = btn.getAttribute('commandfor');
      if (!targetId) return;
      const target = document.getElementById(targetId);
      if (target && 'close' in target && typeof (target as HTMLDialogElement).close === 'function') {
        const dialog = target as HTMLDialogElement;
        if (dialog.open) dialog.close();
      }
    });
  }

  if (!('focusGroup' in HTMLElement.prototype)) {
    for (const fg of document.querySelectorAll<HTMLElement>('[focusgroup~="menu"]')) {
      fg.setAttribute('role', 'menu');
      for (const btn of fg.querySelectorAll<HTMLButtonElement>('button')) {
        if (!btn.hasAttribute('role')) {
          btn.setAttribute('role', 'menuitem');
        }
      }
      fg.addEventListener('keydown', (e) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        const items = Array.from(fg.querySelectorAll<HTMLButtonElement>('button')).filter(
          (b) => !b.disabled && !b.hidden && b.offsetParent !== null,
        );
        if (items.length === 0) return;
        e.preventDefault();
        const activeIdx = items.indexOf(document.activeElement as HTMLButtonElement);
        let nextIdx = 0;
        if (e.key === 'Home') {
          nextIdx = 0;
        } else if (e.key === 'End') {
          nextIdx = items.length - 1;
        } else if (e.key === 'ArrowDown') {
          nextIdx = activeIdx < 0 ? 0 : (activeIdx + 1) % items.length;
        } else if (e.key === 'ArrowUp') {
          nextIdx = activeIdx <= 0 ? items.length - 1 : activeIdx - 1;
        }
        items[nextIdx]?.focus();
      });
    }
  }

  if (!('closedBy' in HTMLDialogElement.prototype)) {
    const outside = (e: PointerEvent, dialog: HTMLDialogElement) => {
      const r = dialog.getBoundingClientRect();
      return (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      );
    };
    let pressedDialog: HTMLDialogElement | null = null;
    document.addEventListener('pointerdown', (e) => {
      const target = e.target;
      if (
        target instanceof HTMLDialogElement &&
        target.open &&
        target.getAttribute('closedby') === 'any' &&
        outside(e, target)
      ) {
        pressedDialog = target;
      } else {
        pressedDialog = null;
      }
    });
    document.addEventListener('pointerup', (e) => {
      const dialog = pressedDialog;
      pressedDialog = null;
      if (dialog && dialog.open && e.target === dialog && outside(e, dialog)) {
        dialog.close();
      }
    });
  }
}
