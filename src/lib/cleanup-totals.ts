/**
 * Total-cleaned and distribution maths shared by the Overview and History
 * pages.
 *
 * "Moved" and "reclaimed" are different things: a Recycle Bin cleanup moves
 * bytes into the bin (they are not free until the bin is emptied), while a
 * permanent delete actually reclaims them. `reclaimedBytes` is only non-zero
 * for permanent deletes, and `movedBytes` already includes those. Presenting
 * `max(moved, reclaimed)` as "reclaimed" overstated recycled cleanups.
 */

/**
 * The lifetime "cleaned" figure.
 *
 * Moved bytes are the whole story for both delete modes. Records written by
 * older versions may only have `reclaimBytes`, so fall back to it when nothing
 * was tracked as moved.
 */
export function lifetimeCleanedBytes(movedBytes: number, reclaimedBytes: number): number {
  const moved = Number.isFinite(movedBytes) && movedBytes > 0 ? movedBytes : 0;
  const reclaimed = Number.isFinite(reclaimedBytes) && reclaimedBytes > 0 ? reclaimedBytes : 0;
  return moved > 0 ? moved : reclaimed;
}

/**
 * Distribution bar widths that always add up to exactly 100%.
 *
 * Segments get a minimum visible share, which pushed the naive sum above 100%
 * and made the bar overflow its container. Flooring first and normalising
 * afterwards keeps every segment visible while the widths sum to 100.
 */
export function normalizeDistributionWidths(percentages: number[], minPercent = 2): number[] {
  if (percentages.length === 0) return [];
  const floor = Math.max(0, minPercent);
  const floored = percentages.map((value) =>
    Number.isFinite(value) && value > 0 ? Math.max(floor, value) : 0,
  );
  const total = floored.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    const even = 100 / floored.length;
    return floored.map(() => even);
  }
  return floored.map((value) => (value / total) * 100);
}
