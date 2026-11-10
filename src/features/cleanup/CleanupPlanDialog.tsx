import React, { useCallback, useEffect, useState } from "react";

import { Dialog } from "@/components/primitives/Dialog";
import { Button } from "@/components/primitives/Button";
import { Checkbox } from "@/components/primitives/Checkbox";
import { useScanStore } from "@/stores/scan-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useUiStore } from "@/stores/ui-store";
import { useCleanupRunStore } from "@/stores/cleanup-run-store";
import { useUIText, localizeAppError, localizeWarningCode } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { formatBytes } from "@/lib/formatters";
import { usePreferencesStore } from "@/stores/preferences-store";
import { maskPath } from "@/lib/format/path";
import { DeleteMode } from "@/types";
import { notificationService } from "@/lib/notifications/notification-service";

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
  const markDeleted = useScanStore((s) => s.markDeleted);
  const deselectMany = useSelectionStore((s) => s.deselectMany);
  const maskPaths = usePreferencesStore((s) => s.maskPaths);
  const language = usePreferencesStore((s) => s.language);

  const run = useCleanupRunStore();

  const [mode, setMode] = useState<DeleteMode>(pendingMode);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  const progress = busy ? run.progress : null;

  const load = useCallback(
    async (nextMode: DeleteMode, ids: string[]) => {
      if (!scanId) {
        showToast(ui.errors.blocked, "error");
        closeModal();
        return;
      }
      setBusy(true);
      setPlan(null);
      try {
        const next = await scannerApi.previewCleanup(scanId, ids, nextMode);
        setPlan(next);
      } catch (err) {
        showToast(localizeAppError(err, ui), "error", 7000);
        closeModal();
      } finally {
        setBusy(false);
      }
    },
    [scanId, setPlan, closeModal, showToast, ui],
  );

  useEffect(() => {
    if (activeModal !== "cleanup-plan") return;
    setAck(false);
    setMode(pendingMode);
    setPlan(null);
    if (pendingIds.length > 0) {
      void load(pendingMode, pendingIds);
    }
  }, [activeModal, pendingIds, pendingMode, load]);

  if (activeModal !== "cleanup-plan") return null;

  const switchMode = (nextMode: DeleteMode) => {
    if (nextMode === mode || busy) return;
    setMode(nextMode);
    setAck(false);
    void load(nextMode, pendingIds);
  };

  const execute = async (runInBackground: boolean) => {
    if (!plan || busy) return;
    if (mode === "permanent" && !ack) return;

    const activePlan = plan;
    setBusy(true);
    run.start(activePlan.id, activePlan.eligibleCount, runInBackground);

    try {
      const report = await scannerApi.executeCleanup(
        activePlan.id,
        activePlan.confirmationToken,
        ack,
        (event) => run.applyEvent(event),
      );

      const successIds = report.results.filter((r) => r.success).map((r) => r.targetId);
      if (successIds.length > 0) {
        markDeleted(successIds);
        // Keep failed targets selected so the user can review and retry them.
        deselectMany(successIds);
      }

      setReport(report);
      setPlan(null);

      notificationService.notifyCleanComplete({
        count: report.successCount,
        bytes: report.reclaimBytes,
        destination:
          mode === "permanent" ? ui.notifications.destPermanent : ui.notifications.destTrash,
      });

      if (runInBackground) {
        // Keep the completed report in the run store so the dock can offer
        // "View results" after the dialog is gone.
        run.finish(report);
        hideModal();
      } else {
        run.finish(report);
        run.dismiss();
        openModal("cleanup-result");
      }

      if (report.auditError) showToast(localizeAppError(report.auditError, ui), "error", 8000);
    } catch (err) {
      run.dismiss();
      showToast(localizeAppError(err, ui), "error", 7000);
      closeModal();
    } finally {
      setBusy(false);
    }
  };

  const cancelRun = async () => {
    run.markCancelling();
    try {
      await scannerApi.cancelCleanup();
    } catch (err) {
      showToast(localizeAppError(err, ui), "error", 7000);
    }
  };

  const cancelling = run.progress?.status === "cancelling";
  const processed = progress?.processed ?? 0;
  const total = progress?.total ?? 0;
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  const footer = busy ? (
    <>
      <Button variant="secondary" size="sm" onClick={() => void cancelRun()} disabled={cancelling}>
        {cancelling ? ui.plan.cancelling : ui.plan.cancelRun}
      </Button>
      <Button variant="primary" size="sm" disabled>
        {ui.plan.working}
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
      onClose={busy ? () => undefined : closeModal}
      title={ui.plan.title}
      footer={footer}
      maxWidth="760px"
    >
      <p className="items-path" style={{ marginTop: 0 }}>
        {ui.plan.subtitle}
      </p>

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
                onChange={() => switchMode("recycleBin")}
              />
              <span>{ui.plan.trash}</span>
            </label>
            <label className={`plan-mode ${mode === "permanent" ? "active" : ""}`}>
              <input
                type="radio"
                name="cleanup-mode"
                checked={mode === "permanent"}
                onChange={() => switchMode("permanent")}
              />
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

              <div className="plan-list">
                {plan.items.map((item) => (
                  <div key={item.targetId} className={`plan-row ${item.eligible ? "" : "blocked"}`}>
                    <div className="plan-row-main">
                      <strong>{item.displayName}</strong>
                      <span className="items-path">
                        {maskPaths ? maskPath(item.displayPath) : item.displayPath}
                      </span>
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
                ))}
              </div>

              <p className="plan-note">{ui.plan.expires}</p>

              {mode === "permanent" && (
                <div className="plan-ack">
                  <Checkbox
                    checked={ack}
                    onChange={() => setAck((v) => !v)}
                    aria-label={ui.plan.permanentAck}
                  />
                  <span>{ui.plan.permanentAck}</span>
                </div>
              )}
            </>
          )}

          {!plan && <p className="items-empty">{ui.common.loading}</p>}
        </>
      )}
    </Dialog>
  );
};
