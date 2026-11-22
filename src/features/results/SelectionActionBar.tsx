import React, { useMemo, useState } from "react";
import { Trash2, AlertTriangle, X, ShieldAlert } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { IconButton } from "@/components/primitives/IconButton";
import { Dialog } from "@/components/primitives/Dialog";
import { useScanStore } from "@/stores/scan-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useUiStore } from "@/stores/ui-store";
import { useAppStore } from "@/stores/app-store";
import { useUIText } from "@/lib/ui-text";
import { useScanController } from "@/features/scan/useScanController";
import { usePreferencesStore } from "@/stores/preferences-store";
import { effectiveSelectedIds } from "@/features/items/selection-helpers";
import { formatBytes } from "@/lib/formatters";
import { formatSavedAt } from "@/lib/format/date";
import { ownBytesById } from "@/lib/item-totals";
import { CleanupItem, DeleteMode } from "@/types";
import "./results.css";

const EMPTY_ITEMS_BY_ID: Record<string, CleanupItem> = {};

export const SelectionActionBar: React.FC = () => {
  const ui = useUIText();
  const language = usePreferencesStore((s) => s.language);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const hasSelection = selectedIds.size > 0;
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const itemsById = useScanStore((s) => (hasSelection ? s.itemsById : EMPTY_ITEMS_BY_ID));
  const restored = useScanStore((s) => s.restored);
  const staleAcknowledged = useScanStore((s) => s.staleAcknowledged);
  const acknowledgeStale = useScanStore((s) => s.acknowledgeStale);
  const lastSavedAt = useScanStore((s) => s.lastSavedAt);
  const scope = useScanStore((s) => s.scope);
  const view = useAppStore((s) => s.view);
  const openModal = useUiStore((s) => s.openModal);
  const setPendingDeletion = useUiStore((s) => s.setPendingDeletion);
  const setPlan = useUiStore((s) => s.setPlan);
  const { startScan, isScanning } = useScanController();
  const [pendingMode, setPendingMode] = useState<DeleteMode | null>(null);

  // Only ids that still describe a cleanable row may influence the count, the
  // total or the plan. Selections can outlive a cleanup (markDeleted) or a
  // restored snapshot; forwarding them made the bar promise bytes for rows that
  // no longer exist.
  const effectiveIds = useMemo(
    () => effectiveSelectedIds(selectedIds, itemsById),
    [selectedIds, itemsById],
  );

  const selectedItems = useMemo(
    () => effectiveIds.map((id) => itemsById[id]),
    [effectiveIds, itemsById],
  );

  const totalBytes = useMemo(() => {
    const own = ownBytesById(selectedItems);
    return selectedItems.reduce(
      (acc, item) =>
        acc + (own.get(item.id)?.estimatedReclaimBytes ?? item.estimatedReclaimBytes ?? 0),
      0,
    );
  }, [selectedItems]);

  if (selectedIds.size === 0 || effectiveIds.length === 0) return null;

  const openPlan = (mode: DeleteMode) => {
    setPlan(null);
    setPendingDeletion(effectiveIds, mode);
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
    // Match the stale banner: the view the user is looking at decides whether
    // the rescan targets agents or the stored project scope.
    void startScan(undefined, view === "agents" ? "agents" : scope);
  };

  return (
    <>
      <div className="selection-action-bar">
        <div className="selection-info">
          <span>{ui.table.selected(effectiveIds.length)}</span>
          <span style={{ color: "var(--text-muted)" }}>•</span>
          <span className="selection-total">{formatBytes(totalBytes, language)}</span>
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
          <IconButton
            size="sm"
            aria-label={ui.table.clearSelection}
            tooltip={ui.table.clearSelection}
            onClick={clearSelection}
          >
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
            <Button variant="primary" size="sm" onClick={rescanNow} disabled={isScanning}>
              {ui.stale.rescan}
            </Button>
          </>
        }
      >
        <p className="plan-note">{ui.stale.warningBody(formatSavedAt(lastSavedAt, language))}</p>
        <p className="plan-note" style={{ marginTop: 8 }}>
          {ui.stale.savedLocally}
        </p>
      </Dialog>
    </>
  );
};
