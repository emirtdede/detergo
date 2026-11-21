import { create } from "zustand";

import { scannerApi } from "@/lib/tauri/scanner-api";
import { toAppError } from "@/lib/errors/app-error";
import {
  AppErrorDto,
  SystemActionId,
  SystemAutomationConfig,
  SystemCleanReport,
  SystemScanReport,
} from "@/types";

const SELECTION_KEY = "detergo.system-selection.v1";

/**
 * The elevated restart creates a new process, so the ticked actions only
 * survive if they live outside the store. localStorage is per-user and the
 * values are opaque action ids, never paths.
 */
function readSelection(): SystemActionId[] {
  try {
    const raw = globalThis.localStorage?.getItem(SELECTION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? (parsed.filter((id) => typeof id === "string") as SystemActionId[])
      : [];
  } catch {
    return [];
  }
}

function persistSelection(ids: SystemActionId[]): void {
  try {
    globalThis.localStorage?.setItem(SELECTION_KEY, JSON.stringify(ids));
  } catch {
    // A missing or full storage only loses the convenience of remembering the
    // selection across an elevated restart.
  }
}

/**
 * State for the C: drive cleaner.
 *
 * The backend owns every safety decision; this store only mirrors the measured
 * list, the user's selection and the progress of a confirmed run. Keeping the
 * selection here (instead of inside the view) means an elevated restart or a
 * tab switch does not silently drop what the user ticked.
 */
interface SystemState {
  report: SystemScanReport | null;
  automation: SystemAutomationConfig | null;
  loading: boolean;
  running: boolean;
  previewing: boolean;
  current: SystemActionId | null;
  error: AppErrorDto | null;
  lastReport: SystemCleanReport | null;
  selected: SystemActionId[];

  load: () => Promise<void>;
  loadAutomation: () => Promise<void>;
  toggle: (id: SystemActionId) => void;
  selectAll: () => void;
  setSelection: (ids: SystemActionId[]) => void;
  clear: () => void;
  run: (ids: SystemActionId[]) => Promise<void>;
  cancel: () => Promise<void>;
  restartElevated: () => Promise<void>;
  saveAutomation: (config: SystemAutomationConfig) => Promise<boolean>;
  removeAutomation: () => Promise<boolean>;
  dismissResult: () => void;
  clearError: () => void;
}

let scanGeneration = 0;

export const useSystemStore = create<SystemState>((set, get) => ({
  report: null,
  automation: null,
  loading: false,
  running: false,
  previewing: false,
  current: null,
  error: null,
  lastReport: null,
  selected: readSelection(),

  load: async () => {
    const state = get();
    if (state.loading || state.running || state.previewing) return;
    const gen = ++scanGeneration;
    set({ loading: true, error: null });
    try {
      const report = await scannerApi.systemScan();
      if (gen !== scanGeneration || get().running || get().previewing) {
        set({ loading: false });
        return;
      }
      const selected = get().selected.filter((id) =>
        report.actions.some(
          (action) =>
            action.id === id && action.available && (!action.requiresAdmin || report.elevated),
        ),
      );
      persistSelection(selected);
      set({ report, loading: false, selected });
    } catch (err) {
      if (gen !== scanGeneration) {
        set({ loading: false });
        return;
      }
      set({ loading: false, error: toAppError(err) });
    }
  },

  loadAutomation: async () => {
    try {
      const automation = await scannerApi.getSystemAutomation();
      set({ automation });
    } catch (err) {
      set({ error: toAppError(err) });
    }
  },

  toggle: (id) => {
    const { selected } = get();
    const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
    persistSelection(next);
    set({ selected: next });
  },

  selectAll: () => {
    const report = get().report;
    if (!report) return;
    const next = report.actions
      .filter((action) => action.available && (!action.requiresAdmin || report.elevated))
      .map((action) => action.id);
    persistSelection(next);
    set({ selected: next });
  },

  setSelection: (ids) => {
    persistSelection(ids);
    set({ selected: ids });
  },

  clear: () => {
    persistSelection([]);
    set({ selected: [] });
  },

  run: async (ids) => {
    if (get().running || get().previewing) return;
    if (ids.length === 0) return;
    scanGeneration += 1;
    set({ loading: false, previewing: true, error: null });
    try {
      const preview = await scannerApi.systemPreview(ids);
      set({ previewing: false, running: true, current: null, lastReport: null });
      const report = await scannerApi.systemExecute(preview.token, (event) => {
        if (event.type === "actionStarted") {
          set({ current: event.id });
        } else if (event.type === "actionFinished") {
          set({ current: null });
        }
      });
      set({ running: false, current: null, lastReport: report });
      // Sizes are now stale; re-measure without blocking the result dialog.
      void get().load();
    } catch (err) {
      set({ running: false, previewing: false, current: null, error: toAppError(err) });
    }
  },

  cancel: async () => {
    try {
      await scannerApi.systemCancel();
    } catch (err) {
      set({ error: toAppError(err) });
    }
  },

  restartElevated: async () => {
    try {
      await scannerApi.systemRestartElevated();
    } catch (err) {
      set({ error: toAppError(err) });
    }
  },

  saveAutomation: async (config) => {
    try {
      const automation = await scannerApi.setSystemAutomation(config);
      set({ automation, error: null });
      return true;
    } catch (err) {
      const failure = toAppError(err);
      set({ error: failure });
      const automation = await safeAutomation();
      set({ automation });
      return false;
    }
  },

  removeAutomation: async () => {
    try {
      const automation = await scannerApi.removeSystemAutomation();
      set({ automation, error: null });
      return true;
    } catch (err) {
      set({ error: toAppError(err) });
      return false;
    }
  },

  dismissResult: () => set({ lastReport: null }),
  clearError: () => set({ error: null }),
}));

async function safeAutomation(): Promise<SystemAutomationConfig | null> {
  try {
    return await scannerApi.getSystemAutomation();
  } catch {
    return null;
  }
}
