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
    for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[closedby="any"]')) {
      let pressedOutside = false;
      dialog.addEventListener('pointerdown', (e) => {
        pressedOutside = outside(e, dialog);
      });
      dialog.addEventListener('pointerup', (e) => {
        if (pressedOutside && outside(e, dialog)) dialog.close();
      });
    }
  }
}
