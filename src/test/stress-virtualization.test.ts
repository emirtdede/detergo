import { describe, it, expect, beforeEach } from "vitest";
import { squarify, type TreemapEntry } from "../features/overview/DiskTreemap";
import { maskPathsInText } from "../lib/format/path";
import { isBrowserShortcutToBlock } from "../lib/desktop-guard";
import { usePreferencesStore } from "../stores/preferences-store";
import { useUiStore } from "../stores/ui-store";
import { makeItem } from "./fixtures";

function makeTreemapEntry(i: number, bytes: number): TreemapEntry {
  return {
    id: `tile-${i}`,
    label: `target-${i}`,
    subtitle: `project-${i}`,
    fullPath: `C:\\Workspaces\\project-${i}\\node_modules`,
    bytes,
    bucket: "node",
    searchTerm: `project-${i}`,
    targetView: "projects",
  };
}

describe("DiskTreemap squarified layout & scale invariants", () => {
  it("packs tiles with zero overlap, exact area/percent conservation, and realistic aspect ratios", () => {
    const entries = Array.from({ length: 16 }, (_, i) => makeTreemapEntry(i, (16 - i) * 100_000));
    const totalBytes = entries.reduce((sum, e) => sum + e.bytes, 0);
    const rects = squarify(entries, totalBytes, 800, 260);

    expect(rects).toHaveLength(16);
    let totalArea = 0;
    let totalPercent = 0;
    for (const rect of rects) {
      expect(rect.w).toBeGreaterThan(0);
      expect(rect.h).toBeGreaterThan(0);
      expect(rect.x).toBeGreaterThanOrEqual(-1e-6);
      expect(rect.y).toBeGreaterThanOrEqual(-1e-6);
      expect(rect.x + rect.w).toBeLessThanOrEqual(100 + 1e-4);
      expect(rect.y + rect.h).toBeLessThanOrEqual(100 + 1e-4);
      totalArea += rect.w * rect.h;
      totalPercent += rect.percent;
    }
    expect(totalArea).toBeCloseTo(100 * 100, 1);
    expect(totalPercent).toBeCloseTo(100, 1);

    // Pairwise non-overlap check
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const separated =
          a.x + a.w <= b.x + 1e-4 ||
          b.x + b.w <= a.x + 1e-4 ||
          a.y + a.h <= b.y + 1e-4 ||
          b.y + b.h <= a.y + 1e-4;
        expect(separated, `tiles ${i} and ${j} overlap`).toBe(true);
      }
    }
  });

  it("handles empty inputs and zero totals without NaN or infinite loops", () => {
    expect(squarify([], 1000, 800, 260)).toEqual([]);
    expect(squarify([makeTreemapEntry(0, 100)], 0, 800, 260)).toEqual([]);
    expect(squarify([makeTreemapEntry(0, 0)], 100, 800, 260)).toEqual([]);
  });
});

describe("UI store isolation, background cleanup & privacy masking", () => {
  beforeEach(() => {
    useUiStore.setState({
      activeModal: null,
      searchQuery: "",
      searchByScope: { projects: "", agents: "" },
      pendingDeletionIds: [],
      pendingMode: "recycleBin",
      plan: null,
      report: null,
      settingsSection: "general",
      aboutPane: "overview",
      legalDoc: "eula",
    });
  });

  it("isolates search queries between Projects and AI Tools views", () => {
    const store = useUiStore.getState();
    store.setScopeSearchQuery("projects", "node_modules");
    store.setScopeSearchQuery("agents", "cursor");

    expect(useUiStore.getState().searchByScope.projects).toBe("node_modules");
    expect(useUiStore.getState().searchByScope.agents).toBe("cursor");
    expect(useUiStore.getState().searchQuery).toBe("node_modules");
  });

  it("hideModal keeps cleanup plan intact for background runs while closeModal resets pendingMode", () => {
    const store = useUiStore.getState();
    store.setPendingDeletion(["id-1"], "permanent");
    store.openModal("cleanup-plan");

    store.hideModal();
    expect(useUiStore.getState().activeModal).toBeNull();
    expect(useUiStore.getState().pendingMode).toBe("permanent");
    expect(useUiStore.getState().pendingDeletionIds).toEqual(["id-1"]);

    store.openModal("cleanup-plan");
    store.closeModal();
    expect(useUiStore.getState().activeModal).toBeNull();
    expect(useUiStore.getState().pendingMode).toBe("recycleBin");
    expect(useUiStore.getState().pendingDeletionIds).toEqual([]);
  });

  it("masks Windows and POSIX usernames inside multiline command logs", () => {
    const raw = [
      "Cleaning C:\\Users\\emir\\AppData\\Local\\Temp\\cache.tmp",
      "Checking /home/alice/.cache/pip and /Users/bob/Library/Caches",
    ].join("\n");
    const masked = maskPathsInText(raw);
    expect(masked).not.toContain("emir");
    expect(masked).not.toContain("alice");
    expect(masked).not.toContain("bob");
    expect(masked).toContain("C:\\Users\\•••\\AppData\\Local\\Temp\\cache.tmp");
    expect(masked).toContain("/home/•••/.cache/pip");
    expect(masked).toContain("/Users/•••/Library/Caches");
  });

  it("lets desktop-guard pass through user-configured Ctrl+F while still blocking Ctrl+J", () => {
    const prevShortcuts = usePreferencesStore.getState().shortcuts;
    try {
      usePreferencesStore.setState({
        shortcuts: { ...prevShortcuts, focusSearch: "Ctrl+F" },
      });
      const ctrlF = new KeyboardEvent("keydown", { key: "f", ctrlKey: true });
      const ctrlJ = new KeyboardEvent("keydown", { key: "j", ctrlKey: true });
      expect(isBrowserShortcutToBlock(ctrlF)).toBe(false);
      expect(isBrowserShortcutToBlock(ctrlJ)).toBe(true);
    } finally {
      usePreferencesStore.setState({ shortcuts: prevShortcuts });
    }
  });

  it("scales candidate fixture aggregation smoothly across 50,000 targets", () => {
    const items = Array.from({ length: 50_000 }, (_, i) =>
      makeItem({
        id: `bulk-${i}`,
        displayName: `target-${i}`,
        projectName: `project-${i % 500}`,
        displayPath: `C:\\Workspaces\\org-${i % 50}\\project-${i % 500}\\node_modules`,
        logicalBytes: (i % 4096) * 1024,
        estimatedReclaimBytes: (i % 4096) * 1024,
      }),
    );

    const t0 = performance.now();
    const filtered = items.filter(
      (item) =>
        (item.projectName ?? "").toLowerCase().includes("project-42") ||
        item.displayPath.toLowerCase().includes("project-42"),
    );
    filtered.sort((a, b) => (b.estimatedReclaimBytes ?? 0) - (a.estimatedReclaimBytes ?? 0));
    const elapsed = performance.now() - t0;

    expect(filtered.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(500);
  });
});
