/**
 * Every selectable theme, in the order the settings picker renders them.
 *
 * This array is the single source of truth: the `ThemeMode` type is derived
 * from it, the store validates against it and the picker maps over it. Three
 * hand-maintained copies used to drift, and a theme missing from the store's
 * set silently reset to black.
 */
export const THEME_MODES = [
  "dark-black",
  "dark-gray",
  "dark-blue",
  "dark-purple",
  "dark-green",
  "dark-red",
  "dark-orange",
  "dark-yellow",
  "light-white",
  "light-gray",
  "light-blue",
  "light-purple",
  "light-green",
  "light-red",
  "light-orange",
  "light-yellow",
] as const;

export type ThemeMode = (typeof THEME_MODES)[number];

export type SupportedLanguage =
  | "tr"
  | "en"
  | "de"
  | "es"
  | "fr"
  | "it"
  | "pt"
  | "nl"
  | "pl"
  | "ru"
  | "ja"
  | "ko"
  | "zh"
  | "zh-tw"
  | "sv"
  | "ar"
  | "hi"
  | "id"
  | "vi"
  | "uk"
  | "el"
  | "cs"
  | "da"
  | "fi"
  | "no"
  | "hu"
  | "ro"
  | "th"
  | "ms"
  | "fil"
  | "bn"
  | "he"
  | "fa"
  | "ur"
  | "az"
  | "kk"
  | "uz"
  | "bg"
  | "sk"
  | "hr"
  | "et"
  | "ta"
  | "te"
  | "mr"
  | "kn"
  | "gu"
  | "ml"
  | "pa"
  | "lt"
  | "lv"
  | "sr"
  | "sl"
  | "bs"
  | "sq"
  | "mk"
  | "is"
  | "sw"
  | "am"
  | "ha"
  | "yo"
  | "af"
  | "ka"
  | "hy"
  | "ky"
  | "tk"
  | "mn"
  | "ca"
  | "eu"
  | "gl"
  | "ga"
  | "my"
  | "km"
  | "si";

export interface FavoriteLocation {
  id: string;
  label: string;
  path: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface SortOption {
  field: "size" | "modified" | "name" | "safety" | "project" | "category";
  direction: "asc" | "desc";
}

export type SafetyClass = "safe" | "regenerate" | "review" | "keep";
export type Confidence = "high" | "medium" | "low";
export type ActiveUse = "yes" | "no" | "unknown";
export type CleanupMethod = "trash" | "permanent" | "officialTool" | "none";
export type TargetKind = "directory" | "file" | "fileGroup";
export type ItemStatus = "discovered" | "measuring" | "ready" | "blocked" | "error" | "deleted";
/**
 * `combined` is the "scan everything" action: the project walk and the AI agent
 * scan run in one backend session, so they share one progress stream, one cancel
 * and one result set. Package cache measurement follows on the frontend.
 */
export type ScanScope = "project" | "agents" | "globalCaches" | "allDrives" | "combined";
/**
 * How much a scan notice affects trust in the result.
 * - `info`: an expected skip (system-protected folder, locked temp dir).
 * - `warning`: a path inside the selected scope could not be read.
 * - `error`: the scan itself was blocked for a root.
 */
export type ScanNoticeSeverity = "info" | "warning" | "error";

/** Per-step outcome of a combined scan. */
export interface ScanSectionResult {
  scope: ScanScope;
  /** `completed`, `partial`, `failed` or `skipped`. */
  status: string;
  itemCount: number;
  cleanableBytes: number;
  errorCode?: string | null;
}
export type MarkerMode = "any" | "all";
/** `denytracked`: tracked or modified content blocks automatic cleanup. */
export type GitPolicy = "ignore" | "denytracked";

export interface CleanupItem {
  id: string;
  scanSessionId: string;
  ruleId: string;
  provider: string;
  ecosystem: string;
  category: string;
  kind: TargetKind;
  projectId?: string | null;
  projectName?: string | null;
  projectRoot?: string | null;
  /**
   * True when `projectRoot` was confirmed by a project manifest. Rows without a
   * manifest are still cleanable but must never be counted as "projects".
   * Older backends omit the field; treat it as true (previous behaviour).
   */
  projectDetected?: boolean;
  displayName: string;
  displayPath: string;
  logicalBytes: number | null;
  allocatedBytes: number | null;
  estimatedReclaimBytes: number | null;
  safetyClass: SafetyClass;
  confidence: Confidence;
  activeUse: ActiveUse;
  evidenceCodes: string[];
  warningCodes: string[];
  cleanupMethod: CleanupMethod;
  regenerateHint?: string | null;
  protected: boolean;
  selectable: boolean;
  autoSelectable: boolean;
  lastModifiedAt?: string | null;
  lastModifiedMs?: number | null;
  status: ItemStatus;
  parentItemId?: string | null;
  note?: string | null;
}

export interface MeasurementUpdate {
  id: string;
  logicalBytes: number;
  allocatedBytes: number | null;
  estimatedReclaimBytes: number;
  fileCount: number;
  hardlinkDedupBytes: number;
  status: ItemStatus;
}

export interface ScanRequest {
  rootPath: string;
  exclusions?: string[];
  scope?: ScanScope;
  profile?: string;
  maxDepth?: number;
  maxCandidates?: number;
  timeoutMinutes?: number;
  minSizeBytes?: number;
  protectedPaths?: string[];
}

export interface ScanProgress {
  phase: string;
  directoriesVisited: number;
  entriesFound: number;
  entriesMeasured: number;
  bytesMeasured: number;
  currentPath?: string | null;
  stopReason?: string | null;
}

export interface ProviderTotal {
  provider: string;
  logicalBytes: number;
  allocatedBytes: number;
  itemCount: number;
  protectedBytes: number;
}

export interface ScanSummary {
  scanId: string;
  rootPath: string;
  scope: ScanScope;
  totalEntries: number;
  totalBytes: number;
  totalAllocatedBytes: number;
  protectedBytes: number;
  cleanableBytes: number;
  durationMs: number;
  errorsCount: number;
  warningsCount: number;
  directoriesVisited: number;
  partial: boolean;
  stopReason?: string | null;
  providerTotals: ProviderTotal[];
  /**
   * Distinct project roots confirmed by a manifest. `null` when the snapshot
   * predates the field; the UI must then ask for a rescan instead of showing a
   * stale count.
   */
  detectedProjectCount?: number | null;
  /** Per-step outcome of a combined scan; empty for single-scope scans. */
  sections?: ScanSectionResult[];
  /** Progress events the backend could not deliver (channel already closed). */
  droppedEvents?: number;
}

/** A scan-level warning: an unreadable path, a failed volume, ... */
export interface ScanWarning {
  code: string;
  path?: string | null;
  /** Missing in snapshots written before severity classification existed. */
  severity?: ScanNoticeSeverity;
  /** Root of the walk that produced the notice. */
  root?: string | null;
}

/** Only the most recent scan is persisted, so the app never opens empty. */
export interface LastScanSnapshot {
  schemaVersion: number;
  savedAt: string;
  summary: ScanSummary;
  items: CleanupItem[];
  /** Scan warnings are part of the result: they explain skipped paths. */
  warnings?: ScanWarning[];
}

export type ScanEvent =
  | { type: "started"; scanId: string }
  | { type: "candidates"; items: CleanupItem[] }
  | { type: "measured"; updates: MeasurementUpdate[] }
  | { type: "progress"; progress: ScanProgress }
  | {
      type: "warning";
      code: string;
      path?: string | null;
      /** Older backends omit this; the UI classifies the code as a fallback. */
      severity?: ScanNoticeSeverity;
      root?: string | null;
    }
  | { type: "completed"; summary: ScanSummary }
  | { type: "partial"; summary: ScanSummary }
  | { type: "cancelled"; summary: ScanSummary }
  | { type: "failed"; error: AppErrorDto };

export interface CatalogRule {
  id: string;
  ecosystem: string;
  category: string;
  kind: TargetKind;
  names: string[];
  markers: string[];
  markerMode: MarkerMode;
  content: string[];
  minEvidence: number;
  safety: SafetyClass;
  confidence: Confidence;
  cleanup: CleanupMethod;
  regenerate?: string | null;
  genericName: boolean;
  protected: boolean;
  nestedIn: string[];
  childRules: string[];
  gitPolicy: GitPolicy;
  requiresIdle: boolean;
  maxDepth?: number | null;
  note?: string | null;
}

export interface CatalogDto {
  schemaVersion: number;
  rules: CatalogRule[];
  valid: boolean;
  error?: string | null;
}

export type DeleteMode = "recycleBin" | "permanent";

export interface TargetSnapshot {
  exists: boolean;
  logicalBytes: number;
  modifiedSecs?: number | null;
  fileId?: string | null;
}

export interface PlanItem {
  targetId: string;
  displayPath: string;
  displayName: string;
  ruleId: string;
  provider: string;
  projectName?: string | null;
  safetyClass: SafetyClass;
  cleanupMethod: CleanupMethod;
  logicalBytes: number;
  estimatedReclaimBytes: number;
  activeUse: ActiveUse;
  eligible: boolean;
  blockedCode?: string | null;
  blockedReason?: string | null;
  regenerateHint?: string | null;
  snapshot: TargetSnapshot;
}

export interface CleanupPlan {
  id: string;
  sessionId: string;
  mode: DeleteMode;
  createdMs: number;
  expiresMs: number;
  items: PlanItem[];
  totalLogicalBytes: number;
  totalEstimatedBytes: number;
  eligibleCount: number;
  blockedCount: number;
  confirmationToken: string;
}

export interface CleanupResultItem {
  targetId: string;
  displayPath: string;
  ruleId: string;
  success: boolean;
  verified: boolean;
  errorCode?: string | null;
  error?: string | null;
  measuredBytes: number;
  reclaimBytes: number;
}

export interface CleanupReport {
  planId: string;
  mode: DeleteMode;
  successCount: number;
  errorCount: number;
  estimatedBytes: number;
  movedBytes: number;
  reclaimBytes: number;
  volumeFreeBefore?: number | null;
  volumeFreeAfter?: number | null;
  volumeFreeDelta?: number | null;
  durationMs: number;
  results: CleanupResultItem[];
  startedAt: string;
  finishedAt: string;
  cancelled: boolean;
  processedCount: number;
  skippedCount: number;
  /** Progress events lost because the frontend channel was already closed. */
  droppedEvents?: number;
  auditError?: string | null;
}

/** Progress events streamed by the backend while a cleanup runs. */
export type CleanupEvent =
  | { type: "started"; total: number }
  | { type: "itemStarted"; index: number; total: number; displayPath: string }
  | {
      type: "itemFinished";
      index: number;
      total: number;
      success: boolean;
      errorCode?: string | null;
    }
  | { type: "cancelled"; processed: number; skipped: number };

export interface AgentRootInfo {
  path: string;
  kind: string;
  source: string;
  exists: boolean;
}

export interface AgentProviderInfo {
  id: string;
  name: string;
  installed: boolean;
  roots: AgentRootInfo[];
  readOnly: boolean;
  note?: string | null;
}

export interface CachePathInfo {
  path: string;
  exists: boolean;
  bytes: number | null;
  /** `readOnly` / `error` when the path exists but could not be measured. */
  unmeasuredReason?: string | null;
}

export interface OfficialActionInfo {
  id: string;
  label: string;
  description: string;
  executable?: string | null;
  args: string[];
  available: boolean;
  unavailableReason?: string | null;
  requiresNetwork: boolean;
  impact: string;
}

export interface CacheProviderInfo {
  id: string;
  name: string;
  detected: boolean;
  version?: string | null;
  cachePaths: CachePathInfo[];
  totalBytes: number;
  actions: OfficialActionInfo[];
  readOnly: boolean;
  note?: string | null;
  measured: boolean;
}

export type CacheMeasureEvent =
  | { type: "started"; providerCount: number }
  | {
      type: "pathMeasured";
      providerId: string;
      path: string;
      exists: boolean;
      bytes: number | null;
      unmeasuredReason?: string | null;
    }
  | { type: "providerFinished"; providerId: string; totalBytes: number }
  | { type: "finished" }
  | { type: "cancelled" };

export interface OfficialActionPreview {
  token: string;
  providerId: string;
  actionId: string;
  executable: string;
  args: string[];
  beforeBytes: number;
  /** The before-size measurement was time-limited; some paths are excluded. */
  measurementTruncated: boolean;
  expiresMs: number;
}

export interface OfficialActionResult {
  success: boolean;
  exitCode?: number | null;
  providerId: string;
  actionId: string;
  label: string;
  beforeBytes: number;
  afterBytes: number;
  deltaBytes: number;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
  note?: string | null;
  measurementTruncated?: boolean;
  auditError?: string | null;
}

export interface GrowthEntry {
  provider: string;
  category: string;
  currentBytes: number;
  previousBytes: number;
  deltaBytes: number;
  windowSeconds: number;
  ratePerHour: number;
  level: "ok" | "attention" | "critical";
}

export interface GrowthReport {
  entries: GrowthEntry[];
  singleFileThresholdBytes: number;
}

export interface AuditEntry {
  targetId: string;
  ruleId: string;
  path: string;
  success: boolean;
  verified: boolean;
  errorCode?: string | null;
  bytes: number;
}

export interface AuditRecord {
  id: string;
  timestamp: string;
  sessionId: string;
  planId: string;
  mode: DeleteMode;
  successCount: number;
  errorCount: number;
  reclaimBytes: number;
  movedBytes: number;
  durationMs: number;
  entries: AuditEntry[];
  cancelled?: boolean;
  processedCount?: number;
  skippedCount?: number;
}

/** One per-category byte measurement, captured after a scan. */
export interface StorageSnapshot {
  timestamp: string;
  provider: string;
  category: string;
  bytes: number;
  itemCount: number;
}

/** Lifetime totals from the complete cleanup history file. */
export interface CleanupTotals {
  reclaimedBytes: number;
  movedBytes: number;
  runs: number;
  actionRuns: number;
  successCount: number;
  errorCount: number;
}

/** Free/total space of one local volume, reported by the backend. */
export interface DiskSpaceInfo {
  drive: string;
  freeBytes: number;
  totalBytes: number;
  percentUsed: number;
}

export interface ActionAuditRecord {
  id: string;
  timestamp: string;
  providerId: string;
  actionId: string;
  label: string;
  success: boolean;
  exitCode?: number | null;
  beforeBytes: number;
  afterBytes: number;
  deltaBytes: number;
  durationMs: number;
}

export interface AgentPolicy {
  allowCacheCleanup: boolean;
  protectBrowserRecordings: boolean;
}

export interface CustomAgentProvider {
  id: string;
  name: string;
  rootPaths: string[];
  createdAt?: string | null;
}

export type SidebarMode = "expanded" | "collapsed";
export type CacheMeasureMode = "fast" | "full";

/** What the window close button does: ask every time, or apply a remembered choice. */
export type CloseAction = "ask" | "tray" | "quit";

export type NotificationChannel = "both" | "in_app" | "desktop" | "none";

export interface NotificationPreferences {
  scanComplete: NotificationChannel;
  cleanComplete: NotificationChannel;
  diskPressure: NotificationChannel;
  processLock: NotificationChannel;
  automationWebhook: NotificationChannel;
  soundEnabled: boolean;
}

export interface AppSettings {
  schemaVersion: number;
  theme: string;
  reduceMotion: boolean;
  favorites: FavoriteLocation[];
  recentLocations: string[];
  lastScanPath: string | null;
  sort: SortOption;
  language?: SupportedLanguage | null;
  protectedPaths: string[];
  excludedNames: string[];
  scanProfile: string;
  maxDepth: number;
  maxCandidates: number;
  timeoutMinutes: number;
  minSizeBytes: number;
  maskPaths: boolean;
  historyEnabled: boolean;
  agentPolicy: AgentPolicy;
  sidebarMode: SidebarMode;
  cacheMeasureMode: CacheMeasureMode;
  closeAction: CloseAction;
  customAgentProviders: CustomAgentProvider[];
  hiddenBuiltinProviders: string[];
  notifications?: NotificationPreferences;
  webhookUrl?: string | null;
  webhookOnScan?: boolean;
  webhookOnClean?: boolean;
  shortcuts?: Record<string, string>;
  mcpAllowDestructive?: boolean;
  /** Backend recovered fields from a malformed config; not persisted. */
  recoveredFromCorrupt?: boolean;
}

export const DEFAULT_SHORTCUTS: Record<string, string> = {
  toggleSidebar: "Ctrl+B",
  focusSearch: "Ctrl+K",
  startStopScan: "Ctrl+Enter",
  navOverview: "Alt+1",
  navProjects: "Alt+2",
  navAgents: "Alt+3",
  navCaches: "Alt+4",
  navDocs: "Alt+5",
  navHistory: "Alt+6",
  navSettings: "Alt+7",
  navSystem: "Alt+8",
};

export const RESERVED_SHORTCUTS = new Set([
  "Ctrl+W",
  "Ctrl+R",
  "Ctrl+Shift+R",
  "Ctrl+J",
  "Ctrl+P",
  "Ctrl+U",
  "Ctrl+S",
  "Ctrl+H",
  "Ctrl+D",
  "Ctrl+O",
  "Ctrl+N",
  "Ctrl+T",
  "F1",
  "F3",
  "F5",
  "F7",
  "Alt+F4",
  "F11",
  "F12",
]);

export interface KnownLocation {
  id: string;
  path: string;
  label: string;
  source: string;
}

/** Identity of the compiled build, embedded by the Rust build script. */
export interface BuildInfo {
  version: string;
  commit: string;
  commitShort: string;
  dirty: boolean;
  profile: "debug" | "release";
  builtAt: string;
}

/** One downloadable file attached to a published release. */
export interface UpdateAsset {
  name: string;
  size: number;
  downloadUrl: string;
}

/**
 * Result of a user-initiated update check.
 *
 * `available` is computed in Rust from a semver comparison, so the UI never has
 * to compare version strings itself (and cannot get `1.9` vs `1.10` wrong).
 */
export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  available: boolean;
  releaseName: string;
  releaseUrl: string;
  notes: string;
  publishedAt: string;
  assets: UpdateAsset[];
}

/** Input for the on-device support ZIP. Every field is already sanitized. */
export interface SupportBundleRequest {
  version: string;
  locale: string;
  generatedAt: string;
  errorLog: string;
  systemLog: string;
  settingsSummary: string;
  systemInfo: string;
}

export interface SupportBundle {
  path: string;
  fileName: string;
  bytes: number;
  createdAt: string;
}

export interface SupportMailResult {
  /** `draft` = client opened with the attachment; `mailto` = plain draft. */
  mode: string;
  path: string;
  message: string;
}

export type AppErrorCode =
  | "InvalidPath"
  | "AccessDenied"
  | "PathNotFound"
  | "ScanCancelled"
  | "ScanFailed"
  | "UnsafeDeleteTarget"
  | "RecycleBinFailed"
  | "RecycleBinTooSmall"
  | "RecycleBinDisabled"
  | "RecycleBinNotFound"
  | "RecycleBinPathTooLong"
  | "RecycleBinSharingViolation"
  | "RecycleBinAccessDenied"
  | "RecycleBinAborted"
  | "RecycleBinComFailed"
  | "PermanentDeleteFailed"
  | "SettingsReadFailed"
  | "SettingsWriteFailed"
  | "PlatformUnsupported"
  | "SessionInvalid"
  | "SessionExpired"
  | "PlanInvalid"
  | "PlanExpired"
  | "PlanChanged"
  | "Blocked"
  | "Network"
  | "Unknown";

export interface AppErrorDto {
  code: AppErrorCode;
  message: string;
}

/* -------------------------------------------------------------------------- */
/* System cleanup (C: drive cleaner)                                           */
/* -------------------------------------------------------------------------- */

export type SystemActionId =
  | "userTemp"
  | "windowsTemp"
  | "prefetch"
  | "windowsUpdate"
  | "errorReports"
  | "recycleBin"
  | "diskCleanup"
  | "componentStore";

export type SystemSafety = "safe" | "regenerate" | "review";

export interface SystemActionInfo {
  id: SystemActionId;
  safety: SystemSafety;
  requiresAdmin: boolean;
  available: boolean;
  reason?: string | null;
  /** Folder or tool the action operates on, shown under the label. */
  path?: string | null;
  bytes: number;
  fileCount: number;
  measured: boolean;
}

export interface SystemScanReport {
  elevated: boolean;
  actions: SystemActionInfo[];
  totalBytes: number;
  disk?: DiskSpaceInfo | null;
  scannedAt: string;
  warnings: string[];
}

export interface SystemPreview {
  token: string;
  actions: SystemActionInfo[];
  totalBytes: number;
  expiresMs: number;
  requiresAdmin: boolean;
  elevated: boolean;
}

export type SystemEvent =
  | { type: "started"; total: number }
  | { type: "actionStarted"; id: SystemActionId; index: number; total: number }
  | {
      type: "actionFinished";
      id: SystemActionId;
      success: boolean;
      freedBytes: number;
      skipped: number;
    }
  | { type: "finished"; freedBytes: number; cancelled: boolean };

export interface SystemActionResult {
  id: SystemActionId;
  success: boolean;
  freedBytes: number;
  deletedFiles: number;
  skipped: number;
  skippedSample: string[];
  exitCode?: number | null;
  logTail?: string | null;
  durationMs: number;
  errorCode?: string | null;
}

export interface SystemCleanReport {
  results: SystemActionResult[];
  freedBytes: number;
  cancelled: boolean;
  startedAt: string;
  finishedAt: string;
  elevated: boolean;
}

export type SystemAutomationFrequency = "daily" | "weekly";
export type SystemAutomationProfile = "quick" | "standard" | "deep";

export interface SystemAutomationConfig {
  enabled: boolean;
  frequency: string;
  time: string;
  weekday: number;
  profile: string;
  installed: boolean;
  lastRun?: string | null;
  lastFreedBytes?: number | null;
}
