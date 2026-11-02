import React, { useMemo, useState } from "react";
import { Trash2, AlertTriangle, X, ShieldAlert } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { IconButton } from "@/components/primitives/IconButton";
import { Dialog } from "@/components/primitives/Dialog";
import { useScanStore } from "@/stores/scan-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useUiStore } from "@/stores/ui-store";
import { useUIText } from "@/lib/ui-text";
import { useScanController } from "@/features/scan/useScanController";
import { formatBytes } from "@/lib/formatters";
import { DeleteMode } from "@/types";
import "./results.css";

function formatSavedAt(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

export const SelectionActionBar: React.FC = () => {
  const ui = useUIText();
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const itemsById = useScanStore((s) => s.itemsById);
  const restored = useScanStore((s) => s.restored);
  const staleAcknowledged = useScanStore((s) => s.staleAcknowledged);
  const acknowledgeStale = useScanStore((s) => s.acknowledgeStale);
  const lastSavedAt = useScanStore((s) => s.lastSavedAt);
  const scope = useScanStore((s) => s.scope);
  const openModal = useUiStore((s) => s.openModal);
  const setPendingDeletion = useUiStore((s) => s.setPendingDeletion);
  const setPlan = useUiStore((s) => s.setPlan);
  const { startScan, isScanning } = useScanController();
  const [pendingMode, setPendingMode] = useState<DeleteMode | null>(null);

  const selectedItems = useMemo(
    () => Array.from(selectedIds).map((id) => itemsById[id]).filter(Boolean),
    [selectedIds, itemsById]
  );

  const totalBytes = useMemo(
    () => selectedItems.reduce((acc, item) => acc + (item.estimatedReclaimBytes ?? 0), 0),
    [selectedItems]
  );

  if (selectedIds.size === 0) return null;

  const openPlan = (mode: DeleteMode) => {
    setPlan(null);
    setPendingDeletion(Array.from(selectedIds), mode);
    openModal("cleanup-plan");
  };

  // Acting on a restored snapshot is allowed, but never silently: the user is
  // told the data is old and offered a fresh scan first.
  const requestPlan = (mode: DeleteMode) => {
    if (restored && !staleAcknowledged) {
      setPendingMode(mode);
      return;
    }
    openPlan(mode);
  };

  const continueAnyway = () => {
    const mode = pendingMode;
    acknowledgeStale();
    setPendingMode(null);
    if (mode) openPlan(mode);
  };

  const rescanNow = () => {
    setPendingMode(null);
    void startScan(undefined, scope);
  };

  return (
    <>
      <div className="selection-action-bar">
        <div className="selection-info">
          <span>{ui.table.selected(selectedIds.size)}</span>
          <span style={{ color: "var(--text-muted)" }}>•</span>
          <span style={{ color: "#5AC8FA" }}>{formatBytes(totalBytes)}</span>
        </div>

        <div className="selection-divider" />

        <div className="selection-actions">
          <Button
            variant="primary"
            size="sm"
            icon={<Trash2 size={13} />}
            onClick={() => requestPlan("recycleBin")}
          >
            {ui.plan.confirmTrash}
          </Button>
          <Button
            variant="danger-outline"
            size="sm"
            icon={<AlertTriangle size={13} />}
            onClick={() => requestPlan("permanent")}
          >
            {ui.plan.confirmPermanent}
          </Button>
          <IconButton size="sm" aria-label={ui.table.clearSelection} tooltip={ui.table.clearSelection} onClick={clearSelection}>
            <X size={13} />
          </IconButton>
        </div>
      </div>

      <Dialog
        isOpen={pendingMode !== null}
        onClose={() => setPendingMode(null)}
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <ShieldAlert size={16} /> {ui.stale.warningTitle}
          </span>
        }
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setPendingMode(null)}>
              {ui.common.cancel}
            </Button>
            <Button variant="secondary" size="sm" onClick={continueAnyway}>
              {ui.stale.continueAnyway}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={rescanNow}
              disabled={isScanning}
            >
              {ui.stale.rescan}
            </Button>
          </>
        }
      >
        <p className="plan-note">{ui.stale.warningBody(formatSavedAt(lastSavedAt))}</p>
        <p className="plan-note" style={{ marginTop: 8 }}>
          {ui.stale.savedLocally}
        </p>
      </Dialog>
    </>
  );
};
