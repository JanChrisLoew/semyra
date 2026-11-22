import { isSamePath } from './path-utils';

export interface NavigationHistoryDeps {
  hasOpenTab: (tabId: string) => boolean;
  activateTab: (tabId: string) => void;
  openFileByPath: (path: string) => Promise<boolean>;
  getActiveTabId: () => string | undefined;
}

export class NavigationHistoryController {
  private entries: Array<{ tabId: string; path: string | null }> = [];
  private index = -1;
  private navigatingDepth = 0;
  private seq = 0;

  constructor(private readonly deps: NavigationHistoryDeps) {}

  public get isNavigating(): boolean {
    return this.navigatingDepth > 0;
  }

  public record(tabId: string, path: string | null): void {
    if (this.navigatingDepth > 0) return;
    const current = this.entries[this.index];
    if (current && current.tabId === tabId && current.path === path) return;
    if (this.index < this.entries.length - 1) {
      this.entries = this.entries.slice(0, this.index + 1);
    }
    this.entries.push({ tabId, path });
    if (this.entries.length > 100) {
      this.entries.shift();
    }
    this.index = this.entries.length - 1;
  }

  public updateTabPath(tabId: string, previousPath: string | null, newPath: string): void {
    for (const entry of this.entries) {
      if (
        entry.tabId === tabId ||
        (previousPath && entry.path && isSamePath(entry.path, previousPath))
      ) {
        entry.path = newPath;
      }
    }
  }

  public remapPaths(remap: (path: string) => string): void {
    for (const entry of this.entries) {
      if (entry.path) {
        entry.path = remap(entry.path);
      }
    }
  }

  public async navigate(delta: -1 | 1): Promise<void> {
    const navSeq = ++this.seq;
    let idx = this.index + delta;
    while (idx >= 0 && idx < this.entries.length) {
      if (navSeq !== this.seq) return;
      const entry = this.entries[idx];
      if (this.deps.hasOpenTab(entry.tabId)) {
        this.index = idx;
        this.navigatingDepth++;
        try {
          this.deps.activateTab(entry.tabId);
        } finally {
          this.navigatingDepth--;
        }
        return;
      }
      if (entry.path) {
        const prevIndex = this.index;
        this.index = idx;
        this.navigatingDepth++;
        let opened = false;
        try {
          opened = await this.deps.openFileByPath(entry.path);
        } finally {
          this.navigatingDepth--;
        }
        if (navSeq !== this.seq) return;
        if (opened) {
          const activeId = this.deps.getActiveTabId();
          if (activeId) {
            entry.tabId = activeId;
          }
          return;
        }
        this.index = prevIndex;
      }
      idx += delta;
    }
  }
}
