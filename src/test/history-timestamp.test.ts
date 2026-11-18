import { describe, expect, it } from "vitest";
import { latestTimestampMs } from "@/lib/format/date";

describe("latestTimestampMs", () => {
  it("returns 0 for an empty list so callers can test > 0", () => {
    expect(latestTimestampMs([])).toBe(0);
  });

  it("returns the newest parseable timestamp and ignores invalid values", () => {
    const newest = latestTimestampMs([
      { timestamp: "2026-01-01T00:00:00Z" },
      { timestamp: "not a date" },
      { timestamp: "2026-03-04T05:06:07Z" },
      { timestamp: "2025-12-31T23:59:59Z" },
    ]);
    expect(newest).toBe(new Date("2026-03-04T05:06:07Z").getTime());
  });

  it("returns 0 when nothing parses", () => {
    expect(latestTimestampMs([{ timestamp: "" }, { timestamp: "???" }])).toBe(0);
  });

  it("does not use the spread argument limit on a long history", () => {
    // 70 000 entries is below `MAX_HISTORY_LINES` but well past the ~65 535
    // argument ceiling that `Math.max(...timestamps)` hits on V8.
    const entries = Array.from({ length: 70_000 }, (_, index) => ({
      timestamp: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
    }));
    expect(latestTimestampMs(entries)).toBe(
      new Date(Date.UTC(2026, 0, 1) + 69_999 * 1000).getTime(),
    );
  });
});
