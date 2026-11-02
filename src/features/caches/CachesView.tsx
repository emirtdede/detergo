import React, { useEffect, useRef, useState } from "react";
import { Gauge, Package, RefreshCw, Square, Terminal } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { Dialog } from "@/components/primitives/Dialog";
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

  const measuredAny = providers.some((provider) => provider.measured);

  return (
    <div className="page-view">
      <header className="view-header">
        <div>
          <h1 className="view-title">{ui.caches.title}</h1>
          <p className="view-subtitle">{ui.caches.subtitle}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
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
        </div>
      </header>

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
            <h3>
              <Package size={14} className="provider-card-icon" />
              <span className="provider-card-name">{provider.name}</span>
              {provider.version && (
                <span className="chip" title={provider.version}>
                  {provider.version}
                </span>
              )}
              {provider.readOnly && <span className="chip">{ui.caches.readOnly}</span>}
              {!provider.detected && <span className="chip">{ui.caches.notFound}</span>}
            </h3>
            <div className="provider-paths">
              {provider.cachePaths.map((path) => (
                <span key={path.path} title={maskPaths ? maskPath(path.path) : path.path}>
                  {maskPaths ? maskPath(path.path) : path.path}{" "}
                  {path.exists && path.bytes !== null && path.bytes !== undefined
                    ? `· ${formatBytes(path.bytes)}`
                    : ""}
                </span>
              ))}
            </div>
            <div className="form-row">
              <span>{ui.table.size}</span>
              {provider.measured ? (
                <strong className="provider-card-size">{formatBytes(provider.totalBytes)}</strong>
              ) : (
                <span className="chip">{ui.caches.notMeasured}</span>
              )}
            </div>
            {provider.note && <p className="plan-note">{provider.note}</p>}
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
          </article>
        ))}
        {!loading && loaded && providers.length === 0 && !loadError && (
          <p className="items-empty">{ui.caches.noProviders}</p>
        )}
        {loading && providers.length === 0 && <p className="items-empty">{ui.common.loading}</p>}
      </div>

      <p className="plan-note">{ui.caches.detectorNote}</p>

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
            <p className="plan-note" style={{ fontFamily: "var(--font-mono)" }}>
              {preview.executable} {preview.args.join(" ")}
            </p>
            <p className="plan-note">
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
                <div className="plan-summary" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
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
            {result?.stderrTail && (
              <pre className="items-path" style={{ whiteSpace: "pre-wrap", maxHeight: 140, overflow: "auto" }}>
                {result.stderrTail}
              </pre>
            )}
            {error && <p className="items-warning">{error}</p>}
          </>
        )}
      </Dialog>
    </div>
  );
};
