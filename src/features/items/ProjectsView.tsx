import React, { useMemo } from "react";
import { FolderOpen, FolderTree, Play } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { EmptyState } from "@/components/primitives/EmptyState";
import { PageHeader } from "@/components/primitives/PageHeader";
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
  const scope = useScanStore((s) => s.scope);
  const status = useScanStore((s) => s.status);
  const error = useScanStore((s) => s.error);
  const progress = useScanStore((s) => s.progress);
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

  // Four distinct states used to collapse into one "no results" line: never
  // scanned, scanning, failed, and a completed scan with nothing to clean.
  const emptyTitle = isScanning
    ? ui.common.scanning
    : status === "failed"
      ? ui.errors.title
      : status === "idle"
        ? ui.overview.noScan
        : ui.table.noItems;
  const emptyDescription = isScanning
    ? `${progress?.entriesFound ?? 0} / ${progress?.entriesMeasured ?? 0}`
    : status === "failed"
      ? error?.message ?? ui.overview.startHint
      : ui.overview.startHint;

  const subtitle =
    scope === "allDrives"
      ? ui.common.allDrives
      : rootPath
        ? truncatePath(maskPaths ? maskPath(rootPath) : rootPath, 90)
        : ui.overview.scanFirst;

  return (
    <div className="items-view">
      <PageHeader
        title={ui.nav.projects}
        description={subtitle}
        actions={
          <>
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
              {isScanning
                ? ui.common.scanning
                : status === "idle"
                  ? ui.common.chooseFolder
                  : ui.common.rescan}
            </Button>
          </>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          live={isScanning}
          icon={<FolderTree size={22} />}
          title={emptyTitle}
          description={emptyDescription}
        />
      ) : (
        <ItemTable items={items} />
      )}
    </div>
  );
};
