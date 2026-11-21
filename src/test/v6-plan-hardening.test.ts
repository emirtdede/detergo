import { describe, expect, it, beforeEach } from "vitest";
import { useScanStore } from "@/stores/scan-store";
import { useScanTargetsStore } from "@/features/scan/scan-activity";
import { getMcpConfigList, getMcpConfigs } from "@/features/docs/docs-data";
import type { CleanupItem } from "@/types";

function makeItem(overrides: Partial<CleanupItem> = {}): CleanupItem {
  return {
    id: "item-1",
    scanSessionId: "s-1",
    ruleId: "js.node_modules",
    provider: "project",
    ecosystem: "javascript",
    category: "dependencies",
    kind: "directory",
    displayName: "node_modules",
    displayPath: "D:\\work\\app\\node_modules",
    logicalBytes: null,
    allocatedBytes: null,
    estimatedReclaimBytes: null,
    safetyClass: "safe",
    confidence: "high",
    activeUse: "no",
    evidenceCodes: ["NAME_MATCH"],
    warningCodes: [],
    cleanupMethod: "trash",
    protected: false,
    selectable: true,
    autoSelectable: true,
    status: "discovered",
    ...overrides,
  };
}

describe("v6.0 hardening contracts", () => {
  beforeEach(() => {
    useScanStore.getState().resetScan();
  });

  it("merges MeasurementUpdate selectability and warnings monotonically", () => {
    const store = useScanStore.getState();
    store.addItems([
      makeItem({ id: "small", selectable: true, autoSelectable: true }),
      makeItem({
        id: "already-blocked",
        selectable: false,
        autoSelectable: false,
        warningCodes: ["USER_PROTECTED"],
        status: "blocked",
      }),
      makeItem({ id: "unreadable", selectable: true, autoSelectable: true }),
    ]);

    useScanStore.getState().applyMeasurements([
      {
        id: "small",
        logicalBytes: 128,
        allocatedBytes: 4096,
        estimatedReclaimBytes: 4096,
        fileCount: 1,
        hardlinkDedupBytes: 0,
        status: "ready",
        selectable: false,
        autoSelectable: false,
        warningCodes: ["BELOW_MIN_SIZE"],
      },
      {
        id: "already-blocked",
        logicalBytes: 500_000,
        allocatedBytes: 500_000,
        estimatedReclaimBytes: 500_000,
        fileCount: 20,
        hardlinkDedupBytes: 0,
        status: "ready",
        selectable: null,
        autoSelectable: null,
        warningCodes: ["USER_PROTECTED"],
      },
      {
        id: "unreadable",
        logicalBytes: 0,
        allocatedBytes: null,
        estimatedReclaimBytes: 0,
        fileCount: 0,
        hardlinkDedupBytes: 0,
        status: "error",
        selectable: false,
        autoSelectable: false,
        warningCodes: ["NOT_MEASURED"],
      },
    ]);

    const { itemsById } = useScanStore.getState();
    expect(itemsById.small.selectable).toBe(false);
    expect(itemsById.small.autoSelectable).toBe(false);
    expect(itemsById.small.warningCodes).toContain("BELOW_MIN_SIZE");

    expect(itemsById["already-blocked"].selectable).toBe(false);
    expect(itemsById["already-blocked"].status).toBe("blocked");
    expect(itemsById["already-blocked"].warningCodes).toEqual(["USER_PROTECTED"]);

    expect(itemsById.unreadable.selectable).toBe(false);
    expect(itemsById.unreadable.logicalBytes).toBeNull();
    expect(itemsById.unreadable.warningCodes).toContain("NOT_MEASURED");
  });

  it("generates dynamic MCP configs for JSON IDEs and Codex TOML", () => {
    const exePath = "C:\\Users\\dev\\Desktop\\Detergo-1.0.0-Portable.exe";
    const configs = getMcpConfigs(exePath);

    const cursorParsed = JSON.parse(configs.cursor.json) as {
      mcpServers: { detergo: { command: string; args: string[] } };
    };
    expect(cursorParsed.mcpServers["detergo"].command).toBe(exePath);
    expect(cursorParsed.mcpServers["detergo"].args).toEqual(["mcp"]);

    const zedParsed = JSON.parse(configs.zed.json) as {
      context_servers: Array<{ command: { path: string; args: string[] } }>;
    };
    expect(zedParsed.context_servers[0].command.path).toBe(exePath);

    expect(configs.codex.syntax).toBe("toml");
    expect(configs.codex.json).toContain("[mcp_servers.detergo]");
    expect(configs.codex.json).toContain(`command = ${JSON.stringify(exePath)}`);

    expect(getMcpConfigList().length).toBeGreaterThanOrEqual(14);
  });

  it("toggles allDrives cleanly in scan targets store", () => {
    const targets = useScanTargetsStore.getState();
    targets.setAllDrives(true);
    expect(useScanTargetsStore.getState().allDrives).toBe(true);
    expect(useScanTargetsStore.getState().targets).toContain("projects");

    targets.setAllDrives(false);
    expect(useScanTargetsStore.getState().allDrives).toBe(false);
  });
});
