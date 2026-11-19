import { useCallback } from "react";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { usePreferencesStore } from "@/stores/preferences-store";
import {
  useScanStore,
  persistLastScanNow,
  enqueueItems,
  enqueueMeasurements,
  flushPendingWrites,
} from "@/stores/scan-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useUiStore } from "@/stores/ui-store";
import { useCacheStore } from "@/stores/cache-store";
import { ScanEvent, ScanRequest, ScanScope, ScanSummary } from "@/types";
import { appendScanHistory } from "@/features/history/scan-history";
import { getUIText, localizeAppError } from "@/lib/ui-text";
import { notificationService } from "@/lib/notifications/notification-service";
import { checkDiskPressure, dispatchLifecycleWebhook } from "@/lib/notifications/lifecycle";
import { toAppError } from "@/lib/errors/app-error";
import { log } from "@/lib/logging";
import { waitForCondition, withTimeout } from "@/lib/async/with-timeout";
import { startCombinedCacheMeasure, abortCombinedCacheMeasure } from "./combined-measure";
import { useScanActive } from "./scan-activity";

/**
 * A backend that never answers must not hold the scan start slot forever. The
 * cap is generous: it exists to end a stuck session, not to interrupt a real
 * measurement of a large disk.
 */
const COMBINED_MEASURE_TIMEOUT_MS = 30 * 60 * 1000;
/** How long the terminal event may take after a cancel was acknowledged. */
const CANCEL_SETTLE_TIMEOUT_MS = 3000;

export function useScanController() {
  const status = useScanStore((s) => s.status);
  const combinedActive = useScanStore((s) => s.combinedActive);
  // One definition of "busy" for the header, the overview and the shortcut
  // listener; a second copy is how Ctrl+Enter went dead during a cache step.
  const isScanning = useScanActive();

  const runScan = useCallback(
    async (
      rootOverride?: string,
      scope: ScanScope = "project",
      measureCaches = false,
    ): Promise<boolean> => {
      const current = useScanStore.getState();
      if (
        current.scanStartPending ||
        current.combinedActive ||
        current.status === "scanning" ||
        current.status === "measuring" ||
        current.status === "cancelling"
      ) {
        return false;
      }

      if (!current.acquireScanStart()) return false;
      // The cache step of a combined run is started next to the walk, not after
      // it, so it has to survive into the `finally` below.
      let measureRun: Promise<void> | null = null;
      try {
        // Only a project scan has a single root. `agents` and `allDrives` are
        // virtual scopes: reusing the last project path made the header claim a
        // folder that the backend was not scanning.
        let root = "";
        if (scope === "project") {
          // `??` only skips null/undefined, so an empty persisted root (first run,
          // cleared location) silently disabled the last-used-folder fallback.
          root =
            rootOverride ||
            current.currentRootPath ||
            usePreferencesStore.getState().lastScanPath ||
            "";
          if (!root) {
            let picked: string | null = null;
            try {
              picked = await scannerApi.selectFolderDialog(getUIText().header.folderNotSelected);
            } catch (err) {
              // Every caller uses `void startScan(...)`, so a rejection from the
              // native dialog would become an unhandled rejection with no
              // feedback: the "Choose folder" button would appear dead.
              useUiStore.getState().showToast(localizeAppError(toAppError(err)), "error", 6000);
              return false;
            }
            if (!picked) return false;
            root = picked;
          }
        } else if (scope === "combined") {
          // "Scan everything" must never block on a folder dialog: the agent and
          // cache scopes do not need a root. When the user has never picked a
          // folder the project step reports `NO_ROOT` in the coverage summary.
          root =
            rootOverride ||
            (current.scope === "allDrives" ? "" : current.currentRootPath) ||
            usePreferencesStore.getState().lastScanPath ||
            "";
        }

        const prefs = usePreferencesStore.getState();
        const runId = useScanStore.getState().beginScanRun();
        useSelectionStore.getState().clearSelection();
        useScanStore.getState().startScanState(root, scope);

        // "Scan everything" covers three scopes. Package caches use a separate
        // backend session, so the measurement starts here, alongside the
        // project/agent walk. Measuring it last left the caches page reading
        // "not measured" for the whole scan — it looked like the action never
        // included caches — and a user "Stop" then resolved the walk and
        // *started* a fresh measurement.
        if (measureCaches) {
          measureRun = startCombinedCacheMeasure();
          useScanStore.getState().setCombinedActive(true);
        }

        const handleEvent = (event: ScanEvent) => {
          // Late events from a previous run must not touch the current session.
          if (runId !== useScanStore.getState().activeScanRun) return;
          const store = useScanStore.getState();
          switch (event.type) {
            case "started":
              if (store.scanId !== event.scanId) {
                useScanStore.setState({ scanId: event.scanId });
              }
              break;
            case "candidates":
              // Buffered for 200 ms; a per-directory commit re-rendered the table
              // hundreds of times per scan.
              enqueueItems(event.items);
              break;
            case "measured":
              // Same 200 ms window as candidates: the backend emits one batch
              // per 100 entries and each commit clones the whole item record.
              enqueueMeasurements(event.updates);
              break;
            case "progress":
              store.updateProgress(event.progress);
              break;
            case "warning":
              // Severity is classified by the backend: it knows the walk root,
              // while the UI only sees the joined label of a full-disk scan.
              store.addWarning({
                code: event.code,
                path: event.path,
                severity: event.severity,
                root: event.root,
              });
              break;
            case "completed":
              flushPendingWrites();
              store.completeScan(event.summary);
              break;
            case "partial":
              // A limit or the timeout stopped the walk. The backend now has a
              // dedicated event so this is never confused with a completed scan or
              // a user cancel.
              flushPendingWrites();
              store.partialScanState(event.summary);
              break;
            case "cancelled":
              // The backend reports both a user cancel and a limit/timeout stop as
              // the "cancelled" event; only `stopReason` distinguishes them.
              flushPendingWrites();
              if (event.summary.partial && event.summary.stopReason !== "cancelled") {
                store.partialScanState(event.summary);
              } else {
                store.cancelScanState(event.summary);
              }
              break;
            case "failed":
              flushPendingWrites();
              store.failScan(event.error);
              break;
          }
        };

        const request: ScanRequest = {
          rootPath: scope === "agents" ? "" : root,
          scope,
          exclusions: prefs.excludedNames,
          protectedPaths: prefs.protectedPaths,
          profile: prefs.scanProfile,
          maxDepth: prefs.maxDepth,
          maxCandidates: prefs.maxCandidates,
          timeoutMinutes: prefs.timeoutMinutes,
          minSizeBytes: prefs.minSizeBytes,
        };

        try {
          const summary = await scannerApi.startScan(request, handleEvent);
          // A newer scan started while this one was awaiting; its state must not be
          // overwritten by the older result (history, notifications, webhook).
          if (runId !== useScanStore.getState().activeScanRun) return false;
          // The last buffered candidate batch must land before the final state is
          // read for history, notifications and the persisted snapshot.
          flushPendingWrites();
          const store = useScanStore.getState();
          if (
            store.status !== "completed" &&
            store.status !== "cancelled" &&
            store.status !== "partial"
          ) {
            if (summary.partial && summary.stopReason !== "cancelled") {
              // Limit/timeout stop: keep it distinct from a user cancel so the UI
              // can explain that the result is incomplete.
              store.partialScanState(summary);
            } else if (summary.partial) {
              store.cancelScanState(summary);
            } else {
              store.completeScan(summary);
            }
          }
          if (scope === "project" && root) {
            prefs.addRecentLocation(root);
          }
          // Persist every finished result (including a partial one); failures keep
          // the previous snapshot untouched so the user still opens to something
          // useful.
          const finished = useScanStore.getState();
          const isFinished =
            finished.status === "completed" ||
            finished.status === "cancelled" ||
            finished.status === "partial";
          // A scan cancelled before it found anything must not replace the last
          // good snapshot (and must not add noise to history).
          const replacedWithNothing =
            finished.status === "cancelled" && finished.itemIds.length === 0;
          if (isFinished && !replacedWithNothing) {
            void persistLastScanNow();
            // `cleanableBytes` is computed by the backend from selectable,
            // unprotected items. Re-deriving it here used to double-count targets
            // that can never be cleaned.
            const cleanableBytes = finished.summary?.cleanableBytes ?? 0;
            // The summary path is authoritative for all-drive scans (it holds the
            // joined drive list); the store root is empty for that virtual scope.
            // A combined run without a selected folder has no path at all, so the
            // history row gets an explicit placeholder instead of "allDrives".
            const rootPath =
              finished.summary?.rootPath ||
              finished.currentRootPath ||
              (finished.scope === "combined"
                ? "combined"
                : finished.scope === "agents"
                  ? "agents"
                  : "allDrives");
            // History is a user-controlled feature; a disabled switch must stop
            // recording immediately rather than only hiding the page.
            if (usePreferencesStore.getState().historyEnabled) {
              appendScanHistory({
                id: finished.scanId || `scan-${Date.now()}`,
                timestamp: new Date().toISOString(),
                scope: finished.scope || "project",
                rootPath,
                itemCount: finished.itemIds.length,
                cleanableBytes,
                durationMs: finished.summary?.durationMs ?? 0,
                status:
                  finished.status === "completed"
                    ? "completed"
                    : finished.status === "cancelled"
                      ? "cancelled"
                      : "partial",
                stopReason: finished.summary?.stopReason ?? null,
              });
            }

            if (finished.status === "completed" || finished.status === "partial") {
              notificationService.notifyScanComplete({
                targetCount: finished.itemIds.length,
                reclaimBytes: cleanableBytes,
                durationMs: finished.summary?.durationMs,
                // Partial results are still actionable; the notice explains why
                // the scan stopped instead of disappearing entirely.
                partial: finished.status === "partial",
                stopReason: finished.summary?.stopReason ?? null,
              });
            }

            void dispatchLifecycleWebhook("scan", {
              event: "scan",
              scanId: finished.scanId,
              scope: finished.scope,
              rootPath,
              itemCount: finished.itemIds.length,
              cleanableBytes,
              durationMs: finished.summary?.durationMs ?? 0,
              partial: Boolean(finished.summary?.partial),
              stopReason: finished.summary?.stopReason ?? null,
            });
            void checkDiskPressure();
          }

          // Cache measurement is already running alongside this walk; see the
          // `startCombinedCacheMeasure` call above. It is awaited in `finally`.
          return true;
        } catch (err) {
          // A cancelled/failed run that was superseded must not mark the new scan
          // as failed.
          if (runId !== useScanStore.getState().activeScanRun) return false;
          flushPendingWrites();
          const error = toAppError(err);
          useScanStore.getState().failScan(error);
          // A failed walk must not leave the parallel measurement running
          // unattended; the user can retry the combined action. Bounded like the
          // stop path so a silent backend cannot keep the start slot held.
          if (measureRun) {
            await withTimeout(
              abortCombinedCacheMeasure(),
              CANCEL_SETTLE_TIMEOUT_MS,
              "abort combined cache measure",
            ).catch((err) => {
              log.warn("Combined cache measurement could not be aborted", err);
            });
          }
          if (error.code !== "ScanCancelled") {
            useUiStore.getState().showToast(localizeAppError(error), "error", 6000);
          }
          return false;
        }
      } finally {
        // The scan start slot only guards the walk. The cache step owns a
        // separate backend session, so awaiting it here made a command that
        // never settles keep `scanStartPending` (and therefore every future
        // start) blocked until the app restarted.
        useScanStore.getState().releaseScanStart();
        if (measureRun) {
          void withTimeout(measureRun, COMBINED_MEASURE_TIMEOUT_MS, "combined cache measure")
            .catch(() => {
              log.warn("Combined cache measurement did not settle in time");
            })
            .finally(() => useScanStore.getState().setCombinedActive(false));
        } else {
          useScanStore.getState().setCombinedActive(false);
        }
      }
    },
    [],
  );

  const startScan = useCallback(
    async (rootOverride?: string, scope: ScanScope = "project") => runScan(rootOverride, scope),
    [runScan],
  );

  /**
   * Always opens the native folder picker and immediately starts a project scan
   * on the selected directory (used by "Choose folder" actions so they never
   * silently re-scan a previous root).
   */
  const chooseFolderAndScan = useCallback(async (): Promise<boolean> => {
    const current = useScanStore.getState();
    if (
      current.scanStartPending ||
      current.combinedActive ||
      current.status === "scanning" ||
      current.status === "measuring" ||
      current.status === "cancelling"
    ) {
      return false;
    }
    let picked: string | null = null;
    try {
      picked = await scannerApi.selectFolderDialog(getUIText().header.folderNotSelected);
    } catch (err) {
      useUiStore.getState().showToast(localizeAppError(toAppError(err)), "error", 6000);
      return false;
    }
    if (!picked) return false;
    return runScan(picked, "project");
  }, [runScan]);

  /**
   * "Scan everything": projects, AI agent storage and package caches.
   *
   * Projects and agents share one backend session (one progress stream, one
   * cancel, one result set). Package caches use the dedicated official-action
   * pipeline, so they are measured in parallel by the same action; the header's
   * single "Stop" cancels both.
   */
  const startFullScan = useCallback(
    async (rootOverride?: string) => runScan(rootOverride, "combined", true),
    [runScan],
  );

  const cancelScan = useCallback(async () => {
    // Read the live status instead of a value captured at render time: a
    // shortcut pressed right after the scan finished would otherwise silently
    // do nothing (or worse, cancel a newer scan).
    const previous = useScanStore.getState().status;
    const combined = useScanStore.getState().combinedActive;
    const cacheRunning = useCacheStore.getState().measuring;
    // Only a scan session can be cancelled on the backend. A combined run may
    // still be measuring caches after the scan itself reported `completed`;
    // that state must not send a scan-cancel for a session that no longer
    // exists (it used to leave the header stuck in `cancelling`).
    const scanRunning =
      previous === "scanning" || previous === "measuring" || previous === "cancelling";
    // Idle is the only state with nothing to cancel; every other state may
    // still hold a backend session that should be released.
    if (!scanRunning && !cacheRunning && !combined) return;
    // Rows buffered just before the cancel must not be lost.
    flushPendingWrites();
    // The cache step of a combined run is aborted even when its measurement has
    // not started yet: it may still be loading provider rows, and that pending
    // start used to ignore the first "Stop" and begin measuring afterwards.
    const abortCaches = combined || cacheRunning;
    if (scanRunning) useScanStore.setState({ status: "cancelling" });
    try {
      await Promise.all([
        scanRunning ? scannerApi.cancelScan() : Promise.resolve(),
        // The abort awaits the measurement promise, and that promise only
        // settles when the backend acknowledges the cancel. A dropped channel
        // must not turn "Stop" into a permanently disabled button, so the wait
        // is bounded here as well; the store reconciles its own flag when the
        // measurement finally ends.
        abortCaches
          ? withTimeout(
              abortCombinedCacheMeasure(),
              CANCEL_SETTLE_TIMEOUT_MS,
              "abort combined cache measure",
            ).catch((err) => {
              log.warn("Combined cache measurement did not stop in time", err);
            })
          : Promise.resolve(),
      ]);
      if (scanRunning) {
        // Acknowledging the cancel is not the same as the walk ending. If the
        // terminal event never arrives (the session closed between the press and
        // the command, or the event channel dropped) the UI stayed in
        // `cancelling` forever and the stop button stayed disabled, so no new
        // scan could start. Reconcile with the backend's own summary instead of
        // trusting an event that may never come.
        const settled = await waitForCondition(
          () => useScanStore.getState().status !== "cancelling",
          { timeoutMs: CANCEL_SETTLE_TIMEOUT_MS },
        );
        if (!settled && useScanStore.getState().status === "cancelling") {
          let summary: ScanSummary | null = null;
          try {
            summary = await withTimeout(
              scannerApi.getScanSummary(useScanStore.getState().scanId ?? undefined),
              2000,
              "getScanSummary",
            );
          } catch (err) {
            // Reconciliation is best-effort; the store still needs a terminal
            // state so the UI is usable again.
            log.warn("Cancel reconciliation could not read the scan summary", err);
          }
          if (useScanStore.getState().status === "cancelling") {
            if (summary) useScanStore.getState().cancelScanState(summary);
            else useScanStore.setState({ status: "cancelled" });
          }
        }
      }
    } catch (err) {
      // The backend never accepted the cancel. Leaving the UI in `cancelling`
      // made the stop button unresponsive forever; roll back to the state the
      // scan actually had.
      const current = useScanStore.getState();
      if (current.status === "cancelling") {
        useScanStore.setState({ status: previous === "cancelling" ? "scanning" : previous });
      }
      useUiStore.getState().showToast(localizeAppError(err), "error");
    }
  }, []);

  return {
    isScanning,
    status,
    combinedActive,
    startScan,
    chooseFolderAndScan,
    startFullScan,
    cancelScan,
  };
}
