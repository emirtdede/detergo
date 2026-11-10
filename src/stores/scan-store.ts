import { create } from "zustand";
import {
  AppErrorDto,
  CleanupItem,
  LastScanSnapshot,
  MeasurementUpdate,
  ScanProgress,
  ScanScope,
  ScanSummary,
} from "@/types";
import { isTauriEnvironment, scannerApi } from "@/lib/tauri/scanner-api";
import { log } from "@/lib/logging";

export type ScanStatus =
  | "idle"
  | "scanning"
  | "measuring"
  | "cancelling"
  | "completed"
  | "cancelled"
  | "failed";

const LAST_SCAN_SCHEMA_VERSION = 1;
export const LAST_SCAN_SCHEMA_SUPPORTED = LAST_SCAN_SCHEMA_VERSION;
const PERSIST_DEBOUNCE_MS = 600;

interface ScanState {
  scanId: string | null;
  status: ScanStatus;
  currentRootPath: string | null;
  scope: ScanScope;
  itemsById: Record<string, CleanupItem>;
  itemIds: string[];
  pendingMeasurements: Record<string, MeasurementUpdate>;
  progress: ScanProgress | null;
  summary: ScanSummary | null;
  error: AppErrorDto | null;
  warnings: Array<{ code: string; path?: string | null }>;

  /** True while the visible results come from the persisted last scan. */
  restored: boolean;
  lastSavedAt: string | null;
  /** Previous scan kept in memory so a fresh scan can be compared to it. */
  previousSummary: ScanSummary | null;
  previousCleanableBytes: number;
  previousItemCount: number;
  staleBannerDismissed: boolean;
  staleAcknowledged: boolean;

  startScanState: (scanId: string, rootPath: string, scope?: ScanScope) => void;
  restoreScan: (snapshot: LastScanSnapshot) => void;
  updateProgress: (progress: ScanProgress) => void;
  addItems: (items: CleanupItem[]) => void;
  addCandidateEntriesBatch: (items: CleanupItem[]) => void;
  applyMeasurements: (updates: MeasurementUpdate[]) => void;
  updateEntryMeasurementBatch: (updates: MeasurementUpdate[]) => void;
  markDeleted: (ids: string[]) => void;
  removeItems: (ids: string[]) => void;
  addWarning: (warning: { code: string; path?: string | null }) => void;
  completeScan: (summary: ScanSummary) => void;
  cancelScanState: (summary?: ScanSummary) => void;
  failScan: (error: AppErrorDto) => void;
  dismissStaleBanner: () => void;
  acknowledgeStale: () => void;
  resetScan: () => void;
}

function applyUpdate(item: CleanupItem, update: MeasurementUpdate): CleanupItem {
  return {
    ...item,
    logicalBytes: update.logicalBytes,
    allocatedBytes: update.allocatedBytes,
    estimatedReclaimBytes: update.estimatedReclaimBytes,
    status:
      update.status === "error" ? "error" : item.status === "blocked" ? "blocked" : update.status,
  };
}

function cleanableBytes(state: Pick<ScanState, "itemIds" | "itemsById">): number {
  let total = 0;
  for (const id of state.itemIds) {
    const item = state.itemsById[id];
    if (!item) continue;
    if (item.protected || item.safetyClass === "keep" || !item.selectable) continue;
    total += item.estimatedReclaimBytes ?? 0;
  }
  return total;
}

function toSnapshot(state: ScanState): LastScanSnapshot | null {
  // An empty result is still a result: after cleaning everything the stored
  // snapshot must shrink too, otherwise deleted targets resurrect on restart.
  if (!state.summary) return null;
  return {
    schemaVersion: LAST_SCAN_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    summary: state.summary,
    // Already-deleted rows must not come back on restart as selectable targets.
    items: state.itemIds
      .map((id) => state.itemsById[id])
      .filter((item) => item && item.status !== "deleted"),
  };
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistChain: Promise<void> = Promise.resolve();

/**
 * Writes the current results as the "last scan". Errors are logged but never
 * surfaced: a failed convenience cache must not interrupt a scan or a cleanup.
 */
export async function persistLastScanNow(): Promise<void> {
  const snapshot = toSnapshot(useScanStore.getState());
  if (!snapshot) return;
  persistChain = persistChain.then(async () => {
    try {
      await scannerApi.saveLastScan(snapshot);
      useScanStore.setState({ lastSavedAt: snapshot.savedAt });
    } catch (err) {
      log.warn("Last scan could not be saved", err);
    }
  });
  return persistChain;
}

/** Cancels a pending debounce so a reset cannot resurrect deleted results. */
export function cancelScheduledPersist(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}

/** Coalesces rapid item mutations (cleanup deletes many rows at once). */
export function scheduleLastScanPersist(): void {
  if (!isTauriEnvironment()) return;
  cancelScheduledPersist();
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistLastScanNow();
  }, PERSIST_DEBOUNCE_MS);
}

export const useScanStore = create<ScanState>((set, get) => ({
  scanId: null,
  status: "idle",
  currentRootPath: null,
  scope: "project",
  itemsById: {},
  itemIds: [],
  pendingMeasurements: {},
  progress: null,
  summary: null,
  error: null,
  warnings: [],

  restored: false,
  lastSavedAt: null,
  previousSummary: null,
  previousCleanableBytes: 0,
  previousItemCount: 0,
  staleBannerDismissed: false,
  staleAcknowledged: false,

  startScanState: (scanId, rootPath, scope = "project") =>
    set((state) => {
      // Keep a compact copy of the previous results before replacing them so
      // the overview can compare the new scan against the old one.
      const hasPrevious = state.itemIds.length > 0 && state.summary !== null;
      return {
        scanId,
        status: "scanning",
        currentRootPath: rootPath,
        scope,
        itemsById: {},
        itemIds: [],
        pendingMeasurements: {},
        progress: {
          phase: "discovering",
          directoriesVisited: 0,
          entriesFound: 0,
          entriesMeasured: 0,
          bytesMeasured: 0,
        },
        summary: null,
        error: null,
        warnings: [],
        restored: false,
        lastSavedAt: null,
        previousSummary: hasPrevious ? state.summary : state.previousSummary,
        previousCleanableBytes: hasPrevious ? cleanableBytes(state) : state.previousCleanableBytes,
        previousItemCount: hasPrevious ? state.itemIds.length : state.previousItemCount,
        staleBannerDismissed: false,
        staleAcknowledged: false,
      };
    }),

  restoreScan: (snapshot) =>
    set(() => {
      if (snapshot.schemaVersion !== LAST_SCAN_SCHEMA_VERSION) {
        // Never load a snapshot produced by another schema; the caller drops
        // the incompatible file and starts from an empty state instead.
        log.warn(
          `Ignoring last scan with unsupported schema ${snapshot.schemaVersion} ` +
            `(expected ${LAST_SCAN_SCHEMA_VERSION})`,
        );
        return {};
      }
      const itemsById: Record<string, CleanupItem> = {};
      const itemIds: string[] = [];
      for (const item of snapshot.items) {
        if (!item || !item.id) continue;
        itemsById[item.id] = item;
        itemIds.push(item.id);
      }
      return {
        scanId: snapshot.summary.scanId,
        status: (snapshot.summary.partial ? "cancelled" : "completed") as ScanStatus,
        currentRootPath: snapshot.summary.rootPath || null,
        scope: snapshot.summary.scope,
        itemsById,
        itemIds,
        pendingMeasurements: {},
        progress: null,
        summary: snapshot.summary,
        error: null,
        warnings: [],
        restored: true,
        lastSavedAt: snapshot.savedAt,
        staleBannerDismissed: false,
        staleAcknowledged: false,
      };
    }),

  updateProgress: (progress) =>
    set((state) => ({
      progress,
      status:
        state.status === "scanning" || state.status === "measuring"
          ? progress.phase === "measuring"
            ? "measuring"
            : state.status
          : state.status,
    })),

  addItems: (items) =>
    set((state) => {
      const nextMap = { ...state.itemsById };
      const nextIds = [...state.itemIds];
      const nextPending = { ...state.pendingMeasurements };

      for (const incoming of items) {
        if (nextMap[incoming.id]) continue;
        let item = incoming;
        const buffered = nextPending[incoming.id];
        if (buffered) {
          item = applyUpdate(incoming, buffered);
          delete nextPending[incoming.id];
        }
        nextMap[item.id] = item;
        nextIds.push(item.id);
      }
      return { itemsById: nextMap, itemIds: nextIds, pendingMeasurements: nextPending };
    }),

  addCandidateEntriesBatch: (items) => {
    get().addItems(items);
  },

  applyMeasurements: (updates) =>
    set((state) => {
      if (updates.length === 0) return state;
      const nextMap = { ...state.itemsById };
      const nextPending = { ...state.pendingMeasurements };

      for (const update of updates) {
        const existing = nextMap[update.id];
        if (existing) {
          nextMap[update.id] = applyUpdate(existing, update);
        } else {
          nextPending[update.id] = update;
        }
      }
      return { itemsById: nextMap, pendingMeasurements: nextPending };
    }),

  updateEntryMeasurementBatch: (updates) => {
    get().applyMeasurements(updates);
  },

  markDeleted: (ids) => {
    set((state) => {
      const nextMap = { ...state.itemsById };
      for (const id of ids) {
        if (nextMap[id]) nextMap[id] = { ...nextMap[id], status: "deleted" };
      }
      return { itemsById: nextMap };
    });
    scheduleLastScanPersist();
  },

  removeItems: (ids) => {
    set((state) => {
      const removeSet = new Set(ids);
      const nextMap = { ...state.itemsById };
      for (const id of ids) delete nextMap[id];
      return {
        itemsById: nextMap,
        itemIds: state.itemIds.filter((id) => !removeSet.has(id)),
      };
    });
    scheduleLastScanPersist();
  },

  addWarning: (warning) => set((state) => ({ warnings: [...state.warnings, warning] })),

  completeScan: (summary) => set({ status: "completed", summary }),

  cancelScanState: (summary) => set({ status: "cancelled", summary: summary ?? null }),

  failScan: (error) => set({ status: "failed", error }),

  dismissStaleBanner: () => set({ staleBannerDismissed: true }),

  acknowledgeStale: () => set({ staleAcknowledged: true, staleBannerDismissed: true }),

  resetScan: () => {
    // A debounced write scheduled before the reset must not persist the old
    // scan after the user asked for a clean slate.
    cancelScheduledPersist();
    set({
      scanId: null,
      status: "idle",
      currentRootPath: null,
      scope: "project",
      itemsById: {},
      itemIds: [],
      pendingMeasurements: {},
      progress: null,
      summary: null,
      error: null,
      warnings: [],
      restored: false,
      lastSavedAt: null,
      staleBannerDismissed: false,
      staleAcknowledged: false,
    });
  },
}));
