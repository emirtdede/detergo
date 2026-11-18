import React, { useEffect, useMemo, useRef, useState } from "react";

import { Gauge, Package, RefreshCw, Square, Terminal, Check, X, Loader2 } from "lucide-react";

import { Button } from "@/components/primitives/Button";

import { Dialog } from "@/components/primitives/Dialog";

import { EmptyState } from "@/components/primitives/EmptyState";

import { PageHeader } from "@/components/primitives/PageHeader";

import {
  useUIText,
  localizeBackendNote,
  localizeActionDescription,
  localizeUnavailableReason,
  localizeAppError,
} from "@/lib/ui-text";

import { translateBackendText } from "@/lib/ui-text/backend-i18n";

import { scannerApi } from "@/lib/tauri/scanner-api";

import { formatBytes, formatSignedBytes } from "@/lib/formatters";

import { usePreferencesStore } from "@/stores/preferences-store";

import { AppErrorDto, OfficialActionPreview, OfficialActionResult } from "@/types";

import { useCacheStore } from "@/stores/cache-store";

import { maskPath } from "@/lib/format/path";
import { toAppError } from "@/lib/errors/app-error";
import { log } from "@/lib/logging";

import "../items/items.css";

import "../shell/shell.css";

export const CachesView: React.FC = () => {
  const ui = useUIText();

  const language = usePreferencesStore((s) => s.language);

  const [preview, setPreview] = useState<OfficialActionPreview | null>(null);

  const [result, setResult] = useState<OfficialActionResult | null>(null);

  const [running, setRunning] = useState(false);

  // Previewing measures the real cache before opening the dialog. On large
  // caches that takes a moment, so the action must report that it is busy
  // instead of appearing to do nothing.
  const [previewLoading, setPreviewLoading] = useState(false);

  const previewRequestRef = useRef(0);

  const [error, setError] = useState<AppErrorDto | null>(null);

  // A failed execute still consumed the single-use confirmation token. Keeping
  // the dialog open (so the error stays visible next to the command) must not
  // offer a "Run" button whose token the backend already discarded.
  const [tokenConsumed, setTokenConsumed] = useState(false);

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

  const load = () => loadProviders(true);

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
  }, [loaded, measureMode, providers, startMeasure]);

  const previewAction = useMemo(
    () =>
      preview
        ? providers
            .find((p) => p.id === preview.providerId)
            ?.actions.find((a) => a.id === preview.actionId)
        : null,
    [preview, providers],
  );

  const openPreview = async (providerId: string, actionId: string) => {
    setError(null);
    setTokenConsumed(false);

    setResult(null);
    setPreviewLoading(true);

    // Preview measurement can still take several seconds on huge caches. The
    // request generation lets "Cancel" drop a late result instead of opening a
    // dialog the user already dismissed.
    const request = previewRequestRef.current + 1;
    previewRequestRef.current = request;

    try {
      const next = await scannerApi.previewOfficialAction(providerId, actionId);

      if (request !== previewRequestRef.current) return;
      setPreview(next);
    } catch (err) {
      if (request !== previewRequestRef.current) return;
      setError(toAppError(err));
    } finally {
      if (request === previewRequestRef.current) setPreviewLoading(false);
    }
  };

  const cancelPreview = () => {
    previewRequestRef.current += 1;
    setPreviewLoading(false);
    setError(null);
    // Drop the late result locally *and* stop the backend walk; without the
    // command "Cancel" only hid the spinner while the disk kept being read.
    void scannerApi.cancelCachePreview().catch((err) => {
      log.warn("Could not cancel the cache preview measurement", err);
    });
  };

  const runAction = async () => {
    // A confirmation token is single-use. Once an attempt has been made, the

    // user must reopen the preview to run the command again.

    if (!preview || running || result !== null || tokenConsumed) return;

    const providerId = preview.providerId;

    setRunning(true);

    setError(null);

    try {
      const next = await scannerApi.executeOfficialAction(preview.token);

      setResult(next);

      // Refresh provider metadata, then re-measure only the provider the
      // action touched. A full re-measure made every other size on the page
      // disappear and forced the user to wait for caches they did not clean.
      await load();

      void startMeasure([providerId]);
    } catch (err) {
      setError(toAppError(err));

      // The token was consumed by the backend even though the command failed.
      // Keep the preview and its error on screen instead of closing the dialog,
      // but disable the action so it cannot be retried with a dead token.
      setTokenConsumed(true);
    } finally {
      setRunning(false);
    }
  };

  const closePreview = () => {
    setPreview(null);

    setResult(null);

    setError(null);

    setTokenConsumed(false);
  };

  const cacheTotals = useMemo(() => {
    const totalBytes = providers.reduce((acc, p) => acc + (p.totalBytes || 0), 0);

    const measuredCount = providers.filter((p) => p.measured).length;

    // The KPI must describe the same set the action buttons can actually run:
    // counting unavailable actions advertised work the UI could not perform.
    const actionsCount = providers.reduce(
      (acc, p) => acc + p.actions.filter((action) => action.available).length,
      0,
    );

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
            {previewLoading && (
              <Button
                variant="danger-outline"
                size="sm"
                icon={<Square size={11} fill="currentColor" />}
                onClick={cancelPreview}
              >
                {ui.common.cancel}
              </Button>
            )}

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
                ? formatBytes(cacheTotals.totalBytes, language)
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

            <span className="nc-kpi-card-sub">{ui.about.ruleCaches}</span>
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

      {loadError && (
        <p className="items-warning">
          {ui.caches.loadError} {localizeAppError(loadError, ui)}
        </p>
      )}

      {measureError && (
        <p className="items-warning">
          {ui.caches.measure}: {localizeAppError(measureError, ui)}
        </p>
      )}

      {previewLoading && (
        <p className="plan-note" aria-live="polite">
          {ui.common.loading}
        </p>
      )}

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

              <span className="provider-card-name">{translateBackendText(provider.name)}</span>

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
                    ? `· ${formatBytes(path.bytes, language)}`
                    : path.exists && path.unmeasuredReason
                      ? `· ${
                          path.unmeasuredReason === "readOnly"
                            ? ui.caches.readOnly
                            : ui.caches.notMeasured
                        }`
                      : ""}
                </span>
              ))}
            </div>

            <div className="form-row provider-card-size-row">
              <span>{ui.table.size}</span>

              {provider.measured ? (
                <strong className="provider-card-size">
                  {formatBytes(provider.totalBytes, language)}
                </strong>
              ) : (
                <span className="chip">{ui.caches.notMeasured}</span>
              )}
            </div>

            <div className="provider-card-footer">
              {provider.note && (
                <p className="plan-note provider-card-note">
                  {localizeBackendNote(provider.note, ui)}
                </p>
              )}

              {provider.actions.length > 0 && (
                <div className="provider-actions">
                  {provider.actions.map((action) => (
                    <Button
                      key={action.id}
                      variant="secondary"
                      size="sm"
                      icon={<Terminal size={12} />}
                      disabled={!action.available || previewLoading}
                      title={
                        action.available
                          ? localizeActionDescription(action.id || action.description, ui)
                          : localizeUnavailableReason(action.unavailableReason)
                      }
                      onClick={() => openPreview(provider.id, action.id)}
                    >
                      {translateBackendText(action.label)}
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

            <Button
              variant="primary"
              size="sm"
              onClick={runAction}
              disabled={running || result !== null || tokenConsumed}
            >
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

                <strong>{formatBytes(preview.beforeBytes, language)}</strong>
              </div>

              <div>
                <span>{ui.caches.executable}</span>

                <strong style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                  {preview.executable}
                </strong>
              </div>
            </div>

            {/* Dev Terminal Console */}

            <div className="cache-terminal">
              <div className="cache-terminal-header">
                <div className="cache-terminal-title">
                  <Terminal size={12} className="cache-terminal-icon" />

                  <span>{ui.caches.terminalTitle}</span>
                </div>

                <div className="cache-terminal-status">
                  {result ? (
                    result.success ? (
                      <Check size={12} className="cache-terminal-success" />
                    ) : (
                      <X size={12} className="cache-terminal-error" />
                    )
                  ) : running ? (
                    <Loader2 size={12} className="cache-terminal-cyan spin" />
                  ) : null}
                  <span>
                    {result
                      ? result.success
                        ? ui.caches.terminalCompleted
                        : ui.caches.terminalError
                      : running
                        ? ui.caches.terminalRunning
                        : ui.caches.terminalReady}
                  </span>
                </div>
              </div>

              <div className="cache-terminal-body">
                <div className="cache-terminal-command">
                  <span className="cache-terminal-prompt">$</span> {preview.executable}{" "}
                  {preview.args.join(" ")}
                </div>

                {running && (
                  <div className="cache-terminal-running">{ui.caches.terminalBackground}</div>
                )}

                {result?.stdoutTail && (
                  <pre className="cache-terminal-stdout">{result.stdoutTail}</pre>
                )}

                {result?.stderrTail && (
                  <pre className="cache-terminal-stderr">{result.stderrTail}</pre>
                )}

                {result && (
                  <div
                    className={`cache-terminal-result ${
                      result.success ? "is-success" : "is-error"
                    }`}
                  >
                    {ui.caches.terminalFinished(result.durationMs, result.exitCode ?? 0)}
                  </div>
                )}
              </div>
            </div>

            {previewAction && (
              <p className="plan-note" style={{ marginTop: 12 }}>
                <strong>{ui.caches.warning}: </strong>

                {translateBackendText(previewAction.impact)}
              </p>
            )}

            {preview.measurementTruncated && (
              <p className="items-warning">{ui.errors.notMeasured}</p>
            )}

            {providers

              .find((p) => p.id === preview.providerId)

              ?.actions.find((a) => a.id === preview.actionId)?.requiresNetwork && (
              <p className="items-warning">{ui.caches.networkWarning}</p>
            )}

            {result && (
              <>
                <div
                  className="plan-summary"
                  style={{ gridTemplateColumns: "1fr 1fr 1fr", marginTop: 10 }}
                >
                  <div>
                    <span>{ui.caches.result}</span>

                    <strong>{result.success ? ui.caches.succeeded : ui.caches.failed}</strong>
                  </div>

                  <div>
                    <span>{ui.caches.after}</span>

                    <strong>{formatBytes(result.afterBytes, language)}</strong>
                  </div>

                  <div>
                    <span>{ui.caches.delta}</span>

                    <strong>{formatSignedBytes(result.deltaBytes, language)}</strong>
                  </div>
                </div>

                {!result.success && (
                  <p className="items-warning">
                    {ui.caches.exitCode}: {result.exitCode ?? "?"}
                  </p>
                )}

                {result.auditError && <p className="items-warning">{ui.caches.auditError}</p>}

                {result.measurementTruncated && (
                  <p className="items-warning">
                    {ui.caches.delta}: {ui.caches.notMeasured}
                  </p>
                )}
              </>
            )}

            {error && <p className="items-warning">{localizeAppError(error, ui)}</p>}
          </>
        )}
      </Dialog>
    </div>
  );
};
