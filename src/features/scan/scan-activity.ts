import { create } from "zustand";
import { useCacheStore } from "@/stores/cache-store";
import { useScanStore } from "@/stores/scan-store";
import { useSystemStore } from "@/stores/system-store";

export type ScanTargetKey = "projects" | "agents" | "caches" | "system";

export const ALL_SCAN_TARGETS: readonly ScanTargetKey[] = [
  "projects",
  "agents",
  "caches",
  "system",
] as const;

const TARGETS_STORAGE_KEY = "dev-cleaner.scan-targets.v1";

function normalizeTargets(raw: unknown): ScanTargetKey[] {
  if (!Array.isArray(raw)) return [...ALL_SCAN_TARGETS];
  const set = new Set<ScanTargetKey>();
  for (const item of raw) {
    if (item === "projects" || item === "agents" || item === "caches" || item === "system") {
      set.add(item);
    }
  }
  const ordered = ALL_SCAN_TARGETS.filter((key) => set.has(key));
  return ordered.length > 0 ? ordered : [...ALL_SCAN_TARGETS];
}

function readStoredTargets(): { targets: ScanTargetKey[]; allDrives: boolean } {
  try {
    const raw = globalThis.localStorage?.getItem(TARGETS_STORAGE_KEY);
    if (!raw) return { targets: [...ALL_SCAN_TARGETS], allDrives: false };
    const parsed = JSON.parse(raw) as { targets?: unknown; allDrives?: unknown } | null;
    const targets = normalizeTargets(parsed?.targets);
    const allDrives = Boolean(parsed?.allDrives) && targets.includes("projects");
    return { targets, allDrives };
  } catch {
    return { targets: [...ALL_SCAN_TARGETS], allDrives: false };
  }
}

function persistTargets(targets: ScanTargetKey[], allDrives: boolean): void {
  try {
    globalThis.localStorage?.setItem(TARGETS_STORAGE_KEY, JSON.stringify({ targets, allDrives }));
  } catch {
    // Private or read-only storage only loses target selection across restarts.
  }
}

interface ScanTargetsState {
  targets: ScanTargetKey[];
  allDrives: boolean;
  /** Which targets belong to the currently running scan (for header live status). */
  activeTargets: ScanTargetKey[];
  activeAllDrives: boolean;

  toggleTarget: (key: ScanTargetKey) => void;
  selectAllTargets: () => void;
  setAllDrives: (enabled: boolean) => void;
  setActiveRun: (targets: ScanTargetKey[], allDrives: boolean) => void;
  clearActiveRun: () => void;
}

const initialTargets = readStoredTargets();

export const useScanTargetsStore = create<ScanTargetsState>((set, get) => ({
  targets: initialTargets.targets,
  allDrives: initialTargets.allDrives,
  activeTargets: [],
  activeAllDrives: false,

  toggleTarget: (key) => {
    const current = get().targets;
    const exists = current.includes(key);
    // Always keep at least one target selected so the top-bar Scan button
    // remains actionable.
    if (exists && current.length <= 1) return;
    const nextSet = new Set<ScanTargetKey>(current);
    if (exists) nextSet.delete(key);
    else nextSet.add(key);
    const next = ALL_SCAN_TARGETS.filter((k) => nextSet.has(k));
    const nextAllDrives = next.includes("projects") ? get().allDrives : false;
    persistTargets(next, nextAllDrives);
    set({ targets: next, allDrives: nextAllDrives });
  },

  selectAllTargets: () => {
    const next = [...ALL_SCAN_TARGETS];
    persistTargets(next, false);
    set({ targets: next, allDrives: false });
  },

  setAllDrives: (enabled) => {
    const current = get().targets;
    const next =
      enabled && !current.includes("projects")
        ? ALL_SCAN_TARGETS.filter((k) => k === "projects" || current.includes(k))
        : current;
    persistTargets(next, enabled);
    set({ targets: next, allDrives: enabled });
  },

  setActiveRun: (targets, allDrives) =>
    set({ activeTargets: [...targets], activeAllDrives: allDrives }),

  clearActiveRun: () => set({ activeTargets: [], activeAllDrives: false }),
}));

/**
 * Single definition of "the app is busy scanning".
 *
 * The store status alone is not enough: a combined run keeps measuring package
 * caches or C: system targets after the walk reported `completed`, and those
 * subsystems can also run on their own from the unified top bar.
 */
export function isScanActiveNow(): boolean {
  const { status, combinedActive } = useScanStore.getState();
  return (
    status === "scanning" ||
    status === "measuring" ||
    status === "cancelling" ||
    combinedActive ||
    useCacheStore.getState().measuring ||
    useSystemStore.getState().loading
  );
}

/** Reactive variant for components that must re-render on the same definition. */
export function useScanActive(): boolean {
  const status = useScanStore((s) => s.status);
  const combinedActive = useScanStore((s) => s.combinedActive);
  const cacheMeasuring = useCacheStore((s) => s.measuring);
  const systemLoading = useSystemStore((s) => s.loading);
  return (
    status === "scanning" ||
    status === "measuring" ||
    status === "cancelling" ||
    combinedActive ||
    cacheMeasuring ||
    systemLoading
  );
}
