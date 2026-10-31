import { CleanupItem, MeasurementUpdate } from "../types";

let counter = 0;

export function makeItem(overrides: Partial<CleanupItem> = {}): CleanupItem {
  counter += 1;
  const id = overrides.id ?? `t-${counter}`;
  const name = overrides.displayName ?? "node_modules";
  return {
    id,
    scanSessionId: "s-test",
    ruleId: "js.node_modules",
    provider: "project",
    ecosystem: "javascript",
    category: "dependencies",
    kind: "directory",
    projectId: "p-1",
    projectName: "app",
    projectRoot: "C:\\Projects\\app",
    displayName: name,
    displayPath: `C:\\Projects\\app\\${name}`,
    logicalBytes: null,
    allocatedBytes: null,
    estimatedReclaimBytes: null,
    safetyClass: "regenerate",
    confidence: "high",
    activeUse: "no",
    evidenceCodes: ["NAME_MATCH", "PROJECT_MARKER"],
    warningCodes: [],
    cleanupMethod: "trash",
    regenerateHint: null,
    protected: false,
    selectable: true,
    autoSelectable: false,
    lastModifiedAt: "2026-08-28T10:00:00Z",
    status: "discovered",
    parentItemId: null,
    note: null,
    ...overrides,
  };
}

export function makeUpdate(
  id: string,
  bytes: number,
  status: MeasurementUpdate["status"] = "ready"
): MeasurementUpdate {
  return {
    id,
    logicalBytes: bytes,
    allocatedBytes: bytes,
    estimatedReclaimBytes: bytes,
    fileCount: 1,
    hardlinkDedupBytes: 0,
    status,
  };
}
