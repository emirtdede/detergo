import React, { useMemo } from "react";
import { FolderOpen, FolderTree, ShieldCheck, Boxes, Play } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { EmptyState } from "@/components/primitives/EmptyState";
import { PageHeader } from "@/components/primitives/PageHeader";
import { useScanStore } from "@/stores/scan-store";
import { useScanController } from "@/features/scan/useScanController";
import { useUIText, localizeAppError } from "@/lib/ui-text";
import { ItemTable } from "./ItemTable";
import { maskPath, truncatePath } from "@/lib/format/path";
import { formatBytes } from "@/lib/formatters";
import { ownBytesById } from "@/lib/item-totals";
import { usePreferencesStore } from "@/stores/preferences-store";
import "./items.css";

export const ProjectsView: React.FC = () => {
  const ui = useUIText();
  const { isScanning, startScan, chooseFolderAndScan } = useScanController();
  const language = usePreferencesStore((s) => s.language);
  const itemsById = useScanStore((s) => s.itemsById);
  const itemIds = useScanStore((s) => s.itemIds);
  const rootPath = useScanStore((s) => s.currentRootPath);
  const scope = useScanStore((s) => s.scope);
  const status = useScanStore((s) => s.status);
  const error = useScanStore((s) => s.error);
  const progress = useScanStore((s) => s.progress);
  const summary = useScanStore((s) => s.summary);
  const maskPaths = usePreferencesStore((s) => s.maskPaths);

  const projectItems = useMemo(
    () => itemIds.map((id) => itemsById[id]).filter((item) => item && item.provider === "project"),
    [itemIds, itemsById],
  );

  const items = useMemo(
    () => projectItems.filter((item) => item.status !== "deleted"),
    [projectItems],
  );

  const projectTotals = useMemo(() => {
    // Nested project targets (for example `.next` and `.next/cache`) are
    // measured recursively; summing the raw rows promised the same bytes twice.
    const own = ownBytesById(projectItems);
    let cleanable = 0;
    let safe = 0;
    let cleanableTargets = 0;
    const projectRoots = new Set<string>();
    for (const item of items) {
      // Fallback rows (a stray `node_modules` outside any manifest) carry a
      // synthetic project id. Counting those was what turned 12 projects into
      // "1059 projects"; they are cleanable but not projects.
      if (item.projectDetected !== false && item.projectRoot) {
        projectRoots.add(item.projectRoot.toLowerCase());
      }
      if (item.protected || item.safetyClass === "keep" || !item.selectable) continue;
      const b = own.get(item.id)?.estimatedReclaimBytes ?? 0;
      cleanable += b;
      cleanableTargets += 1;
      if (item.safetyClass === "safe") safe += b;
    }
    return { cleanable, safe, cleanableTargets, projectRoots: projectRoots.size };
  }, [items, projectItems]);

  // A snapshot written before `detectedProjectCount` existed cannot distinguish
  // real roots from fallback rows, so it must not show a number at all.
  const detectedProjects = useMemo(() => {
    const fromSummary = summary?.detectedProjectCount;
    if (typeof fromSummary === "number") return fromSummary;
    const hasFlags = projectItems.some((item) => typeof item.projectDetected === "boolean");
    return hasFlags ? projectTotals.projectRoots : null;
  }, [summary?.detectedProjectCount, projectItems, projectTotals.projectRoots]);

  const numberFormat = useMemo(() => new Intl.NumberFormat(language ?? undefined), [language]);

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
      ? error
        ? localizeAppError(error, ui)
        : ui.errors.title
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
          <>
            <Button
              variant={rootPath || status !== "idle" ? "secondary" : "primary"}
              size="sm"
              icon={<FolderOpen size={13} />}
              onClick={() => void chooseFolderAndScan()}
              disabled={isScanning}
            >
              {ui.common.chooseFolder}
            </Button>
            {(rootPath || status !== "idle") && (
              <Button
                variant="primary"
                size="sm"
                icon={<Play size={12} fill="currentColor" />}
                onClick={() => void startScan(undefined, "project")}
                disabled={isScanning}
              >
                {isScanning
                  ? ui.common.scanning
                  : status === "idle"
                    ? ui.common.scan
                    : ui.common.rescan}
              </Button>
            )}
          </>
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
              {items.length > 0 ? formatBytes(projectTotals.cleanable, language) : "—"}
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
              {items.length > 0 ? formatBytes(projectTotals.safe, language) : "—"}
            </span>
            <span className="nc-kpi-card-sub">{ui.projects.kpiSafeReclaimSub}</span>
          </div>
        </div>

        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{ui.projects.kpiTargets}</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--purple">
              <Boxes size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {items.length > 0
                ? numberFormat.format(projectTotals.cleanableTargets)
                : numberFormat.format(0)}
            </span>
            <span className="nc-kpi-card-sub">
              {detectedProjects !== null
                ? ui.projects.kpiTargetsSub(numberFormat.format(detectedProjects))
                : ui.projects.kpiTargetsUnknown}
            </span>
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
              <>
                <Button
                  variant={status === "idle" && !rootPath ? "primary" : "secondary"}
                  size="sm"
                  icon={<FolderOpen size={13} />}
                  onClick={() => void chooseFolderAndScan()}
                >
                  {ui.common.chooseFolder}
                </Button>
                {(rootPath || status !== "idle") && (
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Play size={12} fill="currentColor" />}
                    onClick={() => void startScan(undefined, "project")}
                  >
                    {status === "idle" ? ui.common.scan : ui.common.rescan}
                  </Button>
                )}
              </>
            ) : undefined
          }
        />
      ) : (
        <ItemTable items={items} />
      )}
    </div>
  );
};
