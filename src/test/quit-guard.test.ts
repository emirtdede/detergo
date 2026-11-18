import { describe, it, expect, beforeEach, vi } from "vitest";

import { requestQuit } from "../lib/quit-guard";
import { useCleanupRunStore } from "../stores/cleanup-run-store";

function makeApi() {
  return {
    cancelCleanup: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    quitApp: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

describe("quit guard", () => {
  beforeEach(() => {
    useCleanupRunStore.getState().dismiss();
  });

  it("quits immediately when no cleanup is running", async () => {
    const api = makeApi();

    await requestQuit(api);

    expect(api.cancelCleanup).not.toHaveBeenCalled();
    expect(api.quitApp).toHaveBeenCalledTimes(1);
  });

  it("cancels the active cleanup before asking the backend to quit", async () => {
    useCleanupRunStore.getState().start("plan-1", 4, false);
    const api = makeApi();

    await requestQuit(api);

    expect(useCleanupRunStore.getState().progress?.status).toBe("cancelling");
    expect(api.cancelCleanup).toHaveBeenCalledTimes(1);
    expect(api.quitApp).toHaveBeenCalledTimes(1);
    expect(api.cancelCleanup.mock.invocationCallOrder[0]).toBeLessThan(
      api.quitApp.mock.invocationCallOrder[0],
    );
  });

  it("still quits when the cancel request fails", async () => {
    useCleanupRunStore.getState().start("plan-2", 1, true);
    const api = makeApi();
    api.cancelCleanup.mockRejectedValueOnce(new Error("backend down"));

    await requestQuit(api);

    expect(api.quitApp).toHaveBeenCalledTimes(1);
  });
});
