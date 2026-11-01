import React, { useEffect, useMemo, useState } from "react";
import {
  Bot,
  EyeOff,
  FolderPlus,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { Dialog } from "@/components/primitives/Dialog";
import { useScanStore } from "@/stores/scan-store";
import { useScanController } from "@/features/scan/useScanController";
import { useUIText } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { formatBytes } from "@/lib/formatters";
import { AgentProviderInfo, AppSettings, GrowthEntry } from "@/types";
import { ItemTable, maskPath } from "@/features/items/ItemTable";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore } from "@/stores/ui-store";
import "../items/items.css";
import "../shell/shell.css";

function describeError(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: string }).message);
  }
  return String(err);
}

const BUILTIN_NAMES: Record<string, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
  antigravity: "Antigravity",
};

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
  const hiddenProviders = usePreferencesStore((s) => s.hiddenBuiltinProviders);
  const loadPreferences = usePreferencesStore((s) => s.loadPreferences);
  const showToast = useUiStore((s) => s.showToast);

  const [addOpen, setAddOpen] = useState(false);
  const [toolName, setToolName] = useState("");
  const [toolRoots, setToolRoots] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const loadProviders = () => {
    setLoading(true);
    setLoadError(null);
    Promise.all([scannerApi.getAgentProviders(), scannerApi.getGrowthReport()])
      .then(([list, report]) => {
        setProviders(list);
        setGrowth(report.entries);
      })
      .catch((err) => setLoadError(describeError(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadProviders();
  }, []);

  const applySettings = (settings: AppSettings) => {
    loadPreferences(settings);
    loadProviders();
  };

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

  const resetAddForm = () => {
    setToolName("");
    setToolRoots([]);
  };

  const pickRoot = async () => {
    try {
      const selected = await scannerApi.selectFolderDialog();
      if (selected && !toolRoots.some((root) => root.toLowerCase() === selected.toLowerCase())) {
        setToolRoots((prev) => [...prev, selected]);
      }
    } catch (err) {
      showToast(describeError(err), "error");
    }
  };

  const addTool = async () => {
    const name = toolName.trim();
    if (!name || toolRoots.length === 0 || saving) return;
    setSaving(true);
    try {
      const settings = await scannerApi.addCustomAgentProvider(name, toolRoots);
      applySettings(settings);
      showToast(ui.agents.added, "success");
      setAddOpen(false);
      resetAddForm();
    } catch (err) {
      showToast(`${ui.agents.saveError}: ${describeError(err)}`, "error", 6000);
    } finally {
      setSaving(false);
    }
  };

  const removeTool = async (provider: AgentProviderInfo) => {
    if (!window.confirm(ui.agents.removeToolConfirm)) return;
    try {
      const settings = await scannerApi.removeCustomAgentProvider(provider.id);
      applySettings(settings);
      showToast(ui.agents.removed, "success");
    } catch (err) {
      showToast(`${ui.agents.saveError}: ${describeError(err)}`, "error", 6000);
    }
  };

  const setHidden = async (providerId: string, hidden: boolean) => {
    try {
      const settings = await scannerApi.setAgentProviderHidden(providerId, hidden);
      applySettings(settings);
      showToast(hidden ? ui.agents.hidden : ui.agents.shown, "success");
    } catch (err) {
      showToast(`${ui.agents.saveError}: ${describeError(err)}`, "error", 6000);
    }
  };

  return (
    <div className="page-view">
      <header className="view-header">
        <div>
          <h1 className="view-title">{ui.agents.title}</h1>
          <p className="view-subtitle">{ui.agents.subtitle}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus size={13} />}
            onClick={() => {
              resetAddForm();
              setAddOpen(true);
            }}
          >
            {ui.agents.addTool}
          </Button>
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

      {hiddenProviders.length > 0 && (
        <div className="subpage-toolbar" style={{ marginBottom: 12 }}>
          <span className="items-meta">
            <EyeOff size={13} /> {ui.agents.hiddenTools}
          </span>
          {hiddenProviders.map((id) => (
            <button
              key={id}
              type="button"
              className="history-tab"
              onClick={() => setHidden(id, false)}
              title={ui.agents.showHidden}
            >
              {BUILTIN_NAMES[id] ?? id}
            </button>
          ))}
        </div>
      )}

      {providers.length === 0 ? (
        <p className="items-empty">{loading ? ui.common.loading : ui.agents.noProviders}</p>
      ) : (
        <div className="provider-grid">
          {providers.map((provider) => {
            const stats = providerStats[provider.id];
            const isCustom = provider.id.startsWith("custom:");
            return (
              <article key={provider.id} className="provider-card">
                <h3>
                  <span className="provider-card-name" title={provider.name}>
                    {provider.name}
                  </span>
                  {isCustom && <span className="chip">{ui.agents.customTool}</span>}
                  {provider.readOnly && <span className="chip">{ui.agents.readOnly}</span>}
                  {isCustom && <span className="chip ok">{ui.agents.keepOnly}</span>}
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
                <div className="provider-actions">
                  {isCustom ? (
                    <Button
                      variant="danger-outline"
                      size="sm"
                      icon={<Trash2 size={12} />}
                      onClick={() => removeTool(provider)}
                    >
                      {ui.agents.removeTool}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<EyeOff size={12} />}
                      onClick={() => setHidden(provider.id, true)}
                    >
                      {ui.agents.hide}
                    </Button>
                  )}
                </div>
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

      <Dialog
        isOpen={addOpen}
        onClose={() => {
          if (!saving) setAddOpen(false);
        }}
        title={ui.agents.addTool}
        maxWidth="560px"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setAddOpen(false)} disabled={saving}>
              {ui.common.cancel}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={addTool}
              disabled={saving || toolName.trim().length === 0 || toolRoots.length === 0}
            >
              {saving ? ui.common.loading : ui.common.add}
            </Button>
          </>
        }
      >
        <p className="plan-note">{ui.agents.addToolHint}</p>
        <label className="form-row">
          <span>{ui.agents.toolName}</span>
          <input
            type="text"
            value={toolName}
            placeholder={ui.agents.toolNamePlaceholder}
            onChange={(event) => setToolName(event.target.value)}
            maxLength={64}
          />
        </label>
        <div className="plan-note" style={{ marginTop: 8 }}>
          {ui.agents.toolRoots}
        </div>
        <div className="list-editor">
          {toolRoots.map((root) => (
            <div key={root} className="list-row">
              <span>{maskPaths ? maskPath(root) : root}</span>
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                aria-label={ui.settings.remove}
                onClick={() => setToolRoots((prev) => prev.filter((item) => item !== root))}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8 }}>
          <Button variant="secondary" size="sm" icon={<FolderPlus size={12} />} onClick={pickRoot}>
            {ui.agents.addRoot}
          </Button>
        </div>
      </Dialog>
    </div>
  );
};
