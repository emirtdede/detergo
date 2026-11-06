export type ThemeMode =
  | "dark-black"
  | "dark-gray"
  | "dark-blue"
  | "dark-purple"
  | "dark-green"
  | "dark-red"
  | "dark-orange"
  | "dark-yellow"
  | "light-white"
  | "light-gray"
  | "light-blue"
  | "light-purple"
  | "light-green"
  | "light-red"
  | "light-orange"
  | "light-yellow";

/** Theme ids persisted by releases before the four-theme consolidation. */
export type LegacyThemeMode =
  | "dark-blue"
  | "dark-purple"
  | "dark-green"
  | "dark-red"
  | "dark-orange"
  | "dark-yellow"
  | "light-blue"
  | "light-purple"
  | "light-green"
  | "light-red"
  | "light-orange"
  | "light-yellow"
  | "dark-transparent"
  | "white-transparent"
  | "transparent"
  | "black"
  | "white";

export type SupportedLanguage =
  | "tr" | "en" | "de" | "es" | "fr" | "it" | "pt" | "nl" | "pl" | "ru"
  | "ja" | "ko" | "zh" | "zh-tw" | "sv" | "ar" | "hi" | "id" | "vi" | "uk"
  | "el" | "cs" | "da" | "fi" | "no" | "hu" | "ro" | "th" | "ms" | "fil"
  | "bn" | "he" | "fa" | "ur" | "az" | "kk" | "uz" | "bg" | "sk" | "hr"
  | "et" | "ta" | "te" | "mr" | "kn" | "gu" | "ml" | "pa" | "lt" | "lv"
  | "sr" | "sl" | "bs" | "sq" | "mk" | "is" | "sw" | "am" | "ha" | "yo"
  | "af" | "ka" | "hy" | "ky" | "tk" | "mn" | "ca" | "eu" | "gl" | "ga"
  | "my" | "km" | "si";

export interface FavoriteLocation {
  id: string;
  label: string;
  path: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface SortOption {
  field:
    | "size"
    | "modified"
    | "name"
    | "safety"
    | "project"
    | "category";
  direction: "asc" | "desc";
}

export type SafetyClass = "safe" | "regenerate" | "review" | "keep";
export type Confidence = "high" | "medium" | "low";
export type ActiveUse = "yes" | "no" | "unknown";
export type CleanupMethod = "trash" | "permanent" | "officialTool" | "none";
export type TargetKind = "directory" | "file" | "fileGroup";
export type ItemStatus = "discovered" | "measuring" | "ready" | "blocked" | "error" | "deleted";
export type ScanScope = "project" | "agents" | "globalCaches" | "allDrives";

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
  _searchHaystack?: string;
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
  durationMs: number;
  errorsCount: number;
  warningsCount: number;
  directoriesVisited: number;
  partial: boolean;
  stopReason?: string | null;
  providerTotals: ProviderTotal[];
}

/** Only the most recent scan is persisted, so the app never opens empty. */
export interface LastScanSnapshot {
  schemaVersion: number;
  savedAt: string;
  summary: ScanSummary;
  items: CleanupItem[];
}

export type ScanEvent =
  | { type: "started"; scanId: string }
  | { type: "candidates"; items: CleanupItem[] }
  | { type: "measured"; updates: MeasurementUpdate[] }
  | { type: "progress"; progress: ScanProgress }
  | { type: "warning"; code: string; path?: string | null }
  | { type: "completed"; summary: ScanSummary }
  | { type: "cancelled"; summary: ScanSummary }
  | { type: "failed"; error: AppErrorDto };

export interface CatalogRule {
  id: string;
  ecosystem: string;
  category: string;
  kind: TargetKind;
  names: string[];
  markers: string[];
  markerMode: "any" | "all";
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
  gitPolicy: string;
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
  auditError?: string | null;
}

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
  warning: string;
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
}

export interface StorageSnapshot {
  timestamp: string;
  provider: string;
  category: string;
  bytes: number;
  itemCount: number;
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
}

export const DEFAULT_SHORTCUTS: Record<string, string> = {
  toggleSidebar: 'Ctrl+B',
  focusSearch: 'Ctrl+K',
  startStopScan: 'Ctrl+Enter',
  navOverview: 'Alt+1',
  navProjects: 'Alt+2',
  navAgents: 'Alt+3',
  navCaches: 'Alt+4',
  navDocs: 'Alt+5',
  navHistory: 'Alt+6',
  navSettings: 'Alt+7',
};

export const RESERVED_SHORTCUTS = new Set([
  'Ctrl+W',
  'Ctrl+R',
  'Ctrl+Shift+R',
  'Ctrl+J',
  'Ctrl+P',
  'Ctrl+U',
  'Ctrl+S',
  'Ctrl+H',
  'Ctrl+D',
  'Ctrl+O',
  'Ctrl+N',
  'Ctrl+T',
  'F1',
  'F3',
  'F5',
  'F7',
  'Alt+F4',
  'F11',
  'F12',
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

export type AppErrorCode =
  | "InvalidPath"
  | "AccessDenied"
  | "PathNotFound"
  | "ScanCancelled"
  | "ScanFailed"
  | "UnsafeDeleteTarget"
  | "RecycleBinFailed"
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
  | "Unknown";

export interface AppErrorDto {
  code: AppErrorCode;
  message: string;
}
