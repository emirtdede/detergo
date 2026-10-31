import { create } from "zustand";
import {
  AppErrorDto,
  CleanupItem,
  MeasurementUpdate,
  ScanProgress,
  ScanScope,
  ScanSummary,
} from "@/types";

export type ScanStatus =
  | "idle"
  | "scanning"
  | "measuring"
  | "cancelling"
  | "completed"
  | "cancelled"
  | "failed";

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

  startScanState: (scanId: string, rootPath: string, scope?: ScanScope) => void;
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
  resetScan: () => void;
}

function applyUpdate(item: CleanupItem, update: MeasurementUpdate): CleanupItem {
  return {
    ...item,
    logicalBytes: update.logicalBytes,
    allocatedBytes: update.allocatedBytes,
    estimatedReclaimBytes: update.estimatedReclaimBytes,
    status:
      update.status === "error"
        ? "error"
        : item.status === "blocked"
          ? "blocked"
          : update.status,
  };
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

  startScanState: (scanId, rootPath, scope = "project") =>
    set({
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

  markDeleted: (ids) =>
    set((state) => {
      const nextMap = { ...state.itemsById };
      for (const id of ids) {
        if (nextMap[id]) nextMap[id] = { ...nextMap[id], status: "deleted" };
      }
      return { itemsById: nextMap };
    }),

  removeItems: (ids) =>
    set((state) => {
      const removeSet = new Set(ids);
      const nextMap = { ...state.itemsById };
      for (const id of ids) delete nextMap[id];
      return {
        itemsById: nextMap,
        itemIds: state.itemIds.filter((id) => !removeSet.has(id)),
      };
    }),

  addWarning: (warning) => set((state) => ({ warnings: [...state.warnings, warning] })),

  completeScan: (summary) => set({ status: "completed", summary }),

  cancelScanState: (summary) => set({ status: "cancelled", summary: summary ?? null }),

  failScan: (error) => set({ status: "failed", error }),

  resetScan: () =>
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
    }),
}));
