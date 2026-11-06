import { invoke, Channel } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ActionAuditRecord,
  AgentProviderInfo,
  AppSettings,
  AuditRecord,
  BuildInfo,
  CacheMeasureEvent,
  CacheProviderInfo,
  CatalogDto,
  CatalogRule,
  CleanupPlan,
  CleanupReport,
  DeleteMode,
  GrowthReport,
  KnownLocation,
  LastScanSnapshot,
  OfficialActionPreview,
  OfficialActionResult,
  ScanEvent,
  ScanRequest,
  ScanSummary,
} from "@/types";

export function isTauriEnvironment(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
  );
}

export interface ScannerApi {
  startScan(request: ScanRequest, onEvent: (event: ScanEvent) => void): Promise<ScanSummary>;
  cancelScan(): Promise<void>;
  getCatalog(): Promise<CatalogDto>;
  getScanSummary(scanSessionId?: string): Promise<ScanSummary | null>;
  getAgentProviders(): Promise<AgentProviderInfo[]>;
  addCustomAgentProvider(name: string, rootPaths: string[]): Promise<AppSettings>;
  removeCustomAgentProvider(id: string): Promise<AppSettings>;
  setAgentProviderHidden(id: string, hidden: boolean): Promise<AppSettings>;
  getKnownLocations(): Promise<KnownLocation[]>;
  openPathInExplorer(path: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  selectFolderDialog(title?: string): Promise<string | null>;
  previewCleanup(
    scanSessionId: string,
    targetIds: string[],
    mode: DeleteMode
  ): Promise<CleanupPlan>;
  executeCleanup(
    planId: string,
    confirmationToken: string,
    permanentAcknowledged: boolean
  ): Promise<CleanupReport>;
  getCacheProviders(): Promise<CacheProviderInfo[]>;
  measureCacheProviders(onEvent: (event: CacheMeasureEvent) => void): Promise<void>;
  cancelCacheMeasurement(): Promise<void>;
  previewOfficialAction(providerId: string, actionId: string): Promise<OfficialActionPreview>;
  executeOfficialAction(token: string): Promise<OfficialActionResult>;
  getCleanupHistory(limit?: number): Promise<AuditRecord[]>;
  getOfficialActionHistory(limit?: number): Promise<ActionAuditRecord[]>;
  clearCleanupHistory(): Promise<void>;
  clearCleanupsHistory(): Promise<void>;
  clearActionsHistory(): Promise<void>;
  getGrowthReport(): Promise<GrowthReport>;
  getAppSettings(): Promise<AppSettings>;
  saveAppSettings(settings: AppSettings): Promise<void>;
  getLastScan(): Promise<LastScanSnapshot | null>;
  saveLastScan(snapshot: LastScanSnapshot): Promise<void>;
  clearLastScan(): Promise<void>;
  hideToTray(): Promise<void>;
  quitApp(): Promise<void>;
  getBuildInfo(): Promise<BuildInfo>;
}

let memorySettings: AppSettings = {
  schemaVersion: 3,
  theme: "dark-black",
  language: "tr",
  reduceMotion: false,
  favorites: [
    {
      id: "fav-1",
      path: "D:\\dev\\projects",
      label: "Projeler",
      createdAt: "2026-11-01T10:00:00Z",
      lastUsedAt: "2026-11-05T01:00:00Z",
    },
    {
      id: "fav-2",
      path: "C:\\Users\\emir\\Desktop",
      label: "Masaüstü",
      createdAt: "2026-11-01T10:00:00Z",
      lastUsedAt: "2026-11-04T18:00:00Z",
    },
  ],
  recentLocations: [
    "D:\\SOFTWARE DEVELOPMENT\\Tools\\Node_Cleaner",
    "D:\\dev\\web-apps",
    "C:\\Users\\emir\\Desktop",
  ],
  lastScanPath: "D:\\SOFTWARE DEVELOPMENT\\Tools\\Node_Cleaner",
  sort: { field: "size", direction: "desc" },
  protectedPaths: ["C:\\Windows", "C:\\Program Files"],
  excludedNames: [".git", "node_modules/.bin"],
  scanProfile: "balanced",
  maxDepth: 32,
  maxCandidates: 50000,
  timeoutMinutes: 15,
  minSizeBytes: 0,
  maskPaths: false,
  historyEnabled: true,
  agentPolicy: { allowCacheCleanup: true, protectBrowserRecordings: true },
  sidebarMode: "expanded",
  cacheMeasureMode: "fast",
  closeAction: "ask",
  customAgentProviders: [],
  hiddenBuiltinProviders: [],
  notifications: {
    scanComplete: "both",
    cleanComplete: "both",
    diskPressure: "both",
    processLock: "in_app",
    automationWebhook: "both",
    soundEnabled: true,
  },
  webhookUrl: null,
  webhookOnScan: true,
  webhookOnClean: true,
};

const fallbackRules: CatalogRule[] = [
  {
    id: "npm-node-modules",
    ecosystem: "javascript",
    category: "dependencies",
    kind: "directory",
    names: ["node_modules"],
    markers: ["package.json"],
    markerMode: "any",
    content: [],
    minEvidence: 1,
    safety: "safe",
    confidence: "high",
    cleanup: "trash",
    regenerate: "npm install",
    genericName: false,
    protected: false,
    nestedIn: [],
    childRules: [],
    gitPolicy: "ignore",
    requiresIdle: false,
  },
  {
    id: "cargo-target",
    ecosystem: "rust",
    category: "build-output",
    kind: "directory",
    names: ["target"],
    markers: ["Cargo.toml"],
    markerMode: "any",
    content: [],
    minEvidence: 1,
    safety: "safe",
    confidence: "high",
    cleanup: "trash",
    regenerate: "cargo build",
    genericName: false,
    protected: false,
    nestedIn: [],
    childRules: [],
    gitPolicy: "ignore",
    requiresIdle: false,
  },
  {
    id: "python-venv",
    ecosystem: "python",
    category: "environments",
    kind: "directory",
    names: [".venv", "venv"],
    markers: ["pyproject.toml", "requirements.txt"],
    markerMode: "any",
    content: [],
    minEvidence: 1,
    safety: "regenerate",
    confidence: "high",
    cleanup: "trash",
    regenerate: "python -m venv .venv",
    genericName: false,
    protected: false,
    nestedIn: [],
    childRules: [],
    gitPolicy: "ignore",
    requiresIdle: false,
  },
];

let isFolderDialogOpen = false;

export const scannerApi: ScannerApi = {
  async startScan(request: ScanRequest, onEvent: (event: ScanEvent) => void): Promise<ScanSummary> {
    if (!isTauriEnvironment()) {
      throw new Error("Tarama yalnızca masaüstü uygulamasında kullanılabilir.");
    }
    const channel = new Channel<ScanEvent>();
    channel.onmessage = (event: ScanEvent) => onEvent(event);
    return await invoke<ScanSummary>("start_scan", { request, onEvent: channel });
  },

  async cancelScan(): Promise<void> {
    if (!isTauriEnvironment()) {
      return;
    }
    await invoke("cancel_scan");
  },

  async getCatalog(): Promise<CatalogDto> {
    if (isTauriEnvironment()) {
      return await invoke<CatalogDto>("get_catalog");
    }
    return { schemaVersion: 1, rules: fallbackRules, valid: true, error: null };
  },

  async getScanSummary(scanSessionId?: string): Promise<ScanSummary | null> {
    if (isTauriEnvironment()) {
      return await invoke<ScanSummary | null>("get_scan_summary", { scanSessionId: scanSessionId ?? null });
    }
    return null;
  },

  async getAgentProviders(): Promise<AgentProviderInfo[]> {
    if (isTauriEnvironment()) {
      return await invoke<AgentProviderInfo[]>("get_agent_providers");
    }
    return [
      {
        id: "codex",
        name: "OpenAI Codex / CLI",
        installed: true,
        roots: [
          { path: "~/.codex/cache", kind: "cache", source: "default", exists: true },
          { path: "~/.codex/sessions", kind: "sessions", source: "default", exists: true },
        ],
        readOnly: false,
        note: "CLI önbellek ve geçici oturum dosyaları",
      },
      {
        id: "claude-code",
        name: "Claude Code",
        installed: true,
        roots: [
          { path: "~/.claude/cache", kind: "cache", source: "default", exists: true },
          { path: "~/.claude/logs", kind: "logs", source: "default", exists: true },
        ],
        readOnly: false,
        note: "Oturum geçmişi ve telemetri logları",
      },
      {
        id: "antigravity",
        name: "Google Antigravity",
        installed: true,
        roots: [
          { path: "~/.gemini/antigravity/brain", kind: "cache", source: "default", exists: true },
          { path: "~/.gemini/antigravity/scratch", kind: "temp", source: "default", exists: true },
        ],
        readOnly: false,
        note: "Gelişmiş ajan çalışma alanı ve geçici loglar",
      },
    ];
  },

  async addCustomAgentProvider(name: string, rootPaths: string[]): Promise<AppSettings> {
    if (!isTauriEnvironment()) {
      const newProvider = {
        id: `custom-${Date.now()}`,
        name,
        rootPaths,
        createdAt: new Date().toISOString(),
      };
      memorySettings = {
        ...memorySettings,
        customAgentProviders: [...memorySettings.customAgentProviders, newProvider],
      };
      return memorySettings;
    }
    return await invoke<AppSettings>("add_custom_agent_provider", { name, rootPaths });
  },

  async removeCustomAgentProvider(id: string): Promise<AppSettings> {
    if (!isTauriEnvironment()) {
      memorySettings = {
        ...memorySettings,
        customAgentProviders: memorySettings.customAgentProviders.filter((p) => p.id !== id),
      };
      return memorySettings;
    }
    return await invoke<AppSettings>("remove_custom_agent_provider", { id });
  },

  async setAgentProviderHidden(id: string, hidden: boolean): Promise<AppSettings> {
    if (!isTauriEnvironment()) {
      const hiddenSet = new Set(memorySettings.hiddenBuiltinProviders);
      if (hidden) hiddenSet.add(id);
      else hiddenSet.delete(id);
      memorySettings = { ...memorySettings, hiddenBuiltinProviders: Array.from(hiddenSet) };
      return memorySettings;
    }
    return await invoke<AppSettings>("set_agent_provider_hidden", { id, hidden });
  },

  async getKnownLocations(): Promise<KnownLocation[]> {
    if (isTauriEnvironment()) {
      return await invoke<KnownLocation[]>("get_known_locations");
    }
    return [
      { id: "desktop", label: "Masaüstü", path: "C:\\Users\\emir\\Desktop", source: "windows" },
      { id: "documents", label: "Belgeler", path: "C:\\Users\\emir\\Documents", source: "windows" },
      { id: "downloads", label: "İndirilenler", path: "C:\\Users\\emir\\Downloads", source: "windows" },
    ];
  },

  async openPathInExplorer(path: string): Promise<void> {
    if (!isTauriEnvironment()) {
      return;
    }
    await invoke("open_path_in_explorer", { path });
  },

  async openUrl(url: string): Promise<void> {
    if (isTauriEnvironment()) {
      await invoke("open_url", { url });
      return;
    }
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  },

  async selectFolderDialog(title?: string): Promise<string | null> {
    if (isFolderDialogOpen) return null;
    isFolderDialogOpen = true;
    try {
      if (isTauriEnvironment()) {
        const selected = await open({
          directory: true,
          multiple: false,
          title: title ?? "Select folder",
        });
        return typeof selected === "string" ? selected : null;
      }
      return null;
    } finally {
      isFolderDialogOpen = false;
    }
  },

  async previewCleanup(
    scanSessionId: string,
    targetIds: string[],
    mode: DeleteMode
  ): Promise<CleanupPlan> {
    if (isTauriEnvironment()) {
      return await invoke<CleanupPlan>("preview_cleanup", { scanSessionId, targetIds, mode });
    }
    return {
      id: "plan-mock-1",
      sessionId: scanSessionId,
      mode,
      createdMs: Date.now(),
      expiresMs: Date.now() + 600000,
      totalLogicalBytes: 1420000000,
      totalEstimatedBytes: 1420000000,
      eligibleCount: targetIds.length,
      blockedCount: 0,
      confirmationToken: "token-mock-xyz",
      items: targetIds.map((id) => ({
        targetId: id,
        displayPath: "D:\\dev\\projects\\web-platform\\node_modules",
        displayName: "node_modules",
        ruleId: "npm-node-modules",
        provider: "project",
        projectName: "web-platform",
        safetyClass: "safe",
        cleanupMethod: "trash",
        logicalBytes: 1420000000,
        estimatedReclaimBytes: 1420000000,
        activeUse: "no",
        eligible: true,
        snapshot: {
          exists: true,
          logicalBytes: 1420000000,
        },
      })),
    };
  },

  async executeCleanup(
    planId: string,
    confirmationToken: string,
    permanentAcknowledged: boolean
  ): Promise<CleanupReport> {
    if (isTauriEnvironment()) {
      return await invoke<CleanupReport>("execute_cleanup", {
        planId,
        confirmationToken,
        permanentAcknowledged,
      });
    }
    return {
      planId,
      mode: "recycleBin",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      successCount: 1,
      errorCount: 0,
      estimatedBytes: 1420000000,
      reclaimBytes: 1420000000,
      movedBytes: 1420000000,
      durationMs: 340,
      results: [
        {
          targetId: "item-1",
          displayPath: "D:\\dev\\projects\\web-platform\\node_modules",
          ruleId: "npm-node-modules",
          success: true,
          verified: true,
          measuredBytes: 1420000000,
          reclaimBytes: 1420000000,
        },
      ],
    };
  },

  async getCacheProviders(): Promise<CacheProviderInfo[]> {
    if (isTauriEnvironment()) {
      return await invoke<CacheProviderInfo[]>("get_cache_providers");
    }
    return [
      {
        id: "npm",
        name: "npm Cache",
        detected: true,
        version: "10.8.2",
        cachePaths: [{ path: "~/.npm/_cacache", exists: true, bytes: 3450000000 }],
        totalBytes: 3450000000,
        readOnly: false,
        measured: true,
        actions: [
          {
            id: "clean-npm",
            label: "npm cache clean --force",
            description: "npm indirme paket önbelleğini temizler",
            executable: "npm",
            args: ["cache", "clean", "--force"],
            available: true,
            requiresNetwork: false,
            impact: "reclaim-space",
          },
        ],
      },
      {
        id: "pip",
        name: "pip Cache",
        detected: true,
        version: "24.2",
        cachePaths: [{ path: "~/.cache/pip", exists: true, bytes: 1820000000 }],
        totalBytes: 1820000000,
        readOnly: false,
        measured: true,
        actions: [
          {
            id: "clean-pip",
            label: "pip cache purge",
            description: "pip wheel ve http önbelleğini temizler",
            executable: "pip",
            args: ["cache", "purge"],
            available: true,
            requiresNetwork: false,
            impact: "reclaim-space",
          },
        ],
      },
      {
        id: "cargo",
        name: "Cargo Registry Cache",
        detected: true,
        version: "1.82.0",
        cachePaths: [{ path: "~/.cargo/registry/cache", exists: true, bytes: 5200000000 }],
        totalBytes: 5200000000,
        readOnly: false,
        measured: true,
        actions: [
          {
            id: "clean-cargo",
            label: "cargo-cache --autoclean",
            description: "Eski crates.io derleme ve paket önbelleklerini temizler",
            executable: "cargo-cache",
            args: ["--autoclean"],
            available: true,
            requiresNetwork: false,
            impact: "reclaim-space",
          },
        ],
      },
    ];
  },

  async measureCacheProviders(onEvent: (event: CacheMeasureEvent) => void): Promise<void> {
    if (!isTauriEnvironment()) {
      return;
    }
    const channel = new Channel<CacheMeasureEvent>();
    channel.onmessage = (event: CacheMeasureEvent) => onEvent(event);
    await invoke("measure_cache_providers", { onEvent: channel });
  },

  async cancelCacheMeasurement(): Promise<void> {
    if (!isTauriEnvironment()) {
      return;
    }
    await invoke("cancel_cache_measurement");
  },

  async previewOfficialAction(providerId: string, actionId: string): Promise<OfficialActionPreview> {
    return await invoke<OfficialActionPreview>("preview_official_action", { providerId, actionId });
  },

  async executeOfficialAction(token: string): Promise<OfficialActionResult> {
    return await invoke<OfficialActionResult>("execute_official_action", { token });
  },

  async getCleanupHistory(limit = 200): Promise<AuditRecord[]> {
    if (!isTauriEnvironment()) {
      return [
        {
          id: "audit-1",
          timestamp: "2026-11-04T20:15:00Z",
          sessionId: "scan-prev-1",
          planId: "plan-prev-1",
          mode: "recycleBin",
          successCount: 18,
          errorCount: 0,
          reclaimBytes: 4250000000,
          movedBytes: 4250000000,
          durationMs: 1420,
          entries: [
            {
              targetId: "target-1",
              ruleId: "npm-node-modules",
              path: "D:\\dev\\projects\\app\\node_modules",
              success: true,
              verified: true,
              bytes: 1420000000,
            },
          ],
        },
        {
          id: "audit-2",
          timestamp: "2026-11-02T14:40:00Z",
          sessionId: "scan-prev-2",
          planId: "plan-prev-2",
          mode: "recycleBin",
          successCount: 8,
          errorCount: 0,
          reclaimBytes: 1850000000,
          movedBytes: 1850000000,
          durationMs: 820,
          entries: [
            {
              targetId: "target-2",
              ruleId: "cargo-target",
              path: "D:\\dev\\web-apps\\tools\\target",
              success: true,
              verified: true,
              bytes: 1850000000,
            },
          ],
        },
      ];
    }
    return await invoke<AuditRecord[]>("get_cleanup_history", { limit });
  },

  async getOfficialActionHistory(limit = 200): Promise<ActionAuditRecord[]> {
    if (!isTauriEnvironment()) {
      return [];
    }
    return await invoke<ActionAuditRecord[]>("get_official_action_history", { limit });
  },

  async clearCleanupHistory(): Promise<void> {
    if (!isTauriEnvironment()) {
      return;
    }
    await invoke("clear_cleanup_history");
  },

  async clearCleanupsHistory(): Promise<void> {
    if (!isTauriEnvironment()) {
      return;
    }
    await invoke("clear_cleanups_history");
  },

  async clearActionsHistory(): Promise<void> {
    if (!isTauriEnvironment()) {
      return;
    }
    await invoke("clear_actions_history");
  },

  async getGrowthReport(): Promise<GrowthReport> {
    if (!isTauriEnvironment()) {
      return {
        entries: [
          {
            provider: "npm",
            category: "dependencies",
            currentBytes: 18400000000,
            previousBytes: 15200000000,
            deltaBytes: 3200000000,
            windowSeconds: 604800,
            ratePerHour: 19000000,
            level: "attention",
          },
          {
            provider: "cargo",
            category: "build-output",
            currentBytes: 8500000000,
            previousBytes: 4200000000,
            deltaBytes: 4300000000,
            windowSeconds: 604800,
            ratePerHour: 25000000,
            level: "critical",
          },
        ],
        singleFileThresholdBytes: 1073741824,
      };
    }
    return await invoke<GrowthReport>("get_growth_report");
  },

  async getAppSettings(): Promise<AppSettings> {
    if (!isTauriEnvironment()) {
      return memorySettings;
    }
    return await invoke<AppSettings>("get_app_settings");
  },

  async saveAppSettings(settings: AppSettings): Promise<void> {
    if (!isTauriEnvironment()) {
      memorySettings = { ...settings };
      return;
    }
    await invoke("save_app_settings", { settings });
  },

  async saveLastScan(snapshot: LastScanSnapshot): Promise<void> {
    if (!isTauriEnvironment()) return;
    await invoke("save_last_scan", { snapshot });
  },

  async getLastScan(): Promise<LastScanSnapshot | null> {
    if (!isTauriEnvironment()) {
      return {
        schemaVersion: 1,
        savedAt: "2026-11-04T22:30:00Z",
        summary: {
          scanId: "scan-mock-1",
          rootPath: "D:\\dev\\projects",
          scope: "project",
          totalEntries: 6,
          totalBytes: 10610000000,
          totalAllocatedBytes: 10610000000,
          protectedBytes: 890000000,
          durationMs: 1420,
          errorsCount: 0,
          warningsCount: 0,
          directoriesVisited: 420,
          partial: false,
          stopReason: null,
          providerTotals: [
            { provider: "Node.js", logicalBytes: 1420000000, allocatedBytes: 1420000000, itemCount: 1, protectedBytes: 0 },
            { provider: "Rust", logicalBytes: 3840000000, allocatedBytes: 3840000000, itemCount: 1, protectedBytes: 0 },
            { provider: "Python", logicalBytes: 2150000000, allocatedBytes: 2150000000, itemCount: 1, protectedBytes: 0 },
            { provider: ".NET", logicalBytes: 890000000, allocatedBytes: 890000000, itemCount: 1, protectedBytes: 890000000 },
            { provider: "Java/Kotlin", logicalBytes: 1670000000, allocatedBytes: 1670000000, itemCount: 1, protectedBytes: 0 },
            { provider: "Dart/Flutter", logicalBytes: 640000000, allocatedBytes: 640000000, itemCount: 1, protectedBytes: 0 },
          ],
        },
        items: [
          {
            id: "item-1",
            scanSessionId: "scan-mock-1",
            ruleId: "npm-node-modules",
            provider: "project",
            ecosystem: "javascript",
            category: "dependencies",
            kind: "directory",
            projectId: "proj-1",
            projectName: "web-platform",
            projectRoot: "D:\\dev\\projects\\web-platform",
            displayName: "node_modules",
            displayPath: "D:\\dev\\projects\\web-platform\\node_modules",
            logicalBytes: 1420000000,
            allocatedBytes: 1420000000,
            estimatedReclaimBytes: 1420000000,
            safetyClass: "safe",
            confidence: "high",
            activeUse: "no",
            evidenceCodes: ["NAME_MATCH", "PROJECT_MARKER"],
            warningCodes: [],
            cleanupMethod: "trash",
            regenerateHint: "npm install",
            protected: false,
            selectable: true,
            autoSelectable: true,
            lastModifiedAt: "2026-11-03T14:00:00Z",
            status: "ready",
            parentItemId: null,
            note: null,
          },
          {
            id: "item-2",
            scanSessionId: "scan-mock-1",
            ruleId: "cargo-target",
            provider: "project",
            ecosystem: "rust",
            category: "build-output",
            kind: "directory",
            projectId: "proj-2",
            projectName: "rust-engine",
            projectRoot: "D:\\dev\\projects\\rust-engine",
            displayName: "target",
            displayPath: "D:\\dev\\projects\\rust-engine\\target",
            logicalBytes: 3840000000,
            allocatedBytes: 3840000000,
            estimatedReclaimBytes: 3840000000,
            safetyClass: "safe",
            confidence: "high",
            activeUse: "no",
            evidenceCodes: ["NAME_MATCH", "PROJECT_MARKER"],
            warningCodes: [],
            cleanupMethod: "trash",
            regenerateHint: "cargo build",
            protected: false,
            selectable: true,
            autoSelectable: true,
            lastModifiedAt: "2026-11-04T18:00:00Z",
            status: "ready",
            parentItemId: null,
            note: null,
          },
          {
            id: "item-3",
            scanSessionId: "scan-mock-1",
            ruleId: "python-venv",
            provider: "project",
            ecosystem: "python",
            category: "environments",
            kind: "directory",
            projectId: "proj-3",
            projectName: "nlp-pipeline",
            projectRoot: "D:\\dev\\projects\\nlp-pipeline",
            displayName: ".venv",
            displayPath: "D:\\dev\\projects\\nlp-pipeline\\.venv",
            logicalBytes: 2150000000,
            allocatedBytes: 2150000000,
            estimatedReclaimBytes: 2150000000,
            safetyClass: "regenerate",
            confidence: "high",
            activeUse: "no",
            evidenceCodes: ["NAME_MATCH", "PROJECT_MARKER"],
            warningCodes: [],
            cleanupMethod: "trash",
            regenerateHint: "pip install -r requirements.txt",
            protected: false,
            selectable: true,
            autoSelectable: false,
            lastModifiedAt: "2026-11-05T00:30:00Z",
            status: "ready",
            parentItemId: null,
            note: null,
          },
          {
            id: "item-4",
            scanSessionId: "scan-mock-1",
            ruleId: "dotnet-obj",
            provider: "project",
            ecosystem: "dotnet",
            category: "build-output",
            kind: "directory",
            projectId: "proj-4",
            projectName: "enterprise-backend",
            projectRoot: "D:\\dev\\projects\\enterprise-backend",
            displayName: "bin / obj",
            displayPath: "D:\\dev\\projects\\enterprise-backend\\obj",
            logicalBytes: 890000000,
            allocatedBytes: 890000000,
            estimatedReclaimBytes: 890000000,
            safetyClass: "keep",
            confidence: "high",
            activeUse: "yes",
            evidenceCodes: ["USER_PROTECTED"],
            warningCodes: ["USER_PROTECTED"],
            cleanupMethod: "none",
            regenerateHint: null,
            protected: true,
            selectable: false,
            autoSelectable: false,
            lastModifiedAt: "2026-10-28T09:00:00Z",
            status: "ready",
            parentItemId: null,
            note: "Kullanıcı koruma listesinde",
          },
          {
            id: "item-5",
            scanSessionId: "scan-mock-1",
            ruleId: "gradle-cache",
            provider: "project",
            ecosystem: "java",
            category: "build-output",
            kind: "directory",
            projectId: "proj-5",
            projectName: "android-app",
            projectRoot: "D:\\dev\\projects\\android-app",
            displayName: ".gradle",
            displayPath: "D:\\dev\\projects\\android-app\\.gradle",
            logicalBytes: 1670000000,
            allocatedBytes: 1670000000,
            estimatedReclaimBytes: 1670000000,
            safetyClass: "safe",
            confidence: "high",
            activeUse: "no",
            evidenceCodes: ["NAME_MATCH"],
            warningCodes: [],
            cleanupMethod: "trash",
            regenerateHint: "gradle build",
            protected: false,
            selectable: true,
            autoSelectable: true,
            lastModifiedAt: "2026-11-02T11:20:00Z",
            status: "ready",
            parentItemId: null,
            note: null,
          },
          {
            id: "item-6",
            scanSessionId: "scan-mock-1",
            ruleId: "dart-tool",
            provider: "project",
            ecosystem: "dart",
            category: "dependencies",
            kind: "directory",
            projectId: "proj-6",
            projectName: "flutter-app",
            projectRoot: "D:\\dev\\projects\\flutter-app",
            displayName: ".dart_tool",
            displayPath: "D:\\dev\\projects\\flutter-app\\.dart_tool",
            logicalBytes: 640000000,
            allocatedBytes: 640000000,
            estimatedReclaimBytes: 640000000,
            safetyClass: "safe",
            confidence: "high",
            activeUse: "no",
            evidenceCodes: ["NAME_MATCH"],
            warningCodes: [],
            cleanupMethod: "trash",
            regenerateHint: "flutter pub get",
            protected: false,
            selectable: true,
            autoSelectable: true,
            lastModifiedAt: "2026-10-31T16:45:00Z",
            status: "ready",
            parentItemId: null,
            note: null,
          },
        ],
      };
    }
    return await invoke<LastScanSnapshot | null>("get_last_scan");
  },

  async clearLastScan(): Promise<void> {
    if (!isTauriEnvironment()) return;
    await invoke("clear_last_scan");
  },

  async hideToTray(): Promise<void> {
    if (!isTauriEnvironment()) return;
    await invoke("hide_to_tray");
  },

  async quitApp(): Promise<void> {
    if (!isTauriEnvironment()) return;
    await invoke("quit_app");
  },

  async getBuildInfo(): Promise<BuildInfo> {
    if (!isTauriEnvironment()) {
      return {
        version: "2.0.0",
        commit: "7b4c92a",
        commitShort: "7b4c92a",
        dirty: false,
        profile: "release",
        builtAt: "2026-11-05T02:00:00Z",
      };
    }
    return await invoke<BuildInfo>("get_build_info");
  },
};
