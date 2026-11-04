import React, { useCallback, useEffect, useState } from "react";
import { Dialog } from "@/components/primitives/Dialog";
import { Button } from "@/components/primitives/Button";
import { Checkbox } from "@/components/primitives/Checkbox";
import { useScanStore } from "@/stores/scan-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useUiStore } from "@/stores/ui-store";
import { useUIText } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { formatBytes } from "@/lib/formatters";
import { usePreferencesStore } from "@/stores/preferences-store";
import { maskPath } from "@/features/items/ItemTable";
import { DeleteMode } from "@/types";
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
  const showToast = useUiStore((s) => s.showToast);

  const scanId = useScanStore((s) => s.scanId);
  const markDeleted = useScanStore((s) => s.markDeleted);
  const deselectMany = useSelectionStore((s) => s.deselectMany);
  const maskPaths = usePreferencesStore((s) => s.maskPaths);

  const [mode, setMode] = useState<DeleteMode>(pendingMode);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

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
        const message = err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : String(err);
        showToast(message, "error", 6000);
        closeModal();
      } finally {
        setBusy(false);
      }
    },
    [scanId, setPlan, closeModal, showToast, ui.errors.blocked]
  );

  useEffect(() => {
    if (activeModal !== "cleanup-plan") return;
    setAck(false);
    setMode(pendingMode);
    setPlan(null);
    if (pendingIds.length > 0) {
      void load(pendingMode, pendingIds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModal, pendingIds, pendingMode]);

  if (activeModal !== "cleanup-plan") return null;

  const switchMode = (nextMode: DeleteMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setAck(false);
    void load(nextMode, pendingIds);
  };

  const handleConfirm = async () => {
    if (!plan || busy) return;
    if (mode === "permanent" && !ack) return;
    setBusy(true);
    try {
      const report = await scannerApi.executeCleanup(plan.id, plan.confirmationToken, ack);
      const successIds = report.results.filter((r) => r.success).map((r) => r.targetId);
      if (successIds.length > 0) markDeleted(successIds);
      // Keep failed targets selected so the user can review and retry them.
      if (successIds.length > 0) deselectMany(successIds);
      setReport(report);
      setPlan(null);
      openModal("cleanup-result");
      if (report.auditError) showToast(report.auditError, "error", 8000);
    } catch (err) {
      const message = err && typeof err === "object" && "message" in err
        ? String((err as { message: string }).message)
        : String(err);
      showToast(message, "error", 7000);
      closeModal();
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <>
      <Button variant="secondary" size="sm" onClick={closeModal} disabled={busy}>
        {ui.plan.close}
      </Button>
      <Button
        variant={mode === "permanent" ? "danger-outline" : "primary"}
        size="sm"
        onClick={handleConfirm}
        disabled={busy || !plan || (mode === "permanent" && !ack)}
      >
        {busy ? ui.plan.working : mode === "permanent" ? ui.plan.confirmPermanent : ui.plan.confirmTrash}
      </Button>
    </>
  );

  return (
    <Dialog isOpen onClose={closeModal} title={ui.plan.title} footer={footer} maxWidth="760px">
      <p className="items-path" style={{ marginTop: 0 }}>{ui.plan.subtitle}</p>

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
            <div><span>{ui.plan.eligible}</span><strong>{plan.eligibleCount}</strong></div>
            <div><span>{ui.plan.blocked}</span><strong>{plan.blockedCount}</strong></div>
            <div><span>{ui.plan.logical}</span><strong>{formatBytes(plan.totalLogicalBytes)}</strong></div>
            <div><span>{ui.plan.estimated}</span><strong>{formatBytes(plan.totalEstimatedBytes)}</strong></div>
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
                    <span className="items-size">{formatBytes(item.estimatedReclaimBytes)}</span>
                  ) : (
                    <span className="items-warning">{item.blockedCode ?? "BLOCKED"}</span>
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
    </Dialog>
  );
};
