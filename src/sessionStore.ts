export const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;

export interface ExpiredSession<T> {
  id: string;
  value: T;
}

interface SessionEntry<T> {
  value: T;
  lastSeenMs: number;
}

export class SessionStore<T> {
  private readonly sessions = new Map<string, SessionEntry<T>>();

  constructor(
    private readonly ttlMs = DEFAULT_SESSION_TTL_MS,
    private readonly nowMs = () => Date.now()
  ) {}

  get size(): number {
    return this.sessions.size;
  }

  set(id: string, value: T): void {
    this.sessions.set(id, {
      value,
      lastSeenMs: this.nowMs()
    });
  }

  get(id: string): T | undefined {
    const entry = this.sessions.get(id);
    if (!entry) return undefined;

    if (this.isExpired(entry)) {
      this.sessions.delete(id);
      return undefined;
    }

    entry.lastSeenMs = this.nowMs();
    return entry.value;
  }

  delete(id: string): boolean {
    return this.sessions.delete(id);
  }

  sweepExpired(): Array<ExpiredSession<T>> {
    const expired: Array<ExpiredSession<T>> = [];

    for (const [id, entry] of this.sessions.entries()) {
      if (this.isExpired(entry)) {
        this.sessions.delete(id);
        expired.push({ id, value: entry.value });
      }
    }

    return expired;
  }

  private isExpired(entry: SessionEntry<T>): boolean {
    return this.nowMs() - entry.lastSeenMs > this.ttlMs;
  }
}
