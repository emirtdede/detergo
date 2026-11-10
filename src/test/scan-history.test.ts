import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import {
  getScanHistory,
  appendScanHistory,
  clearScanHistory,
  ScanHistoryRecord,
} from "@/features/history/scan-history";

const storageMap = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storageMap.set(key, value);
  },
  removeItem: (key: string) => {
    storageMap.delete(key);
  },
  clear: () => {
    storageMap.clear();
  },
};

beforeAll(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorageMock,
    writable: true,
  });
});

describe("Scan History Storage", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it("returns empty array when no scans are stored", () => {
    expect(getScanHistory()).toEqual([]);
  });

  it("appends and retrieves scan history records", () => {
    const entry: ScanHistoryRecord = {
      id: "scan-1",
      timestamp: new Date().toISOString(),
      scope: "project",
      rootPath: "D:\\test",
      itemCount: 5,
      cleanableBytes: 1048576,
      durationMs: 450,
      status: "completed",
    };

    appendScanHistory(entry);
    const list = getScanHistory();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("scan-1");
    expect(list[0].itemCount).toBe(5);
  });

  it("prepends latest scan and caps at 50 records", () => {
    for (let i = 0; i < 60; i++) {
      appendScanHistory({
        id: `scan-${i}`,
        timestamp: new Date().toISOString(),
        scope: "project",
        rootPath: `D:\\test\\${i}`,
        itemCount: i,
        cleanableBytes: i * 1000,
        durationMs: 100,
        status: "completed",
      });
    }

    const list = getScanHistory();
    expect(list).toHaveLength(50);
    expect(list[0].id).toBe("scan-59");
  });

  it("clears scan history", () => {
    appendScanHistory({
      id: "scan-1",
      timestamp: new Date().toISOString(),
      scope: "project",
      rootPath: "D:\\test",
      itemCount: 1,
      cleanableBytes: 100,
      durationMs: 50,
      status: "completed",
    });

    clearScanHistory();
    expect(getScanHistory()).toEqual([]);
  });
});
