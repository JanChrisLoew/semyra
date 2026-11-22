import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftCheckpoint } from '../draft-checkpoint';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('DraftCheckpoint', () => {
  it('debounces idle edits to 1100ms before persisting', () => {
    const persist = vi.fn();
    const checkpoint = new DraftCheckpoint(persist);

    checkpoint.schedule();
    vi.advanceTimersByTime(800);
    expect(persist).not.toHaveBeenCalled();

    checkpoint.schedule();
    vi.advanceTimersByTime(800);
    expect(persist).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(persist).toHaveBeenCalledOnce();
  });

  it('forces a checkpoint at the 5000ms deadline during continuous typing', () => {
    const persist = vi.fn();
    const checkpoint = new DraftCheckpoint(persist);

    for (let i = 0; i < 9; i++) {
      checkpoint.schedule();
      vi.advanceTimersByTime(500);
    }
    expect(persist).not.toHaveBeenCalled();

    checkpoint.schedule();
    vi.advanceTimersByTime(500);
    expect(persist).toHaveBeenCalledOnce();
  });

  it('flush persists immediately and cancels both pending timers', () => {
    const persist = vi.fn();
    const checkpoint = new DraftCheckpoint(persist);

    checkpoint.schedule();
    checkpoint.flush();
    expect(persist).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(6000);
    expect(persist).toHaveBeenCalledOnce();
  });
});
