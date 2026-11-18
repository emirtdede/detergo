import { CleanupItem } from "@/types";

/**
 * Per-item byte counts that belong to the item itself rather than to its
 * nested children.
 *
 * The backend measures a parent target recursively, so `.next` already includes
 * `.next/cache`. Summing every row double-counted those bytes in the Projects
 * and Overview totals. This mirrors `own_bytes` in
 * `src-tauri/src/scanner/mod.rs`: a parent's own slice is its raw measurement
 * minus the sum of its direct children. Each level subtracts only its direct
 * children, so the effect telescopes over the whole tree.
 */
export interface ItemBytes {
  logicalBytes: number;
  allocatedBytes: number;
  estimatedReclaimBytes: number;
}

function positive(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Raw (not de-duplicated) bytes for one row.
 *
 * `estimatedReclaimBytes` is the UI's fallback when an older snapshot has no
 * allocated size. Real scans always populate all three, so this only keeps
 * restored/legacy rows from collapsing to zero.
 */
export function rawItemBytes(item: CleanupItem): ItemBytes {
  const logicalBytes = positive(item.logicalBytes);
  const allocatedBytes =
    positive(item.allocatedBytes) || positive(item.estimatedReclaimBytes) || logicalBytes;
  const estimatedReclaimBytes =
    positive(item.estimatedReclaimBytes) || allocatedBytes || logicalBytes;
  return { logicalBytes, allocatedBytes, estimatedReclaimBytes };
}

/** Returns the own-bytes slice for every item in `items`, keyed by item id. */
export function ownBytesById(items: readonly CleanupItem[]): Map<string, ItemBytes> {
  const present = new Set(items.map((item) => item.id));
  const childLogical = new Map<string, number>();
  const childAllocated = new Map<string, number>();
  const childEstimated = new Map<string, number>();

  const add = (map: Map<string, number>, key: string, value: number) => {
    map.set(key, (map.get(key) ?? 0) + value);
  };

  for (const item of items) {
    const parentId = item.parentItemId;
    if (!parentId || !present.has(parentId)) continue;
    const raw = rawItemBytes(item);
    add(childLogical, parentId, raw.logicalBytes);
    add(childAllocated, parentId, raw.allocatedBytes);
    add(childEstimated, parentId, raw.estimatedReclaimBytes);
  }

  const own = new Map<string, ItemBytes>();
  for (const item of items) {
    const raw = rawItemBytes(item);
    own.set(item.id, {
      logicalBytes: Math.max(0, raw.logicalBytes - (childLogical.get(item.id) ?? 0)),
      allocatedBytes: Math.max(0, raw.allocatedBytes - (childAllocated.get(item.id) ?? 0)),
      estimatedReclaimBytes: Math.max(
        0,
        raw.estimatedReclaimBytes - (childEstimated.get(item.id) ?? 0),
      ),
    });
  }
  return own;
}
