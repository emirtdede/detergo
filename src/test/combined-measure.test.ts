import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  order: [] as string[],
  // Resolves the in-flight provider load / measurement so the test controls them.
  finishProviders: null as null | (() => void),
  finishMeasure: null as null | (() => void),
  cancelled: 0,
  // Every measurement call receives its own channel so a test can emit a late
  // event from a superseded run.
  channels: [] as Array<(event: unknown) => void>,
}));

const provider = {
  id: "npm",
  name: "npm",
  detected: true,
  version: "10.0.0",
  cachePaths: [{ path: "C:/npm-cache", exists: true, bytes: null }],
  totalBytes: 0,
  actions: [],
  readOnly: false,
  note: null,
  measured: false,
};

vi.mock("@/lib/tauri/scanner-api", () => ({
  scannerApi: {
    getCacheProviders: async () => {
      harness.order.push("providers");
      await new Promise<void>((resolve) => {
        harness.finishProviders = resolve;
      });
      return [provider];
    },
    measureCacheProviders: async (onEvent: (event: unknown) => void) => {
      harness.order.push("measure");
      harness.channels.push(onEvent);
      onEvent({ type: "started", providerCount: 1 });
      await new Promise<void>((resolve) => {
        harness.finishMeasure = resolve;
      });
      onEvent({ type: "finished" });
    },
    cancelCacheMeasurement: async () => {
      harness.cancelled += 1;
    },
  },
}));

import {
  abortCombinedCacheMeasure,
  resetCombinedMeasureForTests,
  startCombinedCacheMeasure,
} from "../features/scan/combined-measure";
import { resetCacheMeasureRunForTests, useCacheStore } from "../stores/cache-store";

function resetStores() {
  harness.order = [];
  harness.finishProviders = null;
  harness.finishMeasure = null;
  harness.cancelled = 0;
  harness.channels = [];
  resetCombinedMeasureForTests();
  resetCacheMeasureRunForTests();
  useCacheStore.setState({
    providers: [],
    loading: false,
    loaded: false,
    loadError: null,
    measuring: false,
    measureDone: 0,
    measureTotal: 0,
    measureError: null,
  });
}

describe("combined cache measurement", () => {
  beforeEach(resetStores);

  it("starts on its own, next to the walk, instead of waiting for a scan", async () => {
    const run = startCombinedCacheMeasure();
    // No scan session exists here: the old implementation awaited the scan
    // result, which is why the caches page stayed at "not measured" for a whole
    // scan.
    await vi.waitFor(() => expect(harness.finishProviders).toBeTypeOf("function"));
    harness.finishProviders?.();
    await vi.waitFor(() => expect(harness.order).toContain("measure"));

    expect(harness.order).toEqual(["providers", "measure"]);
    expect(useCacheStore.getState().measuring).toBe(true);
    expect(useCacheStore.getState().measureTotal).toBe(1);

    harness.finishMeasure?.();
    await run;

    expect(useCacheStore.getState().measuring).toBe(false);
  });

  it("cancel during the provider load prevents the measurement from starting", async () => {
    const run = startCombinedCacheMeasure();
    // The user pressed stop while the provider rows were still loading. The
    // backend token does not exist yet, so a plain cancel call is a no-op; the
    // start path must honour the request instead.
    await vi.waitFor(() => expect(harness.finishProviders).toBeTypeOf("function"));
    const abort = abortCombinedCacheMeasure();
    harness.finishProviders?.();
    await abort;
    await run;

    // The first press stops the whole action: no "measure" step may start after
    // the cancel.
    expect(harness.order).not.toContain("measure");
    expect(useCacheStore.getState().measuring).toBe(false);
  });

  it("cancel stops an already running measurement", async () => {
    const run = startCombinedCacheMeasure();
    await vi.waitFor(() => expect(harness.finishProviders).toBeTypeOf("function"));
    harness.finishProviders?.();
    await vi.waitFor(() => expect(harness.finishMeasure).toBeTypeOf("function"));

    const abort = abortCombinedCacheMeasure();
    harness.finishMeasure?.();
    await abort;
    await run;

    expect(harness.cancelled).toBeGreaterThan(0);
    expect(useCacheStore.getState().measuring).toBe(false);
  });

  it("an aborted run cannot cancel the measurement that replaced it", async () => {
    // First run: cancel it while it is still loading the provider rows, then
    // start a second run before the first abort has settled. The abort used to
    // null a module-level `activeRun`, which left the new measurement with no
    // way to be stopped.
    const first = startCombinedCacheMeasure();
    await vi.waitFor(() => expect(harness.finishProviders).toBeTypeOf("function"));
    harness.finishProviders?.();

    const abort = abortCombinedCacheMeasure();
    await abort;
    await first;

    // Second run starts and reaches `startMeasure`.
    const second = startCombinedCacheMeasure();
    await vi.waitFor(() =>
      expect(harness.order.filter((step) => step === "measure")).toHaveLength(1),
    );

    expect(useCacheStore.getState().measuring).toBe(true);

    // Stopping now must reach the running measurement, not a cleared reference.
    harness.finishMeasure?.();
    await abortCombinedCacheMeasure();
    await second;

    expect(useCacheStore.getState().measuring).toBe(false);
  });
});
