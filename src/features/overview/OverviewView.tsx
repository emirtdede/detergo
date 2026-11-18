import React, { useMemo, useState, useEffect } from "react";
import {
  ShieldCheck,
  FolderTree,
  HardDrive,
  TrendingDown,
  TrendingUp,
  ArrowUpRight,
  Code2,
  Bot,
  Zap,
  Sparkles,
  History,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { Dialog } from "@/components/primitives/Dialog";
import { useScanStore, viewForScanScope } from "@/stores/scan-store";
import { useUIText, localizeAppError } from "@/lib/ui-text";
import { useScanController } from "@/features/scan/useScanController";
import { formatBytes, formatSignedBytes } from "@/lib/formatters";
import { itemBucket } from "@/lib/classify";
import { ownBytesById } from "@/lib/item-totals";
import { lifetimeCleanedBytes, normalizeDistributionWidths } from "@/lib/cleanup-totals";
import { maskPath, truncatePath } from "@/lib/format/path";
import { useThrottledValue, SCAN_AGGREGATE_THROTTLE_MS } from "@/lib/hooks/use-throttled-value";
import { SafetyBadge } from "@/features/items/SafetyBadge";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore } from "@/stores/ui-store";
import { useSelectionStore } from "@/stores/selection-store";
import { useAppStore } from "@/stores/app-store";
import { useCacheStore } from "@/stores/cache-store";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { log } from "@/lib/logging";
import "../items/items.css";
import "./overview.css";

export const OverviewView: React.FC = () => {
  const ui = useUIText();
  const { isScanning } = useScanController();
  const itemsById = useScanStore((s) => s.itemsById);
  const itemIds = useScanStore((s) => s.itemIds);
  const progress = useScanStore((s) => s.progress);
  const summary = useScanStore((s) => s.summary);
  const previousSummary = useScanStore((s) => s.previousSummary);
  const previousCleanableBytes = useScanStore((s) => s.previousCleanableBytes);
  const maskPaths = usePreferencesStore((s) => s.maskPaths);
  const language = usePreferencesStore((s) => s.language);
  const setView = useAppStore((s) => s.setView);
  const cacheProviders = useCacheStore((s) => s.providers);
  const loadCacheProviders = useCacheStore((s) => s.loadProviders);
  const showToast = useUiStore((s) => s.showToast);
  const restored = useScanStore((s) => s.restored);
  const lastSavedAt = useScanStore((s) => s.lastSavedAt);
  const persistedRevision = useScanStore((s) => s.persistedRevision);

  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [hasLastSnapshot, setHasLastSnapshot] = useState(false);

  // The header button must not offer a restore that cannot succeed.
  useEffect(() => {
    let cancelled = false;
    scannerApi
      .getLastScan()
      .then((snapshot) => {
        if (!cancelled) setHasLastSnapshot(Boolean(snapshot && snapshot.summary));
      })
      .catch(() => {
        if (!cancelled) setHasLastSnapshot(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lastSavedAt, persistedRevision]);

  const confirmReset = () => {
    setResetDialogOpen(false);
    useScanStore.getState().resetScan({ clearPersisted: true });
    useSelectionStore.getState().clearSelection();
    showToast(ui.overview.resetToast, "info");
  };

  const confirmRestore = async () => {
    setRestoreDialogOpen(false);
    try {
      const snapshot = await scannerApi.getLastScan();
      if (snapshot && useScanStore.getState().restoreScan(snapshot)) {
        showToast(ui.overview.restoreSuccessToast, "success");
        setView(viewForScanScope(snapshot.summary.scope));
      } else {
        setHasLastSnapshot(false);
        showToast(ui.overview.noLastScanToast, "error");
      }
    } catch (err) {
      showToast(`${ui.history.loadError}: ${localizeAppError(err, ui)}`, "error");
    }
  };

  const [lifetimeReclaimed, setLifetimeReclaimed] = useState<number>(0);
  const [lifetimeRuns, setLifetimeRuns] = useState<number>(0);
  const [historyError, setHistoryError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    // Lifetime numbers must cover the whole history, not the newest page:
    // summing the capped list silently understated long-term totals.
    scannerApi
      .getCleanupTotals()
      .then((totals) => {
        if (cancelled) return;
        // `reclaimedBytes` only counts permanent deletes; Recycle Bin cleanups
        // report zero there. The lifetime figure is therefore the moved total
        // (which already includes permanent deletions), not a reclaimed total:
        // recycled bytes are not free until the bin is emptied. Old records
        // that predate `movedBytes` fall back to `reclaimedBytes`.
        setLifetimeReclaimed(lifetimeCleanedBytes(totals.movedBytes, totals.reclaimedBytes));
        // This card counts cleanup runs. Official tool actions have their own
        // history and controller; adding them here inflated "cleanups" with
        // operations that never moved a file.
        setLifetimeRuns(totals.runs);
        setHistoryError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        // The lifetime counters are a bonus; surface the failure inline instead
        // of silently showing zero reclaimed bytes. Only the raw error is kept:
        // the localized text is produced at render time so changing the
        // language does not leave a stale message.
        log.warn("Could not load lifetime cleanup history", err);
        setHistoryError(err);
      });
    return () => {
      cancelled = true;
    };
    // `lastSavedAt` is bumped by `flushLastScanPersist()` after a cleanup, so
    // this overview (mounted while the global action bar runs a plan) refreshes
    // the lifetime card instead of keeping pre-cleanup totals.
  }, [lastSavedAt]);

  useEffect(() => {
    void loadCacheProviders();
  }, [loadCacheProviders]);

  const allItems = useMemo(
    () =>
      itemIds
        .map((id) => itemsById[id])
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    [itemIds, itemsById],
  );

  const items = useMemo(
    () =>
      // Deleted rows stay in the session so undo/history can reference them,
      // but they must not keep inflating KPIs, charts or top items.
      allItems.filter((item) => item.status !== "deleted"),
    [allItems],
  );

  // Measurement batches change the row map up to 20 times per second. The heavy
  // aggregates below are throttled to a cadence a person can actually read;
  // counts and progress keep using the live store values.
  const aggregateAll = useThrottledValue(allItems, SCAN_AGGREGATE_THROTTLE_MS);

  const aggregateItems = useMemo(
    () => aggregateAll.filter((item) => item.status !== "deleted"),
    [aggregateAll],
  );

  // Nested targets are measured recursively. Passing every row (including
  // deleted ones) lets a surviving parent shed the bytes of a child that is
  // already gone while the totals below only count live rows.
  const own = useMemo(() => ownBytesById(aggregateAll), [aggregateAll]);

  const totals = useMemo(() => {
    let cleanable = 0;
    let safeReclaim = 0;
    let regenerateReclaim = 0;
    let reviewReclaim = 0;
    let protectedBytes = 0;
    const projects = new Set<string>();

    for (const item of aggregateItems) {
      const bytes = own.get(item.id)?.estimatedReclaimBytes ?? 0;
      const blocked = item.protected || item.safetyClass === "keep" || !item.selectable;
      if (blocked) {
        protectedBytes += bytes;
      } else {
        cleanable += bytes;
        if (item.safetyClass === "safe") safeReclaim += bytes;
        else if (item.safetyClass === "regenerate") regenerateReclaim += bytes;
        else reviewReclaim += bytes;
      }
      if (item.projectId && item.projectDetected !== false) projects.add(item.projectId);
    }
    return {
      cleanable,
      safeReclaim,
      regenerateReclaim,
      reviewReclaim,
      protectedBytes,
      projects: projects.size,
    };
  }, [aggregateItems, own]);

  // Only manifest-confirmed roots are projects. The backend counts them, and
  // its number is authoritative because the store may already have pruned rows.
  //
  // The flag scan runs on the throttled snapshot: it is a full pass over every
  // row, and doing it on the live map meant one more O(n) walk per measurement
  // batch for a value that only changes when the result set changes.
  const hasProjectFlags = useMemo(
    () => aggregateAll.some((item) => typeof item.projectDetected === "boolean"),
    [aggregateAll],
  );

  const detectedProjects = useMemo(() => {
    const fromSummary = summary?.detectedProjectCount;
    if (typeof fromSummary === "number") return fromSummary;
    // A restored snapshot from an older build has no flag and no count: showing
    // a number here is exactly how "1059 projects" happened.
    return hasProjectFlags ? totals.projects : null;
  }, [summary?.detectedProjectCount, hasProjectFlags, totals.projects]);

  const numberFormat = useMemo(() => new Intl.NumberFormat(language ?? undefined), [language]);

  // Per-step outcome of a combined scan: projects, agents, and anything the
  // backend had to skip. Without this a silent NO_ROOT step looked like
  // "the project scan found nothing".
  const coverageSections = summary?.sections ?? [];
  const sectionScopeLabel = (scope: string) => {
    switch (scope) {
      case "combined":
        return ui.common.scanAll;
      case "agents":
        return ui.nav.agents;
      case "allDrives":
        return ui.common.allDrives;
      case "globalCaches":
        return ui.nav.caches;
      default:
        return ui.nav.projects;
    }
  };
  const sectionStatusLabel = (status: string) => {
    if (status === "skipped") return ui.overview.sectionSkipped;
    if (status === "failed") return ui.overview.sectionFailed;
    if (status === "partial") return ui.overview.sectionPartial;
    return "";
  };

  const distributionSegments = useMemo(() => {
    if (totals.cleanable <= 0) return [];
    const ecoMap: Record<string, { label: string; bytes: number; color: string }> = {
      node: { label: ui.overview.ecoNode, bytes: 0, color: "var(--accent)" },
      rust: { label: ui.overview.ecoRust, bytes: 0, color: "var(--eco-rust)" },
      python: { label: ui.overview.ecoPython, bytes: 0, color: "var(--success)" },
      agent: { label: ui.overview.ecoAgent, bytes: 0, color: "var(--eco-agent)" },
      cache: { label: ui.overview.ecoCache, bytes: 0, color: "var(--eco-cache)" },
      other: { label: ui.overview.ecoOther, bytes: 0, color: "var(--text-muted)" },
    };

    for (const item of aggregateItems) {
      if (item.protected || item.safetyClass === "keep" || !item.selectable) continue;
      const bytes = own.get(item.id)?.estimatedReclaimBytes ?? 0;
      // Use the backend-provided `ecosystem`/`category` instead of guessing
      // from folder names: a Python directory named `target` is not Rust.
      ecoMap[itemBucket(item)].bytes += bytes;
    }

    return Object.entries(ecoMap)
      .filter(([_, v]) => v.bytes > 0)
      .map(([k, v]) => ({
        id: k,
        label: v.label,
        bytes: v.bytes,
        color: v.color,
        percent: (v.bytes / totals.cleanable) * 100,
      }));
  }, [aggregateItems, own, totals.cleanable]);

  // Widths are normalized once so the bar never overflows: a 2% floor per
  // segment can push the raw percentages above 100.
  const distributionWidths = useMemo(
    () => normalizeDistributionWidths(distributionSegments.map((seg) => seg.percent)),
    [distributionSegments],
  );

  const topItems = useMemo(
    () =>
      aggregateItems
        .filter((item) => item.selectable && !item.protected)
        .map((item) => ({ item, bytes: own.get(item.id)?.estimatedReclaimBytes ?? 0 }))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 5),
    [aggregateItems, own],
  );

  const cleanableDelta = totals.cleanable - previousCleanableBytes;
  const hasComparison = previousCleanableBytes > 0 || previousSummary !== null;

  // Counts for 3 category cards
  const projectItemsCount = useMemo(
    () =>
      items.filter((i) => {
        const bucket = itemBucket(i);
        // Project hubs are the ecosystem targets; AI storage and generic
        // caches have their own cards and must not be double counted here.
        return bucket !== "agent" && bucket !== "cache";
      }).length,
    [items],
  );

  const agentItemsCount = useMemo(
    () => items.filter((i) => itemBucket(i) === "agent").length,
    [items],
  );

  const totalCachesBytes = useMemo(
    () => cacheProviders.reduce((acc, p) => acc + (p.totalBytes || 0), 0),
    [cacheProviders],
  );

  return (
    <div className="overview-page">
      {/* 1. TOP HEADER & TELEMETRY */}
      <header className="overview-header">
        <div className="overview-header-copy">
          <h1 className="overview-title">{ui.overview.pageTitle}</h1>
          <p className="overview-subtitle">{ui.overview.pageSubtitle}</p>
        </div>

        <div className="overview-header-telemetry">
          <div className="overview-status-pill">
            <span
              className={`overview-status-pulse ${isScanning ? "is-scanning" : ""}`}
              aria-hidden="true"
            />
            <span>
              {isScanning
                ? `${ui.common.scanning} (${progress?.entriesFound ?? 0} ${ui.overview.candidates})`
                : items.length > 0
                  ? ui.overview.statusReady
                  : ui.overview.statusIdle}
            </span>
          </div>

          <div className="overview-header-actions" role="toolbar" aria-label={ui.overview.title}>
            <button
              type="button"
              className="overview-header-btn"
              onClick={() => setResetDialogOpen(true)}
              disabled={isScanning || (items.length === 0 && !restored)}
              title={ui.overview.resetUi}
              aria-label={ui.overview.resetUi}
            >
              <RotateCcw size={14} />
            </button>
            <button
              type="button"
              className="overview-header-btn"
              onClick={() => setRestoreDialogOpen(true)}
              disabled={isScanning || !hasLastSnapshot}
              title={ui.overview.restoreLastScan}
              aria-label={ui.overview.restoreLastScan}
            >
              <History size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* 2. 4-COLUMN BENTO KPI ROW */}
      <section className="overview-kpi-grid" aria-label={ui.overview.title}>
        {/* KPI 1: Cleanable Space */}
        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{ui.overview.kpiCleanable}</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--accent">
              <HardDrive size={15} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {items.length > 0 ? formatBytes(totals.cleanable, language) : "—"}
            </span>
            <div className="nc-kpi-card-sub">
              {hasComparison && items.length > 0 ? (
                <span className={`nc-kpi-delta-pill ${cleanableDelta > 0 ? "is-up" : "is-down"}`}>
                  {cleanableDelta > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {formatSignedBytes(cleanableDelta, language)}
                </span>
              ) : (
                <span>{ui.overview.kpiCleanableSub}</span>
              )}
            </div>
          </div>
        </div>

        {/* KPI 2: Safe Reclaim */}
        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{ui.overview.kpiSafeReclaim}</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--success">
              <ShieldCheck size={15} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {items.length > 0 ? formatBytes(totals.safeReclaim, language) : "—"}
            </span>
            <div className="nc-kpi-card-sub">
              <span>{ui.overview.kpiSafeReclaimSub}</span>
            </div>
          </div>
        </div>

        {/* KPI 3: Scanned Targets & Projects */}
        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{ui.overview.kpiTargets}</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--purple">
              <FolderTree size={15} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {items.length > 0 ? ui.common.items(items.length) : ui.common.items(0)}
            </span>
            <div className="nc-kpi-card-sub">
              <span>
                {detectedProjects !== null && detectedProjects > 0
                  ? ui.overview.kpiTargetsSubActive(numberFormat.format(detectedProjects))
                  : ui.overview.kpiTargetsSubIdle}
              </span>
            </div>
          </div>
        </div>

        {/* KPI 4: Lifetime Reclaimed */}
        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{ui.overview.kpiLifetime}</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--warning">
              <Sparkles size={15} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {lifetimeReclaimed > 0 ? formatBytes(lifetimeReclaimed, language) : "0 B"}
            </span>
            <div className="nc-kpi-card-sub">
              <span>
                {lifetimeRuns > 0
                  ? ui.overview.kpiLifetimeSubRuns(lifetimeRuns)
                  : ui.overview.kpiLifetimeSubIdle}
              </span>
            </div>
          </div>
        </div>
      </section>

      {coverageSections.length > 0 && (
        <section className="overview-coverage" aria-label={ui.overview.coverage}>
          <h2 className="overview-coverage-title">{ui.overview.coverage}</h2>
          <ul className="overview-coverage-list">
            {coverageSections.map((section) => {
              const statusLabel = sectionStatusLabel(section.status);
              const skipped = section.status === "skipped" || section.status === "failed";
              return (
                <li key={section.scope} className={`overview-coverage-row is-${section.status}`}>
                  <span className="overview-coverage-name">{sectionScopeLabel(section.scope)}</span>
                  <span className="overview-coverage-status">
                    {statusLabel ||
                      (section.status === "completed" ? (
                        <CheckCircle2 size={13} aria-hidden="true" />
                      ) : (
                        <AlertCircle size={13} aria-hidden="true" />
                      ))}
                    {skipped && section.errorCode === "NO_ROOT" && (
                      <span className="overview-coverage-reason">{ui.overview.sectionNoRoot}</span>
                    )}
                  </span>
                  {!skipped && (
                    <span className="overview-coverage-meta">
                      {ui.common.items(section.itemCount)} ·{" "}
                      {formatBytes(section.cleanableBytes, language)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* 3. FULL-WIDTH STORAGE DISTRIBUTION & INTERACTIVE ACTION CENTER */}
      <section className="overview-dist-panel" aria-label={ui.overview.distTitle}>
        <div className="overview-panel-header">
          <div className="overview-panel-title-group">
            <h2 className="overview-panel-title">{ui.overview.distTitle}</h2>
            <span className="overview-panel-desc">
              {items.length > 0 ? ui.overview.distSubtitleActive : ui.overview.distSubtitleIdle}
            </span>
          </div>
          {items.length > 0 && (
            <span className="overview-hub-badge">
              {ui.overview.distTotalBadge(formatBytes(totals.cleanable, language))}
            </span>
          )}
        </div>

        {/* Interactive Distribution Bar */}
        {items.length > 0 && distributionSegments.length > 0 ? (
          <div className="overview-dist-bar-wrapper">
            <div
              className="overview-dist-bar"
              role="progressbar"
              // A progressbar without an accessible name is a serious WCAG
              // violation (axe `aria-progressbar-name`). The bar is a
              // composition of the per-ecosystem shares, not a task progress
              // indicator, so it is named after the panel it visualises.
              aria-label={ui.overview.distTitle}
              aria-valuenow={100}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              {distributionSegments.map((seg, index) => (
                <div
                  key={seg.id}
                  className="overview-dist-segment"
                  style={{
                    width: `${distributionWidths[index]}%`,
                    backgroundColor: seg.color,
                  }}
                  title={`${seg.label}: ${formatBytes(seg.bytes, language)} (${seg.percent.toFixed(1)}%)`}
                />
              ))}
            </div>

            {/* Interactive Grid of Ecosystems */}
            <div className="overview-eco-cards-grid">
              {distributionSegments.map((seg) => (
                <div
                  key={seg.id}
                  className="overview-eco-card"
                  style={{ "--eco-color": seg.color } as React.CSSProperties}
                  title={`${seg.label}: ${formatBytes(seg.bytes, language)}`}
                >
                  <div className="overview-eco-card-top">
                    <span
                      className="overview-eco-card-dot"
                      style={{ backgroundColor: seg.color }}
                    />
                    <span className="overview-eco-card-name">{seg.label}</span>
                    <span className="overview-eco-card-pct">{seg.percent.toFixed(1)}%</span>
                  </div>
                  <div className="overview-eco-card-bottom">
                    <span className="overview-eco-card-size">
                      {formatBytes(seg.bytes, language)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="overview-zero-state">
            <div className="overview-zero-icon">
              <HardDrive size={26} />
            </div>
            <h3 className="overview-zero-heading">{ui.overview.distEmptyTitle}</h3>
            <p className="overview-zero-desc">{ui.overview.distEmptyDesc}</p>
          </div>
        )}
      </section>

      {/* 4. DUAL BALANCED COLUMNS: Top 5 Targets + 4 Hubs (Same Height) */}
      <section className="overview-secondary-grid" aria-label={ui.overview.breakdown}>
        {/* Left: Top 5 Space Consumers */}
        <div className="overview-panel overview-panel--equal">
          <div className="overview-panel-header">
            <div className="overview-panel-title-group">
              <h2 className="overview-panel-title">{ui.overview.topItemsTitle}</h2>
              <span className="overview-panel-desc">{ui.overview.topItemsSubtitle}</span>
            </div>
            {topItems.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                icon={<ArrowUpRight size={13} />}
                onClick={() => setView("projects")}
              >
                {ui.overview.viewAll}
              </Button>
            )}
          </div>

          <div className="overview-top-items-list">
            {topItems.length > 0 ? (
              topItems.map(({ item, bytes }, index) => (
                <div key={item.id} className="overview-top-item-row">
                  <span className="overview-top-item-rank">{index + 1}</span>
                  <div className="overview-top-item-info">
                    <div className="overview-top-item-header">
                      <span className="overview-top-item-name">{item.displayName}</span>
                      <SafetyBadge safety={item.safetyClass} />
                    </div>
                    <span
                      className="overview-top-item-path"
                      title={maskPaths ? maskPath(item.displayPath) : item.displayPath}
                    >
                      {truncatePath(maskPaths ? maskPath(item.displayPath) : item.displayPath, 50)}
                    </span>
                  </div>
                  <span className="overview-top-item-size">{formatBytes(bytes, language)}</span>
                </div>
              ))
            ) : (
              <div className="overview-zero-state overview-zero-state--fill">
                <span className="overview-top-items-empty">{ui.overview.topItemsEmpty}</span>
              </div>
            )}
          </div>
        </div>

        {/* Right: 4 Category Hub Cards - Exactly matches height of Left Panel */}
        <div
          className="overview-hubs-column overview-hubs-column--equal"
          aria-label={ui.overview.breakdown}
        >
          {/* Hub 1: Projects */}
          <div
            className="overview-hub-card"
            role="button"
            tabIndex={0}
            onClick={() => setView("projects")}
            onKeyDown={(e) => e.key === "Enter" && setView("projects")}
          >
            <div className="overview-hub-left">
              <div className="overview-hub-icon overview-hub-icon--projects">
                <Code2 size={20} />
              </div>
              <div className="overview-hub-info">
                <h3 className="overview-hub-title">{ui.overview.hubProjectsTitle}</h3>
                <span className="overview-hub-desc">{ui.overview.hubProjectsDesc}</span>
              </div>
            </div>
            <div className="overview-hub-right">
              <span className="overview-hub-badge">
                {items.length > 0 ? ui.common.items(projectItemsCount) : ui.nav.projects}
              </span>
              <ArrowUpRight size={16} className="overview-hub-arrow" />
            </div>
          </div>

          {/* Hub 2: AI Coding Agents */}
          <div
            className="overview-hub-card"
            role="button"
            tabIndex={0}
            onClick={() => setView("agents")}
            onKeyDown={(e) => e.key === "Enter" && setView("agents")}
          >
            <div className="overview-hub-left">
              <div className="overview-hub-icon overview-hub-icon--ai">
                <Bot size={20} />
              </div>
              <div className="overview-hub-info">
                <h3 className="overview-hub-title">{ui.overview.hubAgentsTitle}</h3>
                <span className="overview-hub-desc">{ui.overview.hubAgentsDesc}</span>
              </div>
            </div>
            <div className="overview-hub-right">
              <span className="overview-hub-badge">
                {items.length > 0 ? `${agentItemsCount} ${ui.overview.ecoAgent}` : ui.nav.agents}
              </span>
              <ArrowUpRight size={16} className="overview-hub-arrow" />
            </div>
          </div>

          {/* Hub 3: Tool Caches */}
          <div
            className="overview-hub-card"
            role="button"
            tabIndex={0}
            onClick={() => setView("caches")}
            onKeyDown={(e) => e.key === "Enter" && setView("caches")}
          >
            <div className="overview-hub-left">
              <div className="overview-hub-icon overview-hub-icon--caches">
                <Zap size={20} />
              </div>
              <div className="overview-hub-info">
                <h3 className="overview-hub-title">{ui.overview.hubCachesTitle}</h3>
                <span className="overview-hub-desc">{ui.overview.hubCachesDesc}</span>
              </div>
            </div>
            <div className="overview-hub-right">
              <span className="overview-hub-badge">
                {totalCachesBytes > 0
                  ? formatBytes(totalCachesBytes, language)
                  : `${cacheProviders.length} ${ui.nav.caches}`}
              </span>
              <ArrowUpRight size={16} className="overview-hub-arrow" />
            </div>
          </div>

          {/* Hub 4: Cleanup & Operation History */}
          <div
            className="overview-hub-card"
            role="button"
            tabIndex={0}
            onClick={() => setView("history")}
            onKeyDown={(e) => e.key === "Enter" && setView("history")}
          >
            <div className="overview-hub-left">
              <div className="overview-hub-icon overview-hub-icon--history">
                <History size={20} />
              </div>
              <div className="overview-hub-info">
                <h3 className="overview-hub-title">{ui.overview.hubHistoryTitle}</h3>
                <span className="overview-hub-desc">
                  {historyError
                    ? localizeAppError(historyError, ui)
                    : lifetimeReclaimed > 0
                      ? ui.overview.hubHistoryDescActive(formatBytes(lifetimeReclaimed, language))
                      : ui.overview.hubHistoryDescIdle}
                </span>
              </div>
            </div>
            <div className="overview-hub-right">
              <span className="overview-hub-badge">
                {lifetimeRuns > 0 ? ui.history.records(lifetimeRuns) : ui.nav.history}
              </span>
              <ArrowUpRight size={16} className="overview-hub-arrow" />
            </div>
          </div>
        </div>
      </section>

      {/* Confirmation Dialogs */}
      <Dialog
        isOpen={resetDialogOpen}
        onClose={() => setResetDialogOpen(false)}
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <RotateCcw size={18} style={{ color: "var(--danger)" }} />
            {ui.overview.resetConfirmTitle}
          </span>
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetDialogOpen(false)}>
              {ui.common.cancel}
            </Button>
            <Button variant="danger" onClick={confirmReset}>
              {ui.overview.resetConfirmBtn}
            </Button>
          </>
        }
      >
        <p
          style={{
            margin: 0,
            color: "var(--text-secondary)",
            fontSize: "var(--text-sm)",
            lineHeight: "var(--leading-relaxed)",
          }}
        >
          {ui.overview.resetConfirmDesc}
        </p>
      </Dialog>

      <Dialog
        isOpen={restoreDialogOpen}
        onClose={() => setRestoreDialogOpen(false)}
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <History size={18} style={{ color: "var(--accent)" }} />
            {ui.overview.restoreConfirmTitle}
          </span>
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setRestoreDialogOpen(false)}>
              {ui.common.cancel}
            </Button>
            <Button variant="primary" onClick={confirmRestore}>
              {ui.overview.restoreConfirmBtn}
            </Button>
          </>
        }
      >
        <p
          style={{
            margin: 0,
            color: "var(--text-secondary)",
            fontSize: "var(--text-sm)",
            lineHeight: "var(--leading-relaxed)",
          }}
        >
          {ui.overview.restoreConfirmDesc}
        </p>
      </Dialog>
    </div>
  );
};
