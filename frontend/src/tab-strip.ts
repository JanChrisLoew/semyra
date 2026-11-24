import { t } from './i18n';
import { syncRovingTabindex } from './navigation-a11y';
import { positionAndFocusPopover } from './popover-utils';

export interface TabStripItem {
  id: string;
  name: string;
  path: string | null;
  isDirty: boolean;
  isPinned?: boolean;
}

export interface TabStripDeps {
  tabBarEl: HTMLElement;
  tabContextMenuEl: HTMLElement & {
    showPopover?: () => void;
    hidePopover?: () => void;
  };
  tabStripWrapEl: Element | null;
  getTabs: () => readonly TabStripItem[];
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => Promise<unknown> | void;
  onNewTab: () => void;
  onReorderTabs: (draggedId: string, targetId: string, isAfter: boolean) => void;
  onContextAction: (action: string, tabId: string) => Promise<void> | void;
}

export class TabStripController {
  private readonly deps: TabStripDeps;
  private tabContextTargetId: string | null = null;
  private tabDragState: {
    tabId: string;
    startX: number;
    startY: number;
    isDragging: boolean;
    targetTabId: string | null;
    isAfter: boolean;
  } | null = null;
  private suppressNextTabClick = false;
  private suppressNextTabClickTimer: number | undefined;

  constructor(deps: TabStripDeps) {
    this.deps = deps;
    this.bindEvents();
  }

  public render(
    tabs: readonly TabStripItem[],
    activeTabId: string,
    scrollActiveIntoView = false,
  ): void {
    this.deps.tabBarEl.replaceChildren();
    let activeTabBtn: HTMLButtonElement | null = null;

    for (const tab of tabs) {
      const isSelected = tab.id === activeTabId;

      const slot = document.createElement('div');
      slot.className = `tab-slot ${isSelected ? 'is-active' : ''} ${tab.isPinned ? 'is-pinned' : ''}`.trim();
      slot.setAttribute('role', 'presentation');
      slot.dataset.tabId = tab.id;

      slot.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          void this.deps.onCloseTab(tab.id);
        }
      });
      slot.addEventListener('contextmenu', (e) => {
        this.openTabContextMenu(e, tab.id);
      });

      const selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.className = 'tab-select-btn';
      selectBtn.setAttribute('role', 'tab');
      selectBtn.setAttribute('aria-selected', String(isSelected));
      selectBtn.tabIndex = isSelected ? 0 : -1;
      selectBtn.title = tab.path ?? `${tab.name} (${t('tab.unsavedTitle')})`;
      selectBtn.addEventListener('click', (e) => {
        if (this.suppressNextTabClick) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        this.deps.onActivateTab(tab.id);
      });

      const titleSpan = document.createElement('span');
      titleSpan.className = 'tab-title';
      titleSpan.textContent = tab.name;

      if (tab.isPinned) {
        const pinEl = document.createElement('span');
        pinEl.className = 'tab-pin-indicator';
        pinEl.textContent = '📌';
        pinEl.title = t('tab.pinnedTitle');
        pinEl.setAttribute('aria-hidden', 'true');
        selectBtn.append(pinEl, titleSpan);
      } else {
        selectBtn.appendChild(titleSpan);
      }

      if (tab.isDirty) {
        const dot = document.createElement('span');
        dot.className = 'tab-dirty-dot';
        dot.setAttribute('role', 'img');
        dot.title = t('tab.unsavedTitle');
        dot.setAttribute('aria-label', t('tab.unsavedTitle'));
        selectBtn.appendChild(dot);
      }

      if (isSelected) {
        activeTabBtn = selectBtn;
      }

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'tab-close-btn';
      closeBtn.setAttribute('aria-label', t('tab.closeTitle', { name: tab.name }));
      closeBtn.textContent = '×';
      closeBtn.addEventListener('click', () => {
        void this.deps.onCloseTab(tab.id);
      });

      slot.append(selectBtn, closeBtn);
      this.deps.tabBarEl.appendChild(slot);
    }

    syncRovingTabindex(this.deps.tabBarEl, 'button[role="tab"]', activeTabBtn);
    if (scrollActiveIntoView) {
      activeTabBtn?.closest('.tab-slot')?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    }
  }

  public updateDirtyState(tabId: string, isDirty: boolean): void {
    const slot = this.deps.tabBarEl.querySelector<HTMLElement>(
      `.tab-slot[data-tab-id="${tabId}"]`,
    );
    if (!slot) return;
    const selectBtn = slot.querySelector<HTMLButtonElement>('.tab-select-btn');
    if (!selectBtn) return;
    const existingDot = selectBtn.querySelector('.tab-dirty-dot');
    if (isDirty) {
      if (!existingDot) {
        const dot = document.createElement('span');
        dot.className = 'tab-dirty-dot';
        dot.setAttribute('role', 'img');
        dot.title = t('tab.unsavedTitle');
        dot.setAttribute('aria-label', t('tab.unsavedTitle'));
        selectBtn.appendChild(dot);
      }
    } else {
      existingDot?.remove();
    }
  }

  private openTabContextMenu(e: MouseEvent, tabId: string): void {
    e.preventDefault();
    this.tabContextTargetId = tabId;
    const tabs = this.deps.getTabs();
    const tab = tabs.find((tItem) => tItem.id === tabId);
    if (!tab) return;

    const revealBtn = document.getElementById('tab-ctx-reveal') as HTMLButtonElement | null;
    const copyPathBtn = document.getElementById('tab-ctx-copy-path') as HTMLButtonElement | null;
    const copyAtPathBtn = document.getElementById('tab-ctx-copy-at-path') as HTMLButtonElement | null;
    const diffSavedBtn = document.getElementById('tab-ctx-diff-saved') as HTMLButtonElement | null;
    const compareTabsBtn = document.getElementById('tab-ctx-compare-tabs') as HTMLButtonElement | null;
    if (revealBtn) revealBtn.disabled = !tab.path;
    if (copyPathBtn) copyPathBtn.disabled = !tab.path;
    if (copyAtPathBtn) copyAtPathBtn.disabled = !tab.path;
    if (diffSavedBtn) diffSavedBtn.disabled = !tab.path;
    if (compareTabsBtn) compareTabsBtn.disabled = tabs.length < 2;

    const closeOthersBtn = this.deps.tabContextMenuEl.querySelector<HTMLButtonElement>(
      '[data-tab-ctx="close-others"]',
    );
    const closeRightBtn = this.deps.tabContextMenuEl.querySelector<HTMLButtonElement>(
      '[data-tab-ctx="close-to-right"]',
    );
    const tabIdx = tabs.findIndex((tItem) => tItem.id === tabId);
    if (closeOthersBtn) closeOthersBtn.disabled = tabs.length <= 1;
    if (closeRightBtn) closeRightBtn.disabled = tabIdx === -1 || tabIdx >= tabs.length - 1;

    const pinLabel = document.getElementById('tab-ctx-pin-label');
    if (pinLabel) {
      pinLabel.textContent = tab.isPinned ? t('tabCtx.unpin') : t('tabCtx.pin');
    }

    positionAndFocusPopover(this.deps.tabContextMenuEl, e.clientX, e.clientY);
  }

  private bindEvents(): void {
    this.deps.tabContextMenuEl.addEventListener('click', (e) => {
      const actionBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tab-ctx]');
      if (!actionBtn) return;
      const action = actionBtn.dataset.tabCtx;
      const targetId = this.tabContextTargetId;
      this.deps.tabContextMenuEl.hidePopover?.();
      if (!targetId || !action) return;
      void this.deps.onContextAction(action, targetId);
    });

    // Tab drag-and-drop reordering via Pointer Events (immune to button click suppression)
    this.deps.tabBarEl.addEventListener('pointerdown', (e: PointerEvent) => {
      window.clearTimeout(this.suppressNextTabClickTimer);
      this.suppressNextTabClickTimer = undefined;
      this.suppressNextTabClick = false;
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('.tab-close-btn')) return;

      const slot = (e.target as HTMLElement).closest<HTMLElement>('.tab-slot');
      if (!slot || !slot.dataset.tabId) return;

      this.tabDragState = {
        tabId: slot.dataset.tabId,
        startX: e.clientX,
        startY: e.clientY,
        isDragging: false,
        targetTabId: null,
        isAfter: false,
      };
    });

    window.addEventListener('pointermove', (e: PointerEvent) => {
      if (!this.tabDragState) return;

      if (!this.tabDragState.isDragging) {
        const dist = Math.hypot(
          e.clientX - this.tabDragState.startX,
          e.clientY - this.tabDragState.startY,
        );
        if (dist < 6) return;
        this.tabDragState.isDragging = true;
        this.suppressNextTabClick = true;
        document.body.classList.add('is-tab-dragging');

        const activeSlot = this.deps.tabBarEl.querySelector<HTMLElement>(
          `.tab-slot[data-tab-id="${this.tabDragState.tabId}"]`,
        );
        activeSlot?.classList.add('is-dragging');
      }

      for (const el of this.deps.tabBarEl.querySelectorAll('.tab-slot')) {
        el.classList.remove('drop-before', 'drop-after');
      }

      let targetSlot =
        (document.elementFromPoint(e.clientX, e.clientY)?.closest('.tab-slot') as HTMLElement | null) ??
        null;
      const slots = Array.from(this.deps.tabBarEl.querySelectorAll<HTMLElement>('.tab-slot'));
      if (!targetSlot && slots.length > 0) {
        for (const slot of slots) {
          const rect = slot.getBoundingClientRect();
          if (e.clientX >= rect.left && e.clientX <= rect.right) {
            targetSlot = slot;
            break;
          }
        }
        if (!targetSlot) {
          const firstRect = slots[0].getBoundingClientRect();
          const lastRect = slots[slots.length - 1].getBoundingClientRect();
          if (e.clientX < firstRect.left) {
            targetSlot = slots[0];
          } else if (e.clientX > lastRect.right) {
            targetSlot = slots[slots.length - 1];
          }
        }
      }

      if (
        targetSlot &&
        targetSlot.dataset.tabId &&
        targetSlot.dataset.tabId !== this.tabDragState.tabId
      ) {
        const rect = targetSlot.getBoundingClientRect();
        const isAfter = e.clientX > rect.left + rect.width / 2;
        targetSlot.classList.toggle('drop-after', isAfter);
        targetSlot.classList.toggle('drop-before', !isAfter);
        this.tabDragState.targetTabId = targetSlot.dataset.tabId;
        this.tabDragState.isAfter = isAfter;
      } else {
        this.tabDragState.targetTabId = null;
      }
    });

    const finishTabDrag = () => {
      if (!this.tabDragState) return;
      const state = this.tabDragState;
      this.tabDragState = null;

      document.body.classList.remove('is-tab-dragging');
      for (const el of this.deps.tabBarEl.querySelectorAll('.tab-slot')) {
        el.classList.remove('drop-before', 'drop-after', 'is-dragging');
      }

      if (state.isDragging) {
        window.clearTimeout(this.suppressNextTabClickTimer);
        this.suppressNextTabClickTimer = window.setTimeout(() => {
          this.suppressNextTabClickTimer = undefined;
          this.suppressNextTabClick = false;
        }, 80);

        if (state.targetTabId && state.targetTabId !== state.tabId) {
          this.deps.onReorderTabs(state.tabId, state.targetTabId, state.isAfter);
        }
      }
    };

    window.addEventListener('pointerup', finishTabDrag);
    window.addEventListener('pointercancel', finishTabDrag);

    // Double click empty tab bar space to open a new tab
    this.deps.tabStripWrapEl?.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('.tab-slot, button')) return;
      this.deps.onNewTab();
    });

    // Horizontal mouse wheel scrolling on tab bar
    this.deps.tabBarEl.addEventListener(
      'wheel',
      (e) => {
        if (e.deltaY && !e.deltaX) {
          e.preventDefault();
          this.deps.tabBarEl.scrollLeft += e.deltaY;
        }
      },
      { passive: false },
    );
  }
}
