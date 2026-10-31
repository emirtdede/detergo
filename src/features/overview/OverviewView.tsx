import React, { useMemo } from "react";
import { Play, ShieldCheck, Database, FolderTree, PieChart } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { useScanStore } from "@/stores/scan-store";
import { useUIText } from "@/lib/ui-text";
import { useScanController } from "@/features/scan/useScanController";
import { formatBytes } from "@/lib/formatters";
import { maskPath } from "@/features/items/ItemTable";
import { SafetyBadge } from "@/features/items/SafetyBadge";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useAppStore } from "@/stores/app-store";
import "../items/items.css";

export const OverviewView: React.FC = () => {
  const ui = useUIText();
  const { startScan, isScanning } = useScanController();
  const itemsById = useScanStore((s) => s.itemsById);
  const itemIds = useScanStore((s) => s.itemIds);
  const summary = useScanStore((s) => s.summary);
  const status = useScanStore((s) => s.status);
  const progress = useScanStore((s) => s.progress);
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

  return (
    <div>
      <header className="view-header">
        <div>
          <h1 className="view-title">{ui.overview.title}</h1>
          <p className="view-subtitle">{ui.overview.subtitle}</p>
        </div>
        <Button
          variant="primary"
          size="sm"
          icon={<Play size={12} fill="currentColor" />}
          onClick={() => startScan()}
          disabled={isScanning}
        >
          {status === "idle" ? ui.common.chooseFolder : ui.common.rescan}
        </Button>
      </header>

      {isScanning && (
        <p className="plan-note">
          {ui.common.scanning} {progress?.entriesFound ?? 0} / {progress?.entriesMeasured ?? 0}
        </p>
      )}

      {summary?.partial && (
        <p className="items-warning">
          {ui.overview.partial}
          {summary.stopReason ? ` (${ui.overview.stopReason}: ${summary.stopReason})` : ""}
        </p>
      )}
      {summary && (summary.warningsCount > 0 || summary.errorsCount > 0) && (
        <p className="items-warning">
          {ui.overview.warnings}: {summary.warningsCount} · {ui.overview.errors}: {summary.errorsCount}
        </p>
      )}

      <div
        className="plan-summary"
        style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 24 }}
      >
        <div>
          <span>{ui.overview.cleanable}</span>
          <strong>{formatBytes(totals.cleanable)}</strong>
        </div>
        <div>
          <span>{ui.overview.protected}</span>
          <strong>{formatBytes(totals.protectedBytes)}</strong>
        </div>
        <div>
          <span>{ui.overview.candidates}</span>
          <strong>{items.length}</strong>
        </div>
        <div>
          <span>{ui.overview.projects}</span>
          <strong>{totals.projects}</strong>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="scan-hero-viewport">
          <div className="hero-icon-container">
            <FolderTree size={28} />
          </div>
          <h2 className="hero-main-title">{ui.overview.noScan}</h2>
          <p className="hero-main-subtitle">{ui.overview.startHint}</p>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="primary" size="md" onClick={() => startScan()} disabled={isScanning}>
              {ui.common.chooseFolder}
            </Button>
            <Button variant="secondary" size="md" onClick={() => setView("agents")}>
              {ui.agents.title}
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
          <section>
            <h3 className="items-meta" style={{ marginBottom: 8 }}>
              <span>{ui.overview.topItems}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setView("projects")}>
                {ui.nav.projects}
              </button>
            </h3>
            <div className="items-table">
              {topItems.map((item) => (
                <div
                  key={item.id}
                  className="items-row"
                  style={{ gridTemplateColumns: "1fr 90px 90px" }}
                >
                  <div className="items-name">
                    <strong>{item.displayName}</strong>
                    <span className="items-path">
                      {maskPaths ? maskPath(item.displayPath) : item.displayPath}
                    </span>
                  </div>
                  <div>
                    <SafetyBadge safety={item.safetyClass} />
                  </div>
                  <div className="items-cell items-size">
                    {formatBytes(item.estimatedReclaimBytes ?? 0)}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="items-meta" style={{ marginBottom: 8 }}>
              <span>{ui.overview.breakdown}</span>
              <PieChart size={14} />
            </h3>
            <div className="items-table" style={{ padding: 8 }}>
              {providers.length === 0 && <div className="items-empty">{ui.common.none}</div>}
              {providers.map((provider) => (
                <div key={provider.provider} className="plan-row" style={{ border: "none" }}>
                  <div className="plan-row-main">
                    <strong>{provider.provider}</strong>
                    <span className="items-path">
                      {ui.common.items(provider.itemCount)} · {ui.agents.protectedBytes}:{" "}
                      {formatBytes(provider.protectedBytes)}
                    </span>
                  </div>
                  <div className="plan-row-side items-size">
                    {formatBytes(provider.allocatedBytes)}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
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
