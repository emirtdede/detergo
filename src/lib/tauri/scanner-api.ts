import { invoke, Channel } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ActionAuditRecord,
  AgentProviderInfo,
  AppSettings,
  AuditRecord,
  CacheProviderInfo,
  CatalogDto,
  CleanupPlan,
  CleanupReport,
  DeleteMode,
  GrowthReport,
  KnownLocation,
  OfficialActionPreview,
  OfficialActionResult,
  ScanEvent,
  ScanRequest,
  ScanSummary,
} from "@/types";

const DESKTOP_ONLY = "Bu özellik yalnızca masaüstü uygulamasında kullanılabilir.";

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
  getKnownLocations(): Promise<KnownLocation[]>;
  openPathInExplorer(path: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  selectFolderDialog(): Promise<string | null>;
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
  getGlobalCacheProviders(): Promise<CacheProviderInfo[]>;
  previewOfficialAction(providerId: string, actionId: string): Promise<OfficialActionPreview>;
  executeOfficialAction(token: string): Promise<OfficialActionResult>;
  getCleanupHistory(limit?: number): Promise<AuditRecord[]>;
  getOfficialActionHistory(limit?: number): Promise<ActionAuditRecord[]>;
  clearCleanupHistory(): Promise<void>;
  getGrowthReport(): Promise<GrowthReport>;
  getAppSettings(): Promise<AppSettings>;
  saveAppSettings(settings: AppSettings): Promise<void>;
}

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
      throw new Error(DESKTOP_ONLY);
    }
    await invoke("cancel_scan");
  },

  async getCatalog(): Promise<CatalogDto> {
    if (isTauriEnvironment()) {
      return await invoke<CatalogDto>("get_catalog");
    }
    return { schemaVersion: 0, rules: [], valid: false, error: "Masaüstü ortamı gerekli." };
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
    return [];
  },

  async getKnownLocations(): Promise<KnownLocation[]> {
    if (isTauriEnvironment()) {
      return await invoke<KnownLocation[]>("get_known_locations");
    }
    return [];
  },

  async openPathInExplorer(path: string): Promise<void> {
    if (!isTauriEnvironment()) {
      throw new Error(DESKTOP_ONLY);
    }
    await invoke("open_path_in_explorer", { path });
  },

  async openUrl(url: string): Promise<void> {
    if (isTauriEnvironment()) {
      await invoke("open_url", { url });
      return;
    }
    // Browser fallback for the web preview; it is an explicit user action and
    // opens a new tab rather than pretending a desktop handler ran.
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  },

  async selectFolderDialog(): Promise<string | null> {
    if (isFolderDialogOpen) return null;
    isFolderDialogOpen = true;
    try {
      if (isTauriEnvironment()) {
        const selected = await open({
          directory: true,
          multiple: false,
          title: "Taranacak klasörü seçin",
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
    return await invoke<CleanupPlan>("preview_cleanup", { scanSessionId, targetIds, mode });
  },

  async executeCleanup(
    planId: string,
    confirmationToken: string,
    permanentAcknowledged: boolean
  ): Promise<CleanupReport> {
    return await invoke<CleanupReport>("execute_cleanup", {
      planId,
      confirmationToken,
      permanentAcknowledged,
    });
  },

  async getGlobalCacheProviders(): Promise<CacheProviderInfo[]> {
    if (isTauriEnvironment()) {
      return await invoke<CacheProviderInfo[]>("get_global_cache_providers");
    }
    return [];
  },

  async previewOfficialAction(providerId: string, actionId: string): Promise<OfficialActionPreview> {
    return await invoke<OfficialActionPreview>("preview_official_action", { providerId, actionId });
  },

  async executeOfficialAction(token: string): Promise<OfficialActionResult> {
    return await invoke<OfficialActionResult>("execute_official_action", { token });
  },

  async getCleanupHistory(limit = 200): Promise<AuditRecord[]> {
    if (!isTauriEnvironment()) {
      throw new Error(DESKTOP_ONLY);
    }
    return await invoke<AuditRecord[]>("get_cleanup_history", { limit });
  },

  async getOfficialActionHistory(limit = 200): Promise<ActionAuditRecord[]> {
    if (!isTauriEnvironment()) {
      throw new Error(DESKTOP_ONLY);
    }
    return await invoke<ActionAuditRecord[]>("get_official_action_history", { limit });
  },

  async clearCleanupHistory(): Promise<void> {
    if (!isTauriEnvironment()) {
      throw new Error(DESKTOP_ONLY);
    }
    await invoke("clear_cleanup_history");
  },

  async getGrowthReport(): Promise<GrowthReport> {
    if (!isTauriEnvironment()) {
      return { entries: [], singleFileThresholdBytes: 1073741824 };
    }
    return await invoke<GrowthReport>("get_growth_report");
  },

  async getAppSettings(): Promise<AppSettings> {
    if (!isTauriEnvironment()) {
      throw new Error("Ayar yönetimi masaüstü ortamı gerektirir.");
    }
    return await invoke<AppSettings>("get_app_settings");
  },

  async saveAppSettings(settings: AppSettings): Promise<void> {
    if (!isTauriEnvironment()) {
      throw new Error("Ayar kaydı masaüstü ortamı gerektirir.");
    }
    await invoke("save_app_settings", { settings });
  },
};
