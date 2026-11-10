import React from "react";

import { CheckCircle2, AlertTriangle } from "lucide-react";

import { Dialog } from "@/components/primitives/Dialog";

import { Button } from "@/components/primitives/Button";

import { useUiStore } from "@/stores/ui-store";

import { useUIText, localizeAppError } from "@/lib/ui-text";

import { formatBytes } from "@/lib/formatters";

import { usePreferencesStore } from "@/stores/preferences-store";

import { maskPath } from "@/lib/format/path";

import "../items/items.css";

export const CleanupResultDialog: React.FC = () => {
  const ui = useUIText();

  const language = usePreferencesStore((s) => s.language);

  const activeModal = useUiStore((s) => s.activeModal);

  const report = useUiStore((s) => s.report);

  const closeModal = useUiStore((s) => s.closeModal);

  const setReport = useUiStore((s) => s.setReport);

  const maskPaths = usePreferencesStore((s) => s.maskPaths);

  if (activeModal !== "cleanup-result" || !report) return null;

  const close = () => {
    setReport(null);

    closeModal();
  };

  const failures = report.results.filter((r) => !r.success);

  return (
    <Dialog
      isOpen
      onClose={close}
      title={ui.result.title}
      maxWidth="620px"
      footer={
        <Button variant="primary" size="sm" onClick={close}>
          {ui.result.close}
        </Button>
      }
    >
      <div className="plan-summary">
        <div>
          <span>{ui.result.success}</span>
          <strong>{report.successCount}</strong>
        </div>

        <div>
          <span>{ui.result.failed}</span>
          <strong>{report.errorCount}</strong>
        </div>

        <div>
          <span>{ui.result.moved}</span>
          <strong>{formatBytes(report.movedBytes, language)}</strong>
        </div>

        <div>
          <span>{ui.result.reclaimed}</span>
          <strong>{formatBytes(report.reclaimBytes, language)}</strong>
        </div>

        <div>
          <span>{ui.result.processed}</span>
          <strong>{report.processedCount}</strong>
        </div>

        <div>
          <span>{ui.result.skipped}</span>
          <strong>{report.skippedCount}</strong>
        </div>
      </div>

      {report.cancelled && (
        <div className="plan-note cleanup-cancelled-note" role="status">
          <AlertTriangle size={12} />{" "}
          <span>
            <strong>{ui.result.cancelled}</strong>{" "}
            {ui.result.cancelledNote(report.processedCount, report.skippedCount)}
          </span>
        </div>
      )}

      <p className="plan-note">
        {report.mode === "permanent" ? ui.result.permanentNote : ui.result.trashNote}
      </p>

      {report.volumeFreeDelta !== null && report.volumeFreeDelta !== undefined && (
        <p className="plan-note">
          {ui.result.volumeDelta}:{" "}
          {report.volumeFreeDelta >= 0
            ? formatBytes(report.volumeFreeDelta, language)
            : `−${formatBytes(Math.abs(report.volumeFreeDelta), language)}`}
        </p>
      )}

      {report.auditError && (
        <p className="items-warning">
          <AlertTriangle size={11} /> {localizeAppError(report.auditError, ui)}
        </p>
      )}

      {failures.length > 0 && (
        <div className="plan-list">
          {failures.map((failure) => (
            <div key={failure.targetId} className="plan-row blocked">
              <div className="plan-row-main">
                <strong>{maskPaths ? maskPath(failure.displayPath) : failure.displayPath}</strong>

                <span className="items-warning">
                  <AlertTriangle size={11} />{" "}
                  {localizeAppError(failure.errorCode ?? failure.error, ui)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {report.successCount > 0 && (
        <p className="plan-note" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <CheckCircle2 size={13} /> {report.successCount} {ui.result.verified}
        </p>
      )}
    </Dialog>
  );
};
