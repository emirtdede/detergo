import { describe, expect, it } from "vitest";

import { TimeoutError, waitForCondition, withTimeout } from "../lib/async/with-timeout";

// These helpers protect every place that holds a lock across the IPC bridge
// (scan start slot, combined-run flag, cancel reconciliation). A regression
// here means one stuck command can make the app unable to scan again, so the
// contract is asserted directly instead of only through a caller.
describe("withTimeout", () => {
  it("returns the value of an operation that settles in time", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
  });

  it("rejects with a TimeoutError instead of waiting forever", async () => {
    // A promise that is intentionally never settled: the backend stopped
    // answering, which is exactly the case this helper exists for.
    const stuck = new Promise<never>(() => {});
    const started = Date.now();

    await expect(withTimeout(stuck, 20, "stuck command")).rejects.toBeInstanceOf(TimeoutError);
    // Bounded, not merely eventually failing.
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("keeps the label and the budget on the error for the log line", async () => {
    const stuck = new Promise<never>(() => {});
    const error = await withTimeout(stuck, 10, "measure caches").catch((err: unknown) => err);

    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as TimeoutError).timeoutMs).toBe(10);
    expect((error as TimeoutError).message).toContain("measure caches");
  });

  it("propagates a real failure unchanged", async () => {
    const failure = new Error("backend refused");
    await expect(withTimeout(Promise.reject(failure), 1000)).rejects.toBe(failure);
  });
});

describe("waitForCondition", () => {
  it("resolves true as soon as the predicate holds", async () => {
    let ready = false;
    setTimeout(() => {
      ready = true;
    }, 5);

    await expect(waitForCondition(() => ready, { timeoutMs: 500, intervalMs: 5 })).resolves.toBe(
      true,
    );
  });

  it("resolves false when the deadline passes, so the caller can reconcile", async () => {
    await expect(waitForCondition(() => false, { timeoutMs: 20, intervalMs: 5 })).resolves.toBe(
      false,
    );
  });
});
