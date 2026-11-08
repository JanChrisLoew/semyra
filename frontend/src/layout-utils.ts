/** Pure layout helpers for the split view and the resizable sidebar. */
import { t } from './i18n';

export const SPLIT_RATIO_MIN = 20;
export const SPLIT_RATIO_MAX = 80;
export const SPLIT_SNAP_POINT = 50;
export const SPLIT_SNAP_THRESHOLD = 2;

export const SIDEBAR_WIDTH_MIN = 190;
export const SIDEBAR_WIDTH_MAX = 560;
export const SIDEBAR_WIDTH_DEFAULT = 255;

export type SplitOrientation = 'vertical' | 'horizontal';

export function clampSplitRatio(pct: number): number {
  if (!Number.isFinite(pct)) return SPLIT_SNAP_POINT;
  return Math.max(SPLIT_RATIO_MIN, Math.min(SPLIT_RATIO_MAX, pct));
}

/** Snaps to 50/50 when the pointer is close to the centre (dragging only). */
export function snapSplitRatio(pct: number): number {
  const clamped = clampSplitRatio(pct);
  return Math.abs(clamped - SPLIT_SNAP_POINT) <= SPLIT_SNAP_THRESHOLD ? SPLIT_SNAP_POINT : clamped;
}

/** Converts a pointer position inside the split container into a ratio (percent). */
export function splitRatioFromPointer(
  orientation: SplitOrientation,
  pointer: { x: number; y: number },
  rect: { left: number; top: number; width: number; height: number },
): number {
  if (orientation === 'horizontal') {
    return rect.height > 0 ? ((pointer.y - rect.top) / rect.height) * 100 : SPLIT_SNAP_POINT;
  }
  return rect.width > 0 ? ((pointer.x - rect.left) / rect.width) * 100 : SPLIT_SNAP_POINT;
}

export function clampSidebarWidth(px: number, viewportWidth = Infinity): number {
  if (!Number.isFinite(px)) return SIDEBAR_WIDTH_DEFAULT;
  const max = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, viewportWidth * 0.5));
  return Math.round(Math.max(SIDEBAR_WIDTH_MIN, Math.min(max, px)));
}

export type SplitRatios = Record<SplitOrientation, number>;

/** Parses persisted per-orientation split ratios; invalid input falls back to 50/50. */
export function parseSplitRatios(raw: string | null | undefined): SplitRatios {
  const fallback: SplitRatios = { vertical: SPLIT_SNAP_POINT, horizontal: SPLIT_SNAP_POINT };
  if (!raw) return fallback;
  try {
    const data = JSON.parse(raw) as Partial<Record<SplitOrientation, unknown>>;
    return {
      vertical: typeof data.vertical === 'number' ? clampSplitRatio(data.vertical) : fallback.vertical,
      horizontal:
        typeof data.horizontal === 'number' ? clampSplitRatio(data.horizontal) : fallback.horizontal,
    };
  } catch {
    return fallback;
  }
}

/** Formats an accessible description for the split resizer's aria-valuetext. */
export function formatSplitValueText(orientation: SplitOrientation, pct: number): string {
  const rounded = Math.round(clampSplitRatio(pct));
  const other = 100 - rounded;
  return orientation === 'horizontal'
    ? t('resizer.horizontalAria', { ed: rounded, prev: other })
    : t('resizer.verticalAria', { ed: rounded, prev: other });
}

/** Formats an accessible description for the sidebar resizer's aria-valuetext. */
export function formatSidebarValueText(px: number): string {
  return t('resizer.sidebarAria', { width: Math.round(px) });
}
