import { useCacheStore } from "@/stores/cache-store";

/**
 * Package-cache measurement of a "scan everything" run.
 *
 * It runs *alongside* the project/agent walk instead of after it. Measuring last
 * made the caches page read "not measured" for the whole scan, so the top-bar
 * action looked like it had never included caches at all. It also created a
 * worse failure mode: the pending step kept waiting for the scan promise, so a
 * user "Stop" resolved the walk and *then* started a fresh measurement —
 * pressing stop appeared to begin the cache scan.
 *
 * The measurement owns a separate backend session and cancel token, so running
 * it concurrently is safe; the header's single "Stop" aborts both.
 *
 * Cancel intent is tracked per run rather than in the store because the start
 * path awaits the provider list first. A cancel that arrives during that await
 * must not be lost: the token was never created yet, so a plain "cancel now"
 * call would be a no-op and the measurement would start anyway.
 *
 * Each start gets its own generation. A plain module-level `activeRun` let an
 * `abort` that was awaiting the *previous* run clear the reference to a run
 * started in the meantime, which left the new measurement uncancellable.
 */
let activeGeneration = 0;
let activeRun: Promise<void> | null = null;
const cancelledGenerations = new Set<number>();

/** Exported for tests: module state must not leak between cases. */
export function resetCombinedMeasureForTests(): void {
  activeGeneration = 0;
  activeRun = null;
  cancelledGenerations.clear();
}

export function startCombinedCacheMeasure(): Promise<void> {
  const generation = ++activeGeneration;
  cancelledGenerations.delete(generation);
  const run = (async () => {
    // The provider rows must exist before events stream in: `pathMeasured` and
    // `providerFinished` update existing rows, so an empty list would drop every
    // measured size and the page would still read "not measured" afterwards.
    // `startMeasure` guarantees the load itself, so the combined path does not
    // repeat it (and cannot forget it).
    await useCacheStore.getState().loadProviders();
    if (cancelledGenerations.has(generation)) return;
    await useCacheStore.getState().startMeasure();
  })();
  activeRun = run;
  void run.finally(() => {
    // Never clear a newer run: an older abort resolving late used to null the
    // reference to the measurement that was actually running.
    if (activeRun === run) activeRun = null;
  });
  return run;
}

/**
 * Aborts the cache step of a combined run, including one that has not reached
 * `startMeasure` yet. Safe to call when nothing is running.
 */
export async function abortCombinedCacheMeasure(): Promise<void> {
  const generation = activeGeneration;
  const run = activeRun;
  cancelledGenerations.add(generation);
  // A running measurement can be cancelled immediately. When the backend has not
  // created its token yet this is a no-op, which is why the run is awaited
  // below: the start path re-checks the generation and skips the measurement.
  if (useCacheStore.getState().measuring) {
    await useCacheStore.getState().cancelMeasure();
  }
  if (run) {
    try {
      await run;
    } catch {
      // `startMeasure` records its own error; aborting must never reject.
    }
  }
  // The start path may have entered `startMeasure` just before the abort was
  // requested. Its cancel command can also race the start command across the
  // IPC bridge, so re-check once the run has settled.
  if (useCacheStore.getState().measuring) {
    await useCacheStore.getState().cancelMeasure();
  }
  // Bounded bookkeeping only: an older generation may never have reached
  // `startMeasure`, and holding its id forever would grow this set.
  cancelledGenerations.delete(generation);
}
