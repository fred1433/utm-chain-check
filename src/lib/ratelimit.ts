/**
 * Abuse limits for a public service that makes outbound requests.
 *
 * Counters are shared by every request handled by one server instance. They are
 * deliberately small: this page is a prototype, not a public checker, and a scan
 * costs someone else's bandwidth.
 */

type Window = { count: number; resetAt: number };

export class SlidingCounter {
  private windows = new Map<string, Window>();

  constructor(private readonly windowMs: number) {}

  take(key: string, limit: number, now = Date.now()): boolean {
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  }

  sweep(now = Date.now()): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }

  get size(): number {
    return this.windows.size;
  }
}

export class Breaker {
  private failures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
  ) {}

  isOpen(now = Date.now()): boolean {
    if (this.openedAt === null) return false;
    if (now - this.openedAt >= this.cooldownMs) {
      this.openedAt = null;
      this.failures = 0;
      return false;
    }
    return true;
  }

  recordFailure(now = Date.now()): void {
    this.failures += 1;
    if (this.failures >= this.threshold) this.openedAt = now;
  }

  recordSuccess(): void {
    this.failures = 0;
  }
}

export type GateVerdict = { ok: true } | { ok: false; reason: string; status: number };

export class ScanGate {
  private readonly perIp = new SlidingCounter(60_000);
  private readonly perDestination = new SlidingCounter(60_000);
  private readonly global = new SlidingCounter(60_000);
  private readonly breaker = new Breaker(20, 60_000);
  private inFlight = 0;

  constructor(
    private readonly limits = {
      perIpPerMinute: 12,
      perDestinationPerMinute: 20,
      globalPerMinute: 120,
      concurrency: 4,
    },
  ) {}

  enter(ip: string, destinationHost: string, now = Date.now()): GateVerdict {
    if (this.breaker.isOpen(now)) {
      return { ok: false, reason: "the checker is pausing outbound requests, try again shortly", status: 503 };
    }
    if (this.inFlight >= this.limits.concurrency) {
      return { ok: false, reason: "too many scans running at once, try again in a moment", status: 503 };
    }
    if (!this.global.take("all", this.limits.globalPerMinute, now)) {
      return { ok: false, reason: "this page has reached its scan budget for the minute", status: 429 };
    }
    if (!this.perIp.take(ip, this.limits.perIpPerMinute, now)) {
      return { ok: false, reason: "too many scans from this address, try again in a minute", status: 429 };
    }
    if (!this.perDestination.take(destinationHost, this.limits.perDestinationPerMinute, now)) {
      return { ok: false, reason: "too many scans towards this destination, try again in a minute", status: 429 };
    }
    this.inFlight += 1;
    return { ok: true };
  }

  leave(outcome: "ok" | "failed", now = Date.now()): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (outcome === "failed") this.breaker.recordFailure(now);
    else this.breaker.recordSuccess();
    this.perIp.sweep(now);
    this.perDestination.sweep(now);
  }
}

export const scanGate = new ScanGate();
