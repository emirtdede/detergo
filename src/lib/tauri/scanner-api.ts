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
    mode: DeleteMode,
  ): Promise<CleanupPlan>;
  executeCleanup(
    planId: string,
    confirmationToken: string,
    permanentAcknowledged: boolean,
    onEvent?: (event: CleanupEvent) => void,
  ): Promise<CleanupReport>;
  cancelCleanup(): Promise<void>;
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
  testWebhook(
    url: string,
    payload?: Record<string, unknown>,
  ): Promise<{ ok: boolean; status: number; latencyMs: number; message: string }>;
}

/** The desktop implementation. Only valid inside the Tauri runtime. */
const realApi: ScannerApi = {
  async startScan(request: ScanRequest, onEvent: (event: ScanEvent) => void): Promise<ScanSummary> {
    const channel = new Channel<ScanEvent>();
    channel.onmessage = (event: ScanEvent) => onEvent(event);
    return await invoke<ScanSummary>("start_scan", { request, onEvent: channel });
  },

  async cancelScan(): Promise<void> {
    await invoke("cancel_scan");
  },

  async getCatalog(): Promise<CatalogDto> {
    return await invoke<CatalogDto>("get_catalog");
  },

  async getScanSummary(scanSessionId?: string): Promise<ScanSummary | null> {
    return await invoke<ScanSummary | null>("get_scan_summary", {
      scanSessionId: scanSessionId ?? null,
    });
  },

  async getAgentProviders(): Promise<AgentProviderInfo[]> {
    return await invoke<AgentProviderInfo[]>("get_agent_providers");
  },

  async addCustomAgentProvider(name: string, rootPaths: string[]): Promise<AppSettings> {
    return await invoke<AppSettings>("add_custom_agent_provider", { name, rootPaths });
  },

  async removeCustomAgentProvider(id: string): Promise<AppSettings> {
    return await invoke<AppSettings>("remove_custom_agent_provider", { id });
  },

  async setAgentProviderHidden(id: string, hidden: boolean): Promise<AppSettings> {
    return await invoke<AppSettings>("set_agent_provider_hidden", { id, hidden });
  },

  async getKnownLocations(): Promise<KnownLocation[]> {
    return await invoke<KnownLocation[]>("get_known_locations");
  },

  async openPathInExplorer(path: string): Promise<void> {
    await invoke("open_path_in_explorer", { path });
  },

  async openUrl(url: string): Promise<void> {
    await invoke("open_url", { url });
  },

  async selectFolderDialog(title?: string): Promise<string | null> {
    const selected = await open({
      directory: true,
      multiple: false,
      title,
    });
    return typeof selected === "string" ? selected : null;
  },

  async previewCleanup(
    scanSessionId: string,
    targetIds: string[],
    mode: DeleteMode,
  ): Promise<CleanupPlan> {
    return await invoke<CleanupPlan>("preview_cleanup", { scanSessionId, targetIds, mode });
  },

  async executeCleanup(
    planId: string,
    confirmationToken: string,
    permanentAcknowledged: boolean,
    onEvent?: (event: CleanupEvent) => void,
  ): Promise<CleanupReport> {
    // Always create a channel so the user sees per-item progress, even when
    // the caller does not subscribe to it.
    const channel = new Channel<CleanupEvent>();
    if (onEvent) channel.onmessage = onEvent;
    return await invoke<CleanupReport>("execute_cleanup", {
      planId,
      confirmationToken,
      permanentAcknowledged,
      onEvent: channel,
    });
  },

  async cancelCleanup(): Promise<void> {
    await invoke("cancel_cleanup");
  },

  async getCacheProviders(): Promise<CacheProviderInfo[]> {
    return await invoke<CacheProviderInfo[]>("get_cache_providers");
  },

  async measureCacheProviders(onEvent: (event: CacheMeasureEvent) => void): Promise<void> {
    const channel = new Channel<CacheMeasureEvent>();
    channel.onmessage = (event: CacheMeasureEvent) => onEvent(event);
    await invoke("measure_cache_providers", { onEvent: channel });
  },

  async cancelCacheMeasurement(): Promise<void> {
    await invoke("cancel_cache_measurement");
  },

  async previewOfficialAction(
    providerId: string,
    actionId: string,
  ): Promise<OfficialActionPreview> {
    return await invoke<OfficialActionPreview>("preview_official_action", { providerId, actionId });
  },

  async executeOfficialAction(token: string): Promise<OfficialActionResult> {
    return await invoke<OfficialActionResult>("execute_official_action", { token });
  },

  async getCleanupHistory(limit = 200): Promise<AuditRecord[]> {
    return await invoke<AuditRecord[]>("get_cleanup_history", { limit });
  },

  async getOfficialActionHistory(limit = 200): Promise<ActionAuditRecord[]> {
    return await invoke<ActionAuditRecord[]>("get_official_action_history", { limit });
  },

  async clearCleanupHistory(): Promise<void> {
    await invoke("clear_all_history");
  },

  async clearCleanupsHistory(): Promise<void> {
    await invoke("clear_cleanups_history");
  },

  async clearActionsHistory(): Promise<void> {
    await invoke("clear_actions_history");
  },

  async getGrowthReport(): Promise<GrowthReport> {
    return await invoke<GrowthReport>("get_growth_report");
  },

  async getAppSettings(): Promise<AppSettings> {
    return await invoke<AppSettings>("get_app_settings");
  },

  async saveAppSettings(settings: AppSettings): Promise<void> {
    await invoke("save_app_settings", { settings });
  },

  async saveLastScan(snapshot: LastScanSnapshot): Promise<void> {
    await invoke("save_last_scan", { snapshot });
  },

  async getLastScan(): Promise<LastScanSnapshot | null> {
    return await invoke<LastScanSnapshot | null>("get_last_scan");
  },

  async clearLastScan(): Promise<void> {
    await invoke("clear_last_scan");
  },

  async hideToTray(): Promise<void> {
    await invoke("hide_to_tray");
  },

  async quitApp(): Promise<void> {
    await invoke("quit_app");
  },

  async getBuildInfo(): Promise<BuildInfo> {
    return await invoke<BuildInfo>("get_build_info");
  },

  async testWebhook(
    url: string,
    payload?: Record<string, unknown>,
  ): Promise<{ ok: boolean; status: number; latencyMs: number; message: string }> {
    return await invoke("test_webhook", { url, payload: payload ?? null });
  },
};

async function createApi(): Promise<ScannerApi> {
  if (isTauriEnvironment()) {
    return realApi;
  }
  if (import.meta.env.DEV) {
    const { createMockScannerApi } = await import("./scanner-api.mock");
    return createMockScannerApi();
  }
  // Production frontend always runs inside Tauri. Reaching this branch means
  // the desktop bridge is missing, which is a real error, not a demo mode.
  throw new Error("Backend unavailable: this build requires the desktop runtime.");
}

export const scannerApi: ScannerApi = await createApi();
