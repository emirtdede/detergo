import { create } from "zustand";
import {
  AppErrorDto,
  CleanupItem,
  LastScanSnapshot,
  MeasurementUpdate,
  ProviderTotal,
  ScanProgress,
  ScanScope,
  ScanSummary,
  ScanWarning,
} from "@/types";
import { isTauriEnvironment, scannerApi } from "@/lib/tauri/scanner-api";
import { log } from "@/lib/logging";
import { useUiStore } from "@/stores/ui-store";
import { useSelectionStore } from "@/stores/selection-store";
import { localizeAppError, getUIText } from "@/lib/ui-text";
import { ownBytesById } from "@/lib/item-totals";
import { isAppDataResetting } from "@/lib/app-data-reset";

export type ScanStatus =
  | "idle"
  | "scanning"
  | "measuring"
  | "cancelling"
  | "completed"
  | "cancelled"
  /** Finished, but the walk stopped early (limit/timeout) so the result is incomplete. */
  | "partial"
  | "failed";

const LAST_SCAN_SCHEMA_VERSION = 1;
export const LAST_SCAN_SCHEMA_SUPPORTED = LAST_SCAN_SCHEMA_VERSION;

/**
 * The view that can display a restored scan. An agent scan has no project rows,
 * so sending the user to Projects after restoring one showed an empty page. A
 * combined scan contains both kinds of rows, so the overview is the only view
 * that shows the whole result.
 */
export function viewForScanScope(scope: ScanScope): "overview" | "projects" | "agents" {
  if (scope === "agents") return "agents";
  if (scope === "combined") return "overview";
  return "projects";
}

const PERSIST_DEBOUNCE_MS = 600;

/**
 * Upper bound for the per-scan warning list.
 *
 * The backend emits one `warning` event per unreadable/skipped path, so a scan
 * of a locked drive could push tens of thousands of entries into the store.
 * That list is rendered (one `<li>` each) and serialized into
 * `last-scan.json`, whose 64 MiB cap then starts rejecting the whole snapshot.
 * The banner reports the true total from `warningsTotal`, so capping loses no
 * information the user is shown.
 */
export const MAX_SCAN_WARNINGS = 200;

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
  warnings: ScanWarning[];
  /** Every warning the backend sent, including the ones past `MAX_SCAN_WARNINGS`. */
  warningsTotal: number;

  /** True while the visible results come from the persisted last scan. */
  restored: boolean;
  lastSavedAt: string | null;
  /** Previous scan kept in memory so a fresh scan can be compared to it. */
  previousSummary: ScanSummary | null;
  previousCleanableBytes: number;
  previousItemCount: number;
  /**
   * Bumped whenever the persisted snapshot is cleared. `OverviewView` watches
   * this so the "restore last scan" button flips off as soon as the reset is
   * requested, without waiting for the async IPC round-trip (L2).
   */
  persistedRevision: number;
  staleBannerDismissed: boolean;
  /** Partial-scan banner dismissal is independent from the stale banner. */
  partialBannerDismissed: boolean;
  /** Scan-warning / depth-limit notice dismissal (both severity rows). */
  noticesBannerDismissed: boolean;
  /**
   * Expected skips (system-protected folders) are dismissed separately from
   * real gaps. Dismissing "3 locations were skipped" must not hide a later
   * "a folder in your project could not be read".
   */
  noticesInfoDismissed: boolean;
  noticesIssuesDismissed: boolean;
  staleAcknowledged: boolean;
  /**
   * True from the start of a "scan everything" action until its cache step
   * finishes. The scan itself may already be `completed` while package caches
   * are still being measured, and the header must keep offering "Stop" instead
   * of starting a second run.
   */
  combinedActive: boolean;
  /**
   * Monotonic id of the scan the user currently wants. Kept in the store, not
   * in the controller module, so a hot reload cannot reset the counter and let
   * a late event from the previous channel overwrite a fresh run.
   */
  activeScanRun: number;
  /**
   * Guards the window between the status check and the `scanning` state being
   * set. That window includes the native folder dialog, during which the status
   * is still `idle`, so a second click could start a competing scan (Y-4).
   */
  scanStartPending: boolean;
  /**
   * Bumped on every workspace reset. The startup restore is asynchronous, so a
   * reset that lands while the snapshot is still being read would otherwise be
   * undone when the read resolves: `resetScan` returns the store to `idle`
   * with no items, which is exactly the guard that allows a restore. `App`
   * captures this token before awaiting and drops the snapshot if it changed.
   */
  workspaceResetToken: number;

  startScanState: (rootPath: string, scope?: ScanScope, scanId?: string | null) => void;
  /** Claims the "starting" slot; false when another start is already pending. */
  acquireScanStart: () => boolean;
  releaseScanStart: () => void;
  /** Starts a new run id; late events whose id is not current are ignored. */
  beginScanRun: () => number;
  restoreScan: (snapshot: LastScanSnapshot) => boolean;
  updateProgress: (progress: ScanProgress) => void;
  addItems: (items: CleanupItem[]) => void;
  applyMeasurements: (updates: MeasurementUpdate[]) => void;
  markDeleted: (ids: string[]) => void;
  removeItems: (ids: string[]) => void;
  /**
   * Removes every row that matches `predicate`, together with its descendants.
   *
   * Used when the user hides or deletes an AI provider: its already-scanned
   * rows would otherwise stay in the table (and in the selection and summary)
   * even though the provider is no longer part of the policy.
   */
  pruneItems: (predicate: (item: CleanupItem) => boolean) => void;
  addWarning: (warning: ScanWarning) => void;
  completeScan: (summary: ScanSummary) => void;
  cancelScanState: (summary?: ScanSummary) => void;
  partialScanState: (summary: ScanSummary) => void;
  failScan: (error: AppErrorDto) => void;
  dismissStaleBanner: () => void;
  dismissPartialBanner: () => void;
  dismissNoticesBanner: () => void;
  dismissInfoNotices: () => void;
  dismissIssueNotices: () => void;
  setCombinedActive: (active: boolean) => void;
  acknowledgeStale: () => void;
  resetScan: (options?: { clearPersisted?: boolean }) => void;
}

function applyUpdate(item: CleanupItem, update: MeasurementUpdate): CleanupItem {
  // M7: an unreadable target is not an empty folder. The backend sends a zero
  // placeholder on the wire for compatibility, but the row must keep `null`
  // sizes so the table shows "Not measured" instead of "0 B".
  const failed = update.status === "error";
  return {
    ...item,
    logicalBytes: failed ? null : update.logicalBytes,
    allocatedBytes: failed ? null : update.allocatedBytes,
    estimatedReclaimBytes: failed ? null : update.estimatedReclaimBytes,
    status:
      update.status === "error" ? "error" : item.status === "blocked" ? "blocked" : update.status,
  };
}

function cleanableBytes(state: Pick<ScanState, "itemIds" | "itemsById">): number {
  // `ownBytesById` must see deleted rows too: a deleted child no longer owns
  // the bytes its parent measured, so subtracting them keeps the parent honest.
  const allItems = state.itemIds
    .map((id) => state.itemsById[id])
    .filter((item): item is CleanupItem => Boolean(item));
  const own = ownBytesById(allItems);
  let total = 0;
  for (const item of allItems) {
    if (item.status === "deleted") continue;
    if (item.protected || item.safetyClass === "keep" || !item.selectable) continue;
    total += own.get(item.id)?.allocatedBytes ?? 0;
  }
  return total;
}

/**
 * Rebuilds the summary totals from the items that still exist.
 *
 * The backend summary describes the scan as discovered. After a cleanup marks
 * rows deleted (or removes them), keeping that summary made the overview and
 * the persisted last-scan snapshot claim space that was already reclaimed.
 * The rules mirror `build_summary` in `src-tauri/src/scanner/mod.rs`, including
 * its `own_bytes` de-duplication of nested targets.
 *
 * `items` should include deleted rows: their own bytes are removed from the
 * totals, but they must still be subtracted from a surviving parent's slice.
 */
function recomputeSummary(summary: ScanSummary, items: CleanupItem[]): ScanSummary {
  const own = ownBytesById(items);
  let totalBytes = 0;
  let totalAllocatedBytes = 0;
  let protectedBytes = 0;
  let cleanableTotal = 0;
  let errorsCount = 0;
  let warningsCount = 0;
  const providers = new Map<string, ProviderTotal>();
  let totalEntries = 0;

  for (const item of items) {
    if (item.status === "deleted") continue;
    totalEntries += 1;
    const bytes = own.get(item.id);
    const logical = bytes?.logicalBytes ?? 0;
    const allocated = bytes?.allocatedBytes ?? 0;
    totalBytes += logical;
    totalAllocatedBytes += allocated;
    const protectedItem = item.protected || item.safetyClass === "keep" || !item.selectable;
    if (protectedItem) protectedBytes += allocated;
    else cleanableTotal += allocated;
    if (item.status === "error") errorsCount += 1;
    if ((item.warningCodes?.length ?? 0) > 0) warningsCount += 1;

    const entry: ProviderTotal = providers.get(item.provider) ?? {
      provider: item.provider,
      logicalBytes: 0,
      allocatedBytes: 0,
      itemCount: 0,
      protectedBytes: 0,
    };
    entry.itemCount += 1;
    if (protectedItem) {
      entry.protectedBytes += allocated;
    } else {
      entry.logicalBytes += logical;
      entry.allocatedBytes += allocated;
    }
    providers.set(item.provider, entry);
  }

  const providerTotals = [...providers.values()].sort(
    (a, b) => b.allocatedBytes - a.allocatedBytes,
  );

  return {
    ...summary,
    totalEntries,
    totalBytes,
    totalAllocatedBytes,
    protectedBytes,
    cleanableBytes: cleanableTotal,
    errorsCount,
    warningsCount,
    providerTotals,
  };
}

/**
 * Removes selections that no longer describe a cleanable row.
 *
 * Selections survive item mutations (a cleanup marks rows deleted, a new scan
 * replaces the map). Without this, the action bar could keep showing a count
 * for targets that are gone and the plan would receive ids the backend no
 * longer knows.
 */
function pruneSelection(state: Pick<ScanState, "itemIds" | "itemsById">): void {
  if (useSelectionStore.getState().selectedIds.size === 0) return;
  const available = state.itemIds.filter((id) => {
    const item = state.itemsById[id];
    return (
      !!item &&
      item.selectable &&
      !item.protected &&
      item.safetyClass !== "keep" &&
      item.status !== "deleted" &&
      item.logicalBytes !== null
    );
  });
  useSelectionStore.getState().prune(available);
}

/**
 * Expands a deletion set to every descendant of the selected rows.
 *
 * A parent target is measured recursively; once it is deleted its nested
 * rows no longer exist on disk. Leaving them in the table kept selectable
 * "ghost" targets whose plan could never succeed.
 *
 * One pass builds a `parent -> children` index, then a stack walks it, so the
 * cost is O(n + e) instead of the previous O(n * depth) rescan loop (Y-3).
 */
function collectDescendants(
  state: Pick<ScanState, "itemIds" | "itemsById">,
  ids: readonly string[],
): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const id of state.itemIds) {
    const parentId = state.itemsById[id]?.parentItemId;
    if (!parentId) continue;
    const children = childrenOf.get(parentId);
    if (children) children.push(id);
    else childrenOf.set(parentId, [id]);
  }

  const selected = new Set(ids);
  const stack = [...ids];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const child of childrenOf.get(current) ?? []) {
      if (selected.has(child)) continue;
      selected.add(child);
      stack.push(child);
    }
  }
  return [...selected];
}

const SAFETY_CLASSES = new Set<CleanupItem["safetyClass"]>([
  "safe",
  "regenerate",
  "review",
  "keep",
]);
const ITEM_STATUSES = new Set<CleanupItem["status"]>([
  "discovered",
  "measuring",
  "ready",
  "blocked",
  "error",
  "deleted",
]);

/**
 * Validates one row of a persisted snapshot.
 *
 * `last-scan.json` is user-visible local data: a partial write, a disk error or
 * a hand edit can leave a row with a missing `warningCodes` array. Trusting it
 * made `recomputeSummary` throw on the next cleanup, inside a debounced timer
 * where nothing could catch it. Unknown or incomplete rows are dropped instead
 * of poisoning the whole session.
 */
function normalizeRestoredItem(raw: unknown): CleanupItem | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Partial<CleanupItem>;
  if (typeof item.id !== "string" || item.id.length === 0) return null;
  if (typeof item.provider !== "string" || item.provider.length === 0) return null;
  if (typeof item.displayName !== "string" || typeof item.displayPath !== "string") return null;
  const bytes = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  const stringList = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  return {
    ...(item as CleanupItem),
    warningCodes: stringList(item.warningCodes),
    evidenceCodes: stringList(item.evidenceCodes),
    logicalBytes: bytes(item.logicalBytes),
    allocatedBytes: bytes(item.allocatedBytes),
    estimatedReclaimBytes: bytes(item.estimatedReclaimBytes),
    safetyClass: SAFETY_CLASSES.has(item.safetyClass as CleanupItem["safetyClass"])
      ? (item.safetyClass as CleanupItem["safetyClass"])
      : "review",
    status: ITEM_STATUSES.has(item.status as CleanupItem["status"])
      ? (item.status as CleanupItem["status"])
      : "ready",
    protected: Boolean(item.protected),
    selectable: item.selectable !== false,
    autoSelectable: Boolean(item.autoSelectable),
  };
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
    warnings: state.warnings,
  };
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistChain: Promise<void> = Promise.resolve();
/**
 * Incremented when the persisted snapshot is cleared. A write queued before a
 * reset must not resurrect the scan the user just erased.
 */
let persistGeneration = 0;
let lastPersistErrorAt = 0;

/**
 * Writes the current results as the "last scan". Errors are logged but never
 * surfaced as a scan failure: a failed convenience cache must not interrupt a
 * scan or a cleanup. A size/serialization failure is still shown once so the
 * user knows why the next launch starts empty.
 */
export async function persistLastScanNow(): Promise<void> {
  // A factory reset is about to delete this file; a flush from `pagehide`
  // must not recreate it from the old in-memory scan.
  if (isAppDataResetting()) return;
  // A cleanup marks rows deleted and schedules the summary rebuild on a 250 ms
  // debounce. Persisting first produced a snapshot whose `items` already
  // excluded the deleted rows while `summary` still counted their bytes, so a
  // restart reported reclaimed space as reclaimable. Rebuild synchronously.
  flushPendingSummary();
  const generation = persistGeneration;
  const snapshot = toSnapshot(useScanStore.getState());
  if (!snapshot) return;
  persistChain = persistChain.then(async () => {
    if (generation !== persistGeneration) return;
    try {
      await scannerApi.saveLastScan(snapshot);
      if (generation === persistGeneration) {
        useScanStore.setState({ lastSavedAt: snapshot.savedAt });
      }
    } catch (err) {
      log.warn("Last scan could not be saved", err);
      const now = Date.now();
      if (now - lastPersistErrorAt > 60_000) {
        lastPersistErrorAt = now;
        const ui = getUIText();
        useUiStore
          .getState()
          .showToast(`${ui.overview.warnings}: ${localizeAppError(err, ui)}`, "warning", 6000);
      }
    }
  });
  return persistChain;
}

/** True when a debounced snapshot write is waiting; `false` means nothing is lost. */
export function hasScheduledScanPersist(): boolean {
  return persistTimer !== null;
}

/** Cancels a pending debounce so a reset cannot resurrect deleted results. */
export function cancelScheduledPersist(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}

/**
 * Flushes a pending debounced write immediately. Used before the window is
 * hidden or closed so the rows deleted a moment ago are not lost.
 */
export function flushLastScanPersist(): Promise<void> {
  cancelScheduledPersist();
  return persistLastScanNow();
}

/**
 * Deletes the persisted snapshot and blocks already-queued writes from
 * recreating it. This is what "reset workspace" must do to stay durable.
 */
export function clearPersistedLastScan(): Promise<boolean> {
  cancelScheduledPersist();
  persistGeneration += 1;
  // L2: the restore button must not stay enabled while the clear IPC is in
  // flight. Bump the revision synchronously so any watcher re-checks the file.
  useScanStore.setState((state) => ({
    lastSavedAt: null,
    persistedRevision: state.persistedRevision + 1,
  }));
  if (!isTauriEnvironment()) return Promise.resolve(true);
  const attempt = persistChain.then(async () => {
    try {
      await scannerApi.clearLastScan();
      return true;
    } catch (err) {
      // Callers that only fire-and-forget (`void clearPersistedLastScan()`)
      // must not see an unhandled rejection; the History view awaits the
      // boolean to decide whether announcing success is honest.
      log.warn("Last scan could not be cleared", err);
      return false;
    }
  });
  persistChain = attempt.then(() => undefined);
  return attempt;
}

/** Coalesces rapid item mutations (cleanup deletes many rows at once). */
export function scheduleLastScanPersist(): void {
  if (!isTauriEnvironment() || isAppDataResetting()) return;
  cancelScheduledPersist();
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistLastScanNow();
  }, PERSIST_DEBOUNCE_MS);
}

/**
 * Progress events arrive in tight bursts (one `candidates` event per directory).
 * Committing each into Zustand re-rendered the whole table hundreds of times per
 * scan, so candidate rows are buffered for a short window instead (Y-2).
 */
const ITEM_BATCH_MS = 200;
/** Summary rebuilds scan every item; cleaning 500 rows used to do that 500 times. */
const SUMMARY_DEBOUNCE_MS = 250;

let pendingItems: CleanupItem[] = [];
let itemFlushTimer: ReturnType<typeof setTimeout> | null = null;
let summaryDirty = false;
let summaryFlushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Measurement updates are buffered on the same window as candidates.
 *
 * The backend emits one `measured` event per 100 entries, and every commit
 * cloned the whole `itemsById` record (O(N) per event). A 50,000-row scan
 * produced 500 events and therefore 500 full-clone passes plus 500 invalidations
 * of every `itemsById` subscriber (the overview alone re-derives six full
 * aggregates per event). Coalescing cuts both by an order of magnitude.
 */
let pendingMeasurementUpdates: MeasurementUpdate[] = [];
let measurementFlushTimer: ReturnType<typeof setTimeout> | null = null;

/** Commits buffered candidate rows immediately. */
export function flushPendingItems(): void {
  if (itemFlushTimer !== null) {
    clearTimeout(itemFlushTimer);
    itemFlushTimer = null;
  }
  if (pendingItems.length === 0) return;
  const batch = pendingItems;
  pendingItems = [];
  useScanStore.getState().addItems(batch);
}

/** Appends candidate rows to the buffer and schedules one flush. */
export function enqueueItems(items: CleanupItem[]): void {
  if (items.length === 0) return;
  pendingItems.push(...items);
  if (itemFlushTimer === null) {
    itemFlushTimer = setTimeout(() => {
      itemFlushTimer = null;
      flushPendingItems();
    }, ITEM_BATCH_MS);
  }
}

/** Commits buffered measurement updates immediately. */
export function flushPendingMeasurements(): void {
  if (measurementFlushTimer !== null) {
    clearTimeout(measurementFlushTimer);
    measurementFlushTimer = null;
  }
  if (pendingMeasurementUpdates.length === 0) return;
  const batch = pendingMeasurementUpdates;
  pendingMeasurementUpdates = [];
  useScanStore.getState().applyMeasurements(batch);
}

/** Buffers measurement updates and schedules one commit per `ITEM_BATCH_MS`. */
export function enqueueMeasurements(updates: MeasurementUpdate[]): void {
  if (updates.length === 0) return;
  pendingMeasurementUpdates.push(...updates);
  if (measurementFlushTimer === null) {
    measurementFlushTimer = setTimeout(() => {
      measurementFlushTimer = null;
      flushPendingMeasurements();
    }, ITEM_BATCH_MS);
  }
}

/** Rebuilds the summary from the current rows if a mutation is pending. */
export function flushPendingSummary(): void {
  if (summaryFlushTimer !== null) {
    clearTimeout(summaryFlushTimer);
    summaryFlushTimer = null;
  }
  if (!summaryDirty) return;
  summaryDirty = false;
  useScanStore.setState((state) => {
    if (!state.summary) return {};
    const items = state.itemIds
      .map((id) => state.itemsById[id])
      .filter((item): item is CleanupItem => Boolean(item));
    return { summary: recomputeSummary(state.summary, items) };
  });
}

function scheduleSummaryFlush(): void {
  summaryDirty = true;
  if (summaryFlushTimer !== null) return;
  summaryFlushTimer = setTimeout(() => {
    summaryFlushTimer = null;
    flushPendingSummary();
  }, SUMMARY_DEBOUNCE_MS);
}

/**
 * Flushes every buffered write. Called before a scan result is finalized and
 * before a reset, so no row or total is lost or resurrected.
 */
export function flushPendingWrites(): void {
  flushPendingItems();
  flushPendingMeasurements();
  flushPendingSummary();
}

/**
 * Drops buffered writes that belong to a scan being replaced. Without this a
 * late candidate batch from the previous run could appear in the new one.
 */
function discardPendingWrites(): void {
  if (itemFlushTimer !== null) {
    clearTimeout(itemFlushTimer);
    itemFlushTimer = null;
  }
  if (summaryFlushTimer !== null) {
    clearTimeout(summaryFlushTimer);
    summaryFlushTimer = null;
  }
  if (measurementFlushTimer !== null) {
    clearTimeout(measurementFlushTimer);
    measurementFlushTimer = null;
  }
  pendingItems = [];
  pendingMeasurementUpdates = [];
  summaryDirty = false;
}

/**
 * Releases every buffered write and its timer.
 *
 * The buffers are module-level on purpose (a scan must survive a view unmount),
 * but that also means they outlive a store replacement. HMR and the test runner
 * both swap the module: without this an orphan timer kept writing into a store
 * nobody renders, and a test inherited another test's pending batch.
 */
export function disposeScanBuffers(): void {
  cancelScheduledPersist();
  discardPendingWrites();
  // Invalidate a queued persist that is already inside the write chain.
  persistGeneration += 1;
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
  warningsTotal: 0,

  restored: false,
  lastSavedAt: null,
  previousSummary: null,
  previousCleanableBytes: 0,
  previousItemCount: 0,
  persistedRevision: 0,
  workspaceResetToken: 0,
  staleBannerDismissed: false,
  partialBannerDismissed: false,
  noticesBannerDismissed: false,
  noticesInfoDismissed: false,
  noticesIssuesDismissed: false,
  staleAcknowledged: false,
  combinedActive: false,
  activeScanRun: 0,
  scanStartPending: false,

  acquireScanStart: () => {
    if (get().scanStartPending) return false;
    set({ scanStartPending: true });
    return true;
  },

  releaseScanStart: () => set({ scanStartPending: false }),

  beginScanRun: () => {
    const next = get().activeScanRun + 1;
    set({ activeScanRun: next });
    return next;
  },

  startScanState: (rootPath, scope = "project", scanId = null) => {
    // Buffered rows from a previous run must never leak into this one.
    discardPendingWrites();
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
        warningsTotal: 0,
        restored: false,
        lastSavedAt: null,
        previousSummary: hasPrevious ? state.summary : state.previousSummary,
        previousCleanableBytes: hasPrevious ? cleanableBytes(state) : state.previousCleanableBytes,
        previousItemCount: hasPrevious ? state.itemIds.length : state.previousItemCount,
        staleBannerDismissed: false,
        partialBannerDismissed: false,
        noticesBannerDismissed: false,
        noticesInfoDismissed: false,
        noticesIssuesDismissed: false,
        staleAcknowledged: false,
      };
    });
  },

  restoreScan: (snapshot) => {
    if (!snapshot || !snapshot.summary) return false;
    if (snapshot.schemaVersion !== LAST_SCAN_SCHEMA_VERSION) {
      // Never load a snapshot produced by another schema; the caller drops
      // the incompatible file and starts from an empty state instead.
      log.warn(
        `Ignoring last scan with unsupported schema ${snapshot.schemaVersion} ` +
          `(expected ${LAST_SCAN_SCHEMA_VERSION})`,
      );
      return false;
    }
    set(() => {
      const itemsById: Record<string, CleanupItem> = {};
      const itemIds: string[] = [];
      for (const raw of snapshot.items ?? []) {
        const item = normalizeRestoredItem(raw);
        if (!item) continue;
        itemsById[item.id] = item;
        itemIds.push(item.id);
      }
      return {
        scanId: snapshot.summary.scanId,
        // A restored partial scan must keep its warning banner. It is only
        // "cancelled" when the user stopped it; a limit/timeout stop is
        // "partial" and needs the stop reason shown to the user.
        status: (snapshot.summary.partial
          ? snapshot.summary.stopReason === "cancelled"
            ? "cancelled"
            : "partial"
          : "completed") as ScanStatus,
        currentRootPath: snapshot.summary.rootPath || null,
        scope: snapshot.summary.scope,
        itemsById,
        itemIds,
        pendingMeasurements: {},
        progress: null,
        summary: snapshot.summary,
        error: null,
        // Restored warnings explain why the previous scan was incomplete
        // (skipped paths, access errors); dropping them made the partial banner
        // unable to say more than the stop reason.
        warnings: snapshot.warnings ?? [],
        warningsTotal: (snapshot.warnings ?? []).length,
        restored: true,
        lastSavedAt: snapshot.savedAt,
        staleBannerDismissed: false,
        partialBannerDismissed: false,
        noticesBannerDismissed: false,
        noticesInfoDismissed: false,
        noticesIssuesDismissed: false,
        staleAcknowledged: false,
      };
    });
    pruneSelection(get());
    return true;
  },

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

  addItems: (items) => {
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
    });
    pruneSelection(get());
  },

  applyMeasurements: (updates) => {
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
    });
    pruneSelection(get());
  },

  markDeleted: (ids) => {
    set((state) => {
      const affected = collectDescendants(state, ids);
      const nextMap = { ...state.itemsById };
      for (const id of affected) {
        if (nextMap[id]) nextMap[id] = { ...nextMap[id], status: "deleted" };
      }
      return { itemsById: nextMap };
    });
    pruneSelection(get());
    // The summary is a whole-set aggregate; rebuilding it per row made a large
    // cleanup quadratic. One coalesced rebuild per 250 ms is enough (Y-2).
    scheduleSummaryFlush();
    scheduleLastScanPersist();
  },

  removeItems: (ids) => {
    set((state) => {
      const affected = collectDescendants(state, ids);
      const removeSet = new Set(affected);
      const nextMap = { ...state.itemsById };
      for (const id of affected) delete nextMap[id];
      const nextIds = state.itemIds.filter((id) => !removeSet.has(id));
      return { itemsById: nextMap, itemIds: nextIds };
    });
    pruneSelection(get());
    scheduleSummaryFlush();
    scheduleLastScanPersist();
  },

  pruneItems: (predicate) => {
    set((state) => {
      const matches = state.itemIds.filter((id) => {
        const item = state.itemsById[id];
        return !!item && predicate(item);
      });
      if (matches.length === 0) return state;

      const removeSet = new Set(collectDescendants(state, matches));
      const nextMap = { ...state.itemsById };
      for (const id of removeSet) delete nextMap[id];
      const nextIds = state.itemIds.filter((id) => !removeSet.has(id));
      const remaining = nextIds
        .map((id) => nextMap[id])
        .filter((item): item is CleanupItem => Boolean(item));

      // Rebuild the totals here instead of only scheduling the debounced flush:
      // provider statistics and the page header read the summary immediately,
      // so they would otherwise keep counting removed rows for up to 250 ms.
      return {
        itemsById: nextMap,
        itemIds: nextIds,
        summary: state.summary ? recomputeSummary(state.summary, remaining) : state.summary,
      };
    });
    pruneSelection(get());
    scheduleLastScanPersist();
  },

  addWarning: (warning) =>
    set((state) => ({
      // Past the cap the array keeps its identity, so no subscriber re-renders
      // for a warning the banner will not display; the counter still advances.
      warnings:
        state.warnings.length >= MAX_SCAN_WARNINGS ? state.warnings : [...state.warnings, warning],
      warningsTotal: state.warningsTotal + 1,
    })),

  // Defensive routing: even if a caller (or an older backend) delivers a
  // limit/timeout summary as `completed`, an explicitly partial summary must
  // never be shown as a complete scan. True cancellations arrive on the
  // dedicated `cancelled` path instead.
  completeScan: (summary) => set({ status: summary.partial ? "partial" : "completed", summary }),

  // A cancelled event without a summary must not erase the numbers the user was
  // already looking at; keep the previous summary in that case.
  cancelScanState: (summary) =>
    set((state) => ({ status: "cancelled", summary: summary ?? state.summary })),

  partialScanState: (summary) => set({ status: "partial", summary }),

  failScan: (error) => set({ status: "failed", error }),

  dismissStaleBanner: () => set({ staleBannerDismissed: true }),

  dismissPartialBanner: () => set({ partialBannerDismissed: true }),

  dismissNoticesBanner: () =>
    set({
      noticesBannerDismissed: true,
      noticesInfoDismissed: true,
      noticesIssuesDismissed: true,
    }),

  dismissInfoNotices: () => set({ noticesInfoDismissed: true }),

  dismissIssueNotices: () => set({ noticesIssuesDismissed: true }),

  setCombinedActive: (active) => set({ combinedActive: active }),

  acknowledgeStale: () => set({ staleAcknowledged: true, staleBannerDismissed: true }),

  resetScan: (options?: { clearPersisted?: boolean }) => {
    // A debounced write scheduled before the reset must not persist the old
    // scan after the user asked for a clean slate.
    cancelScheduledPersist();
    // Buffered rows/summaries describe the scan being discarded.
    discardPendingWrites();
    if (options?.clearPersisted) {
      // The snapshot on disk is part of "scan data": leaving it behind made
      // the reset undurable across a restart.
      clearPersistedLastScan();
    }
    // Selected ids only describe the rows being discarded; keeping them left
    // the action bar counting targets that no longer exist.
    useSelectionStore.getState().clearSelection();
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
      warningsTotal: 0,
      restored: false,
      lastSavedAt: null,
      // M4: the comparison badge describes the discarded scan; carrying it
      // into the next scan produced phantom up/down deltas.
      previousSummary: null,
      previousCleanableBytes: 0,
      previousItemCount: 0,
      staleBannerDismissed: false,
      partialBannerDismissed: false,
      noticesBannerDismissed: false,
      noticesInfoDismissed: false,
      noticesIssuesDismissed: false,
      staleAcknowledged: false,
      combinedActive: false,
      // Signals a late startup restore that the user asked for a clean slate.
      workspaceResetToken: get().workspaceResetToken + 1,
    });
  },
}));
