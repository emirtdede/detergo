import { describe, it, expect } from "vitest";
import { CleanupItem } from "../types";
import { makeItem } from "./fixtures";

describe("WP-7: Synthetic dataset and stress tests (1000+ items)", () => {
  function generate1000(): CleanupItem[] {
    return Array.from({ length: 1000 }, (_, i) =>
      makeItem({
        id: `synth-${i}`,
        displayName: `target-${i}`,
        projectName: `project-${i}`,
        displayPath: `C:\\Workspaces\\org-${Math.floor(i / 10)}\\project-${i}\\node_modules`,
        logicalBytes: Math.floor(Math.random() * 5 * 1024 * 1024 * 1024),
        estimatedReclaimBytes: Math.floor(Math.random() * 5 * 1024 * 1024 * 1024),
        safetyClass: i % 5 === 0 ? "review" : "regenerate",
      })
    );
  }

  it("filters 1000 items by project name within 15ms", () => {
    const items = generate1000();
    const query = "project-7";
    const t0 = performance.now();
    const filtered = items.filter(
      (item) =>
        (item.projectName ?? "").toLowerCase().includes(query) ||
        item.displayPath.toLowerCase().includes(query)
    );
    expect(filtered.length).toBeGreaterThan(0);
    expect(performance.now() - t0).toBeLessThan(15);
  });

  it("sorts 1000 items by size in descending order within 10ms", () => {
    const items = generate1000();
    const t0 = performance.now();
    items.sort((a, b) => (b.estimatedReclaimBytes ?? 0) - (a.estimatedReclaimBytes ?? 0));
    expect(items[0].estimatedReclaimBytes!).toBeGreaterThanOrEqual(
      items[items.length - 1].estimatedReclaimBytes!
    );
    expect(performance.now() - t0).toBeLessThan(10);
  });

  it("calculates totals across 1000 items quickly", () => {
    const items = generate1000();
    const t0 = performance.now();
    const total = items.reduce((acc, item) => acc + (item.estimatedReclaimBytes ?? 0), 0);
    expect(total).toBeGreaterThan(0);
    expect(performance.now() - t0).toBeLessThan(5);
  });

  it("builds a selection set of 1000 ids in <5ms", () => {
    const items = generate1000();
    const t0 = performance.now();
    const set = new Set(items.map((item) => item.id));
    expect(set.size).toBe(1000);
    expect(performance.now() - t0).toBeLessThan(5);
  });
});
