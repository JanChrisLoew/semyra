/**
 * Pure helper for reordering tabs via drag-and-drop or keyboard shortcuts.
 */
export function reorderTabList<T extends { id: string }>(
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
  return copy;
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
