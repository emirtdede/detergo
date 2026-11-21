/**
 * Bounds an async operation that can hang on an external actor.
 *
 * Every long-running operation crosses the Tauri IPC bridge. A backend panic
 * that never answers, a dropped channel or a suspended WebView2 all leave the
 * promise unsettled forever. Callers that hold a lock (a scan start slot, a
 * combined-run flag) cannot wait for that: a single stuck command used to make
 * the whole app unable to scan again until it was restarted.
 *
 * `withTimeout` never cancels the underlying work - it only stops the caller
 * from waiting for it. The operation is still expected to settle on its own
 * (or to be cancelled through its own token) so no state is left behind.
 */
export class TimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(label: string, timeoutMs: number) {
    super(`${label} did not settle within ${timeoutMs} ms`);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label = "operation",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(label, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/**
 * Resolves `true` when `predicate` becomes true before the deadline.
 *
 * Used for state reconciliation: after a cancel command is acknowledged the UI
 * may still be waiting for the terminal event on the event channel. Polling a
 * local store is cheap and keeps that wait bounded instead of relying on an
 * event that may never arrive.
 */
export async function waitForCondition(
  predicate: () => boolean,
  { timeoutMs, intervalMs = 100 }: { timeoutMs: number; intervalMs?: number },
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
  return predicate();
}
