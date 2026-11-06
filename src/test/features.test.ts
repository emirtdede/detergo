import { describe, it, expect, beforeEach } from "vitest";
import { useScanStore } from "../stores/scan-store";
import { useSelectionStore } from "../stores/selection-store";
import { usePreferencesStore } from "../stores/preferences-store";
import { useUiStore } from "../stores/ui-store";
import { useCacheStore } from "../stores/cache-store";
import { useAppStore } from "../stores/app-store";
import { isStaleScanBannerVisible } from "../features/shell/StaleScanBanner";
import { bulkSelectableIds } from "../features/items/selection-helpers";
import { makeItem, makeUpdate } from "./fixtures";

describe("WP-3..6: Feature & workflow unit tests", () => {
  beforeEach(() => {
    useScanStore.getState().resetScan();
    useSelectionStore.getState().clearSelection();
    useUiStore.getState().closeModal();
    useUiStore.getState().setSearchQuery("");
  });

  it("adds candidate items and applies measurements in batch", () => {
    const scanStore = useScanStore.getState();
    scanStore.startScanState("scan-123", "C:\\Users\\emir\\Projects");

    scanStore.addItems([
      makeItem({ id: "nm-1", displayName: "node_modules" }),
      makeItem({ id: "nm-2", displayName: ".next", safetyClass: "regenerate" }),
      makeItem({ id: "nm-3", displayPath: "C:\\Projects\\app\\dist", displayName: "dist" }),
    ]);

    expect(useScanStore.getState().itemIds).toHaveLength(3);

    scanStore.applyMeasurements([
      makeUpdate("nm-1", 104857600),
      makeUpdate("nm-2", 524288000),
      makeUpdate("nm-3", 1073741824),
    ]);

    const state = useScanStore.getState();
    expect(state.itemsById["nm-1"].logicalBytes).toBe(104857600);
    expect(state.itemsById["nm-3"].estimatedReclaimBytes).toBe(1073741824);
    expect(state.itemsById["nm-3"].status).toBe("ready");
  });

  it("buffers measurements that arrive before their item", () => {
    const scanStore = useScanStore.getState();
    scanStore.startScanState("scan-ooo", "C:\\Projects");

    scanStore.applyMeasurements([makeUpdate("late", 734003200)]);
    expect(useScanStore.getState().pendingMeasurements["late"].estimatedReclaimBytes).toBe(734003200);
    expect(useScanStore.getState().itemsById["late"]).toBeUndefined();

    scanStore.addItems([makeItem({ id: "late" })]);
    expect(useScanStore.getState().itemsById["late"].logicalBytes).toBe(734003200);
    expect(useScanStore.getState().itemsById["late"].status).toBe("ready");
    expect(useScanStore.getState().pendingMeasurements["late"]).toBeUndefined();
  });

  it("bulk selection covers manually selectable rows, not only auto-selectable ones", () => {
    const items = [
      makeItem({
        id: "provider",
        autoSelectable: false,
        selectable: true,
        protected: false,
      }),
      makeItem({
        id: "keep",
        autoSelectable: false,
        selectable: false,
        protected: true,
      }),
      makeItem({ id: "safe", autoSelectable: true, selectable: true }),
    ];

    // Filtering to provider targets leaves autoSelectable empty; the bulk
    // action must still select the visible selectable row.
    const filteredProviderRows = items.filter((item) => item.id === "provider");
    expect(bulkSelectableIds(filteredProviderRows)).toEqual(["provider"]);
    expect(bulkSelectableIds(items)).toEqual(["provider", "safe"]);
  });

  it("keeps blocked items visible but non-selectable", () => {
    useScanStore.getState().addItems([
      makeItem({
        id: "brain",
        displayName: "brain",
        safetyClass: "keep",
        protected: true,
        selectable: false,
        autoSelectable: false,
      }),
      makeItem({ id: "cache", displayName: "image-cache", safetyClass: "safe", autoSelectable: true }),
    ]);

    const items = useScanStore.getState().itemsById;
    expect(items["brain"].selectable).toBe(false);
    expect(items["cache"].autoSelectable).toBe(true);
  });

  it("handles deletion transitions and store cleanup", () => {
    const scanStore = useScanStore.getState();
    scanStore.startScanState("scan-del", "C:\\Projects");
    scanStore.addItems([makeItem({ id: "del-1" })]);

    scanStore.markDeleted(["del-1"]);
    expect(useScanStore.getState().itemsById["del-1"].status).toBe("deleted");

    scanStore.removeItems(["del-1"]);
    expect(useScanStore.getState().itemIds).not.toContain("del-1");
    expect(useScanStore.getState().itemsById["del-1"]).toBeUndefined();
  });

  it("supports adding and removing favorites with custom labels", () => {
    const prefStore = usePreferencesStore.getState();
    const fav = prefStore.addFavorite("C:\\Work\\MyProject", "My Custom Project");
    expect(fav.label).toBe("My Custom Project");

    prefStore.renameFavorite(fav.id, "Renamed Project");
    expect(usePreferencesStore.getState().favorites.find((f) => f.id === fav.id)?.label).toBe(
      "Renamed Project"
    );

    prefStore.removeFavorite(fav.id);
    expect(usePreferencesStore.getState().favorites.some((f) => f.id === fav.id)).toBe(false);
  });

  it("supports switching all verified colour themes", () => {
    const prefStore = usePreferencesStore.getState();
    const verifiedThemes = [
      "dark-black",
      "dark-gray",
      "dark-blue",
      "dark-purple",
      "dark-green",
      "dark-red",
      "dark-orange",
      "dark-yellow",
      "light-white",
      "light-gray",
      "light-blue",
      "light-purple",
      "light-green",
      "light-red",
      "light-orange",
      "light-yellow",
    ] as const;

    for (const theme of verifiedThemes) {
      prefStore.setTheme(theme);
      expect(usePreferencesStore.getState().theme).toBe(theme);
    }
  });

  it("normalizes every legacy theme id onto a verified theme", () => {
    const prefStore = usePreferencesStore.getState();
    prefStore.loadPreferences({ theme: "black" });
    expect(usePreferencesStore.getState().theme).toBe("dark-black");
    prefStore.loadPreferences({ theme: "white" });
    expect(usePreferencesStore.getState().theme).toBe("light-white");
    prefStore.loadPreferences({ theme: "transparent" });
    expect(usePreferencesStore.getState().theme).toBe("dark-black");
    prefStore.loadPreferences({ theme: "dark-blue" });
    expect(usePreferencesStore.getState().theme).toBe("dark-blue");
    prefStore.loadPreferences({ theme: "light-yellow" });
    expect(usePreferencesStore.getState().theme).toBe("light-yellow");
    prefStore.loadPreferences({ theme: "not-a-theme" });
    expect(usePreferencesStore.getState().theme).toBe("dark-black");
  });

  it("remembers the window close choice and falls back to asking", () => {
    const prefStore = usePreferencesStore.getState();

    // Settings written before the field existed must keep the guard dialog.
    prefStore.loadPreferences({});
    expect(usePreferencesStore.getState().closeAction).toBe("ask");

    prefStore.loadPreferences({ closeAction: "tray" });
    expect(usePreferencesStore.getState().closeAction).toBe("tray");

    prefStore.loadPreferences({ closeAction: "quit" });
    expect(usePreferencesStore.getState().closeAction).toBe("quit");

    // A change made from Settings reaches the same field without a reload.
    usePreferencesStore.getState().updateSettings({ closeAction: "tray" });
    expect(usePreferencesStore.getState().closeAction).toBe("tray");

    // An unknown value from a hand-edited file must not disable the guard.
    prefStore.loadPreferences({ closeAction: "explode" as never });
    expect(usePreferencesStore.getState().closeAction).toBe("ask");  });

  it("stores cleanup plans and reports for the dialogs", () => {
    const ui = useUiStore.getState();
    ui.setPendingDeletion(["a", "b"], "permanent");
    expect(useUiStore.getState().pendingDeletionIds).toEqual(["a", "b"]);
    expect(useUiStore.getState().pendingMode).toBe("permanent");
  });

  it("respects protected paths in settings", () => {
    usePreferencesStore.getState().updateSettings({
      protectedPaths: ["C:\\Work\\important"],
    });
    expect(usePreferencesStore.getState().protectedPaths).toEqual(["C:\\Work\\important"]);
  });

  it("keeps cache measurement progress outside the caches view", () => {
    const cache = useCacheStore.getState();
    useCacheStore.setState({
      providers: [
        {
          id: "npm",
          name: "npm",
          detected: true,
          cachePaths: [{ path: "C:\\npm-cache", exists: true, bytes: 0 }],
          totalBytes: 0,
          actions: [],
          readOnly: false,
          measured: false,
        },
      ],
      measureDone: 0,
      measureTotal: 0,
    });

    cache.applyMeasureEvent({ type: "started", providerCount: 1 });

    // Leaving the Tool Caches page unmounts the view but must not lose the
    // running run: events still land in the global store.
    cache.applyMeasureEvent({
      type: "pathMeasured",
      providerId: "npm",
      path: "C:\\npm-cache",
      exists: true,
      bytes: 4096,
    });
    cache.applyMeasureEvent({ type: "providerFinished", providerId: "npm", totalBytes: 4096 });

    const state = useCacheStore.getState();
    expect(state.measureDone).toBe(1);
    expect(state.providers[0].measured).toBe(true);
    expect(state.providers[0].totalBytes).toBe(4096);
    expect(state.providers[0].cachePaths[0].bytes).toBe(4096);
  });

  it("activates docs view in app state and supports navigation", () => {
    const appStore = useAppStore.getState();
    appStore.setView("docs");
    expect(useAppStore.getState().view).toBe("docs");

    appStore.setView("overview");
    expect(useAppStore.getState().view).toBe("overview");
  });

  it("shows stale scan banner strictly on scannable views (projects and agents), not on other views", () => {
    // When restored is false or dismissed is true, never visible
    expect(isStaleScanBannerVisible("projects", false, false)).toBe(false);
    expect(isStaleScanBannerVisible("projects", true, true)).toBe(false);
    expect(isStaleScanBannerVisible("agents", false, false)).toBe(false);

    // When restored is true and not dismissed:
    // Only 'projects' and 'agents' (the views where scanning can be initiated) are allowed
    expect(isStaleScanBannerVisible("projects", true, false)).toBe(true);
    expect(isStaleScanBannerVisible("agents", true, false)).toBe(true);

    // Global top bar scan button is excluded, so other views must NEVER show the banner
    expect(isStaleScanBannerVisible("overview", true, false)).toBe(false);
    expect(isStaleScanBannerVisible("caches", true, false)).toBe(false);
    expect(isStaleScanBannerVisible("docs", true, false)).toBe(false);
    expect(isStaleScanBannerVisible("history", true, false)).toBe(false);
    expect(isStaleScanBannerVisible("settings", true, false)).toBe(false);
    expect(isStaleScanBannerVisible("about", true, false)).toBe(false);
  });

  it("resets interface scan data and restores snapshot correctly", () => {
    const scanStore = useScanStore.getState();
    const selStore = useSelectionStore.getState();

    // Populate data
    scanStore.startScanState("scan-test", "C:\\Projects");
    scanStore.addItems([makeItem({ id: "item-1" })]);
    selStore.toggleSelection("item-1");
    expect(useScanStore.getState().itemIds).toHaveLength(1);
    expect(useSelectionStore.getState().selectedIds.has("item-1")).toBe(true);

    // Reset scan
    scanStore.resetScan();
    selStore.clearSelection();
    expect(useScanStore.getState().itemIds).toHaveLength(0);
    expect(useScanStore.getState().itemsById).toEqual({});
    expect(useScanStore.getState().status).toBe("idle");
    expect(useSelectionStore.getState().selectedIds.size).toBe(0);

    // Restore snapshot
    scanStore.restoreScan({
      schemaVersion: 2,
      savedAt: "2026-11-06T00:00:00Z",
      summary: {
        scanId: "restored-1",
        rootPath: "C:\\Projects",
        scope: "project",
        totalEntries: 1,
        totalBytes: 1000,
        totalAllocatedBytes: 1000,
        protectedBytes: 0,
        durationMs: 50,
        errorsCount: 0,
        warningsCount: 0,
        directoriesVisited: 1,
        partial: false,
        stopReason: null,
        providerTotals: [],
      },
      items: [makeItem({ id: "restored-item", estimatedReclaimBytes: 1000 })],
    });

    expect(useScanStore.getState().restored).toBe(true);
    expect(useScanStore.getState().itemIds).toContain("restored-item");
    expect(useScanStore.getState().itemsById["restored-item"].estimatedReclaimBytes).toBe(1000);
  });
});
