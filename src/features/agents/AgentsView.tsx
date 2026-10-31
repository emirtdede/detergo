import React, { useEffect, useMemo, useState } from "react";
import { Bot, RefreshCw, ShieldAlert, TrendingUp } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { useScanStore } from "@/stores/scan-store";
import { useScanController } from "@/features/scan/useScanController";
import { useUIText } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { formatBytes } from "@/lib/formatters";
import { AgentProviderInfo, GrowthEntry } from "@/types";
import { ItemTable, maskPath } from "@/features/items/ItemTable";
import { usePreferencesStore } from "@/stores/preferences-store";
import "../items/items.css";
import "../shell/shell.css";

export const AgentsView: React.FC = () => {
  const ui = useUIText();
  const { startScan, isScanning } = useScanController();
  const itemsById = useScanStore((s) => s.itemsById);
  const itemIds = useScanStore((s) => s.itemIds);
  const [providers, setProviders] = useState<AgentProviderInfo[]>([]);
  const [growth, setGrowth] = useState<GrowthEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const maskPaths = usePreferencesStore((s) => s.maskPaths);

  const loadProviders = () => {
    setLoading(true);
    setLoadError(null);
    Promise.all([scannerApi.getAgentProviders(), scannerApi.getGrowthReport()])
      .then(([list, report]) => {
        setProviders(list);
        setGrowth(report.entries);
      })
      .catch((err) =>
        setLoadError(
          err && typeof err === "object" && "message" in err
            ? String((err as { message: string }).message)
            : String(err)
        )
      )
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadProviders();
  }, []);

  const items = useMemo(
    () =>
      itemIds
        .map((id) => itemsById[id])
        .filter((item) => item && item.provider !== "project" && item.status !== "deleted"),
    [itemIds, itemsById]
  );

  const providerStats = useMemo(() => {
    const map: Record<string, { protectedBytes: number; cleanableBytes: number; active: boolean }> = {};
    for (const item of items) {
      const entry = map[item.provider] ?? { protectedBytes: 0, cleanableBytes: 0, active: false };
      const bytes = item.estimatedReclaimBytes ?? 0;
      if (item.protected) entry.protectedBytes += bytes;
      else entry.cleanableBytes += bytes;
      if (item.activeUse === "yes") entry.active = true;
      map[item.provider] = entry;
    }
    return map;
  }, [items]);

  return (
    <div className="items-view">
      <header className="view-header">
        <div>
          <h1 className="view-title">{ui.agents.title}</h1>
          <p className="view-subtitle">{ui.agents.subtitle}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="secondary" size="sm" icon={<RefreshCw size={13} />} onClick={loadProviders} disabled={loading}>
            {ui.common.refresh}
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<Bot size={13} />}
            onClick={() => startScan(undefined, "agents")}
            disabled={isScanning}
          >
            {ui.agents.scan}
          </Button>
        </div>
      </header>

      {loadError && (
        <p className="items-warning">
          {ui.agents.loadError} {loadError}
        </p>
      )}

      {providers.length === 0 ? (
        <p className="items-empty">{loading ? ui.common.loading : ui.agents.noProviders}</p>
      ) : (
        <div className="provider-grid">
          {providers.map((provider) => {
            const stats = providerStats[provider.id];
            return (
              <article key={provider.id} className="provider-card">
                <h3>
                  {provider.name}
                  {provider.readOnly && <span className="chip">{ui.agents.readOnly}</span>}
                  {stats?.active && <span className="chip warn">{ui.agents.active}</span>}
                  {!provider.installed && <span className="chip">{ui.agents.notInstalled}</span>}
                </h3>
                <div className="provider-paths">
                  {provider.roots
                    .filter((root) => root.exists)
                    .slice(0, 4)
                    .map((root) => (
                      <span key={root.path}>
                        {maskPaths ? maskPath(root.path) : root.path}
                      </span>
                    ))}
                </div>
                <div className="form-row">
                  <span>{ui.agents.protectedBytes}</span>
                  <strong>{formatBytes(stats?.protectedBytes ?? 0)}</strong>
                </div>
                <div className="form-row">
                  <span>{ui.overview.cleanable}</span>
                  <strong>{formatBytes(stats?.cleanableBytes ?? 0)}</strong>
                </div>
                {provider.note && <p className="plan-note">{provider.note}</p>}
              </article>
            );
          })}
        </div>
      )}

      <section>
        <h3 className="items-meta" style={{ marginBottom: 8 }}>
          <span>
            <TrendingUp size={13} /> {ui.agents.growth}
          </span>
        </h3>
        {growth.length === 0 ? (
          <p className="plan-note">{ui.agents.growthEmpty}</p>
        ) : (
          <table className="table-simple">
            <thead>
              <tr>
                <th>{ui.agents.providerNote}</th>
                <th>{ui.table.category}</th>
                <th className="num">{ui.overview.cleanable}</th>
                <th className="num">{ui.result.volumeDelta}</th>
              </tr>
            </thead>
            <tbody>
              {growth.slice(0, 8).map((entry) => (
                <tr key={`${entry.provider}-${entry.category}`}>
                  <td>{entry.provider}</td>
                  <td>{entry.category}</td>
                  <td className="num">{formatBytes(entry.currentBytes)}</td>
                  <td className="num">
                    <span className={`chip ${entry.level === "critical" ? "danger" : entry.level === "attention" ? "warn" : "ok"}`}>
                      {entry.deltaBytes >= 0 ? "+" : ""}
                      {formatBytes(Math.abs(entry.deltaBytes))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {items.length > 0 ? (
        <ItemTable items={items} showProject={false} />
      ) : (
        <p className="plan-note">
          <ShieldAlert size={13} /> {ui.overview.scanFirst}
        </p>
      )}
    </div>
  );
};
