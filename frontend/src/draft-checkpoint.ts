const IDLE_DELAY_MS = 1100;
const MAX_DELAY_MS = 5000;

export class DraftCheckpoint {
  private idleTimer: number | undefined;
  private deadlineTimer: number | undefined;

  constructor(private readonly persist: () => void) {}

  schedule(): void {
    this.deadlineTimer ??= window.setTimeout(() => this.flush(), MAX_DELAY_MS);
    window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => this.flush(), IDLE_DELAY_MS);
  }

  flush(): void {
    window.clearTimeout(this.idleTimer);
    window.clearTimeout(this.deadlineTimer);
    this.idleTimer = undefined;
    this.deadlineTimer = undefined;
    this.persist();
  }
}
