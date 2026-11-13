/**
 * Pure helper for reordering tabs via drag-and-drop or keyboard shortcuts.
 */
export function reorderTabList<T extends { id: string; isPinned?: boolean }>(
  tabs: T[],
  sourceId: string,
  targetId: string,
  isAfter: boolean,
): T[] {
  const sourceIndex = tabs.findIndex((t) => t.id === sourceId);
  let targetIndex = tabs.findIndex((t) => t.id === targetId);
  if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
    return tabs;
  }

  if (isAfter) {
    targetIndex++;
  }
  if (sourceIndex < targetIndex) {
    targetIndex--;
  }

  const copy = [...tabs];
  const [moved] = copy.splice(sourceIndex, 1);
  copy.splice(targetIndex, 0, moved);
  const pinned = copy.filter((t) => t.isPinned);
  const unpinned = copy.filter((t) => !t.isPinned);
  return [...pinned, ...unpinned];
}

/**
 * Calculates the next or previous active tab id with circular wrap-around.
 */
export function findAdjacentTabId<T extends { id: string }>(
  tabs: T[],
  currentId: string,
  direction: 1 | -1,
): string | null {
  if (tabs.length <= 1) return null;
  const curIdx = tabs.findIndex((t) => t.id === currentId);
  if (curIdx === -1) return null;
  const nextIdx = (curIdx + direction + tabs.length) % tabs.length;
  return tabs[nextIdx].id;
}

/**
 * Toggles `isPinned` on `tabId` and keeps all pinned tabs grouped at the start of the strip.
 */
export function toggleTabPinned<T extends { id: string; isPinned?: boolean }>(
  tabs: T[],
  tabId: string,
): T[] {
  const idx = tabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return tabs;

  const updated = tabs.map((t) =>
    t.id === tabId ? { ...t, isPinned: !t.isPinned } : t,
  );
  const pinned = updated.filter((t) => t.isPinned);
  const unpinned = updated.filter((t) => !t.isPinned);
  return [...pinned, ...unpinned];
}
