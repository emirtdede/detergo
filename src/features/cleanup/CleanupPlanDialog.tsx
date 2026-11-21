import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { Dialog } from "@/components/primitives/Dialog";
import { Button } from "@/components/primitives/Button";
import { Checkbox } from "@/components/primitives/Checkbox";
import { useScanStore, flushLastScanPersist } from "@/stores/scan-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useUiStore } from "@/stores/ui-store";
import { useCleanupRunStore } from "@/stores/cleanup-run-store";
import {
  useUIText,
  localizeAppError,
  localizeBackendNote,
  localizeWarningCode,
  isScanSessionError,
} from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { formatBytes } from "@/lib/formatters";
import { usePreferencesStore } from "@/stores/preferences-store";
import { maskPath } from "@/lib/format/path";
import { DeleteMode } from "@/types";
import { useScanController } from "@/features/scan/useScanController";
import { notificationService } from "@/lib/notifications/notification-service";
import {
  checkDiskPressure,
  dispatchLifecycleWebhook,
  notifyLockedTargets,
} from "@/lib/notifications/lifecycle";

import "../items/items.css";

export const CleanupPlanDialog: React.FC = () => {
  const ui = useUIText();
  const activeModal = useUiStore((s) => s.activeModal);
  const plan = useUiStore((s) => s.plan);
  const pendingIds = useUiStore((s) => s.pendingDeletionIds);
  const pendingMode = useUiStore((s) => s.pendingMode);
  const setPlan = useUiStore((s) => s.setPlan);
  const setReport = useUiStore((s) => s.setReport);
  const openModal = useUiStore((s) => s.openModal);
  const closeModal = useUiStore((s) => s.closeModal);
  const hideModal = useUiStore((s) => s.hideModal);
  const showToast = useUiStore((s) => s.showToast);

  const scanId = useScanStore((s) => s.scanId);
  const scope = useScanStore((s) => s.scope);
  const markDeleted = useScanStore((s) => s.markDeleted);
  const deselectMany = useSelectionStore((s) => s.deselectMany);
  const maskPaths = usePreferencesStore((s) => s.maskPaths);
  const language = usePreferencesStore((s) => s.language);
  const { startScan, isScanning } = useScanController();

  const runProgress = useCleanupRunStore((s) => s.progress);
  // Actions are stable references; subscribing to the whole store re-rendered
  // this dialog for every `itemStarted`/`itemFinished` event.
  const runStart = useCleanupRunStore((s) => s.start);
  const runApplyEvent = useCleanupRunStore((s) => s.applyEvent);
  const runFinish = useCleanupRunStore((s) => s.finish);
  const runDismiss = useCleanupRunStore((s) => s.dismiss);
  const runMarkCancelling = useCleanupRunStore((s) => s.markCancelling);

  const [mode, setMode] = useState<DeleteMode>(pendingMode);
  const [ack, setAck] = useState(false);
  // `busy` means a cleanup command is actually running. Preview preparation has
  // its own flag: reusing `busy` made the "cancel run" button call
  // `cancelCleanup()` while no cleanup existed, and locked the dialog shut.
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  // A restored snapshot has no live backend session after a restart. Keep the
  // dialog open and offer a rescan instead of closing on a generic toast.
  const [sessionProblem, setSessionProblem] = useState(false);

  const progress = busy ? runProgress : null;
  // Drops a late preview response after the dialog was closed or the user
  // switched mode/selection while the request was still running.
  const loadGenerationRef = useRef(0);
  const planListRef = useRef<HTMLDivElement>(null);
  const planItems = plan?.items ?? [];
  const planVirtualizer = useVirtualizer({
    count: planItems.length,
    getScrollElement: () => planListRef.current,
    estimateSize: () => 56,
    overscan: 8,
    initialRect: { width: 680, height: 320 },
  });

  const load = useCallback(
    async (nextMode: DeleteMode, ids: string[]) => {
      if (!scanId) {
        showToast(ui.errors.blocked, "error");
        closeModal();
        return;
      }
      const generation = loadGenerationRef.current + 1;
      loadGenerationRef.current = generation;
      setPreviewing(true);
      setPlan(null);
      setSessionProblem(false);
      try {
        const next = await scannerApi.previewCleanup(scanId, ids, nextMode);
        if (generation !== loadGenerationRef.current) return;
        setPlan(next);
      } catch (err) {
        if (generation !== loadGenerationRef.current) return;
        if (isScanSessionError(err)) {
          setSessionProblem(true);
          return;
        }
        showToast(localizeAppError(err, ui), "error", 7000);
        closeModal();
      } finally {
        if (generation === loadGenerationRef.current) setPreviewing(false);
      }
    },
    [scanId, setPlan, closeModal, showToast, ui],
  );

  // The load effect must react to the selected targets, not to the identity of
  // the `load` callback. `load` depends on the UI dictionary, so a language
  // switch used to reset the acknowledgement checkbox and re-fetch the plan
  // while the user was reviewing it.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const pendingIdsRef = useRef(pendingIds);
  useEffect(() => {
    pendingIdsRef.current = pendingIds;
  }, [pendingIds]);

  // A stable key: the order of ids must not force a reload.
  const pendingKey = useMemo(() => [...pendingIds].sort().join("\u0000"), [pendingIds]);

  useEffect(() => {
    if (activeModal !== "cleanup-plan") {
      // Invalidate any in-flight preview when the dialog closes.
      loadGenerationRef.current += 1;
      setPreviewing(false);
      return;
    }
    setAck(false);
    setMode(pendingMode);
    setPlan(null);
    setSessionProblem(false);
    const ids = pendingIdsRef.current;
    if (ids.length > 0) {
      void loadRef.current(pendingMode, ids);
    }
    return () => {
      // A mode/selection change must not let the previous plan land late.
      loadGenerationRef.current += 1;
    };
  }, [activeModal, pendingKey, pendingMode]);

  if (activeModal !== "cleanup-plan") return null;

  const switchMode = (nextMode: DeleteMode) => {
    if (nextMode === mode || busy || previewing) return;
    setMode(nextMode);
    setAck(false);
    void load(nextMode, pendingIds);
  };

  const execute = async (runInBackground: boolean) => {
    if (!plan || busy || previewing) return;
    if (mode === "permanent" && !ack) return;

    const activePlan = plan;
    setBusy(true);
    runStart(activePlan.id, activePlan.eligibleCount, runInBackground);
    // Dismiss the modal immediately when the user chose background execution so
    // the workspace unlocks right away while CleanupProgressDock tracks progress.
    if (runInBackground) {
      hideModal();
    }

    // A cleanup can fail mid-run (backend error, cancelled session, IO error).
    // `executeCleanup` then rejects without a report, so the rows already
    // deleted stayed selected and cleanable in the table. Track successes by
    // their 1-based eligible index and reconcile the scan snapshot on failure.
    const eligibleItems = activePlan.items.filter((item) => item.eligible);
    const succeededIds = new Set<string>();

    try {
      const report = await scannerApi.executeCleanup(
        activePlan.id,
        activePlan.confirmationToken,
        ack,
        (event) => {
          if (event.type === "itemFinished" && event.success) {
            const item = eligibleItems[event.index - 1];
            if (item) succeededIds.add(item.targetId);
          }
          runApplyEvent(event);
        },
      );

      const successIds = report.results.filter((r) => r.success).map((r) => r.targetId);
      if (successIds.length > 0) {
        markDeleted(successIds);
        // Persist immediately: if the app is closed right after a cleanup the
        // deleted rows must not reappear as cleanable on the next launch.
        void flushLastScanPersist();
        // Keep failed targets selected so the user can review and retry them.
        deselectMany(successIds);
      }

      setReport(report);
      setPlan(null);

      notificationService.notifyCleanComplete({
        count: report.successCount,
        // Moving a file to the Recycle Bin does not free disk space, so a
        // recycle-mode notice must report the moved bytes (reclaimBytes stays
        // zero until the user empties the bin).
        bytes: report.mode === "permanent" ? report.reclaimBytes : report.movedBytes,
        destination:
          report.mode === "permanent" ? ui.notifications.destPermanent : ui.notifications.destTrash,
      });

      // Files held by a running process cannot be cleaned; tell the user which
      // ones instead of leaving them as anonymous failures.
      notifyLockedTargets(report.results);

      void dispatchLifecycleWebhook("clean", {
        event: "clean",
        planId: report.planId,
        mode: report.mode,
        successCount: report.successCount,
        errorCount: report.errorCount,
        reclaimBytes: report.reclaimBytes,
        movedBytes: report.movedBytes,
        durationMs: report.durationMs,
        cancelled: report.cancelled,
      });
      void checkDiskPressure();

      if (runInBackground) {
        // Keep the completed report in the run store so the dock can offer
        // "View results" after the dialog is gone.
        runFinish(report);
        hideModal();
      } else {
        runFinish(report);
        runDismiss();
        openModal("cleanup-result");
      }

      if (report.auditError) showToast(localizeAppError(report.auditError, ui), "error", 8000);
    } catch (err) {
      runDismiss();
      // Whatever the backend managed to delete before failing is already gone
      // from disk. Mark those rows deleted so the table and the remaining
      // selection do not promise a cleanup that would fail again.
      if (succeededIds.size > 0) {
        const ids = Array.from(succeededIds);
        markDeleted(ids);
        deselectMany(ids);
        void flushLastScanPersist();
      }
      setPlan(null);
      if (isScanSessionError(err)) {
        // The plan outlived its session. Keep the dialog open so the user can
        // rescan without losing the workflow to a transient toast.
        setSessionProblem(true);
        setPlan(null);
        return;
      }
      showToast(localizeAppError(err, ui), "error", 7000);
      closeModal();
    } finally {
      setBusy(false);
    }
  };

  const rescanNow = () => {
    closeModal();
    void startScan(undefined, scope);
  };

  const cancelRun = async () => {
    runMarkCancelling();
    try {
      await scannerApi.cancelCleanup();
    } catch (err) {
      showToast(localizeAppError(err, ui), "error", 7000);
    }
  };

  const cancelling = runProgress?.status === "cancelling";
  const processed = progress?.processed ?? 0;
  const total = progress?.total ?? 0;
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  // Closing while a preview is still being prepared is allowed: the generation
  // counter makes the late answer harmless.
  const cancelPreview = () => {
    loadGenerationRef.current += 1;
    setPreviewing(false);
    setPlan(null);
    closeModal();
  };

  const footer = busy ? (
    <>
      <Button variant="secondary" size="sm" onClick={() => void cancelRun()} disabled={cancelling}>
        {cancelling ? ui.plan.cancelling : ui.plan.cancelRun}
      </Button>
      <Button variant="primary" size="sm" disabled>
        {ui.plan.working}
      </Button>
    </>
  ) : previewing ? (
    <>
      <Button variant="secondary" size="sm" onClick={cancelPreview}>
        {ui.common.cancel}
      </Button>
      <Button variant="primary" size="sm" disabled>
        {ui.common.loading}
      </Button>
    </>
  ) : sessionProblem ? (
    <>
      <Button variant="secondary" size="sm" onClick={closeModal}>
        {ui.plan.close}
      </Button>
      <Button variant="primary" size="sm" onClick={rescanNow} disabled={isScanning}>
        {ui.stale.rescan}
      </Button>
    </>
  ) : (
    <>
      <Button variant="secondary" size="sm" onClick={closeModal}>
        {ui.plan.close}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void execute(true)}
        disabled={!plan || (mode === "permanent" && !ack)}
      >
        {ui.plan.runInBackground}
      </Button>
      <Button
        variant={mode === "permanent" ? "danger-outline" : "primary"}
        size="sm"
        onClick={() => void execute(false)}
        disabled={!plan || (mode === "permanent" && !ack)}
      >
        {mode === "permanent" ? ui.plan.confirmPermanent : ui.plan.confirmTrash}
      </Button>
    </>
  );

  return (
    <Dialog
      isOpen
      onClose={busy ? () => undefined : previewing ? cancelPreview : closeModal}
      title={ui.plan.title}
      footer={footer}
      maxWidth="760px"
    >
      <p className="items-path" style={{ marginTop: 0 }}>
        {ui.plan.subtitle}
      </p>

      {sessionProblem && (
        <p className="items-warning" role="alert" style={{ marginBottom: 12 }}>
          {ui.errors.sessionExpired}
        </p>
      )}

      {progress ? (
        <div className="cleanup-progress" role="status" aria-live="polite">
          <div className="cleanup-progress-head">
            <strong>{cancelling ? ui.plan.cancelling : ui.plan.progress(processed, total)}</strong>
            <span className="items-size">{percent}%</span>
          </div>
          <div
            className="cleanup-progress-track"
            role="progressbar"
            aria-label={ui.plan.progress(processed, total)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div className="cleanup-progress-fill" style={{ width: `${percent}%` }} />
          </div>
          {progress.currentPath && (
            <p className="items-path">
              {ui.plan.currentItem(
                maskPaths ? maskPath(progress.currentPath) : progress.currentPath,
              )}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="plan-modes">
            <label className={`plan-mode ${mode === "recycleBin" ? "active" : ""}`}>
              <input
                type="radio"
                name="cleanup-mode"
                checked={mode === "recycleBin"}
                disabled={previewing || busy}
                onChange={() => switchMode("recycleBin")}
              />
              <span className="plan-mode-radio" aria-hidden="true" />
              <span>{ui.plan.trash}</span>
            </label>
            <label className={`plan-mode ${mode === "permanent" ? "active" : ""}`}>
              <input
                type="radio"
                name="cleanup-mode"
                checked={mode === "permanent"}
                disabled={previewing || busy}
                onChange={() => switchMode("permanent")}
              />
              <span className="plan-mode-radio" aria-hidden="true" />
              <span>{ui.plan.permanent}</span>
            </label>
          </div>

          <p className="plan-note">
            {mode === "permanent" ? ui.plan.permanentNote : ui.plan.trashNote}
          </p>

          {plan && (
            <>
              <div className="plan-summary">
                <div>
                  <span>{ui.plan.eligible}</span>
                  <strong>{plan.eligibleCount}</strong>
                </div>
                <div>
                  <span>{ui.plan.blocked}</span>
                  <strong>{plan.blockedCount}</strong>
                </div>
                <div>
                  <span>{ui.plan.logical}</span>
                  <strong>{formatBytes(plan.totalLogicalBytes, language)}</strong>
                </div>
                <div>
                  <span>{ui.plan.estimated}</span>
                  <strong>{formatBytes(plan.totalEstimatedBytes, language)}</strong>
                </div>
              </div>

              <div className="plan-list" ref={planListRef}>
                <div
                  style={{
                    height: planVirtualizer.getTotalSize(),
                    position: "relative",
                    width: "100%",
                  }}
                >
                  {planVirtualizer.getVirtualItems().map((virtualRow) => {
                    const item = planItems[virtualRow.index];
                    return (
                      <div
                        key={item.targetId}
                        data-index={virtualRow.index}
                        ref={planVirtualizer.measureElement}
                        className={`plan-row ${item.eligible ? "" : "blocked"}`}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        <div className="plan-row-main">
                          <div className="plan-row-title">
                            <strong>{item.displayName}</strong>
                            {item.projectName && item.projectName !== item.displayName && (
                              <span className="chip plan-row-provider">{item.projectName}</span>
                            )}
                          </div>
                          <span className="items-path">
                            {maskPaths ? maskPath(item.displayPath) : item.displayPath}
                          </span>
                          {item.regenerateHint && (
                            <span className="plan-row-hint">
                              {localizeBackendNote(item.regenerateHint, ui)}
                            </span>
                          )}
                        </div>
                        <div className="plan-row-side">
                          {item.eligible ? (
                            <span className="items-size">
                              {formatBytes(item.estimatedReclaimBytes, language)}
                            </span>
                          ) : (
                            <span className="items-warning">
                              {localizeWarningCode(item.blockedCode, ui)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <p className="plan-note">{ui.plan.expires}</p>

              {mode === "permanent" && (
                <div className="plan-ack">
                  <Checkbox
                    checked={ack}
                    onChange={() => setAck((v) => !v)}
                    label={ui.plan.permanentAck}
                  />
                </div>
              )}
            </>
          )}

          {!plan && previewing && <p className="items-empty">{ui.common.loading}</p>}
        </>
      )}
    </Dialog>
  );
};
