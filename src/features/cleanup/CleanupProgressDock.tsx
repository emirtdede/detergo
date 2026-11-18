import React from "react";

import { Button } from "@/components/primitives/Button";
import { useUIText, localizeAppError } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { useCleanupRunStore } from "@/stores/cleanup-run-store";
import { useUiStore } from "@/stores/ui-store";
import { usePreferencesStore } from "@/stores/preferences-store";
import { maskPath } from "@/lib/format/path";

import "../items/items.css";

/**
 * Global progress for a cleanup that the user sent to the background. The
 * foreground run renders its own progress inside the plan dialog, so this dock
 * stays hidden unless `background` is set.
 */
export const CleanupProgressDock: React.FC = () => {
  const ui = useUIText();
  const progress = useCleanupRunStore((s) => s.progress);
  const lastReport = useCleanupRunStore((s) => s.lastReport);
  const markCancelling = useCleanupRunStore((s) => s.markCancelling);
  const dismissRun = useCleanupRunStore((s) => s.dismiss);
  const setReport = useUiStore((s) => s.setReport);
  const openModal = useUiStore((s) => s.openModal);
  const showToast = useUiStore((s) => s.showToast);
  const maskPaths = usePreferencesStore((s) => s.maskPaths);

  const active = progress?.background ? progress : null;
  // While a cleanup is running (foreground or background) the live progress is
  // the only truth. A report left from the previous run used to render in this
  // dock and hide the fact that work was still in flight.
  if (progress && !active) return null;
  if (!active && !lastReport) return null;

  const viewResults = () => {
    // Never swap the plan/preview dialog for the result modal mid-run; the
    // result it would show belongs to an older plan.
    if (useCleanupRunStore.getState().progress) return;
    if (lastReport) setReport(lastReport);
    dismissRun();
    openModal("cleanup-result");
  };

  const dismiss = () => {
    setReport(null);
    dismissRun();
  };

  const cancel = async () => {
    markCancelling();
    try {
      await scannerApi.cancelCleanup();
    } catch (err) {
      showToast(localizeAppError(err, ui), "error", 7000);
    }
  };

  const total = active?.total ?? 0;
  const processed = active?.processed ?? 0;
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const cancelling = active?.status === "cancelling";

  return (
    <div className="cleanup-dock" role="status" aria-live="polite">
      {active ? (
        <>
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
          {active.currentPath && (
            <p className="items-path">
              {ui.plan.currentItem(maskPaths ? maskPath(active.currentPath) : active.currentPath)}
            </p>
          )}
          <div className="cleanup-dock-actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void cancel()}
              disabled={cancelling}
            >
              {cancelling ? ui.plan.cancelling : ui.plan.cancelRun}
            </Button>
          </div>
        </>
      ) : (
        <>
          <strong>{lastReport!.cancelled ? ui.result.cancelled : ui.result.title}</strong>
          <p className="items-path">
            {lastReport!.cancelled
              ? ui.result.cancelledNote(lastReport!.processedCount, lastReport!.skippedCount)
              : `${ui.result.success}: ${lastReport!.successCount} · ${ui.result.failed}: ${lastReport!.errorCount}`}
          </p>
          <div className="cleanup-dock-actions">
            <Button variant="secondary" size="sm" onClick={dismiss}>
              {ui.result.dismiss}
            </Button>
            <Button variant="primary" size="sm" onClick={viewResults}>
              {ui.result.viewResults}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};
