import React, { useMemo } from "react";
import { Trash2, AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { IconButton } from "@/components/primitives/IconButton";
import { useScanStore } from "@/stores/scan-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useUiStore } from "@/stores/ui-store";
import { useUIText } from "@/lib/ui-text";
import { formatBytes } from "@/lib/formatters";
import "./results.css";

export const SelectionActionBar: React.FC = () => {
  const ui = useUIText();
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const itemsById = useScanStore((s) => s.itemsById);
  const openModal = useUiStore((s) => s.openModal);
  const setPendingDeletion = useUiStore((s) => s.setPendingDeletion);
  const setPlan = useUiStore((s) => s.setPlan);

  const selectedItems = useMemo(
    () => Array.from(selectedIds).map((id) => itemsById[id]).filter(Boolean),
    [selectedIds, itemsById]
  );

  const totalBytes = useMemo(
    () => selectedItems.reduce((acc, item) => acc + (item.estimatedReclaimBytes ?? 0), 0),
    [selectedItems]
  );

  if (selectedIds.size === 0) return null;

  const openPlan = (mode: "recycleBin" | "permanent") => {
    setPlan(null);
    setPendingDeletion(Array.from(selectedIds), mode);
    openModal("cleanup-plan");
  };

  return (
    <div className="selection-action-bar">
      <div className="selection-info">
        <span>{ui.table.selected(selectedIds.size)}</span>
        <span style={{ color: "var(--text-muted)" }}>•</span>
        <span style={{ color: "#5AC8FA" }}>{formatBytes(totalBytes)}</span>
      </div>

      <div className="selection-divider" />

      <div className="selection-actions">
        <Button variant="primary" size="sm" icon={<Trash2 size={13} />} onClick={() => openPlan("recycleBin")}>
          {ui.plan.confirmTrash}
        </Button>
        <Button
          variant="danger-outline"
          size="sm"
          icon={<AlertTriangle size={13} />}
          onClick={() => openPlan("permanent")}
        >
          {ui.plan.confirmPermanent}
        </Button>
        <IconButton size="sm" aria-label={ui.table.clearSelection} tooltip={ui.table.clearSelection} onClick={clearSelection}>
          <X size={13} />
        </IconButton>
      </div>
    </div>
  );
};
