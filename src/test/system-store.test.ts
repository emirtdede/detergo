import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  SystemActionId,
  SystemActionInfo,
  SystemAutomationConfig,
  SystemCleanReport,
  SystemEvent,
  SystemScanReport,
} from "@/types";

const systemScan = vi.fn<() => Promise<SystemScanReport>>();
const systemPreview = vi.fn();
const systemExecute = vi.fn();
const systemCancel = vi.fn();
const systemRestartElevated = vi.fn();
const getSystemAutomation = vi.fn<() => Promise<SystemAutomationConfig>>();
const setSystemAutomation = vi.fn();
const removeSystemAutomation = vi.fn();

vi.mock("@/lib/tauri/scanner-api", () => ({
  scannerApi: {
    systemScan: () => systemScan(),
    systemPreview: (...args: unknown[]) => systemPreview(...args),
    systemExecute: (...args: unknown[]) => systemExecute(...args),
    systemCancel: () => systemCancel(),
    systemRestartElevated: () => systemRestartElevated(),
    getSystemAutomation: () => getSystemAutomation(),
    setSystemAutomation: (...args: unknown[]) => setSystemAutomation(...args),
    removeSystemAutomation: () => removeSystemAutomation(),
  },
}));

import { useSystemStore } from "@/stores/system-store";

function action(id: SystemActionId, overrides: Partial<SystemActionInfo> = {}): SystemActionInfo {
  return {
    id,
    safety: "safe",
    requiresAdmin: false,
    available: true,
    reason: null,
    path: null,
    bytes: 100,
    fileCount: 1,
    measured: true,
    ...overrides,
  };
}

function report(elevated = false): SystemScanReport {
  return {
    elevated,
    actions: [
      action("userTemp", { bytes: 500 }),
      action("windowsTemp", { requiresAdmin: true, reason: "needsAdmin" }),
      action("recycleBin", { safety: "review", bytes: 250 }),
    ],
    totalBytes: 750,
    disk: null,
    scannedAt: "2026-11-19T10:00:00Z",
    warnings: [],
  };
}

function automation(): SystemAutomationConfig {
  return {
    enabled: false,
    frequency: "weekly",
    time: "12:00",
    weekday: 0,
    profile: "quick",
    installed: false,
    lastRun: null,
    lastFreedBytes: null,
  };
}

const cleanReport: SystemCleanReport = {
  results: [],
  freedBytes: 0,
  cancelled: false,
  startedAt: "2026-11-19T10:00:00Z",
  finishedAt: "2026-11-19T10:00:01Z",
  elevated: false,
};

describe("system cleanup store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    systemScan.mockResolvedValue(report());
    useSystemStore.setState({
      report: null,
      automation: null,
      loading: false,
      running: false,
      previewing: false,
      current: null,
      error: null,
      lastReport: null,
      selected: [],
    });
  });

  it("keeps a selection that is still selectable after a rescan", async () => {
    useSystemStore.setState({ selected: ["userTemp", "windowsTemp", "recycleBin"] });
    systemScan.mockResolvedValue(report(false));

    await useSystemStore.getState().load();

    // windowsTemp needs elevation in this run, so it is dropped; the other two
    // remain selected instead of clearing the whole list.
    expect(useSystemStore.getState().selected).toEqual(["userTemp", "recycleBin"]);
  });

  it("allows an admin action once the scan reports elevation", async () => {
    systemScan.mockResolvedValue(report(true));
    await useSystemStore.getState().load();
    useSystemStore.getState().selectAll();
    expect(useSystemStore.getState().selected).toEqual(["userTemp", "windowsTemp", "recycleBin"]);
  });

  it("runs the preview token and forwards progress events", async () => {
    systemPreview.mockResolvedValue({
      token: "sys-token",
      actions: [action("userTemp")],
      totalBytes: 500,
      expiresMs: 300_000,
      requiresAdmin: false,
      elevated: false,
    });
    let emit: ((event: SystemEvent) => void) | null = null;
    const seen: SystemEvent[] = [];
    systemExecute.mockImplementation(
      async (_token: string, onEvent: (event: SystemEvent) => void) => {
        emit = onEvent;
        onEvent({ type: "started", total: 1 });
        onEvent({ type: "actionStarted", id: "userTemp", index: 0, total: 1 });
        seen.push({ type: "started", total: 1 });
        return cleanReport;
      },
    );

    await useSystemStore.getState().run(["userTemp"]);

    expect(systemPreview).toHaveBeenCalledWith(["userTemp"]);
    expect(systemExecute).toHaveBeenCalledWith("sys-token", expect.any(Function));
    expect(useSystemStore.getState().lastReport).toEqual(cleanReport);
    expect(useSystemStore.getState().running).toBe(false);
    expect(emit).toBeTypeOf("function");
    expect(seen).toHaveLength(1);
  });

  it("does not preview an empty selection", async () => {
    await useSystemStore.getState().run([]);
    expect(systemPreview).not.toHaveBeenCalled();
  });

  it("records a preview failure as a localizable error", async () => {
    systemPreview.mockRejectedValue({ code: "Blocked", message: "needs admin" });
    await useSystemStore.getState().run(["windowsTemp"]);
    expect(useSystemStore.getState().error).toEqual({
      code: "Blocked",
      message: "needs admin",
    });
    expect(systemExecute).not.toHaveBeenCalled();
  });

  it("returns false and keeps the last known schedule when saving fails", async () => {
    getSystemAutomation.mockResolvedValue(automation());
    setSystemAutomation.mockRejectedValue({ code: "Blocked", message: "no task" });

    const ok = await useSystemStore.getState().saveAutomation({
      ...automation(),
      enabled: true,
    });

    expect(ok).toBe(false);
    expect(useSystemStore.getState().automation).toEqual(automation());
    expect(useSystemStore.getState().error?.code).toBe("Blocked");
  });

  it("drops a stale in-flight load response if a cleanup run starts before load finishes", async () => {
    let resolveScan: ((value: SystemScanReport) => void) | null = null;
    systemScan.mockImplementationOnce(
      () =>
        new Promise<SystemScanReport>((resolve) => {
          resolveScan = resolve;
        }),
    );

    const loadPromise = useSystemStore.getState().load();
    expect(useSystemStore.getState().loading).toBe(true);

    // User starts a run while the background load is still in flight.
    let resolvePreview: ((value: unknown) => void) | null = null;
    systemPreview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
    );
    useSystemStore.setState({ selected: ["userTemp", "windowsTemp"] });
    const runPromise = useSystemStore.getState().run(["userTemp"]);

    // The stale non-elevated scan lands while run() is previewing; it must not
    // overwrite selected or report.
    resolveScan!(report(false));
    await loadPromise;
    expect(useSystemStore.getState().selected).toEqual(["userTemp", "windowsTemp"]);

    systemScan.mockResolvedValueOnce(report(true));
    systemExecute.mockResolvedValueOnce(cleanReport);
    resolvePreview!({
      token: "sys-token-2",
      actions: [action("userTemp")],
      totalBytes: 500,
      expiresMs: 300_000,
      requiresAdmin: false,
      elevated: true,
    });
    await runPromise;
  });
});
