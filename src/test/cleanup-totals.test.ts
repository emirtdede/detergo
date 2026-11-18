import { describe, it, expect } from "vitest";

import { lifetimeCleanedBytes, normalizeDistributionWidths } from "@/lib/cleanup-totals";

describe("cleanup totals", () => {
  it("reports moved bytes for recycle-bin and permanent cleanups", () => {
    // Permanent delete: reclaimed equals moved.
    expect(lifetimeCleanedBytes(500, 500)).toBe(500);
    // Recycle Bin delete: reclaimed is zero, but the bytes still moved.
    expect(lifetimeCleanedBytes(500, 0)).toBe(500);
  });

  it("falls back to reclaimed bytes for legacy records", () => {
    expect(lifetimeCleanedBytes(0, 300)).toBe(300);
  });

  it("never adds moved and reclaimed together", () => {
    expect(lifetimeCleanedBytes(1_000, 1_000)).toBe(1_000);
    expect(lifetimeCleanedBytes(1_000, 250)).toBe(1_000);
  });

  it("handles empty and invalid input", () => {
    expect(lifetimeCleanedBytes(0, 0)).toBe(0);
    expect(lifetimeCleanedBytes(Number.NaN, Number.NaN)).toBe(0);
  });
});

describe("distribution widths", () => {
  it("sums to exactly 100% after the minimum-share floor", () => {
    // 98% + 1% + 1% would floor to 98 + 2 + 2 = 102 without normalisation.
    const widths = normalizeDistributionWidths([98, 1, 1]);
    expect(widths.reduce((sum, value) => sum + value, 0)).toBeCloseTo(100, 10);
  });

  it("keeps every positive segment visible", () => {
    const widths = normalizeDistributionWidths([0.1, 0.1, 99.8]);
    expect(widths.every((value) => value > 0)).toBe(true);
    expect(widths.reduce((sum, value) => sum + value, 0)).toBeCloseTo(100, 10);
  });

  it("leaves an exact distribution unchanged", () => {
    expect(normalizeDistributionWidths([50, 30, 20])).toEqual([50, 30, 20]);
  });

  it("returns an empty list for no segments", () => {
    expect(normalizeDistributionWidths([])).toEqual([]);
  });

  it("splits evenly when no segment carries bytes", () => {
    const widths = normalizeDistributionWidths([0, 0]);
    expect(widths).toEqual([50, 50]);
  });
});
