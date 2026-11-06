import React, { useEffect, useMemo, useState } from "react";
import {
  Bot,
  EyeOff,
  FolderPlus,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { Dialog } from "@/components/primitives/Dialog";
import { EmptyState } from "@/components/primitives/EmptyState";
import { PageHeader } from "@/components/primitives/PageHeader";
import { useScanStore } from "@/stores/scan-store";
import { useScanController } from "@/features/scan/useScanController";
import { useUIText } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { formatBytes } from "@/lib/formatters";
import { AgentProviderInfo, AppSettings } from "@/types";
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
  opencode: "OpenCode",
  t3code: "T3 Code",
  bionic: "Bionic",
  cursor: "Cursor",
  windsurf: "Windsurf",
  ollama: "Ollama",
};

export const AgentsView: React.FC = () => {
  const ui = useUIText();
  const { startScan, isScanning } = useScanController();
  const itemsById = useScanStore((s) => s.itemsById);
  const itemIds = useScanStore((s) => s.itemIds);
  const status = useScanStore((s) => s.status);
  const error = useScanStore((s) => s.error);
  const progress = useScanStore((s) => s.progress);
  const restored = useScanStore((s) => s.restored);
  const [providers, setProviders] = useState<AgentProviderInfo[]>([]);
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

  const loadProviders = (silent = false) => {
    if (loading) return;
    setLoading(true);
    setLoadError(null);
    scannerApi.getAgentProviders()
      .then((list) => {
        setProviders(list);
        if (!silent) showToast("AI araçları güncellendi", "info");
      })
      .catch((err) => {
        setLoadError(describeError(err));
        showToast(`AI sağlayıcıları alınamadı: ${describeError(err)}`, "error");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadProviders(true);
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
      const selected = await scannerApi.selectFolderDialog(ui.agents.toolRoots);
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

  // The AI storage table distinguishes the same four scan states as Projects,
  // so "nothing scanned yet" is not shown after a failed or empty scan.
  const isLoadedOrScanned = status === "completed" || itemIds.length > 0 || restored;
  const emptyTitle = isScanning
    ? ui.common.scanning
    : status === "failed"
      ? ui.errors.title
      : isLoadedOrScanned
        ? "Temizlenebilir AI Kalıntısı Bulunamadı"
        : "AI Araçları Taranmadı";
  const emptyDescription = isScanning
    ? `${progress?.entriesFound ?? 0} / ${progress?.entriesMeasured ?? 0}`
    : status === "failed"
      ? error?.message ?? ui.overview.startHint
      : isLoadedOrScanned
        ? "Taranan AI araçları ve çalışma alanı temiz durumda. Silinebilecek oturum veya geçici log dosyası yok."
        : "AI depolamasını analiz etmek için yukarıdaki 'AI depolamasını tara' butonunu kullanın.";

  const agentTotals = useMemo(() => {
    let cleanable = 0;
    let safe = 0;
    for (const item of items) {
      if (item.protected || item.safetyClass === "keep" || !item.selectable) continue;
      const b = item.estimatedReclaimBytes ?? 0;
      cleanable += b;
      if (item.safetyClass === "safe") safe += b;
    }
    const detectedCount = providers.filter((p) => p.installed).length;
    return { cleanable, safe, detectedCount };
  }, [items, providers]);

  return (
    <div className="page-view">
      <PageHeader
        title={ui.agents.title}
        description={ui.agents.subtitle}
        actions={
          <>
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
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={13} className={loading ? "spin" : ""} />}
              onClick={() => loadProviders(false)}
              disabled={loading}
            >
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
          </>
        }
      />

      {/* Shared Bento KPI Strip for Agents */}
      <div className="nc-bento-strip nc-bento-strip--3">
        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">AI Depolama Yükü</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--accent">
              <Bot size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {items.length > 0
                ? formatBytes(agentTotals.cleanable)
                : agentTotals.detectedCount > 0
                  ? "Taranmadı"
                  : "0 B"}
            </span>
            <span className="nc-kpi-card-sub">
              {items.length > 0
                ? `${items.length} oturum & bellek öğesi`
                : "Sağ üstten 'AI depolamasını tara' butonuna tıklayın"}
            </span>
          </div>
        </div>

        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">Güvenli Geri Kazanım</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--success">
              <ShieldCheck size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {items.length > 0
                ? formatBytes(agentTotals.safe)
                : agentTotals.detectedCount > 0
                  ? "Taranmadı"
                  : "0 B"}
            </span>
            <span className="nc-kpi-card-sub">Geri Dönüşüm Kutusuna taşınır</span>
          </div>
        </div>

        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">Yüklü AI Ajanları</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--purple">
              <TrendingUp size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {agentTotals.detectedCount} / {providers.length} Ajan
            </span>
            <span className="nc-kpi-card-sub">Claude Code, Cursor, Codex...</span>
          </div>
        </div>
      </div>

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
        <EmptyState
          live={loading}
          icon={<Bot size={22} />}
          title={loading ? ui.common.loading : ui.agents.noProviders}
        />
      ) : (
        <div className="agents-provider-grid">
          {providers.map((provider) => {
            const stats = providerStats[provider.id];
            const isCustom = provider.id.startsWith("custom:");
            return (
              <article key={provider.id} className="agents-provider-card">
                <header>
                  <span className="provider-card-name" title={provider.name}>
                    {provider.name}
                  </span>
                  {isCustom && <span className="chip">{ui.agents.customTool}</span>}
                  {provider.readOnly && <span className="chip">{ui.agents.readOnly}</span>}
                  {isCustom && <span className="chip ok">{ui.agents.keepOnly}</span>}
                  {stats?.active && <span className="chip warn">{ui.agents.active}</span>}
                  {!provider.installed && <span className="chip">{ui.agents.notInstalled}</span>}
                </header>
                <div className="provider-paths">
                  {provider.roots
                    .filter((root) => root.exists)
                    .slice(0, 4)
                    .map((root) => (
                      <span key={root.path} title={maskPaths ? maskPath(root.path) : root.path}>
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
                <p className="plan-note">{provider.note || "\u00A0"}</p>
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

      {items.length > 0 ? (
        <ItemTable items={items} showProject={false} />
      ) : (
        <div className="agents-scan-results-card">
          <EmptyState
            variant="compact"
            live={isScanning}
            icon={isLoadedOrScanned ? <ShieldCheck size={28} style={{ color: "var(--success)" }} /> : <ShieldAlert size={28} />}
            title={emptyTitle}
            description={emptyDescription}
          />
        </div>
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
                aria-label={`${ui.settings.remove}: ${maskPaths ? maskPath(root) : root}`}
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
