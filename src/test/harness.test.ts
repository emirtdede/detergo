import { describe, it, expect } from "vitest";

import { createFakeScannerApi, createInvokeMock } from "./harness";

describe("test harness", () => {
  it("routes invoke to the registered handler and records the call", async () => {
    const mock = createInvokeMock({
      get_catalog: () => ({ schemaVersion: 1, rules: [], valid: true, error: null }),
    });

    const result = await mock.invoke("get_catalog", { extra: true });

    expect(result).toEqual({ schemaVersion: 1, rules: [], valid: true, error: null });
    expect(mock.calls).toEqual([{ command: "get_catalog", args: { extra: true } }]);
  });

  it("throws for an unregistered command instead of returning undefined", async () => {
    const mock = createInvokeMock();
    await expect(mock.invoke("missing_command")).rejects.toThrow(/Unexpected Tauri command/);
  });

  it("builds a fake ScannerApi with overrides on top of the mock implementation", async () => {
    const api = createFakeScannerApi({
      getCleanupHistory: async () => [],
    });

    expect(await api.getCleanupHistory()).toEqual([]);
    await expect(api.getCatalog()).resolves.toMatchObject({ valid: true });
  });
});
