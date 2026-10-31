import React, { useMemo } from "react";
import { FolderOpen, Play } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { useScanStore } from "@/stores/scan-store";
import { useScanController } from "@/features/scan/useScanController";
import { useUIText } from "@/lib/ui-text";
import { ItemTable, maskPath } from "./ItemTable";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { truncatePath } from "@/lib/formatters";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore } from "@/stores/ui-store";
import "./items.css";

export const ProjectsView: React.FC = () => {
  const ui = useUIText();
  const { startScan, isScanning } = useScanController();
  const itemsById = useScanStore((s) => s.itemsById);
  const itemIds = useScanStore((s) => s.itemIds);
  const rootPath = useScanStore((s) => s.currentRootPath);
  const status = useScanStore((s) => s.status);
  const maskPaths = usePreferencesStore((s) => s.maskPaths);
  const showToast = useUiStore((s) => s.showToast);

  const items = useMemo(
    () =>
      itemIds
        .map((id) => itemsById[id])
        .filter((item) => item && item.provider === "project" && item.status !== "deleted"),
    [itemIds, itemsById]
  );

  const openRoot = async () => {
    if (!rootPath) return;
    try {
      await scannerApi.openPathInExplorer(rootPath);
    } catch {
      showToast(ui.errors.title, "error");
    }
  };

  return (
    <div className="items-view">
      <header className="view-header">
        <div>
          <h1 className="view-title">{ui.nav.projects}</h1>
          <p className="view-subtitle" title={rootPath ? (maskPaths ? maskPath(rootPath) : rootPath) : undefined}>
            {rootPath
              ? truncatePath(maskPaths ? maskPath(rootPath) : rootPath, 90)
              : ui.overview.scanFirst}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {rootPath && (
            <Button
              variant="secondary"
              size="sm"
              icon={<FolderOpen size={13} />}
              onClick={openRoot}
            >
              {ui.common.open}
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            icon={<Play size={12} fill="currentColor" />}
            onClick={() => startScan()}
            disabled={isScanning}
          >
            {status === "idle" ? ui.common.chooseFolder : ui.common.rescan}
          </Button>
        </div>
      </header>

      <ItemTable items={items} />
    </div>
  );
};
