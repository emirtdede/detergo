// One-off codemod: adds the opt-in specta derive to every type that crosses the
// IPC boundary. Idempotent; safe to re-run.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("src-tauri/src");
const TARGETS = {
  "scanner/models.rs": [
    "ScanScope",
    "ItemStatus",
    "CleanupItem",
    "MeasurementUpdate",
    "ScanRequest",
    "ScanProgress",
    "ProviderTotal",
    "ScanSummary",
    "ScanEvent",
  ],
  "catalog/model.rs": [
    "SafetyClass",
    "CleanupMethod",
    "TargetKind",
    "MarkerMode",
    "GitPolicy",
    "Confidence",
    "Rule",
  ],
  "safety/process_guard.rs": ["ActiveUse"],
  "cleanup/mod.rs": ["DeleteMode"],
  "cleanup/plan.rs": ["TargetSnapshot", "PlanItem", "CleanupPlan"],
  "cleanup/coordinator.rs": ["CleanupResultItem", "CleanupReport", "CleanupEvent"],
  "cleanup/official_actions.rs": [
    "CachePathInfo",
    "OfficialActionInfo",
    "CacheProviderInfo",
    "CacheMeasureEvent",
    "OfficialActionPreview",
    "OfficialActionResult",
  ],
  "providers/mod.rs": ["AgentRootInfo", "AgentProviderInfo"],
  "providers/growth.rs": ["GrowthEntry"],
  "commands/history_commands.rs": ["GrowthReport"],
  "commands/system_commands.rs": ["DiskSpaceInfo"],
  "build_info.rs": ["BuildInfo"],
  "last_scan.rs": ["LastScanSnapshot"],
  "platform/windows/known_folders.rs": ["KnownLocation"],
  "settings/model.rs": [
    "FavoriteItem",
    "SortConfig",
    "CustomAgentProvider",
    "AgentPolicy",
    "NotificationChannel",
    "NotificationPreferences",
    "AppSettings",
  ],
  "audit/repository.rs": [
    "AuditEntry",
    "AuditRecord",
    "StorageSnapshot",
    "ActionAuditRecord",
    "CleanupTotals",
  ],
  "error/app_error.rs": ["AppError"],
};

const ATTRIBUTE = '#[cfg_attr(feature = "bindings", derive(specta::Type))]';

let changed = 0;
for (const [relative, names] of Object.entries(TARGETS)) {
  const file = path.join(root, relative);
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const name of names) {
    const declaration = lines.findIndex((line) =>
      new RegExp(`^pub (struct|enum) ${name}\\b`).test(line),
    );
    if (declaration === -1) {
      throw new Error(`${relative}: declaration for ${name} not found`);
    }
    // Walk back to the derive attribute that documents this item (skipping
    // doc comments and serde attributes between it and the declaration).
    let index = declaration - 1;
    while (index >= 0 && !lines[index].startsWith("#[derive(")) index -= 1;
    if (index < 0) throw new Error(`${relative}: no derive attribute for ${name}`);
    if (lines[index - 1] === ATTRIBUTE) continue;
    lines.splice(index, 0, ATTRIBUTE);
    changed += 1;
  }
  fs.writeFileSync(file, lines.join("\n"));
}
console.log(`added ${changed} specta derives`);
