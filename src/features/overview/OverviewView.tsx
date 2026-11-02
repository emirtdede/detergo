import React, { useMemo } from "react";
import {
  Play,
  ShieldCheck,
  Database,
  FolderTree,
  PieChart,
  HardDrive,
  Layers,
  TrendingDown,
  TrendingUp,
  Sparkles,
  ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { useScanStore } from "@/stores/scan-store";
import { useUIText } from "@/lib/ui-text";
import { useScanController } from "@/features/scan/useScanController";
import { formatBytes, formatSignedBytes } from "@/lib/formatters";
import { maskPath } from "@/features/items/ItemTable";
import { SafetyBadge } from "@/features/items/SafetyBadge";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useAppStore } from "@/stores/app-store";
import "../items/items.css";
import "./overview.css";

export const OverviewView: React.FC = () => {
  const ui = useUIText();
  const { startScan, isScanning } = useScanController();
  const itemsById = useScanStore((s) => s.itemsById);
  const itemIds = useScanStore((s) => s.itemIds);
  const summary = useScanStore((s) => s.summary);
  const status = useScanStore((s) => s.status);
  const scope = useScanStore((s) => s.scope);
  const progress = useScanStore((s) => s.progress);
  const previousSummary = useScanStore((s) => s.previousSummary);
  const previousCleanableBytes = useScanStore((s) => s.previousCleanableBytes);
  const previousItemCount = useScanStore((s) => s.previousItemCount);
  const maskPaths = usePreferencesStore((s) => s.maskPaths);
  const setView = useAppStore((s) => s.setView);

  const items = useMemo(
    () => itemIds.map((id) => itemsById[id]).filter(Boolean),
    [itemIds, itemsById]
  );

  const totals = useMemo(() => {
    let cleanable = 0;
    let protectedBytes = 0;
    const projects = new Set<string>();
    for (const item of items) {
      const bytes = item.estimatedReclaimBytes ?? 0;
      const blocked = item.protected || item.safetyClass === "keep" || !item.selectable;
      if (blocked) protectedBytes += bytes;
      else cleanable += bytes;
      if (item.projectId) projects.add(item.projectId);
    }
    return { cleanable, protectedBytes, projects: projects.size };
  }, [items]);

  const topItems = useMemo(
    () =>
      [...items]
        .filter((item) => item.selectable && !item.protected)
        .sort((a, b) => (b.estimatedReclaimBytes ?? 0) - (a.estimatedReclaimBytes ?? 0))
        .slice(0, 6),
    [items]
  );

  const providers = summary?.providerTotals ?? [];
  const maxTargetBytes = Math.max(1, ...topItems.map((i) => i.estimatedReclaimBytes ?? 0));
  const maxProviderBytes = Math.max(1, ...providers.map((p) => p.allocatedBytes));

  const hasComparison = previousItemCount > 0 || previousSummary !== null;
  const cleanableDelta = totals.cleanable - previousCleanableBytes;
  const itemDelta = items.length - previousItemCount;

  return (
    <div className="overview-page">
      <header className="overview-hero">
        <div className="overview-hero-glow" aria-hidden="true" />
        <div className="overview-hero-copy">
          <span className="overview-eyebrow">
            <Sparkles size={12} /> {ui.nav.overview}
          </span>
          <h1 className="overview-title">{ui.overview.title}</h1>
          <p className="overview-subtitle">{ui.overview.subtitle}</p>
        </div>
        <div className="overview-hero-actions">
          <Button
            variant="primary"
            size="md"
            icon={<Play size={13} fill="currentColor" />}
            onClick={() => startScan(undefined, scope)}
            disabled={isScanning}
          >
            {status === "idle" ? ui.common.chooseFolder : ui.common.rescan}
          </Button>
        </div>
      </header>

      {isScanning && (
        <div className="overview-scan-progress" role="status">
          <span className="overview-scan-pulse" aria-hidden="true" />
          <span>
            {ui.common.scanning} {progress?.entriesFound ?? 0} / {progress?.entriesMeasured ?? 0}
          </span>
        </div>
      )}

      {summary?.partial && (
        <p className="items-warning">
          {ui.overview.partial}
          {summary.stopReason ? ` (${ui.overview.stopReason}: ${summary.stopReason})` : ""}
        </p>
      )}
      {summary && (summary.warningsCount > 0 || summary.errorsCount > 0) && (
        <p className="items-warning">
          {ui.overview.warnings}: {summary.warningsCount} · {ui.overview.errors}:{" "}
          {summary.errorsCount}
        </p>
      )}

      <div className="overview-stats">
        <article className="overview-stat overview-stat--accent">
          <span className="overview-stat-icon">
            <HardDrive size={16} />
          </span>
          <div>
            <span className="overview-stat-label">{ui.overview.cleanable}</span>
            <strong className="overview-stat-value">{formatBytes(totals.cleanable)}</strong>
          </div>
        </article>
        <article className="overview-stat overview-stat--protected">
          <span className="overview-stat-icon">
            <ShieldCheck size={16} />
          </span>
          <div>
            <span className="overview-stat-label">{ui.overview.protected}</span>
            <strong className="overview-stat-value">{formatBytes(totals.protectedBytes)}</strong>
          </div>
        </article>
        <article className="overview-stat">
          <span className="overview-stat-icon">
            <Layers size={16} />
          </span>
          <div>
            <span className="overview-stat-label">{ui.overview.candidates}</span>
            <strong className="overview-stat-value">{items.length}</strong>
          </div>
        </article>
        <article className="overview-stat">
          <span className="overview-stat-icon">
            <FolderTree size={16} />
          </span>
          <div>
            <span className="overview-stat-label">{ui.overview.projects}</span>
            <strong className="overview-stat-value">{totals.projects}</strong>
          </div>
        </article>
      </div>

      {hasComparison && items.length > 0 && (
        <div className="overview-compare">
          <span className="overview-compare-label">
            <TrendingUp size={13} /> {ui.stale.previousComparison}
          </span>
          <span className={`overview-compare-delta ${cleanableDelta > 0 ? "is-up" : "is-down"}`}>
            {cleanableDelta > 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            {formatSignedBytes(cleanableDelta)}
          </span>
          <span className="overview-compare-meta">{ui.overview.cleanable}</span>
          <span className="overview-compare-sep" aria-hidden="true">·</span>
          <span className="overview-compare-meta">{ui.stale.itemsDelta(itemDelta)}</span>
        </div>
      )}

      {items.length === 0 ? (
        <section className="overview-empty">
          <span className="overview-empty-icon">
            <FolderTree size={30} />
          </span>
          <h2 className="overview-empty-title">{ui.overview.noScan}</h2>
          <p className="overview-empty-hint">{ui.overview.startHint}</p>
          <div className="overview-empty-actions">
            <Button variant="primary" size="md" onClick={() => startScan(undefined, scope)} disabled={isScanning}>
              {ui.common.chooseFolder}
            </Button>
            <Button variant="secondary" size="md" onClick={() => setView("agents")}>
              {ui.agents.title}
            </Button>
          </div>
          <div className="overview-empty-points">
            <span><ShieldCheck size={13} /> {ui.safety.keep}</span>
            <span><Database size={13} /> {ui.nav.caches}</span>
            <span><PieChart size={13} /> {ui.overview.breakdown}</span>
          </div>
        </section>
      ) : (
        <div className="overview-grid">
          <section className="overview-panel">
            <header className="overview-panel-head">
              <div>
                <h2>{ui.overview.topItems}</h2>
                <span className="overview-panel-hint">{ui.common.showing(topItems.length)}</span>
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon={<ArrowUpRight size={12} />}
                onClick={() => setView("projects")}
              >
                {ui.nav.projects}
              </Button>
            </header>
            <div className="overview-targets">
              {topItems.map((item, index) => (
                <div key={item.id} className="overview-target">
                  <span className="overview-target-rank">{index + 1}</span>
                  <div className="overview-target-main">
                    <div className="overview-target-title">
                      <strong>{item.displayName}</strong>
                      <SafetyBadge safety={item.safetyClass} />
                    </div>
                    <span className="overview-target-path">
                      {maskPaths ? maskPath(item.displayPath) : item.displayPath}
                    </span>
                    <div className="overview-bar" aria-hidden="true">
                      <span
                        style={{
                          width: `${Math.max(
                            4,
                            ((item.estimatedReclaimBytes ?? 0) / maxTargetBytes) * 100
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                  <span className="overview-target-size">
                    {formatBytes(item.estimatedReclaimBytes ?? 0)}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="overview-panel">
            <header className="overview-panel-head">
              <div>
                <h2>{ui.overview.breakdown}</h2>
                <span className="overview-panel-hint">
                  {ui.common.items(providers.reduce((acc, p) => acc + p.itemCount, 0))}
                </span>
              </div>
              <PieChart size={15} className="overview-panel-icon" />
            </header>
            {providers.length === 0 ? (
              <div className="items-empty">{ui.common.none}</div>
            ) : (
              <div className="overview-providers">
                {providers.map((provider) => (
                  <div key={provider.provider} className="overview-provider">
                    <div className="overview-provider-head">
                      <strong>{provider.provider}</strong>
                      <span>{formatBytes(provider.allocatedBytes)}</span>
                    </div>
                    <div className="overview-bar overview-bar--provider" aria-hidden="true">
                      <span
                        style={{
                          width: `${Math.max(4, (provider.allocatedBytes / maxProviderBytes) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="overview-provider-meta">
                      {ui.common.items(provider.itemCount)} · {ui.agents.protectedBytes}:{" "}
                      {formatBytes(provider.protectedBytes)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="overview-panel-actions">
              <Button
                variant="secondary"
                size="sm"
                icon={<Database size={13} />}
                onClick={() => setView("caches")}
              >
                {ui.nav.caches}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<ShieldCheck size={13} />}
                onClick={() => setView("settings")}
              >
                {ui.nav.settings}
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
