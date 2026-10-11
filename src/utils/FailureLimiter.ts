// Counts failures per key inside a sliding window and says when a key should be turned away.
// In-memory only: it exists to make online password guessing impractical, not to be a full audit log.
export class FailureLimiter {
    private failures = new Map<string, number[]>();

    constructor(
        private readonly maxFailures: number,
        private readonly windowMs: number,
        private readonly maxKeys = 10_000
    ) {}

    private recent(key: string, now: number): number[] {
        const list = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
        if (list.length) this.failures.set(key, list);
        else this.failures.delete(key);
        return list;
    }

    isBlocked(key: string, now = Date.now()): boolean {
        return this.recent(key, now).length >= this.maxFailures;
    }

    // Seconds until the oldest counted failure ages out, for a Retry-After header.
    retryAfterSeconds(key: string, now = Date.now()): number {
        const list = this.recent(key, now);
        return list.length ? Math.max(1, Math.ceil((list[0] + this.windowMs - now) / 1000)) : 0;
    }

    recordFailure(key: string, now = Date.now()): void {
        const list = this.recent(key, now);
        list.push(now);
        this.failures.set(key, list);
        if (this.failures.size > this.maxKeys) {
            const oldest = this.failures.keys().next().value;
            if (oldest !== undefined) this.failures.delete(oldest);
        }
    }

    reset(key: string): void {
        this.failures.delete(key);
    }
}
