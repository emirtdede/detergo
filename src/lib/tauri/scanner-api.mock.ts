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
  CleanupEvent,
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
import type { ScannerApi } from "./scanner-api";

// Demo/offline data used when the app runs outside Tauri (browser preview and
// unit tests). This module is imported dynamically only when `import.meta.env.DEV`
// is true, so none of it ships in a production bundle.

let memorySettings: AppSettings = {
  schemaVersion: 4,
  theme: "dark-black",
  language: "tr",
  reduceMotion: false,
  favorites: [
    {
      id: "fav-1",
      path: "~/dev/projects",
      label: "Projects",
      createdAt: "2026-11-01T10:00:00Z",
      lastUsedAt: "2026-11-05T01:00:00Z",
    },
    {
      id: "fav-2",
      path: "~/Desktop",
      label: "Desktop",
      createdAt: "2026-11-01T10:00:00Z",
      lastUsedAt: "2026-11-04T18:00:00Z",
    },
  ],
  recentLocations: ["~/dev/node-cleaner", "~/dev/web-apps", "~/Desktop"],
  lastScanPath: "~/dev/node-cleaner",
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
  shortcuts: {
    toggleSidebar: "Ctrl+B",
    focusSearch: "Ctrl+K",
    startStopScan: "Ctrl+Enter",
  },
  mcpAllowDestructive: false,
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

const mockAuditRecords: AuditRecord[] = [
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

let isFolderDialogOpen = false;

/**
 * Returns a fully in-memory `ScannerApi` for browser previews and unit tests.
 * Never imported by a production build.
 */
export function createMockScannerApi(): ScannerApi {
  return {
    async startScan(
      _request: ScanRequest,
      _onEvent: (event: ScanEvent) => void,
    ): Promise<ScanSummary> {
      // Tag the error with a stable code so the UI can localize it through
      // localizeAppError() instead of surfacing this English message.
      const error = new Error("Scanning is only available in the desktop application.") as Error & {
        code?: string;
      };
      error.code = "PlatformUnsupported";
      throw error;
    },

    async cancelScan(): Promise<void> {
      return;
    },

    async getCatalog(): Promise<CatalogDto> {
      return { schemaVersion: 1, rules: fallbackRules, valid: true, error: null };
    },

    async getScanSummary(_scanSessionId?: string): Promise<ScanSummary | null> {
      return null;
    },

    async getAgentProviders(): Promise<AgentProviderInfo[]> {
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
          note: "Archived sessions; managed via official commands.",
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
          note: "Conversations and file-history are preserved; only verified cache and task outputs can be cleaned.",
        },
        {
          id: "antigravity",
          name: "Google Antigravity",
          installed: true,
          roots: [
            { path: "~/.gemini/antigravity/brain", kind: "cache", source: "default", exists: true },
            {
              path: "~/.gemini/antigravity/scratch",
              kind: "temp",
              source: "default",
              exists: true,
            },
          ],
          readOnly: false,
          note: "Downloaded local models and identities are preserved read-only; temporary logs and update remnants can be cleaned.",
        },
      ];
    },

    async addCustomAgentProvider(name: string, rootPaths: string[]): Promise<AppSettings> {
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
    },

    async removeCustomAgentProvider(id: string): Promise<AppSettings> {
      memorySettings = {
        ...memorySettings,
        customAgentProviders: memorySettings.customAgentProviders.filter((p) => p.id !== id),
      };
      return memorySettings;
    },

    async setAgentProviderHidden(id: string, hidden: boolean): Promise<AppSettings> {
      const hiddenSet = new Set(memorySettings.hiddenBuiltinProviders);
      if (hidden) hiddenSet.add(id);
      else hiddenSet.delete(id);
      memorySettings = { ...memorySettings, hiddenBuiltinProviders: Array.from(hiddenSet) };
      return memorySettings;
    },

    async getKnownLocations(): Promise<KnownLocation[]> {
      return [
        { id: "desktop", label: "Desktop", path: "~/Desktop", source: "windows" },
        { id: "documents", label: "Documents", path: "~/Documents", source: "windows" },
        { id: "downloads", label: "Downloads", path: "~/Downloads", source: "windows" },
      ];
    },

    async openPathInExplorer(_path: string): Promise<void> {
      return;
    },

    async openUrl(url: string): Promise<void> {
      if (typeof window !== "undefined") {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    },

    async selectFolderDialog(_title?: string): Promise<string | null> {
      if (isFolderDialogOpen) return null;
      isFolderDialogOpen = true;
      try {
        return null;
      } finally {
        isFolderDialogOpen = false;
      }
    },

    async previewCleanup(
      scanSessionId: string,
      targetIds: string[],
      mode: DeleteMode,
    ): Promise<CleanupPlan> {
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
      _confirmationToken: string,
      _permanentAcknowledged: boolean,
      onEvent?: (event: CleanupEvent) => void,
    ): Promise<CleanupReport> {
      onEvent?.({ type: "started", total: 1 });
      onEvent?.({
        type: "itemStarted",
        index: 1,
        total: 1,
        displayPath: "D:\\dev\\projects\\web-platform\\node_modules",
      });
      onEvent?.({
        type: "itemFinished",
        index: 1,
        total: 1,
        success: true,
        errorCode: null,
      });
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
        cancelled: false,
        processedCount: 1,
        skippedCount: 0,
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

    async cancelCleanup(): Promise<void> {
      return;
    },

    async getCacheProviders(): Promise<CacheProviderInfo[]> {
      return [
        {
          id: "npm",
          name: "npm",
          detected: true,
          version: "10.8.2",
          cachePaths: [{ path: "~/.npm/_cacache", exists: true, bytes: 3450000000 }],
          totalBytes: 3450000000,
          readOnly: false,
          measured: true,
          actions: [
            {
              id: "npm.cache.clean",
              label: "npm cache clean --force",
              description: "Cleans npm cache via the official command.",
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
          name: "pip",
          detected: true,
          version: "24.2",
          cachePaths: [{ path: "~/.cache/pip", exists: true, bytes: 1820000000 }],
          totalBytes: 1820000000,
          readOnly: false,
          measured: true,
          actions: [
            {
              id: "pip.cache.purge",
              label: "pip cache purge",
              description: "Purges pip wheel cache via the official command.",
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
          name: "Cargo",
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
              description:
                "Downloaded .crate archives and git repositories cache. Re-downloaded during compilation as needed.",
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

    async measureCacheProviders(_onEvent: (event: CacheMeasureEvent) => void): Promise<void> {
      return;
    },

    async cancelCacheMeasurement(): Promise<void> {
      return;
    },

    async previewOfficialAction(
      _providerId: string,
      _actionId: string,
    ): Promise<OfficialActionPreview> {
      return {
        token: "action-token-mock",
        providerId: "npm",
        actionId: "npm.cache.clean",
        executable: "npm",
        args: ["cache", "clean", "--force"],
        beforeBytes: 3450000000,
        warning: "",
        expiresMs: Date.now() + 300000,
      };
    },

    async executeOfficialAction(_token: string): Promise<OfficialActionResult> {
      return {
        success: true,
        exitCode: 0,
        providerId: "npm",
        actionId: "npm.cache.clean",
        label: "npm cache clean --force",
        beforeBytes: 3450000000,
        afterBytes: 0,
        deltaBytes: 3450000000,
        durationMs: 420,
        stdoutTail: "Simulated (browser preview)",
        stderrTail: "",
      };
    },

    async getCleanupHistory(limit = 200): Promise<AuditRecord[]> {
      return mockAuditRecords.slice(0, limit);
    },

    async getOfficialActionHistory(_limit = 200): Promise<ActionAuditRecord[]> {
      return [];
    },

    async clearCleanupHistory(): Promise<void> {
      return;
    },

    async clearCleanupsHistory(): Promise<void> {
      return;
    },

    async clearActionsHistory(): Promise<void> {
      return;
    },

    async getGrowthReport(): Promise<GrowthReport> {
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
    },

    async getAppSettings(): Promise<AppSettings> {
      return memorySettings;
    },

    async saveAppSettings(settings: AppSettings): Promise<void> {
      memorySettings = { ...settings };
    },

    async saveLastScan(_snapshot: LastScanSnapshot): Promise<void> {
      return;
    },

    async getLastScan(): Promise<LastScanSnapshot | null> {
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
            {
              provider: "Node.js",
              logicalBytes: 1420000000,
              allocatedBytes: 1420000000,
              itemCount: 1,
              protectedBytes: 0,
            },
            {
              provider: "Rust",
              logicalBytes: 3840000000,
              allocatedBytes: 3840000000,
              itemCount: 1,
              protectedBytes: 0,
            },
            {
              provider: "Python",
              logicalBytes: 2150000000,
              allocatedBytes: 2150000000,
              itemCount: 1,
              protectedBytes: 0,
            },
            {
              provider: ".NET",
              logicalBytes: 890000000,
              allocatedBytes: 890000000,
              itemCount: 1,
              protectedBytes: 890000000,
            },
            {
              provider: "Java/Kotlin",
              logicalBytes: 1670000000,
              allocatedBytes: 1670000000,
              itemCount: 1,
              protectedBytes: 0,
            },
            {
              provider: "Dart/Flutter",
              logicalBytes: 640000000,
              allocatedBytes: 640000000,
              itemCount: 1,
              protectedBytes: 0,
            },
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
            note: "Protected",
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
    },

    async clearLastScan(): Promise<void> {
      return;
    },

    async hideToTray(): Promise<void> {
      return;
    },

    async quitApp(): Promise<void> {
      return;
    },

    async getBuildInfo(): Promise<BuildInfo> {
      return {
        version: "2.2.1",
        commit: "demo",
        commitShort: "demo",
        dirty: false,
        profile: "release",
        builtAt: "2026-11-05T02:00:00Z",
      };
    },

    async testWebhook(
      _url: string,
      _payload?: Record<string, unknown>,
    ): Promise<{ ok: boolean; status: number; latencyMs: number; message: string }> {
      return { ok: true, status: 200, latencyMs: 12, message: "Simulated (browser preview)" };
    },
  };
}
