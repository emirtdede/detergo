import React, { useEffect, useMemo, useRef, useState } from "react";
import { Gauge, Package, RefreshCw, Square, Terminal } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { Dialog } from "@/components/primitives/Dialog";
import { EmptyState } from "@/components/primitives/EmptyState";
import { PageHeader } from "@/components/primitives/PageHeader";
import { useUIText } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { formatBytes, formatSignedBytes } from "@/lib/formatters";
import {
  OfficialActionPreview,
  OfficialActionResult,
} from "@/types";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useCacheStore } from "@/stores/cache-store";
import { maskPath } from "@/features/items/ItemTable";
import "../items/items.css";
import "../shell/shell.css";

function describeError(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: string }).message);
  }
  return String(err);
}

export const CachesView: React.FC = () => {
  const ui = useUIText();
  const [preview, setPreview] = useState<OfficialActionPreview | null>(null);
  const [result, setResult] = useState<OfficialActionResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const providers = useCacheStore((s) => s.providers);
  const loading = useCacheStore((s) => s.loading);
  const loaded = useCacheStore((s) => s.loaded);
  const loadError = useCacheStore((s) => s.loadError);
  const measuring = useCacheStore((s) => s.measuring);
  const measureDone = useCacheStore((s) => s.measureDone);
  const measureTotal = useCacheStore((s) => s.measureTotal);
  const measureError = useCacheStore((s) => s.measureError);
  const loadProviders = useCacheStore((s) => s.loadProviders);
  const startMeasure = useCacheStore((s) => s.startMeasure);
  const cancelMeasure = useCacheStore((s) => s.cancelMeasure);
  const maskPaths = usePreferencesStore((s) => s.maskPaths);
  const measureMode = usePreferencesStore((s) => s.cacheMeasureMode);

  const load = () => {
    void loadProviders(true);
  };

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  // "Full" mode measures on open; "fast" lets the user decide. The store keeps
  // the run alive across unmounts, so this only ever starts once per mount and
  // a manual cancel is not immediately undone by the effect.
  const autoMeasureStarted = useRef(false);
  useEffect(() => {
    if (
      loaded &&
      measureMode === "full" &&
      !autoMeasureStarted.current &&
      !providers.some((p) => p.measured)
    ) {
      autoMeasureStarted.current = true;
      void startMeasure();
    }
  }, [loaded, measureMode, measuring, providers, startMeasure]);

  const openPreview = async (providerId: string, actionId: string) => {
    setError(null);
    setResult(null);
    try {
      const next = await scannerApi.previewOfficialAction(providerId, actionId);
      setPreview(next);
    } catch (err) {
      setError(describeError(err));
    }
  };

  const runAction = async () => {
    // A confirmation token is single-use. Once an attempt has been made, the
    // user must reopen the preview to run the command again.
    if (!preview || running || result !== null) return;
    setRunning(true);
    setError(null);
    try {
      const next = await scannerApi.executeOfficialAction(preview.token);
      setResult(next);
      load();
    } catch (err) {
      setError(describeError(err));
      // The token was consumed by the backend even though the command failed.
      setPreview(null);
    } finally {
      setRunning(false);
    }
  };

  const closePreview = () => {
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const cacheTotals = useMemo(() => {
    const totalBytes = providers.reduce((acc, p) => acc + (p.totalBytes || 0), 0);
    const measuredCount = providers.filter((p) => p.measured).length;
    const actionsCount = providers.reduce((acc, p) => acc + p.actions.length, 0);
    return { totalBytes, measuredCount, actionsCount };
  }, [providers]);

  const measuredAny = providers.some((provider) => provider.measured);

  return (
    <div className="page-view">
      <PageHeader
        title={ui.caches.title}
        description={ui.caches.subtitle}
        actions={
          <>
            {measuring ? (
              <Button
                variant="danger-outline"
                size="sm"
                icon={<Square size={11} fill="currentColor" />}
                onClick={() => void cancelMeasure()}
              >
                {ui.caches.cancelMeasure}
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                icon={<Gauge size={13} />}
                onClick={() => void startMeasure()}
                disabled={loading || providers.length === 0}
              >
                {ui.caches.measure}
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={13} />}
              onClick={load}
              disabled={loading || measuring}
            >
              {ui.caches.refresh}
            </Button>
          </>
        }
      />

      {/* Shared Bento KPI Strip for Caches */}
      <div className="nc-bento-strip nc-bento-strip--3">
        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{ui.caches.kpiTotal}</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--accent">
              <Package size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {cacheTotals.measuredCount > 0
                ? formatBytes(cacheTotals.totalBytes)
                : measuring
                  ? ui.caches.measuring
                  : ui.caches.notMeasured}
            </span>
            <span className="nc-kpi-card-sub">
              {cacheTotals.measuredCount > 0
                ? ui.caches.measureProgress(cacheTotals.measuredCount, providers.length)
                : ui.caches.measureHint}
            </span>
          </div>
        </div>

        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{ui.caches.kpiMeasured}</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--success">
              <Gauge size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {ui.caches.measureProgress(cacheTotals.measuredCount, providers.length)}
            </span>
            <span className="nc-kpi-card-sub">npm, Cargo, Pip, Yarn...</span>
          </div>
        </div>

        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{ui.caches.kpiActions}</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--warning">
              <Terminal size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {ui.caches.actionsReady(cacheTotals.actionsCount)}
            </span>
            <span className="nc-kpi-card-sub">{ui.caches.kpiActionsSub}</span>
          </div>
        </div>
      </div>

      {loadError && <p className="items-warning">{ui.caches.loadError} {loadError}</p>}
      {measureError && <p className="items-warning">{measureError}</p>}

      {measuring && (
        <p className="plan-note" aria-live="polite">
          {ui.caches.measuring}{" "}
          {measureTotal > 0 ? `· ${ui.caches.measureProgress(measureDone, measureTotal)}` : ""}
        </p>
      )}
      {!measuring && measuredAny && (
        <p className="plan-note">
          {ui.caches.measured} · {ui.caches.measureHint}
        </p>
      )}

      <div className="provider-grid">
        {providers.map((provider) => (
          <article key={provider.id} className="provider-card">
            <header className="provider-card-header">
              <Package size={14} className="provider-card-icon" />
              <span className="provider-card-name">{provider.name}</span>
              {provider.version && (
                <span className="chip" title={provider.version}>
                  {provider.version}
                </span>
              )}
              {provider.readOnly && <span className="chip">{ui.caches.readOnly}</span>}
              {!provider.detected && <span className="chip">{ui.caches.notFound}</span>}
            </header>
            <div className="provider-paths">
              {provider.cachePaths.slice(0, 2).map((path) => (
                <span key={path.path} title={maskPaths ? maskPath(path.path) : path.path}>
                  {maskPaths ? maskPath(path.path) : path.path}{" "}
                  {path.exists && path.bytes !== null && path.bytes !== undefined
                    ? `· ${formatBytes(path.bytes)}`
                    : ""}
                </span>
              ))}
            </div>
            <div className="form-row provider-card-size-row">
              <span>{ui.table.size}</span>
              {provider.measured ? (
                <strong className="provider-card-size">{formatBytes(provider.totalBytes)}</strong>
              ) : (
                <span className="chip">{ui.caches.notMeasured}</span>
              )}
            </div>
            <div className="provider-card-footer">
              {provider.note && <p className="plan-note provider-card-note">{provider.note}</p>}
              {provider.actions.length > 0 && (
                <div className="provider-actions">
                  {provider.actions.map((action) => (
                    <Button
                      key={action.id}
                      variant="secondary"
                      size="sm"
                      icon={<Terminal size={12} />}
                      disabled={!action.available}
                      title={action.available ? action.description : action.unavailableReason ?? ""}
                      onClick={() => openPreview(provider.id, action.id)}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </article>
        ))}
        {!loading && loaded && providers.length === 0 && !loadError && (
          <EmptyState
            variant="compact"
            icon={<Package size={20} />}
            title={ui.caches.noProviders}
            description={ui.caches.detectorNote}
          />
        )}
        {loading && providers.length === 0 && (
          <EmptyState
            variant="compact"
            live
            icon={<RefreshCw size={20} />}
            title={ui.common.loading}
          />
        )}
      </div>

      {providers.length > 0 && <p className="plan-note">{ui.caches.detectorNote}</p>}

      <Dialog
        isOpen={preview !== null}
        onClose={closePreview}
        title={ui.caches.previewTitle}
        maxWidth="640px"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={closePreview}>
              {ui.common.close}
            </Button>
            <Button variant="primary" size="sm" onClick={runAction} disabled={running || result !== null}>
              {running ? ui.caches.running : ui.caches.runAction}
            </Button>
          </>
        }
      >
        {preview && (
          <>
            <div className="plan-summary" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div>
                <span>{ui.caches.before}</span>
                <strong>{formatBytes(preview.beforeBytes)}</strong>
              </div>
              <div>
                <span>{ui.caches.executable}</span>
                <strong style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                  {preview.executable}
                </strong>
              </div>
            </div>
            {/* Dev Terminal Console */}
            <div
              style={{
                marginTop: 14,
                borderRadius: 8,
                background: "#080c14",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                overflow: "hidden",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "6px 12px",
                  background: "#0d131f",
                  borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                  color: "#94a3b8",
                  fontSize: 11,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Terminal size={12} color="#00f0ff" />
                  <span>{ui.caches.terminalTitle}</span>
                </div>
                <span>{result ? (result.success ? ui.caches.terminalCompleted : ui.caches.terminalError) : running ? ui.caches.terminalRunning : ui.caches.terminalReady}</span>
              </div>
              <div style={{ padding: "10px 12px", color: "#e2e8f0", lineHeight: 1.5, maxHeight: 180, overflowY: "auto" }}>
                <div style={{ color: "#38bdf8" }}>
                  <span style={{ color: "#a855f7" }}>$</span> {preview.executable} {preview.args.join(" ")}
                </div>
                {running && (
                  <div style={{ color: "#94a3b8", fontStyle: "italic", marginTop: 4 }}>
                    {ui.caches.terminalBackground}
                  </div>
                )}
                {result?.stdoutTail && (
                  <pre style={{ margin: "6px 0", color: "#cbd5e1", whiteSpace: "pre-wrap" }}>
                    {result.stdoutTail}
                  </pre>
                )}
                {result?.stderrTail && (
                  <pre style={{ margin: "6px 0", color: "#f87171", whiteSpace: "pre-wrap" }}>
                    {result.stderrTail}
                  </pre>
                )}
                {result && (
                  <div style={{ color: result.success ? "#4ade80" : "#f87171", marginTop: 6, fontSize: 11 }}>
                    {ui.caches.terminalFinished(result.durationMs, result.exitCode ?? 0)}
                  </div>
                )}
              </div>
            </div>

            <p className="plan-note" style={{ marginTop: 12 }}>
              <strong>{ui.caches.warning}: </strong>
              {preview.warning}
            </p>
            {providers
              .find((p) => p.id === preview.providerId)
              ?.actions.find((a) => a.id === preview.actionId)?.requiresNetwork && (
              <p className="items-warning">{ui.caches.networkWarning}</p>
            )}
            {result && (
              <>
                <div className="plan-summary" style={{ gridTemplateColumns: "1fr 1fr 1fr", marginTop: 10 }}>
                  <div>
                    <span>{ui.caches.result}</span>
                    <strong>{result.success ? ui.caches.succeeded : ui.caches.failed}</strong>
                  </div>
                  <div>
                    <span>{ui.caches.after}</span>
                    <strong>{formatBytes(result.afterBytes)}</strong>
                  </div>
                  <div>
                    <span>{ui.caches.delta}</span>
                    <strong>{formatSignedBytes(result.deltaBytes)}</strong>
                  </div>
                </div>
                {!result.success && (
                  <p className="items-warning">
                    {ui.caches.exitCode}: {result.exitCode ?? "?"}
                  </p>
                )}
                {result.auditError && <p className="items-warning">{ui.caches.auditError}</p>}
              </>
            )}
            {error && <p className="items-warning">{error}</p>}
          </>
        )}
      </Dialog>
    </div>
  );
};
