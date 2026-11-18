import { afterEach, describe, expect, it, vi } from "vitest";

import { scannerApi } from "@/lib/tauri/scanner-api";
import { flushPreferences, usePreferencesStore } from "@/stores/preferences-store";
import type { AppSettings } from "@/types";

const SAVED = {} as AppSettings;

describe("settings persistence", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("coalesces a burst of setters into a single backend write", async () => {
    vi.useFakeTimers();
    const save = vi.spyOn(scannerApi, "saveAppSettings").mockResolvedValue(SAVED);

    // The store skips persistence until settings have been loaded.
    usePreferencesStore.setState({ isLoaded: true });

    const setters = usePreferencesStore.getState();
    setters.setTheme("dark-black");
    setters.setTheme("dark-gray");
    setters.setReduceMotion(true);
    setters.setLanguage("tr");
    setters.setSort({ field: "name", direction: "asc" });
    setters.setSidebarMode("collapsed");
    setters.setCacheMeasureMode("fast");
    setters.setCloseAction("tray");
    setters.setLastScanPath("C:\\Projects");
    setters.setShortcut("toggleSidebar", "Ctrl+Shift+B");

    expect(save).not.toHaveBeenCalled();

    // Advancing past the debounce window flushes exactly one snapshot.
    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledTimes(1);

    // An explicit flush is a forced write, not a no-op, so it adds one call.
    await flushPreferences();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("reports a failed write once and keeps the queue alive", async () => {
    vi.useFakeTimers();
    const save = vi
      .spyOn(scannerApi, "saveAppSettings")
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(SAVED);

    usePreferencesStore.setState({ isLoaded: true });
    usePreferencesStore.getState().setTheme("dark-gray");

    await expect(flushPreferences()).rejects.toThrow("disk full");
    await flushPreferences();

    expect(save).toHaveBeenCalledTimes(2);
  });
});
