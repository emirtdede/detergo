import { describe, it, expect, beforeEach } from "vitest";

import { ownBytesById } from "../lib/item-totals";
import { useScanStore, flushPendingSummary } from "../stores/scan-store";
import { useSelectionStore } from "../stores/selection-store";
import { makeItem } from "./fixtures";

const summary = {
  scanId: "scan-own",
  rootPath: "C:\\Projects\\app",
  scope: "project" as const,
  totalBytes: 1400,
  totalAllocatedBytes: 1400,
  cleanableBytes: 1400,
  protectedBytes: 0,
  totalEntries: 2,
  errorsCount: 0,
  warningsCount: 0,
  directoriesVisited: 1,
  durationMs: 1,
  partial: false,
  providerTotals: [
    {
      provider: "project",
      logicalBytes: 1400,
      allocatedBytes: 1400,
      itemCount: 2,
      protectedBytes: 0,
    },
  ],
};

describe("own-bytes totals", () => {
  beforeEach(() => {
    useScanStore.getState().resetScan();
    useSelectionStore.getState().clearSelection();
  });

  it("subtracts only direct children from a parent measurement", () => {
    const parent = makeItem({
      id: "parent",
      logicalBytes: 1000,
      allocatedBytes: 1000,
      estimatedReclaimBytes: 1000,
    });
    const child = makeItem({
      id: "child",
      parentItemId: "parent",
      logicalBytes: 400,
      allocatedBytes: 400,
      estimatedReclaimBytes: 400,
    });

    const own = ownBytesById([parent, child]);

    expect(own.get("parent")).toEqual({
      logicalBytes: 600,
      allocatedBytes: 600,
      estimatedReclaimBytes: 600,
    });
    // The child keeps its own bytes; the sum of own slices equals the parent's
    // recursive measurement, never 1400.
    expect(own.get("child")?.allocatedBytes).toBe(400);
    const total = [...own.values()].reduce((sum, bytes) => sum + bytes.allocatedBytes, 0);
    expect(total).toBe(1000);
  });

  it("does not attribute an orphaned child's bytes to a missing parent", () => {
    const orphan = makeItem({
      id: "orphan",
      parentItemId: "not-in-session",
      logicalBytes: 250,
      allocatedBytes: 250,
      estimatedReclaimBytes: 250,
    });

    const own = ownBytesById([orphan]);

    expect(own.get("orphan")?.allocatedBytes).toBe(250);
  });

  it("recomputes the summary without double counting nested targets", () => {
    const store = useScanStore.getState();
    store.startScanState("C:\\Projects\\app");
    store.addItems([
      makeItem({
        id: "parent",
        logicalBytes: 1000,
        allocatedBytes: 1000,
        estimatedReclaimBytes: 1000,
      }),
      makeItem({
        id: "child",
        parentItemId: "parent",
        logicalBytes: 400,
        allocatedBytes: 400,
        estimatedReclaimBytes: 400,
      }),
    ]);
    store.completeScan({ ...summary });

    // Marking the parent deleted removes the descendant rows and the totals
    // must fall to zero instead of keeping the child's ghost bytes.
    useScanStore.getState().markDeleted(["parent"]);
    flushPendingSummary();

    const state = useScanStore.getState();
    expect(state.itemsById["child"]?.status).toBe("deleted");
    expect(state.summary?.totalAllocatedBytes).toBe(0);
    expect(state.summary?.cleanableBytes).toBe(0);
    expect(state.summary?.totalEntries).toBe(0);
  });
});
