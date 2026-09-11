/**
 * Circuit breaker for outbound model calls (reliability audit R-9).
 *
 * Failure law: when the model service is down, EVERY copilot query still pays
 * the full network timeout before failing — a self-inflicted latency collapse
 * while the deterministic tier could answer instantly. The breaker opens after
 * N consecutive failures and fails fast (`isOpen` -> service_unavailable in
 * ~0 ms) until a cooldown elapses; the next call then probes (half-open) and
 * either closes the breaker on success or re-opens it on failure.
 *
 * Dependency-free and clock-injected: `now()` is a parameter so tests can walk
 * time without sleeping, mirroring the deterministic-evidence law of the rest
 * of the codebase.
 *
 * This is the documented swap-shape for a shared breaker (Redis) if the tier
 * ever scales past one process — see docs/DECISIONS.md ADR-006.
 */

export type BreakerState = "closed" | "open" | "half_open";

export interface BreakerOptions {
  /** Consecutive failures before opening. */
  threshold?: number;
  /** ms the breaker stays open before allowing a probe. */
  cooldownMs?: number;
  /** Clock source (injectable for tests). */
  now?: () => number;
}

export class CircuitBreaker {
  readonly threshold: number;
  readonly cooldownMs: number;
  private readonly now: () => number;
  private _failures = 0;
  private _openedAt = 0;
  private _state: BreakerState = "closed";

  constructor(opts: BreakerOptions = {}) {
    this.threshold = Math.max(1, opts.threshold ?? 3);
    this.cooldownMs = Math.max(0, opts.cooldownMs ?? 30_000);
    this.now = opts.now ?? Date.now;
  }

  get state(): BreakerState {
    if (this._state === "open" && this.now() - this._openedAt >= this.cooldownMs) {
      // Cooldown elapsed: allow one probe through (half-open).
      return "half_open";
    }
    return this._state;
  }

  /** True when a call may proceed. Half-open allows exactly one probe. */
  allow(): boolean {
    const s = this.state;
    if (s === "closed") return true;
    if (s === "half_open") return true;
    return false;
  }

  /** Record a success: any state -> closed, counters reset. */
  success(): void {
    this._failures = 0;
    this._state = "closed";
  }

  /** Record a failure: increments, opens the breaker at the threshold. */
  failure(): void {
    this._failures += 1;
    if (this._state === "half_open" || this._failures >= this.threshold) {
      this._state = "open";
      this._openedAt = this.now();
    }
  }
}

/**
 * Process-wide breaker for the model dependency. Threshold 3 consecutive
 * failures / 30 s cooldown keeps the demo honest: brief blips retry silently,
 * a real outage flips to fast, honest `service_unavailable` answers instead of
 * 30-second hangs per query.
 */
export const modelBreaker = new CircuitBreaker({ threshold: 3, cooldownMs: 30_000 });
