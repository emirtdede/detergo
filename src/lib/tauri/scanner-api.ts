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
  CleanupTotals,
  DiskSpaceInfo,
  UpdateInfo,
  SupportBundle,
  SupportBundleRequest,
  SupportMailResult,
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
  measureCacheProviders(
    onEvent: (event: CacheMeasureEvent) => void,
    providerIds?: string[],
  ): Promise<void>;
  cancelCacheMeasurement(): Promise<void>;
  cancelCachePreview(): Promise<void>;
  previewOfficialAction(providerId: string, actionId: string): Promise<OfficialActionPreview>;
  executeOfficialAction(token: string): Promise<OfficialActionResult>;
  getCleanupHistory(limit?: number): Promise<AuditRecord[]>;
  getCleanupTotals(): Promise<CleanupTotals>;
  getDiskPressure(): Promise<DiskSpaceInfo[]>;
  getOfficialActionHistory(limit?: number): Promise<ActionAuditRecord[]>;
  clearCleanupHistory(): Promise<void>;
  clearCleanupsHistory(): Promise<void>;
  clearActionsHistory(): Promise<void>;
  getGrowthReport(): Promise<GrowthReport>;
  getAppSettings(): Promise<AppSettings>;
  saveAppSettings(settings: AppSettings): Promise<AppSettings>;
  /** Deletes settings and local history; refuses while a scan/cleanup runs. */
  resetAppData(): Promise<void>;
  getLastScan(): Promise<LastScanSnapshot | null>;
  saveLastScan(snapshot: LastScanSnapshot): Promise<void>;
  clearLastScan(): Promise<void>;
  hideToTray(): Promise<void>;
  quitApp(): Promise<void>;
  getBuildInfo(): Promise<BuildInfo>;
  checkForUpdates(): Promise<UpdateInfo>;
  createSupportBundle(request: SupportBundleRequest): Promise<SupportBundle>;
  composeSupportMail(bundlePath: string, version: string): Promise<SupportMailResult>;
  testWebhook(
    url: string,
    payload?: Record<string, unknown>,
  ): Promise<{ ok: boolean; status: number; latencyMs: number; message: string }>;
  dispatchWebhook(
    event: "scan" | "clean",
    payload: Record<string, unknown>,
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

  async measureCacheProviders(
    onEvent: (event: CacheMeasureEvent) => void,
    providerIds?: string[],
  ): Promise<void> {
    const channel = new Channel<CacheMeasureEvent>();
    channel.onmessage = (event: CacheMeasureEvent) => onEvent(event);
    await invoke("measure_cache_providers", { providerIds, onEvent: channel });
  },

  async cancelCacheMeasurement(): Promise<void> {
    await invoke("cancel_cache_measurement");
  },

  async cancelCachePreview(): Promise<void> {
    await invoke("cancel_cache_preview");
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

  async getCleanupTotals(): Promise<CleanupTotals> {
    return await invoke<CleanupTotals>("get_cleanup_totals");
  },

  async getDiskPressure(): Promise<DiskSpaceInfo[]> {
    return await invoke<DiskSpaceInfo[]>("get_disk_pressure");
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

  async saveAppSettings(settings: AppSettings): Promise<AppSettings> {
    return await invoke<AppSettings>("save_app_settings", { settings });
  },

  async resetAppData(): Promise<void> {
    await invoke("reset_app_data");
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

  async checkForUpdates(): Promise<UpdateInfo> {
    return await invoke<UpdateInfo>("check_for_updates");
  },

  async createSupportBundle(request: SupportBundleRequest): Promise<SupportBundle> {
    return await invoke<SupportBundle>("create_support_bundle", { request });
  },

  async composeSupportMail(bundlePath: string, version: string): Promise<SupportMailResult> {
    return await invoke<SupportMailResult>("compose_support_mail", { bundlePath, version });
  },

  async testWebhook(
    url: string,
    payload?: Record<string, unknown>,
  ): Promise<{ ok: boolean; status: number; latencyMs: number; message: string }> {
    return await invoke("test_webhook", { url, payload: payload ?? null });
  },

  async dispatchWebhook(
    event: "scan" | "clean",
    payload: Record<string, unknown>,
  ): Promise<{ ok: boolean; status: number; latencyMs: number; message: string }> {
    return await invoke("dispatch_webhook", { event, payload });
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

/**
 * Resolved backend API, created on first use.
 *
 * This module must never block the ES module graph: `App`, the stores and the
 * scan controller all import it at the top level, so a rejected module would
 * prevent `createRoot().render()` from ever running and leave the user with an
 * empty window and no error boundary.
 */
let apiPromise: Promise<ScannerApi> | null = null;

function getApi(): Promise<ScannerApi> {
  if (!apiPromise) {
    apiPromise = createApi().catch((err) => {
      // Allow a later call (for example the explicit "retry" button) to try
      // again instead of caching the failure for the whole session.
      apiPromise = null;
      throw err;
    });
  }
  return apiPromise;
}

/**
 * Lazily bound `ScannerApi`.
 *
 * Every member is a method (see the interface above), so the proxy can return a
 * forwarding function for any property name. Symbols and the promise protocol
 * keys are deliberately excluded: returning a function for `then` would make
 * `await scannerApi` (or `Promise.resolve(scannerApi)`) treat the proxy as a
 * thenable and recurse forever.
 *
 * Defined properties are recorded in `overrides` instead of the (empty) target.
 * Tests rely on `vi.spyOn(scannerApi, …)`, which needs a configurable own
 * property descriptor and writes the spy back through `defineProperty`.
 */
const overrides = new Map<string, unknown>();

function forward(prop: string): (...args: unknown[]) => Promise<unknown> {
  return (...args: unknown[]) =>
    getApi().then((api) => {
      const member = (api as unknown as Record<string, unknown>)[prop];
      if (typeof member !== "function") {
        throw new Error(`ScannerApi member "${prop}" is not callable.`);
      }
      return (member as (...a: unknown[]) => unknown).apply(api, args);
    });
}

function member(prop: string): unknown {
  return overrides.has(prop) ? overrides.get(prop) : forward(prop);
}

export const scannerApi: ScannerApi = new Proxy({} as ScannerApi, {
  get(_target, prop) {
    if (typeof prop === "symbol" || prop === "then" || prop === "toJSON") {
      return undefined;
    }
    return member(prop);
  },
  set(_target, prop, value) {
    if (typeof prop === "string") overrides.set(prop, value);
    return true;
  },
  defineProperty(_target, prop, descriptor) {
    if (typeof prop === "string") overrides.set(prop, descriptor.value);
    return true;
  },
  deleteProperty(_target, prop) {
    if (typeof prop === "string") overrides.delete(prop);
    return true;
  },
  getOwnPropertyDescriptor(target, prop) {
    if (typeof prop === "symbol") {
      return Reflect.getOwnPropertyDescriptor(target, prop);
    }
    if (prop === "then" || prop === "toJSON") {
      return Reflect.getOwnPropertyDescriptor(target, prop);
    }
    return {
      configurable: true,
      enumerable: true,
      writable: true,
      value: member(prop),
    };
  },
});

/** Warms the backend bridge without throwing. Drives the bridge-status screen. */
export function warmUpApi(): Promise<boolean> {
  return getApi().then(
    () => true,
    () => false,
  );
}
