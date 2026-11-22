import { describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import {
  clampSidebarWidth,
  clampSplitRatio,
  formatSidebarValueText,
  formatSplitValueText,
  parseSplitRatios,
  snapSplitRatio,
  splitRatioFromPointer,
} from '../layout-utils';

describe('split ratio helpers', () => {
  it('clamps to 20..80 and falls back to 50 for invalid values', () => {
    expect(clampSplitRatio(5)).toBe(20);
    expect(clampSplitRatio(95)).toBe(80);
    expect(clampSplitRatio(NaN)).toBe(50);
  });

  it('snaps to 50 near the centre only', () => {
    expect(snapSplitRatio(51.5)).toBe(50);
    expect(snapSplitRatio(48.1)).toBe(50);
    expect(snapSplitRatio(53)).toBe(53);
  });

  it('derives ratio from pointer for both orientations', () => {
    const rect = { left: 100, top: 50, width: 1000, height: 400 };
    expect(splitRatioFromPointer('vertical', { x: 350, y: 0 }, rect)).toBe(25);
    expect(splitRatioFromPointer('horizontal', { x: 0, y: 250 }, rect)).toBe(50);
    expect(splitRatioFromPointer('vertical', { x: 0, y: 0 }, { ...rect, width: 0 })).toBe(50);
  });
});

describe('sidebar width', () => {
  it('clamps to 190..560', () => {
    expect(clampSidebarWidth(100)).toBe(190);
    expect(clampSidebarWidth(900)).toBe(560);
    expect(clampSidebarWidth(300)).toBe(300);
    expect(clampSidebarWidth(NaN)).toBe(255);
  });

  it('never exceeds half of a narrow viewport', () => {
    expect(clampSidebarWidth(500, 800)).toBe(400);
    expect(clampSidebarWidth(500, 300)).toBe(190);
  });
});

describe('parseSplitRatios', () => {
  it('reads valid per-orientation values and clamps them', () => {
    expect(parseSplitRatios('{"vertical":35,"horizontal":99}')).toEqual({ vertical: 35, horizontal: 80 });
  });

  it('falls back to 50/50 for missing or broken data', () => {
    const fallback = { vertical: 50, horizontal: 50 };
    expect(parseSplitRatios(null)).toEqual(fallback);
    expect(parseSplitRatios('not json')).toEqual(fallback);
    expect(parseSplitRatios('{"vertical":"x"}')).toEqual(fallback);
  });
});

describe('formatValueText helpers', () => {
  it('formats split resizer value text for vertical and horizontal', () => {
    setLanguage('de', false);
    expect(formatSplitValueText('vertical', 40)).toBe('Editor 40% links, Vorschau 60% rechts');
    expect(formatSplitValueText('horizontal', 65)).toBe('Editor 65% oben, Vorschau 35% unten');
    expect(formatSidebarValueText(280.4)).toBe('280 Pixel');

    setLanguage('en', false);
    expect(formatSplitValueText('vertical', 40)).toBe('Editor 40% left, preview 60% right');
    expect(formatSplitValueText('horizontal', 65)).toBe('Editor 65% top, preview 35% bottom');
    expect(formatSidebarValueText(280.4)).toBe('280 pixels');
    setLanguage('de', false);
  });
});
