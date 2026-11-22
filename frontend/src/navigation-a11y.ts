/**
 * WAI-ARIA roving tabindex & horizontal arrow-key navigation for composite
 * `[role="tablist"]` and `[role="toolbar"]` containers.
 */
export interface RovingNavOptions {
  itemSelector: string;
  activateOnFocus?: boolean;
}

export function syncRovingTabindex(
  container: HTMLElement,
  itemSelector: string,
  preferredEl?: HTMLElement | null,
): void {
  const items = Array.from(container.querySelectorAll<HTMLElement>(itemSelector)).filter(
    (el) => !el.hasAttribute('disabled') && !el.hidden,
  );
  if (items.length === 0) return;

  const active =
    (preferredEl && items.includes(preferredEl) ? preferredEl : null) ??
    items.find((el) => el.getAttribute('aria-selected') === 'true') ??
    items.find((el) => el.tabIndex === 0) ??
    items[0];

  for (const item of items) {
    item.tabIndex = item === active ? 0 : -1;
  }
}

export function bindRovingHorizontalKeyNav(
  container: HTMLElement,
  options: RovingNavOptions,
): void {
  const { itemSelector, activateOnFocus = false } = options;
  syncRovingTabindex(container, itemSelector);

  container.addEventListener('focusin', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>(itemSelector);
    if (target && container.contains(target)) {
      syncRovingTabindex(container, itemSelector, target);
    }
  });

  container.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;

    const current = (e.target as HTMLElement).closest<HTMLElement>(itemSelector);
    if (!current || !container.contains(current)) return;

    const items = Array.from(container.querySelectorAll<HTMLElement>(itemSelector)).filter(
      (el) => !el.hasAttribute('disabled') && !el.hidden && el.offsetParent !== null,
    );
    if (items.length <= 1) return;

    const idx = items.indexOf(current);
    if (idx < 0) return;

    let nextIdx = idx;
    if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = items.length - 1;
    } else if (e.key === 'ArrowRight') {
      nextIdx = (idx + 1) % items.length;
    } else if (e.key === 'ArrowLeft') {
      nextIdx = (idx - 1 + items.length) % items.length;
    }

    const next = items[nextIdx];
    if (!next || next === current) return;

    e.preventDefault();
    syncRovingTabindex(container, itemSelector, next);
    next.focus();
    if (activateOnFocus) {
      next.click();
    }
  });
}
