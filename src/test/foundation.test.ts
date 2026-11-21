import { describe, it, expect, beforeEach } from "vitest";
import { formatBytes, formatDate } from "../lib/formatters";
import { truncatePath, maskPath } from "../lib/format/path";
import { useScanStore } from "../stores/scan-store";
import { useSelectionStore } from "../stores/selection-store";
import { usePreferencesStore } from "../stores/preferences-store";
import { useUiStore } from "../stores/ui-store";
import { makeItem, makeUpdate } from "./fixtures";

describe("WP-1: Foundation & Formatting Utilities", () => {
  it("formats bytes accurately with Turkish decimal comma", () => {
    expect(formatBytes(0, "tr")).toBe("0 B");
    expect(formatBytes(1024, "tr")).toBe("1,00 KB");
    expect(formatBytes(1048576, "tr")).toBe("1,00 MB");
    expect(formatBytes(1572864, "tr")).toBe("1,50 MB");
    expect(formatBytes(1073741824 * 2.5, "tr")).toBe("2,50 GB");
    expect(formatBytes(null, "tr")).toBe("-");
  });

  it("formats dates into relative and exact values", () => {
    const now = new Date().toISOString();
    expect(formatDate(now, "tr").relative).toBe("Az önce");
    expect(formatDate(null, "tr").relative).toBe("-");
  });

  it("truncates long file paths cleanly", () => {
    const shortPath = "C:\\Projects\\my-app";
    expect(truncatePath(shortPath)).toBe(shortPath);
    const longPath =
      "C:\\Users\\developer\\Desktop\\workspaces\\deep\\nested\\projects\\frontend-web-application\\packages\\app";
    expect(truncatePath(longPath, 40)).toContain("...");
  });

  it("keeps the server and share of a UNC path when truncating", () => {
    const unc = "\\\\fileserver\\projects\\deep\\nested\\packages\\app\\node_modules";
    const truncated = truncatePath(unc, 40);
    // The old split produced `\...\node_modules`: the server is the only part
    // that identifies which machine the target lives on.
    expect(truncated.startsWith("\\\\fileserver\\projects")).toBe(true);
    expect(truncated.endsWith("node_modules")).toBe(true);
    expect(truncated).toContain("...");
  });

  it("masks the account name in a UNC home path", () => {
    expect(maskPath("\\\\fileserver\\Users\\alice\\AppData\\detergo")).toBe(
      "\\\\fileserver\\Users\\•••\\AppData\\detergo",
    );
    expect(maskPath("C:\\Users\\alice\\AppData")).toBe("C:\\Users\\•••\\AppData");
  });
});

describe("WP-1: Domain Stores Isolation", () => {
  beforeEach(() => {
    useScanStore.getState().resetScan();
    useSelectionStore.getState().clearSelection();
  });

  it("scan store manages candidates and measurements correctly", () => {
    const store = useScanStore.getState();
    store.startScanState("C:\\Projects");
    expect(useScanStore.getState().status).toBe("scanning");

    store.addItems([makeItem({ id: "entry-1" })]);
    expect(useScanStore.getState().itemIds).toHaveLength(1);
    expect(useScanStore.getState().itemsById["entry-1"].logicalBytes).toBeNull();

    store.applyMeasurements([makeUpdate("entry-1", 104857600)]);
    expect(useScanStore.getState().itemsById["entry-1"].logicalBytes).toBe(104857600);
    expect(useScanStore.getState().itemsById["entry-1"].status).toBe("ready");
  });

  it("selection store accurately toggles and tracks sets of IDs", () => {
    const selStore = useSelectionStore.getState();
    selStore.toggleSelection("item-1");
    selStore.toggleSelection("item-2");
    expect(useSelectionStore.getState().selectedIds.size).toBe(2);
    selStore.toggleSelection("item-1");
    expect(useSelectionStore.getState().selectedIds.has("item-1")).toBe(false);

    selStore.selectMany(["item-a", "item-b", "item-c"]);
    expect(useSelectionStore.getState().selectedIds.size).toBe(4);

    selStore.prune(["item-b"]);
    expect(Array.from(useSelectionStore.getState().selectedIds)).toEqual(["item-b"]);

    selStore.clearSelection();
    expect(useSelectionStore.getState().selectedIds.size).toBe(0);
  });

  it("preferences store changes themes, language and settings", () => {
    const prefStore = usePreferencesStore.getState();
    prefStore.setTheme("light-white");
    expect(usePreferencesStore.getState().theme).toBe("light-white");

    prefStore.setTheme("dark-black");
    expect(usePreferencesStore.getState().theme).toBe("dark-black");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark-black");

    prefStore.updateSettings({ maskPaths: true, scanProfile: "fast" });
    expect(usePreferencesStore.getState().maskPaths).toBe(true);
    expect(usePreferencesStore.getState().scanProfile).toBe("fast");
  });

  it("ui store manages modals, plans and toasts", () => {
    const uiStore = useUiStore.getState();
    uiStore.openModal("cleanup-plan");
    expect(useUiStore.getState().activeModal).toBe("cleanup-plan");
    uiStore.closeModal();
    expect(useUiStore.getState().activeModal).toBeNull();

    uiStore.showToast("Test Toast", "success");
    expect(useUiStore.getState().toast?.message).toBe("Test Toast");
    expect(useUiStore.getState().toast?.type).toBe("success");
  });
});
