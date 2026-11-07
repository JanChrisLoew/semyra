import { describe, expect, it } from 'vitest';
import { findAdjacentTabId, reorderTabList } from '../tab-utils';

describe('reorderTabList', () => {
  const tabs = [
    { id: 'tab-1', name: 'Alpha.md' },
    { id: 'tab-2', name: 'Beta.md' },
    { id: 'tab-3', name: 'Gamma.md' },
    { id: 'tab-4', name: 'Delta.md' },
  ];

  it('moves tab forward before target', () => {
    // Move tab-1 before tab-3 -> should become [tab-2, tab-1, tab-3, tab-4]
    const result = reorderTabList(tabs, 'tab-1', 'tab-3', false);
    expect(result.map((t) => t.id)).toEqual(['tab-2', 'tab-1', 'tab-3', 'tab-4']);
  });

  it('moves tab forward after target', () => {
    // Move tab-1 after tab-3 -> should become [tab-2, tab-3, tab-1, tab-4]
    const result = reorderTabList(tabs, 'tab-1', 'tab-3', true);
    expect(result.map((t) => t.id)).toEqual(['tab-2', 'tab-3', 'tab-1', 'tab-4']);
  });

  it('moves tab backward before target', () => {
    // Move tab-4 before tab-2 -> should become [tab-1, tab-4, tab-2, tab-3]
    const result = reorderTabList(tabs, 'tab-4', 'tab-2', false);
    expect(result.map((t) => t.id)).toEqual(['tab-1', 'tab-4', 'tab-2', 'tab-3']);
  });

  it('moves tab backward after target', () => {
    // Move tab-4 after tab-2 -> should become [tab-1, tab-2, tab-4, tab-3]
    const result = reorderTabList(tabs, 'tab-4', 'tab-2', true);
    expect(result.map((t) => t.id)).toEqual(['tab-1', 'tab-2', 'tab-4', 'tab-3']);
  });

  it('moves tab to first position', () => {
    const result = reorderTabList(tabs, 'tab-4', 'tab-1', false);
    expect(result.map((t) => t.id)).toEqual(['tab-4', 'tab-1', 'tab-2', 'tab-3']);
  });

  it('moves tab to last position', () => {
    const result = reorderTabList(tabs, 'tab-1', 'tab-4', true);
    expect(result.map((t) => t.id)).toEqual(['tab-2', 'tab-3', 'tab-4', 'tab-1']);
  });

  it('returns original list if sourceId equals targetId', () => {
    const result = reorderTabList(tabs, 'tab-2', 'tab-2', false);
    expect(result).toBe(tabs);
  });

  it('returns original list if sourceId or targetId not found', () => {
    expect(reorderTabList(tabs, 'invalid', 'tab-2', false)).toBe(tabs);
    expect(reorderTabList(tabs, 'tab-1', 'invalid', true)).toBe(tabs);
  });
});

describe('findAdjacentTabId', () => {
  const tabs = [
    { id: 'tab-1', name: 'Alpha.md' },
    { id: 'tab-2', name: 'Beta.md' },
    { id: 'tab-3', name: 'Gamma.md' },
  ];

  it('cycles to next tab forward', () => {
    expect(findAdjacentTabId(tabs, 'tab-1', 1)).toBe('tab-2');
    expect(findAdjacentTabId(tabs, 'tab-2', 1)).toBe('tab-3');
  });

  it('wraps around to first tab when advancing past the end', () => {
    expect(findAdjacentTabId(tabs, 'tab-3', 1)).toBe('tab-1');
  });

  it('cycles to previous tab backward', () => {
    expect(findAdjacentTabId(tabs, 'tab-3', -1)).toBe('tab-2');
    expect(findAdjacentTabId(tabs, 'tab-2', -1)).toBe('tab-1');
  });

  it('wraps around to last tab when stepping back before the start', () => {
    expect(findAdjacentTabId(tabs, 'tab-1', -1)).toBe('tab-3');
  });

  it('returns null if list has 1 or 0 tabs or currentId is missing', () => {
    expect(findAdjacentTabId([], 'tab-1', 1)).toBeNull();
    expect(findAdjacentTabId([{ id: 'solo' }], 'solo', 1)).toBeNull();
    expect(findAdjacentTabId(tabs, 'unknown', 1)).toBeNull();
  });
});
