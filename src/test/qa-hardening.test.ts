import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  providerCalls: 0,
  cancelCalls: 0,
  resolvers: [] as Array<() => void>,
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
  isTauriEnvironment: () => false,
  scannerApi: {
    getCacheProviders: async () => {
      harness.providerCalls += 1;
      return [provider];
    },
    measureCacheProviders: async (onEvent: (event: unknown) => void) => {
      harness.channels.push(onEvent);
      await new Promise<void>((resolve) => {
        harness.resolvers.push(resolve);
      });
    },
    cancelCacheMeasurement: async () => {
      harness.cancelCalls += 1;
    },
  },
}));

import { resetCacheMeasureRunForTests, useCacheStore } from "../stores/cache-store";
import { disposeScanBuffers, flushPendingSummary, useScanStore } from "../stores/scan-store";
import { redactSecrets } from "../lib/logging";
import { classifyWebhookFailure, describeWebhookFailure } from "../lib/errors/webhook-failure";
import { getUIText } from "../lib/ui-text";
import { isScanActiveNow } from "../features/scan/scan-activity";
import { makeItem } from "./fixtures";
import { CacheProviderInfo, CleanupItem, LastScanSnapshot } from "../types";

function resetCacheStore() {
  harness.providerCalls = 0;
  harness.cancelCalls = 0;
  harness.resolvers = [];
  harness.channels = [];
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

beforeEach(() => {
  resetCacheStore();
  disposeScanBuffers();
  useScanStore.getState().resetScan();
});

afterEach(() => {
  disposeScanBuffers();
});

describe("cache measurement races (K1/K3)", () => {
  it("a superseded run cannot clear the measuring flag of the run that replaced it", async () => {
    useCacheStore.setState({ providers: [provider as CacheProviderInfo], loaded: true });

    const first = useCacheStore.getState().startMeasure();
    await vi.waitFor(() => expect(harness.channels).toHaveLength(1));

    // Second request while the first is still walking. The store cancels the
    // first session and starts a new one.
    const second = useCacheStore.getState().startMeasure();
    await vi.waitFor(() => expect(harness.channels).toHaveLength(2));
    expect(useCacheStore.getState().measuring).toBe(true);

    // The first run settles *after* the second one started. Its `finally` must
    // not turn the UI into "idle" while the second walk is still running.
    harness.resolvers[0]?.();
    await first;
    expect(useCacheStore.getState().measuring).toBe(true);

    harness.resolvers[1]?.();
    await second;
    expect(useCacheStore.getState().measuring).toBe(false);
  });

  it("ignores events from a superseded channel", async () => {
    useCacheStore.setState({ providers: [provider as CacheProviderInfo], loaded: true });

    const first = useCacheStore.getState().startMeasure();
    await vi.waitFor(() => expect(harness.channels).toHaveLength(1));
    const second = useCacheStore.getState().startMeasure();
    await vi.waitFor(() => expect(harness.channels).toHaveLength(2));

    // A late `finished` from run 1 must not stop run 2.
    harness.channels[0]?.({ type: "finished" });
    expect(useCacheStore.getState().measuring).toBe(true);

    harness.resolvers[1]?.();
    await second;
    harness.resolvers[0]?.();
    await first;
    expect(useCacheStore.getState().measuring).toBe(false);
  });

  it("loads provider rows before measuring, even when the caller forgot", async () => {
    // `loaded` is false: the header's "Caches" scope action used to call
    // `startMeasure` directly, so the first `pathMeasured` event found no row
    // and every measured size was dropped.
    expect(useCacheStore.getState().loaded).toBe(false);
    const run = useCacheStore.getState().startMeasure();
    await vi.waitFor(() => expect(harness.channels).toHaveLength(1));

    expect(harness.providerCalls).toBe(1);
    const channel = harness.channels[0]!;
    channel({
      type: "pathMeasured",
      providerId: "npm",
      path: "C:/npm-cache",
      exists: true,
      bytes: 1024,
    });

    const npm = useCacheStore.getState().providers.find((entry) => entry.id === "npm");
    expect(npm?.cachePaths[0]?.bytes).toBe(1024);

    harness.resolvers[0]?.();
    await run;
  });
});

describe("snapshot validation (O3)", () => {
  it("bumps the reset token so a late restore cannot undo a workspace reset", () => {
    // The startup restore awaits an IPC read. If the user resets while that read
    // is in flight, `resetScan` puts the store back into the exact `idle` +
    // empty-items state that `App` treats as "safe to restore", so the snapshot
    // would reappear after the reset. The token is what App compares.
    const before = useScanStore.getState().workspaceResetToken;
    useScanStore.getState().resetScan({ clearPersisted: true });
    const afterClear = useScanStore.getState().workspaceResetToken;
    expect(afterClear).toBe(before + 1);

    useScanStore.getState().resetScan();
    expect(useScanStore.getState().workspaceResetToken).toBe(afterClear + 1);
  });

  it("drops unusable rows and repairs incomplete ones instead of poisoning the summary", () => {
    const valid = makeItem({ id: "valid", status: "ready", allocatedBytes: 2048 });
    const missingProvider = { ...makeItem({ id: "no-provider" }), provider: undefined };
    // A hand-edited or partially written file can lose the array.
    const missingWarnings = { ...makeItem({ id: "no-warnings" }), warningCodes: undefined };

    const snapshot: LastScanSnapshot = {
      schemaVersion: 1,
      savedAt: new Date().toISOString(),
      summary: {
        scanId: "s-1",
        rootPath: "C:\\Projects\\app",
        scope: "project",
        startedAt: new Date().toISOString(),
        durationMs: 10,
        totalEntries: 3,
        totalBytes: 2048,
        totalAllocatedBytes: 2048,
        protectedBytes: 0,
        cleanableBytes: 2048,
        errorsCount: 0,
        warningsCount: 0,
        providerTotals: [],
        partial: false,
        stopReason: null,
        sections: [],
      } as unknown as LastScanSnapshot["summary"],
      items: [valid, missingProvider, missingWarnings] as unknown as CleanupItem[],
      warnings: [],
    };

    expect(useScanStore.getState().restoreScan(snapshot)).toBe(true);
    const restored = useScanStore.getState();
    // The row without a provider is unusable and dropped; the row with a
    // missing `warningCodes` array is repaired instead of poisoning the session.
    expect(restored.itemIds).toEqual(["valid", "no-warnings"]);
    expect(restored.itemsById["no-warnings"]?.warningCodes).toEqual([]);

    // The debounced summary rebuild used to throw here when a row had no
    // `warningCodes` array.
    expect(() => {
      useScanStore.getState().markDeleted(["valid"]);
      flushPendingSummary();
    }).not.toThrow();
  });
});

describe("secret redaction (O2)", () => {
  it("drops the credential path from a webhook URL and masks the account name", () => {
    const redacted = redactSecrets(
      "POST https://discord.com/api/webhooks/123456/secret-token failed at C:\\Users\\emir\\AppData",
    );
    expect(redacted).not.toContain("secret-token");
    expect(redacted).not.toContain("emir");
    expect(redacted).toContain("https://discord.com");
  });
});

describe("webhook failure classification (Y4/O1)", () => {
  const ui = getUIText("en");

  it("maps statuses to token-free reasons", () => {
    expect(classifyWebhookFailure(404)).toBe("http_404");
    expect(classifyWebhookFailure(0)).toBe("network");
    expect(classifyWebhookFailure(undefined)).toBe("network");
  });

  it("never echoes a free-form backend message", () => {
    const leaked = describeWebhookFailure(
      "error sending request for url (https://discord.com/api/webhooks/1/token)",
      ui,
    );
    expect(leaked).toBe(ui.errors.network);
    expect(leaked).not.toContain("discord.com");
    expect(describeWebhookFailure("http_500", ui)).toBe("HTTP 500");
  });
});

describe("single source of scan activity (Y3)", () => {
  it("treats the scan status, a combined tail and a standalone measurement as busy", () => {
    useScanStore.setState({ status: "idle", combinedActive: false });
    useCacheStore.setState({ measuring: false });
    expect(isScanActiveNow()).toBe(false);

    // Ctrl+Enter used to read the status only, so it was dead while the caches
    // page measured on its own.
    useCacheStore.setState({ measuring: true });
    expect(isScanActiveNow()).toBe(true);

    useCacheStore.setState({ measuring: false });
    useScanStore.setState({ status: "measuring" });
    expect(isScanActiveNow()).toBe(true);

    // The walk has finished but its cache step is still running; the shortcut
    // must still offer "stop" instead of a dead "start".
    useScanStore.setState({ status: "completed", combinedActive: true });
    expect(isScanActiveNow()).toBe(true);

    useScanStore.setState({ status: "cancelling", combinedActive: false });
    expect(isScanActiveNow()).toBe(true);
  });
});
