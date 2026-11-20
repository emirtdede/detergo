import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

import { useUIText, getUIText, localizeAppError, localizeBackendNote } from "@/lib/ui-text";

import { scannerApi } from "@/lib/tauri/scanner-api";

import { formatBytes } from "@/lib/formatters";

import { AgentProviderInfo, AppSettings } from "@/types";

import { ItemTable } from "@/features/items/ItemTable";
import { maskPath } from "@/lib/format/path";
import { describeError } from "@/lib/errors/user-message";
import { ownBytesById } from "@/lib/item-totals";

import { usePreferencesStore } from "@/stores/preferences-store";

import { useUiStore } from "@/stores/ui-store";

import "../items/items.css";

import "../shell/shell.css";

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

  const scope = useScanStore((s) => s.scope);

  const error = useScanStore((s) => s.error);

  const progress = useScanStore((s) => s.progress);

  const restored = useScanStore((s) => s.restored);

  const pruneItems = useScanStore((s) => s.pruneItems);

  const [providers, setProviders] = useState<AgentProviderInfo[]>([]);

  const [loading, setLoading] = useState(false);

  const [loadError, setLoadError] = useState<string | null>(null);

  const maskPaths = usePreferencesStore((s) => s.maskPaths);

  const hiddenProviders = usePreferencesStore((s) => s.hiddenBuiltinProviders);

  const applyProviderSettings = usePreferencesStore((s) => s.applyProviderSettings);

  const showToast = useUiStore((s) => s.showToast);

  const language = usePreferencesStore((s) => s.language);

  const [addOpen, setAddOpen] = useState(false);

  const [toolName, setToolName] = useState("");

  const [toolRoots, setToolRoots] = useState<string[]>([]);

  const [saving, setSaving] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<AgentProviderInfo | null>(null);
  const [tab, setTab] = useState<"items" | "providers">("items");

  // `loading` in a closure only reflects the render that created the callback,
  // so two quick refreshes could both pass the guard. The ref is synchronous and
  // the generation drops responses that arrive after unmount or after a newer
  // request, preventing an old list from overwriting fresh data.
  const loadingRef = useRef(false);

  const loadGenerationRef = useRef(0);

  // A mutation-triggered reload that arrives while a fetch is in flight must
  // not be dropped (the old `if (loadingRef.current) return` silently showed
  // the pre-mutation provider list). It is queued and re-run on completion.
  const pendingReloadRef = useRef(false);

  const unmountedRef = useRef(false);

  const loadProviders = useCallback(
    async (silent = false) => {
      if (unmountedRef.current) return;
      if (loadingRef.current) {
        pendingReloadRef.current = true;
        return;
      }

      loadingRef.current = true;

      const generation = loadGenerationRef.current + 1;

      loadGenerationRef.current = generation;

      if (!unmountedRef.current) {
        setLoading(true);
        setLoadError(null);
      }

      try {
        const list = await scannerApi.getAgentProviders();

        if (generation !== loadGenerationRef.current || unmountedRef.current) return;

        setProviders(list);

        if (!silent) useUiStore.getState().showToast(getUIText().agents.toastRefreshed, "info");
      } catch (err) {
        if (generation !== loadGenerationRef.current || unmountedRef.current) return;

        const message = describeError(err);

        setLoadError(message);

        useUiStore.getState().showToast(getUIText().agents.toastError(message), "error");
      } finally {
        loadingRef.current = false;

        if (generation === loadGenerationRef.current && !unmountedRef.current) setLoading(false);

        // Run the queued refresh outside this call so it starts with the guard
        // released.
        if (pendingReloadRef.current && !unmountedRef.current) {
          pendingReloadRef.current = false;
          void loadProviders(true);
        }
      }
    },
    [showToast],
  );

  useEffect(() => {
    unmountedRef.current = false;
    void loadProviders(true);

    return () => {
      // Late responses must not touch state after the view unmounts.
      unmountedRef.current = true;
      loadGenerationRef.current += 1;
    };
  }, [loadProviders]);

  const applySettings = (settings: AppSettings) => {
    applyProviderSettings(settings);

    // Hiding a built-in provider or deleting a custom one only changed the
    // policy and the provider cards: rows from the previous scan stayed in the
    // table, the selection and the summary, and could still be cleaned. Drop
    // them as soon as the new policy is known.
    const hidden = new Set(settings.hiddenBuiltinProviders ?? []);
    const customIds = new Set(
      (settings.customAgentProviders ?? []).map((provider) => `custom:${provider.id}`),
    );
    pruneItems((item) => {
      if (item.provider === "project") return false;
      if (hidden.has(item.provider)) return true;
      return item.provider.startsWith("custom:") && !customIds.has(item.provider);
    });

    void loadProviders();
  };

  const items = useMemo(
    () =>
      itemIds

        .map((id) => itemsById[id])

        .filter((item) => item && item.provider !== "project" && item.status !== "deleted"),

    [itemIds, itemsById],
  );

  const ownBytes = useMemo(() => ownBytesById(items), [items]);

  const providerStats = useMemo(() => {
    const map: Record<string, { protectedBytes: number; cleanableBytes: number; active: boolean }> =
      {};

    for (const item of items) {
      const entry = map[item.provider] ?? { protectedBytes: 0, cleanableBytes: 0, active: false };

      const bytes = ownBytes.get(item.id)?.allocatedBytes ?? item.estimatedReclaimBytes ?? 0;

      // Same rule as the page total and the backend summary: a target is only
      // cleanable when it is not protected, not a "keep" safety class and
      // selectable. The card used to count only `protected`, so cards summed
      // to more than the header total (M2).
      if (item.protected || item.safetyClass === "keep" || !item.selectable) {
        entry.protectedBytes += bytes;
      } else {
        entry.cleanableBytes += bytes;
      }

      if (item.activeUse === "yes") entry.active = true;

      map[item.provider] = entry;
    }

    return map;
  }, [items, ownBytes]);

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
    setPendingRemove(null);
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

  // A project or global-cache scan produces no agent rows. Treating any
  // `itemIds` as "agents scanned" told the user their agent scan found nothing
  // right after a project scan. Only an agents/all-drives scan (or a restored
  // one) counts here.
  const scopeCoversAgents = scope === "agents" || scope === "allDrives" || scope === "combined";
  const isLoadedOrScanned =
    scopeCoversAgents &&
    (status === "completed" || status === "partial" || itemIds.length > 0 || restored);

  const emptyTitle = isScanning
    ? ui.common.scanning
    : status === "failed"
      ? ui.errors.title
      : isLoadedOrScanned
        ? ui.agents.emptyTitleClean
        : ui.agents.emptyTitleIdle;

  const emptyDescription = isScanning
    ? `${progress?.entriesFound ?? 0} / ${progress?.entriesMeasured ?? 0}`
    : status === "failed"
      ? error
        ? localizeAppError(error, ui)
        : ui.overview.startHint
      : isLoadedOrScanned
        ? ui.agents.emptyDescClean
        : ui.agents.emptyDescIdle;

  const agentTotals = useMemo(() => {
    let cleanable = 0;

    let safe = 0;

    for (const item of items) {
      if (item.protected || item.safetyClass === "keep" || !item.selectable) continue;

      const b = ownBytes.get(item.id)?.allocatedBytes ?? item.estimatedReclaimBytes ?? 0;

      cleanable += b;

      if (item.safetyClass === "safe") safe += b;
    }

    const detectedCount = providers.filter((p) => p.installed).length;

    return { cleanable, safe, detectedCount };
  }, [items, ownBytes, providers]);

  return (
    <div className="page-view agents-page-view">
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
              onClick={() => void loadProviders(false)}
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
            <span className="nc-kpi-card-label">{ui.agents.kpiStorage}</span>

            <span className="nc-kpi-card-icon nc-kpi-card-icon--accent">
              <Bot size={14} />
            </span>
          </div>

          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {items.length > 0
                ? formatBytes(agentTotals.cleanable, language)
                : agentTotals.detectedCount > 0
                  ? ui.agents.notScanned
                  : "0 B"}
            </span>

            <span className="nc-kpi-card-sub">
              {items.length > 0 ? ui.agents.itemsSub(items.length) : ui.agents.scanHint}
            </span>
          </div>
        </div>

        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{ui.agents.kpiSafeReclaim}</span>

            <span className="nc-kpi-card-icon nc-kpi-card-icon--success">
              <ShieldCheck size={14} />
            </span>
          </div>

          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {items.length > 0
                ? formatBytes(agentTotals.safe, language)
                : agentTotals.detectedCount > 0
                  ? ui.agents.notScanned
                  : "0 B"}
            </span>

            <span className="nc-kpi-card-sub">{ui.agents.kpiSafeReclaimSub}</span>
          </div>
        </div>

        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{ui.agents.kpiInstalled}</span>

            <span className="nc-kpi-card-icon nc-kpi-card-icon--purple">
              <TrendingUp size={14} />
            </span>
          </div>

          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {agentTotals.detectedCount} / {providers.length} {ui.overview.ecoAgent}
            </span>

            <span className="nc-kpi-card-sub">{ui.about.ruleAgents}</span>
          </div>
        </div>
      </div>

      {loadError && (
        <p className="items-warning">
          {ui.agents.loadError} {loadError}
        </p>
      )}

      <div className="subpage-toolbar" role="tablist" aria-label={ui.agents.title}>
        {(["items", "providers"] as const).map((id, index, all) => {
          const active = tab === id;
          return (
            <button
              key={id}
              id={`agents-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`agents-panel-${id}`}
              tabIndex={active ? 0 : -1}
              className={`history-tab ${active ? "active" : ""}`}
              onClick={() => setTab(id)}
              onKeyDown={(event) => {
                if (
                  event.key !== "ArrowRight" &&
                  event.key !== "ArrowLeft" &&
                  event.key !== "Home" &&
                  event.key !== "End"
                ) {
                  return;
                }
                event.preventDefault();
                let next = index;
                if (event.key === "ArrowRight") next = (index + 1) % all.length;
                else if (event.key === "ArrowLeft") next = (index - 1 + all.length) % all.length;
                else if (event.key === "Home") next = 0;
                else next = all.length - 1;
                setTab(all[next]);
                document.getElementById(`agents-tab-${all[next]}`)?.focus();
              }}
            >
              <span>{id === "items" ? ui.agents.tabItems : ui.agents.tabProviders}</span>
            </button>
          );
        })}
      </div>

      <div
        id="agents-panel-providers"
        role="tabpanel"
        aria-labelledby="agents-tab-providers"
        hidden={tab !== "providers"}
      >
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

                    <strong>{formatBytes(stats?.protectedBytes ?? 0, language)}</strong>
                  </div>

                  <div className="form-row">
                    <span>{ui.overview.cleanable}</span>

                    <strong>{formatBytes(stats?.cleanableBytes ?? 0, language)}</strong>
                  </div>

                  <p className="plan-note">{localizeBackendNote(provider.note, ui) || "\u00A0"}</p>

                  <div className="provider-actions">
                    {isCustom ? (
                      <Button
                        variant="danger-outline"
                        size="sm"
                        icon={<Trash2 size={12} />}
                        onClick={() => setPendingRemove(provider)}
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
      </div>

      <div
        id="agents-panel-items"
        role="tabpanel"
        aria-labelledby="agents-tab-items"
        hidden={tab !== "items"}
      >
        {tab === "items" && items.length > 0 ? (
          <ItemTable items={items} showProject={false} />
        ) : tab === "items" ? (
          <EmptyState
            className="agents-empty-state"
            live={isScanning}
            icon={
              isLoadedOrScanned ? (
                <ShieldCheck size={28} style={{ color: "var(--success)" }} />
              ) : (
                <ShieldAlert size={28} />
              )
            }
            title={emptyTitle}
            description={emptyDescription}
          />
        ) : null}
      </div>

      <Dialog
        isOpen={addOpen}
        onClose={() => {
          if (!saving) setAddOpen(false);
        }}
        title={ui.agents.addTool}
        maxWidth="560px"
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setAddOpen(false)}
              disabled={saving}
            >
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

      <Dialog
        isOpen={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        title={ui.agents.removeTool}
        maxWidth="440px"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setPendingRemove(null)}>
              {ui.common.cancel}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (pendingRemove) void removeTool(pendingRemove);
              }}
            >
              {ui.agents.removeTool}
            </Button>
          </>
        }
      >
        <p className="plan-note">
          {ui.agents.removeToolConfirm}
          {pendingRemove ? ` (${pendingRemove.name})` : ""}
        </p>
      </Dialog>
    </div>
  );
};
