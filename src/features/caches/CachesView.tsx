import React, { useEffect, useState } from "react";
import { Package, RefreshCw, Terminal } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { Dialog } from "@/components/primitives/Dialog";
import { useUIText } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { formatBytes } from "@/lib/formatters";
import { CacheProviderInfo, OfficialActionPreview, OfficialActionResult } from "@/types";
import { usePreferencesStore } from "@/stores/preferences-store";
import { maskPath } from "@/features/items/ItemTable";
import "../items/items.css";
import "../shell/shell.css";

function describeError(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: string }).message);
  }
  return String(err);
}

function formatSignedBytes(bytes: number): string {
  if (bytes === 0) return formatBytes(0);
  return `${bytes > 0 ? "+" : "−"}${formatBytes(Math.abs(bytes))}`;
}

export const CachesView: React.FC = () => {
  const ui = useUIText();
  const [providers, setProviders] = useState<CacheProviderInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [preview, setPreview] = useState<OfficialActionPreview | null>(null);
  const [result, setResult] = useState<OfficialActionResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const maskPaths = usePreferencesStore((s) => s.maskPaths);

  const load = () => {
    setLoading(true);
    setLoadError(null);
    scannerApi
      .getGlobalCacheProviders()
      .then((next) => {
        setProviders(next);
        setLoaded(true);
      })
      .catch((err) => setLoadError(describeError(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

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

  return (
    <div className="items-view">
      <header className="view-header">
        <div>
          <h1 className="view-title">{ui.caches.title}</h1>
          <p className="view-subtitle">{ui.caches.subtitle}</p>
        </div>
        <Button variant="secondary" size="sm" icon={<RefreshCw size={13} />} onClick={load} disabled={loading}>
          {ui.caches.refresh}
        </Button>
      </header>

      {loadError && <p className="items-warning">{ui.caches.loadError} {loadError}</p>}

      <div className="provider-grid">
        {providers.map((provider) => (
          <article key={provider.id} className="provider-card">
            <h3>
              <Package size={14} /> {provider.name}
              {provider.version && <span className="chip">{provider.version}</span>}
              {provider.readOnly && <span className="chip">{ui.caches.readOnly}</span>}
              {!provider.detected && <span className="chip">{ui.caches.notFound}</span>}
            </h3>
            <div className="provider-paths">
              {provider.cachePaths.map((path) => (
                <span key={path.path}>
                  {maskPaths ? maskPath(path.path) : path.path}{" "}
                  {path.exists && path.bytes !== null ? `· ${formatBytes(path.bytes)}` : ""}
                </span>
              ))}
            </div>
            <div className="form-row">
              <span>{ui.table.size}</span>
              <strong>{formatBytes(provider.totalBytes)}</strong>
            </div>
            {provider.note && <p className="plan-note">{provider.note}</p>}
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
              {provider.actions.length === 0 && <span className="chip">{ui.caches.readOnly}</span>}
            </div>
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
