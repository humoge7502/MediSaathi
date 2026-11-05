/**
 * Single-flight guard for expensive, repeatable server work.
 *
 * `/api/evals` is the case it exists for: an unauthenticated POST that runs
 * ~20 copilot calls plus ~20 rubric-judge calls and is allowed 300 seconds to
 * do it. The request *count* was limited by the proxy; the cost per
 * request never was, so a tab that re-renders, a retry, or one curious
 * script-writer could stack runs, each of which bills the model provider and
 * holds a worker. Two laws, both enforced here rather than in the route:
 *
 *   1. one run at a time — a caller arriving mid-run JOINS the run already in
 *      flight instead of starting a second one;
 *   2. a finished run answers for `reuseMs` afterwards, and a caller inside
 *      that window is served that result rather than triggering a new run.
 *
 * State is per-process (module-level), which coalesces on the long-running
 * Node server this app actually deploys to. It is not a distributed lock: two
 * replicas may each run the suite once per window. The failure mode of that
 * imprecision is one extra evaluation, not a corrupted verdict — unlike the
 * safety plane, nothing here is persisted or user-visible except the report.
 */

export type RunSource = "ran" | "joined" | "recent";

export interface Guarded<T> {
  value: T;
  /** How this caller got its answer, so the caller can say so honestly rather
   *  than implying it just spent a model budget. */
  source: RunSource;
  /** ms between this call arriving and the run it answers for starting. */
  ageMs: number;
}

export interface RunOptions {
  reuseMs: number;
  /** Ignore the reuse window and demand a new run. A call in flight is still
   *  joined — "force" never means "run two at once". */
  force?: boolean;
  now?: () => number;
}

export interface RunGuard<T> {
  run(fn: () => Promise<T>, opts: RunOptions): Promise<Guarded<T>>;
  /** Number of runs this process actually launched — the number the guard
   *  exists to keep small, and the one its tests assert on. */
  readonly launches: number;
  reset(): void;
}

export function makeRunGuard<T>(): RunGuard<T> {
  let inflight: { promise: Promise<T>; startedAt: number } | null = null;
  let recent: { value: T; finishedAt: number } | null = null;
  let launches = 0;

  async function run(fn: () => Promise<T>, opts: RunOptions): Promise<Guarded<T>> {
    const now = opts.now ?? Date.now;
    const reuseMs = Math.max(0, opts.reuseMs);
    const at = now();

    if (!opts.force && recent && at - recent.finishedAt < reuseMs) {
      return { value: recent.value, source: "recent", ageMs: at - recent.finishedAt };
    }

    if (inflight) {
      const joined = inflight;
      // A run that fails takes its joiners down with it — they asked for the
      // same thing, and serving them a stale result would hide the failure.
      return { value: await joined.promise, source: "joined", ageMs: Math.max(0, at - joined.startedAt) };
    }

    launches += 1;
    // Assigned in the same tick as the launch, before any await: two callers
    // in one tick cannot both take the `inflight === null` branch.
    const started: { promise: Promise<T>; startedAt: number } = {
      promise: (async () => {
        try {
          return await fn();
        } finally {
          inflight = null;
        }
      })(),
      startedAt: at,
    };
    inflight = started;

    try {
      const value = await started.promise;
      recent = { value, finishedAt: now() };
      return { value, source: "ran", ageMs: 0 };
    } catch (e) {
      // A failed run is not a result worth re-serving for two minutes.
      recent = null;
      throw e;
    }
  }

  return {
    run,
    get launches() {
      return launches;
    },
    reset() {
      inflight = null;
      recent = null;
      launches = 0;
    },
  };
}
