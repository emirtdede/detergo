import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  LAST_SCAN_SCHEMA_SUPPORTED,
  clearPersistedLastScan,
  flushPendingSummary,
  useScanStore,
  viewForScanScope,
} from "@/stores/scan-store";
import { useSelectionStore } from "@/stores/selection-store";
import { usePreferencesStore, SETTING_LIMITS } from "@/stores/preferences-store";
import { itemBucket } from "@/lib/classify";
import { getUIText, localizeAppError, localizeWarningCode } from "@/lib/ui-text";
import { isValidWebhookUrl, normalizeWebhookUrl } from "@/lib/validation/webhook-url";
import {
  bulkSelectableIds,
  effectiveSelectedIds,
  isEffectiveTarget,
} from "@/features/items/selection-helpers";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { notificationService } from "@/lib/notifications/notification-service";
import { checkDiskPressure, resetDiskPressureCooldown } from "@/lib/notifications/lifecycle";
import { makeItem } from "./fixtures";
import { formatBytes } from "@/lib/formatters";
import { useCleanupRunStore } from "@/stores/cleanup-run-store";
import { useUiStore } from "@/stores/ui-store";
import { isGlobalShortcutBlocked } from "@/stores/ui-store";

// jsdom does not expose a usable `localStorage` under this Node version, and
// the app's storage helpers must still be exercised. A tiny in-memory store
// makes the persistence assertions deterministic.
const storageMap = new Map<string, string>();
const storageMock: Storage = {
  get length() {
    return storageMap.size;
  },
  clear: () => storageMap.clear(),
  getItem: (key: string) => storageMap.get(key) ?? null,
  key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
  removeItem: (key: string) => {
    storageMap.delete(key);
  },
  setItem: (key: string, value: string) => {
    storageMap.set(key, value);
  },
};
Object.defineProperty(window, "localStorage", { value: storageMock, configurable: true });
Object.defineProperty(globalThis, "localStorage", { value: storageMock, configurable: true });

describe("Permanent fixes", () => {
  beforeEach(() => {
    useScanStore.getState().resetScan();
  });

  it("blocks global shortcuts while any dialog is mounted", () => {
    const store = useUiStore.getState();
    expect(isGlobalShortcutBlocked(store)).toBe(false);

    store.pushDialog();
    expect(isGlobalShortcutBlocked(useUiStore.getState())).toBe(true);
    // Nested dialogs (a confirmation inside Settings) keep the block active
    // until the last one closes.
    store.pushDialog();
    useUiStore.getState().popDialog();
    expect(isGlobalShortcutBlocked(useUiStore.getState())).toBe(true);
    useUiStore.getState().popDialog();
    expect(isGlobalShortcutBlocked(useUiStore.getState())).toBe(false);

    // An unmatched unmount must not make the counter negative.
    useUiStore.getState().popDialog();
    expect(useUiStore.getState().dialogDepth).toBe(0);

    useUiStore.getState().openModal("settings");
    expect(isGlobalShortcutBlocked(useUiStore.getState())).toBe(true);
    useUiStore.getState().closeModal();
  });

  it("classifies targets from backend metadata instead of folder names", () => {
    expect(itemBucket({ ecosystem: "javascript", category: "dependencies" })).toBe("node");
    expect(itemBucket({ ecosystem: "rust", category: "build" })).toBe("rust");
    // A Python project can contain a directory literally named `target`.
    expect(itemBucket({ ecosystem: "python", category: "build" })).toBe("python");
    expect(itemBucket({ ecosystem: "ai", category: "cache" })).toBe("agent");
    expect(itemBucket({ ecosystem: "java", category: "build" })).toBe("other");
  });

  it("localizes SCREAMING_SNAKE_CASE cleanup failure codes", () => {
    const ui = getUIText("en");
    expect(localizeAppError("RECYCLE_BIN_TOO_SMALL", ui)).toBe(ui.errors.recycleBinTooSmall);
    expect(localizeAppError("RECYCLE_FAILED", ui)).toBe(ui.errors.recycleBinFailed);
    expect(localizeAppError("IN_USE", ui)).toBe(ui.warnings.targetActive);
    expect(localizeAppError("PERMANENT_FAILED", ui)).toBe(ui.errors.permanentDeleteFailed);
  });

  it("localizes every plan block code without leaking raw identifiers", () => {
    const uiTr = getUIText("tr");
    expect(localizeWarningCode("COVERED_BY_PARENT", uiTr)).toBe(uiTr.plan.coveredByParent);
    expect(localizeWarningCode("NO_METHOD", uiTr)).toBe(uiTr.plan.noMethod);
    expect(localizeWarningCode("OFFICIAL_ACTION_REQUIRED", uiTr)).toBe(
      uiTr.plan.officialActionRequired,
    );
    expect(localizeWarningCode("MODE_NOT_ALLOWED", uiTr)).toBe(uiTr.plan.modeNotAllowed);

    // Unknown future codes must fall back to localized copy, never the code.
    const future = localizeWarningCode("SOME_FUTURE_CODE", uiTr);
    expect(future).not.toContain("SOME_FUTURE_CODE");
    expect(future).toBe(uiTr.warnings.other("SOME_FUTURE_CODE"));
  });

  it("keeps machine-readable error detail without leaking English prose", () => {
    const ui = getUIText("en");
    expect(
      localizeAppError({ code: "Unknown", message: "OS error 5 while reading C:\\Windows" }, ui),
    ).toContain("OS error 5");
    expect(localizeAppError({ code: "Unknown", message: "Some internal prose" }, ui)).toBe(
      ui.errors.unknown,
    );
  });

  it("resets the scan-warning notice dismissal on a new scan", () => {
    useScanStore.getState().dismissNoticesBanner();
    expect(useScanStore.getState().noticesBannerDismissed).toBe(true);
    useScanStore.getState().startScanState("C:\\Projects");
    expect(useScanStore.getState().noticesBannerDismissed).toBe(false);
  });

  it("keeps a partial restored scan distinct from a user cancel", () => {
    const baseSummary = {
      scanId: "partial-1",
      rootPath: "C:\\Projects",
      scope: "project" as const,
      totalEntries: 1,
      totalBytes: 1000,
      totalAllocatedBytes: 1000,
      protectedBytes: 0,
      cleanableBytes: 1000,
      durationMs: 50,
      errorsCount: 0,
      warningsCount: 0,
      directoriesVisited: 1,
      providerTotals: [],
    };

    useScanStore.getState().restoreScan({
      schemaVersion: LAST_SCAN_SCHEMA_SUPPORTED,
      savedAt: "2026-11-12T00:00:00Z",
      summary: { ...baseSummary, partial: true, stopReason: "timeout" },
      items: [makeItem({ id: "partial-item", estimatedReclaimBytes: 1000 })],
    });
    expect(useScanStore.getState().status).toBe("partial");

    useScanStore.getState().restoreScan({
      schemaVersion: LAST_SCAN_SCHEMA_SUPPORTED,
      savedAt: "2026-11-12T00:00:00Z",
      summary: { ...baseSummary, partial: true, stopReason: "cancelled" },
      items: [],
    });
    expect(useScanStore.getState().status).toBe("cancelled");
  });

  it("round-trips scan warnings through the snapshot", () => {
    useScanStore.getState().restoreScan({
      schemaVersion: LAST_SCAN_SCHEMA_SUPPORTED,
      savedAt: "2026-11-12T00:00:00Z",
      summary: {
        scanId: "warn-1",
        rootPath: "C:\\Projects",
        scope: "project",
        totalEntries: 0,
        totalBytes: 0,
        totalAllocatedBytes: 0,
        protectedBytes: 0,
        cleanableBytes: 0,
        durationMs: 10,
        errorsCount: 0,
        warningsCount: 1,
        directoriesVisited: 1,
        partial: false,
        providerTotals: [],
      },
      items: [],
      warnings: [{ code: "ACCESS_DENIED", path: "C:\\Windows" }],
    });
    expect(useScanStore.getState().warnings).toEqual([
      { code: "ACCESS_DENIED", path: "C:\\Windows" },
    ]);
  });

  it("routes a partial summary to the partial state even via completeScan", () => {
    const summary = {
      scanId: "partial-complete",
      rootPath: "C:\\Projects",
      scope: "project" as const,
      totalEntries: 1,
      totalBytes: 1000,
      totalAllocatedBytes: 1000,
      protectedBytes: 0,
      cleanableBytes: 1000,
      durationMs: 50,
      errorsCount: 0,
      warningsCount: 0,
      directoriesVisited: 1,
      partial: true,
      stopReason: "timeout",
      providerTotals: [],
    };

    useScanStore.getState().completeScan(summary);
    expect(useScanStore.getState().status).toBe("partial");

    useScanStore.getState().completeScan({ ...summary, partial: false, stopReason: undefined });
    expect(useScanStore.getState().status).toBe("completed");
  });

  it("merges only provider slices and keeps pending unrelated edits", () => {
    const preferences = usePreferencesStore.getState();
    preferences.updateSettings({ maskPaths: true });

    usePreferencesStore.getState().applyProviderSettings({
      customAgentProviders: [{ id: "tool-1", name: "Tool", rootPaths: ["D:\\tool"] }],
      hiddenBuiltinProviders: ["codex"],
    });

    const next = usePreferencesStore.getState();
    // The unrelated dirty value must survive the provider mutation response.
    expect(next.maskPaths).toBe(true);
    expect(next.customAgentProviders).toHaveLength(1);
    expect(next.hiddenBuiltinProviders).toEqual(["codex"]);

    // Fields absent from the response are left untouched rather than cleared.
    usePreferencesStore.getState().applyProviderSettings({});
    expect(usePreferencesStore.getState().customAgentProviders).toHaveLength(1);
    expect(usePreferencesStore.getState().hiddenBuiltinProviders).toEqual(["codex"]);
  });

  it("keeps the previous summary when a cancel arrives without one", () => {
    const summary = {
      scanId: "s-1",
      rootPath: "C:\\Projects",
      scope: "project" as const,
      totalEntries: 1,
      totalBytes: 100,
      totalAllocatedBytes: 100,
      protectedBytes: 0,
      cleanableBytes: 100,
      durationMs: 5,
      errorsCount: 0,
      warningsCount: 0,
      directoriesVisited: 1,
      partial: false,
      providerTotals: [],
    };
    useScanStore.getState().completeScan(summary);
    useScanStore.getState().cancelScanState();
    expect(useScanStore.getState().summary?.scanId).toBe("s-1");
    expect(useScanStore.getState().status).toBe("cancelled");
  });

  it("prunes selections whose target was removed", () => {
    const scan = useScanStore.getState();
    scan.addItems([makeItem({ id: "keep-me", logicalBytes: 10 })]);
    useSelectionStore.getState().selectMany(["keep-me"]);
    expect(useSelectionStore.getState().selectedIds.has("keep-me")).toBe(true);

    scan.removeItems(["keep-me"]);
    expect(useSelectionStore.getState().selectedIds.size).toBe(0);
  });

  it("excludes unmeasured rows from bulk selection", () => {
    const measured = makeItem({ id: "measured", logicalBytes: 10 });
    const unmeasured = makeItem({ id: "unmeasured", logicalBytes: null });
    expect(bulkSelectableIds([measured, unmeasured])).toEqual(["measured"]);
  });

  it("validates webhook URLs before they reach settings", () => {
    expect(normalizeWebhookUrl("https://example.com/hook").ok).toBe(true);
    expect(normalizeWebhookUrl("  ").ok).toBe(true);
    expect(isValidWebhookUrl("https://")).toBe(false);
    expect(isValidWebhookUrl("ftp://example.com")).toBe(false);
    expect(isValidWebhookUrl("not a url")).toBe(false);
  });

  it("rejects loopback and private webhook literals in the settings form", () => {
    // Mirrors the backend SSRF policy: the request is made by the process, so
    // localhost/LAN targets must never be saved as a webhook.
    for (const url of [
      "http://localhost:8080/hook",
      "http://api.localhost/hook",
      "http://printer.local/hook",
      "http://127.0.0.1/hook",
      "http://127.1/hook",
      "http://10.0.0.5/hook",
      "http://172.16.0.1/hook",
      "http://192.168.1.10/hook",
      "http://169.254.169.254/latest/meta-data",
      "http://100.64.0.1/hook",
      "http://[::1]/hook",
      "http://[fc00::1]/hook",
      "http://[fe80::1]/hook",
      "http://[::ffff:127.0.0.1]/hook",
    ]) {
      expect(isValidWebhookUrl(url), `${url} must be rejected`).toBe(false);
    }
    expect(isValidWebhookUrl("http://1.1.1.1/hook")).toBe(true);
    expect(isValidWebhookUrl("http://[2606:4700:4700::1111]/hook")).toBe(true);
    expect(isValidWebhookUrl("https://example.com/hook")).toBe(true);
  });

  it("normalizes persisted settings instead of trusting the file", () => {
    usePreferencesStore.getState().loadPreferences({
      notifications: {
        scanComplete: "bogus",
        cleanComplete: "desktop",
      } as never,
      webhookUrl: "javascript:alert(1)",
      webhookOnScan: "yes" as never,
      shortcuts: { toggleSidebar: 42 } as never,
    });

    const state = usePreferencesStore.getState();
    expect(state.notifications?.scanComplete).toBe("both");
    expect(state.notifications?.cleanComplete).toBe("desktop");
    expect(state.webhookUrl).toBeNull();
    expect(state.webhookOnScan).toBe(true);
    expect(typeof state.shortcuts?.toggleSidebar).toBe("string");
  });

  it("clamps numeric settings to the same limits as the backend", () => {
    usePreferencesStore.getState().loadPreferences({
      maxDepth: 0,
      maxCandidates: 999_999_999,
      timeoutMinutes: 0,
      minSizeBytes: 64 * 1024 * 1024 * 1024,
    });

    const state = usePreferencesStore.getState();
    expect(state.maxDepth).toBe(SETTING_LIMITS.maxDepth.min);
    expect(state.maxCandidates).toBe(SETTING_LIMITS.maxCandidates.max);
    expect(state.timeoutMinutes).toBe(SETTING_LIMITS.timeoutMinutes.min);
    expect(state.minSizeBytes).toBe(SETTING_LIMITS.minSizeBytes.max);
    // The UI's min-size field is expressed in MB and must match the backend cap.
    expect(SETTING_LIMITS.minSizeBytes.max / (1024 * 1024)).toBe(1024);
  });

  it("uses one effective-target predicate for counters and bulk actions", () => {
    const measured = makeItem({ id: "measured", logicalBytes: 10 });
    const unmeasured = makeItem({ id: "unmeasured", logicalBytes: null });
    const protectedItem = makeItem({ id: "protected", logicalBytes: 10, protected: true });
    const kept = makeItem({ id: "kept", logicalBytes: 10, safetyClass: "keep" });

    expect(isEffectiveTarget(measured)).toBe(true);
    expect(isEffectiveTarget(unmeasured)).toBe(false);
    expect(isEffectiveTarget(protectedItem)).toBe(false);
    expect(isEffectiveTarget(kept)).toBe(false);

    const itemsById = {
      measured,
      unmeasured,
      protected: protectedItem,
      kept,
    };
    expect(
      effectiveSelectedIds(["measured", "unmeasured", "protected", "kept"], itemsById),
    ).toEqual(["measured"]);
    expect(bulkSelectableIds(Object.values(itemsById))).toEqual(["measured"]);
  });

  it("recomputes summary totals after a cleanup marks rows deleted", () => {
    const summary = {
      scanId: "sum-1",
      rootPath: "C:\\Projects",
      scope: "project" as const,
      totalEntries: 2,
      totalBytes: 3000,
      totalAllocatedBytes: 3000,
      protectedBytes: 0,
      cleanableBytes: 3000,
      durationMs: 5,
      errorsCount: 0,
      warningsCount: 0,
      directoriesVisited: 1,
      partial: false,
      providerTotals: [],
    };
    const a = makeItem({
      id: "a",
      logicalBytes: 1000,
      allocatedBytes: 1000,
      estimatedReclaimBytes: 1000,
    });
    const b = makeItem({
      id: "b",
      logicalBytes: 2000,
      allocatedBytes: 2000,
      estimatedReclaimBytes: 2000,
    });

    useScanStore.getState().addItems([a, b]);
    useScanStore.getState().completeScan(summary);

    useScanStore.getState().markDeleted(["a"]);
    flushPendingSummary();
    let state = useScanStore.getState().summary!;
    expect(state.totalEntries).toBe(1);
    expect(state.totalBytes).toBe(2000);
    expect(state.cleanableBytes).toBe(2000);
    expect(state.providerTotals).toEqual([
      {
        provider: "project",
        logicalBytes: 2000,
        allocatedBytes: 2000,
        itemCount: 1,
        protectedBytes: 0,
      },
    ]);

    useScanStore.getState().removeItems(["b"]);
    flushPendingSummary();
    state = useScanStore.getState().summary!;
    expect(state.totalEntries).toBe(0);
    expect(state.totalBytes).toBe(0);
    expect(state.providerTotals).toEqual([]);
  });

  it("restores only valid snapshots and reports the outcome", () => {
    const summary = {
      scanId: "restore-1",
      rootPath: "C:\\Projects",
      scope: "agents" as const,
      totalEntries: 1,
      totalBytes: 10,
      totalAllocatedBytes: 10,
      protectedBytes: 0,
      cleanableBytes: 10,
      durationMs: 5,
      errorsCount: 0,
      warningsCount: 0,
      directoriesVisited: 1,
      partial: false,
      providerTotals: [],
    };

    expect(
      useScanStore.getState().restoreScan({
        schemaVersion: LAST_SCAN_SCHEMA_SUPPORTED + 1,
        savedAt: "2026-11-12T00:00:00Z",
        summary,
        items: [],
      }),
    ).toBe(false);
    expect(useScanStore.getState().summary).not.toEqual(summary);

    expect(
      useScanStore.getState().restoreScan({
        schemaVersion: LAST_SCAN_SCHEMA_SUPPORTED,
        savedAt: "2026-11-12T00:00:00Z",
        summary,
        items: [makeItem({ id: "agent-item", provider: "agents" })],
      }),
    ).toBe(true);
    expect(useScanStore.getState().summary).toEqual(summary);
    // Restored agent results must open the Agents view, not Projects.
    expect(viewForScanScope(summary.scope)).toBe("agents");
    expect(viewForScanScope("project")).toBe("projects");
    expect(viewForScanScope("allDrives")).toBe("projects");
  });

  it("clears the previous-scan comparison on reset", () => {
    const summary = {
      scanId: "prev-1",
      rootPath: "C:\\Projects",
      scope: "project" as const,
      totalEntries: 1,
      totalBytes: 10,
      totalAllocatedBytes: 10,
      protectedBytes: 0,
      cleanableBytes: 10,
      durationMs: 5,
      errorsCount: 0,
      warningsCount: 0,
      directoriesVisited: 1,
      partial: false,
      stopReason: null,
      providerTotals: [],
    };
    const store = useScanStore.getState();
    store.startScanState("C:\\Projects");
    store.addItems([makeItem({ id: "prev-item", estimatedReclaimBytes: 10 })]);
    store.completeScan(summary);
    store.startScanState("C:\\Projects");
    expect(useScanStore.getState().previousItemCount).toBe(1);

    useScanStore.getState().resetScan();
    // M4: the comparison described the discarded scan; it must not survive.
    expect(useScanStore.getState().previousSummary).toBeNull();
    expect(useScanStore.getState().previousCleanableBytes).toBe(0);
    expect(useScanStore.getState().previousItemCount).toBe(0);
  });

  it("keeps unreadable measurements null instead of zero", () => {
    const store = useScanStore.getState();
    store.startScanState("C:\\Projects");
    store.addItems([
      makeItem({ id: "unreadable", logicalBytes: null, estimatedReclaimBytes: null }),
    ]);
    store.applyMeasurements([
      {
        id: "unreadable",
        logicalBytes: 0,
        allocatedBytes: 0,
        estimatedReclaimBytes: 0,
        fileCount: 0,
        hardlinkDedupBytes: 0,
        status: "error",
      },
    ]);
    const item = useScanStore.getState().itemsById["unreadable"];
    // M7: an unreadable target is not an empty folder.
    expect(item.logicalBytes).toBeNull();
    expect(item.estimatedReclaimBytes).toBeNull();
    expect(item.status).toBe("error");
  });

  it("bumps the persisted revision when the snapshot is cleared", () => {
    const before = useScanStore.getState().persistedRevision;
    clearPersistedLastScan();
    // L2: the overview watches this to disable restore immediately.
    expect(useScanStore.getState().persistedRevision).toBe(before + 1);
  });

  it("persists the disk-pressure cooldown across sessions", async () => {
    const key = "detergo.disk-pressure-cooldown.v1";
    const legacyKey = "node-cleaner.disk-pressure-cooldown.v1";
    const storage = window.localStorage;
    storage.removeItem(key);
    storage.removeItem(legacyKey);
    resetDiskPressureCooldown();
    const pressure = vi
      .spyOn(scannerApi, "getDiskPressure")
      .mockResolvedValue([
        { drive: "C:", freeBytes: 1024, totalBytes: 1024 * 1024, percentUsed: 99 },
      ]);
    const notify = vi.spyOn(notificationService, "notifyDiskPressure").mockImplementation(() => {});

    try {
      await checkDiskPressure();
      expect(notify).toHaveBeenCalledTimes(1);
      const stored = storage.getItem(key);
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toHaveProperty("C:");

      // A second check inside the cooldown window must stay silent.
      await checkDiskPressure();
      expect(notify).toHaveBeenCalledTimes(1);
    } finally {
      resetDiskPressureCooldown();
      pressure.mockRestore();
      notify.mockRestore();
    }
    expect(storage.getItem(key)).toBeNull();
  });

  it("migrates the disk-pressure cooldown written under the retired product name", async () => {
    const key = "detergo.disk-pressure-cooldown.v1";
    const legacyKey = "node-cleaner.disk-pressure-cooldown.v1";
    const storage = window.localStorage;
    resetDiskPressureCooldown();
    storage.setItem(legacyKey, JSON.stringify({ "C:": Date.now() }));

    vi.spyOn(scannerApi, "getDiskPressure").mockResolvedValue([
      { drive: "C:", freeBytes: 1024, totalBytes: 1024 * 1024, percentUsed: 99 },
    ]);

    try {
      await checkDiskPressure();
      // The legacy entry suppresses the duplicate alert and is rewritten under
      // the shipped product name.
      expect(storage.getItem(key)).not.toBeNull();
      expect(storage.getItem(legacyKey)).toBeNull();
    } finally {
      resetDiskPressureCooldown();
      vi.restoreAllMocks();
    }
  });

  it("formats non-finite and negative byte counts without NaN", () => {
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("-");
    expect(formatBytes(Number.NaN)).toBe("-");
    expect(formatBytes(-1024)).toBe("−1.00 KB");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.00 KB");
  });

  it("promotes to the next unit when rounding reaches 1024", () => {
    // 1 MiB - 1 used to render as "1,024.0 KB", which is not a valid size.
    expect(formatBytes(1_048_575)).toBe("1.00 MB");
    // 1 GiB - 1 used to render as "1,024.0 MB".
    expect(formatBytes(1_073_741_823)).toBe("1.00 GB");
    expect(formatBytes(-1_048_575)).toBe("−1.00 MB");
    // The largest unit has nowhere to go and must not print "1024 PB".
    expect(formatBytes(Number.MAX_VALUE)).toContain("PB");
  });

  it("queues a routine toast behind an error instead of overwriting it", () => {
    const ui = useUiStore.getState();
    ui.clearToast();
    ui.showToast("first", "success", 10_000);
    ui.showToast("failure", "error", 10_000);
    expect(useUiStore.getState().toast?.message).toBe("failure");
    // The success message is still pending and is shown after the error.
    ui.showToast("later", "info", 10_000);
    expect(useUiStore.getState().toast?.message).toBe("failure");
    ui.clearToast();
    expect(useUiStore.getState().toast).toBeNull();
  });

  it("clears the previous cleanup report when a new run starts", () => {
    const store = useCleanupRunStore.getState();
    store.finish({
      planId: "old",
      mode: "recycleBin",
      successCount: 1,
      errorCount: 0,
      reclaimBytes: 0,
      movedBytes: 100,
      processedCount: 1,
      skippedCount: 0,
      cancelled: false,
      durationMs: 1,
      results: [],
      startedAt: "",
      finishedAt: "",
    } as never);
    expect(useCleanupRunStore.getState().lastReport).not.toBeNull();
    store.start("new", 5, true);
    expect(useCleanupRunStore.getState().lastReport).toBeNull();
    expect(useCleanupRunStore.getState().progress?.planId).toBe("new");
    store.dismiss();
  });
});
