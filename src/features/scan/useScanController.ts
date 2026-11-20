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
import { useSystemStore } from "@/stores/system-store";
import { ScanEvent, ScanRequest, ScanScope, ScanSummary } from "@/types";
import { appendScanHistory } from "@/features/history/scan-history";
import { getUIText, localizeAppError } from "@/lib/ui-text";
import { notificationService } from "@/lib/notifications/notification-service";
import { checkDiskPressure, dispatchLifecycleWebhook } from "@/lib/notifications/lifecycle";
import { toAppError } from "@/lib/errors/app-error";
import { log } from "@/lib/logging";
import { waitForCondition, withTimeout } from "@/lib/async/with-timeout";
import { startCombinedCacheMeasure, abortCombinedCacheMeasure } from "./combined-measure";
import {
  ALL_SCAN_TARGETS,
  isScanActiveNow,
  ScanTargetKey,
  useScanActive,
  useScanTargetsStore,
} from "./scan-activity";

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
      scanSystem = false,
      activeTargetsOverride?: ScanTargetKey[],
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
      // The cache & system steps of a combined run are started next to the walk,
      // not after it, so they have to survive into the `finally` below.
      let measureRun: Promise<void> | null = null;
      let systemRun: Promise<void> | null = null;
      const inferredTargets: ScanTargetKey[] = activeTargetsOverride ?? [
        ...(scope === "agents" ? (["agents"] as const) : (["projects"] as const)),
        ...(scope === "combined" ? (["agents"] as const) : []),
        ...(measureCaches ? (["caches"] as const) : []),
        ...(scanSystem ? (["system"] as const) : []),
      ];
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
        useScanTargetsStore.getState().setActiveRun(inferredTargets, scope === "allDrives");
        useScanStore.getState().startScanState(root, scope);

        // Package caches and C: system scan use separate backend sessions, so
        // they start alongside the project/agent walk. Measuring them last left
        // those views reading "not measured" for the whole scan and could race a
        // user "Stop".
        if (measureCaches) {
          measureRun = startCombinedCacheMeasure();
        }
        if (scanSystem) {
          systemRun = useSystemStore.getState().load();
        }
        if (measureRun || systemRun) {
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
          includeAgents: scope === "allDrives" ? inferredTargets.includes("agents") : undefined,
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
          if ((scope === "project" || scope === "combined") && root) {
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
        // The scan start slot only guards the walk. Parallel cache and system
        // steps own separate backend sessions, so awaiting them here would block
        // future starts if one never settled.
        useScanStore.getState().releaseScanStart();
        const companionRuns = [measureRun, systemRun].filter(
          (run): run is Promise<void> => run !== null,
        );
        if (companionRuns.length > 0) {
          void withTimeout(
            Promise.allSettled(companionRuns),
            COMBINED_MEASURE_TIMEOUT_MS,
            "combined companion scans",
          )
            .catch(() => {
              log.warn("Combined companion scan did not settle in time");
            })
            .finally(() => {
              useScanStore.getState().setCombinedActive(false);
              useScanTargetsStore.getState().clearActiveRun();
            });
        } else {
          useScanStore.getState().setCombinedActive(false);
          useScanTargetsStore.getState().clearActiveRun();
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
   * Unified multi-target scan entry point for the top command bar.
   *
   * Runs any user-selected subset of `{projects, agents, caches, system}` (and
   * optional all-drives mode) in parallel under one live header indicator.
   */
  const startSelectedScan = useCallback(
    async (
      targetsOverride?: ScanTargetKey[],
      allDrivesOverride?: boolean,
      rootOverride?: string,
    ): Promise<boolean> => {
      if (isScanActiveNow() || useScanStore.getState().scanStartPending) {
        return false;
      }
      const targetState = useScanTargetsStore.getState();
      const rawTargets = targetsOverride ?? targetState.targets;
      const targets: ScanTargetKey[] =
        rawTargets.length > 0 ? [...rawTargets] : [...ALL_SCAN_TARGETS];

      const hasProjects = targets.includes("projects");
      const hasAgents = targets.includes("agents");
      const hasCaches = targets.includes("caches");
      const hasSystem = targets.includes("system");

      const effectiveAllDrives = hasProjects && (allDrivesOverride ?? targetState.allDrives);

      if (hasProjects || hasAgents) {
        const scope: ScanScope =
          hasProjects && effectiveAllDrives
            ? "allDrives"
            : hasProjects && hasAgents
              ? "combined"
              : hasProjects
                ? "project"
                : "agents";
        return runScan(rootOverride, scope, hasCaches, hasSystem, targets);
      }

      // Only caches and/or C: system cleaner selected — run without starting a
      // filesystem project/agent walk.
      useScanTargetsStore.getState().setActiveRun(targets, false);
      if (hasCaches || hasSystem) {
        useScanStore.getState().setCombinedActive(true);
      }
      try {
        const tasks: Promise<void>[] = [];
        if (hasCaches) tasks.push(startCombinedCacheMeasure());
        if (hasSystem) tasks.push(useSystemStore.getState().load());
        await Promise.allSettled(tasks);
        return true;
      } finally {
        useScanStore.getState().setCombinedActive(false);
        useScanTargetsStore.getState().clearActiveRun();
      }
    },
    [runScan],
  );

  /**
   * "Scan everything": projects, AI agent storage, package caches and C: system.
   */
  const startFullScan = useCallback(
    async (rootOverride?: string) => startSelectedScan([...ALL_SCAN_TARGETS], false, rootOverride),
    [startSelectedScan],
  );

  const cancelScan = useCallback(async () => {
    // Read the live status instead of a value captured at render time: a
    // shortcut pressed right after the scan finished would otherwise silently
    // do nothing (or worse, cancel a newer scan).
    const previous = useScanStore.getState().status;
    const combined = useScanStore.getState().combinedActive;
    const cacheRunning = useCacheStore.getState().measuring;
    const systemRunning = useSystemStore.getState().loading;
    // Only a scan session can be cancelled on the backend. A combined run may
    // still be measuring caches or C: system targets after the scan itself
    // reported `completed`; that state must not send a scan-cancel for a session
    // that no longer exists (it used to leave the header stuck in `cancelling`).
    const scanRunning =
      previous === "scanning" || previous === "measuring" || previous === "cancelling";
    // Idle is the only state with nothing to cancel; every other state may
    // still hold a backend session that should be released.
    if (!scanRunning && !cacheRunning && !systemRunning && !combined) return;
    // Rows buffered just before the cancel must not be lost.
    flushPendingWrites();
    // The cache & system steps of a combined run are aborted even when their
    // measurement has not started yet.
    const abortCaches = combined || cacheRunning;
    const abortSystem = combined || systemRunning;
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
        abortSystem
          ? withTimeout(
              useSystemStore.getState().cancel(),
              CANCEL_SETTLE_TIMEOUT_MS,
              "abort system scan",
            ).catch((err) => {
              log.warn("System scan did not stop in time", err);
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
    startSelectedScan,
    startFullScan,
    cancelScan,
  };
}
