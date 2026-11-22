export function positionAndFocusPopover(
  popoverEl: HTMLElement & { showPopover?: () => void },
  clientX: number,
  clientY: number,
): void {
  popoverEl.style.left = `${clientX}px`;
  popoverEl.style.top = `${clientY}px`;
  popoverEl.showPopover?.();

  requestAnimationFrame(() => {
    const rect = popoverEl.getBoundingClientRect();
    const clampedLeft = Math.max(6, Math.min(clientX, window.innerWidth - rect.width - 8));
    const clampedTop = Math.max(6, Math.min(clientY, window.innerHeight - rect.height - 8));
    popoverEl.style.left = `${clampedLeft}px`;
    popoverEl.style.top = `${clampedTop}px`;

    const firstItem = popoverEl.querySelector<HTMLButtonElement>(
      '[focusgroup~="menu"] > button:not(:disabled, [hidden])',
    );
    firstItem?.focus();
  });
}
