import React, { useMemo } from "react";
import { FolderTree, ShieldCheck, Boxes, Play } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { EmptyState } from "@/components/primitives/EmptyState";
import { PageHeader } from "@/components/primitives/PageHeader";
import { useScanStore } from "@/stores/scan-store";
import { useScanController } from "@/features/scan/useScanController";
import { useUIText } from "@/lib/ui-text";
import { ItemTable, maskPath } from "./ItemTable";
import { formatBytes, truncatePath } from "@/lib/formatters";
import { usePreferencesStore } from "@/stores/preferences-store";
import "./items.css";

export const ProjectsView: React.FC = () => {
  const ui = useUIText();
  const { isScanning, startScan } = useScanController();
  const itemsById = useScanStore((s) => s.itemsById);
  const itemIds = useScanStore((s) => s.itemIds);
  const rootPath = useScanStore((s) => s.currentRootPath);
  const scope = useScanStore((s) => s.scope);
  const status = useScanStore((s) => s.status);
  const error = useScanStore((s) => s.error);
  const progress = useScanStore((s) => s.progress);
  const maskPaths = usePreferencesStore((s) => s.maskPaths);

  const items = useMemo(
    () =>
      itemIds
        .map((id) => itemsById[id])
        .filter((item) => item && item.provider === "project" && item.status !== "deleted"),
    [itemIds, itemsById]
  );

  const projectTotals = useMemo(() => {
    let cleanable = 0;
    let safe = 0;
    const projects = new Set<string>();
    for (const item of items) {
      if (item.protected || item.safetyClass === "keep" || !item.selectable) continue;
      const b = item.estimatedReclaimBytes ?? 0;
      cleanable += b;
      if (item.safetyClass === "safe") safe += b;
      if (item.projectId) projects.add(item.projectId);
    }
    return { cleanable, safe, projectCount: projects.size };
  }, [items]);

  const emptyTitle = isScanning
    ? ui.common.scanning
    : status === "failed"
      ? ui.errors.title
      : status === "idle"
        ? ui.projects.emptyTitleIdle
        : ui.projects.emptyTitleClean;
  const emptyDescription = isScanning
    ? `${progress?.entriesFound ?? 0} / ${progress?.entriesMeasured ?? 0}`
    : status === "failed"
      ? error?.message ?? ui.errors.title
      : status === "idle"
        ? ui.projects.emptyDescIdle
        : ui.projects.emptyDescClean;

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
          <Button
            variant="primary"
            size="sm"
            icon={<Play size={12} fill="currentColor" />}
            onClick={() => startScan(undefined, "project")}
            disabled={isScanning}
          >
            {isScanning
              ? ui.common.scanning
              : status === "idle"
                ? ui.common.chooseFolder
                : ui.common.rescan}
          </Button>
        }
      />

      {/* Shared Bento KPI Strip for Projects */}
      <div className="nc-bento-strip nc-bento-strip--3">
        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{ui.projects.kpiArtifacts}</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--accent">
              <FolderTree size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {items.length > 0 ? formatBytes(projectTotals.cleanable) : "—"}
            </span>
            <span className="nc-kpi-card-sub">{ui.common.showing(items.length)}</span>
          </div>
        </div>

        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{ui.projects.kpiSafeReclaim}</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--success">
              <ShieldCheck size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {items.length > 0 ? formatBytes(projectTotals.safe) : "—"}
            </span>
            <span className="nc-kpi-card-sub">{ui.projects.kpiSafeReclaimSub}</span>
          </div>
        </div>

        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{ui.projects.kpiDetected}</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--purple">
              <Boxes size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">{projectTotals.projectCount} {ui.overview.projects}</span>
            <span className="nc-kpi-card-sub">{ui.projects.kpiDetectedSub}</span>
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          live={isScanning}
          icon={<FolderTree size={22} />}
          title={emptyTitle}
          description={emptyDescription}
          actions={
            !isScanning ? (
              <Button
                variant="primary"
                size="sm"
                icon={<Play size={12} fill="currentColor" />}
                onClick={() => startScan(undefined, "project")}
              >
                {status === "idle" ? ui.common.chooseFolder : ui.common.rescan}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ItemTable items={items} />
      )}
    </div>
  );
};
