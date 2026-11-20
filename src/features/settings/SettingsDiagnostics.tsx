import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Bug,
  Copy,
  ExternalLink,
  FileArchive,
  Mail,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/primitives/Button";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore } from "@/stores/ui-store";
import { useUIText, resolveUiLocale, localizeAppError } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { withTimeout } from "@/lib/async/with-timeout";
import { toAppError } from "@/lib/errors/app-error";
import { log } from "@/lib/logging";
import { SUPPORT_EMAIL } from "@/lib/links";
import {
  clearErrorLog,
  formatErrorLog,
  readErrorLog,
  type ErrorLogEntry,
} from "@/lib/diagnostics/error-log";
import { buildIssueUrl, formatDiagnosticTime } from "@/lib/diagnostics/issue-url";
import {
  clearSystemLog,
  formatSystemLog,
  readSystemLog,
  type SystemLogEntry,
} from "@/lib/diagnostics/system-log";
import type { SupportBundle } from "@/types";

interface SettingsDiagnosticsProps {
  version: string;
}

/**
 * Settings > Diagnostics.
 *
 * Two local-only streams are shown: system messages mirrored from the logger and
 * the caught-error ring buffer. The support button zips both plus the backend
 * log, then asks the mail client for a draft addressed to Vellium. Nothing is
 * uploaded by this screen; the user presses Send in their own mail app.
 */
export const SettingsDiagnostics: React.FC<SettingsDiagnosticsProps> = ({ version }) => {
  const ui = useUIText();
  const language = usePreferencesStore((s) => s.language);
  const theme = usePreferencesStore((s) => s.theme);
  const maskPaths = usePreferencesStore((s) => s.maskPaths);
  const historyEnabled = usePreferencesStore((s) => s.historyEnabled);
  const scanProfile = usePreferencesStore((s) => s.scanProfile);
  const locale = resolveUiLocale(language);
  const showToast = useUiStore((s) => s.showToast);

  const [errors, setErrors] = useState<ErrorLogEntry[]>([]);
  const [system, setSystem] = useState<SystemLogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [bundle, setBundle] = useState<SupportBundle | null>(null);
  const unmountedRef = useRef(false);

  const refresh = useCallback(() => {
    setErrors(readErrorLog());
    setSystem(readSystemLog());
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    refresh();
    return () => {
      unmountedRef.current = true;
    };
  }, [refresh]);

  const copy = async (text: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        showToast(ui.overview.detailsCopied, "success");
      }
    } catch (err) {
      log.warn("Could not copy the diagnostics log", err);
    }
  };

  const clear = () => {
    clearErrorLog();
    clearSystemLog();
    setErrors([]);
    setSystem([]);
    showToast(ui.diagnostics.clearAll, "success");
  };

  const report = () => {
    scannerApi.openUrl(buildIssueUrl(errors, version)).catch((err) => {
      log.warn("Could not open the issue form", err);
      showToast(`${ui.errors.title}: ${localizeAppError(err, ui)}`, "error");
    });
  };

  const buildBundle = async () => {
    if (busy) return;
    setBusy(true);
    setBundle(null);
    try {
      const settingsSummary = JSON.stringify(
        { version, locale, theme, scanProfile, maskPaths, historyEnabled },
        null,
        2,
      );
      const systemInfo = [
        `Platform: ${navigator.platform || "unknown"}`,
        `User agent: ${navigator.userAgent}`,
        `Language: ${navigator.language}`,
        `Locale: ${locale}`,
      ].join("\n");

      const created = await withTimeout(
        scannerApi.createSupportBundle({
          version,
          locale,
          generatedAt: new Date().toISOString(),
          errorLog: formatErrorLog(errors),
          systemLog: formatSystemLog(system),
          settingsSummary,
          systemInfo,
        }),
        20_000,
        "createSupportBundle",
      );
      if (unmountedRef.current) return;
      setBundle(created);

      const result = await withTimeout(
        scannerApi.composeSupportMail(created.path, version),
        15_000,
        "composeSupportMail",
      );
      if (unmountedRef.current) return;
      if (result.mode === "draft") {
        showToast(ui.diagnostics.mailOpened, "success");
      } else if (result.mode === "mailto") {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(created.path).catch(() => {});
        }
        showToast(ui.diagnostics.mailFallback, "warning", 7000);
      } else {
        showToast(ui.diagnostics.mailFailed, "error");
      }
    } catch (err) {
      log.error("Could not create the support bundle", err);
      if (!unmountedRef.current) {
        showToast(`${ui.diagnostics.mailFailed}: ${localizeAppError(err, ui)}`, "error", 6000);
      }
    } finally {
      if (!unmountedRef.current) setBusy(false);
    }
  };

  const reveal = () => {
    if (!bundle) return;
    scannerApi.openPathInExplorer(bundle.path).catch((err) => {
      log.warn("Could not reveal the support bundle", err);
      const appErr = toAppError(err);
      // The user deleted or moved the ZIP outside the app: drop the stale
      // bundle card immediately instead of leaving broken Explorer/Copy buttons.
      if (appErr.code === "PathNotFound" || appErr.code === "InvalidPath") {
        setBundle(null);
      }
      showToast(`${ui.errors.title}: ${localizeAppError(appErr, ui)}`, "warning", 6000);
    });
  };

  return (
    <div className="settings-diagnostics">
      <section className="settings-card settings-diag-support-card">
        <div className="settings-diag-header">
          <div className="settings-diag-head">
            <span className="settings-diag-icon" aria-hidden="true">
              <Mail size={16} />
            </span>
            <div className="settings-diag-copy">
              <span className="settings-diag-title">{ui.diagnostics.supportTitle}</span>
              <span className="settings-diag-hint">{ui.diagnostics.supportHint}</span>
            </div>
          </div>

          <div className="settings-diag-actions">
            <Button
              variant="primary"
              size="sm"
              icon={<FileArchive size={14} />}
              onClick={() => void buildBundle()}
              disabled={busy}
            >
              {busy ? ui.diagnostics.creating : ui.diagnostics.createBundle}
            </Button>
            {bundle && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<ExternalLink size={13} />}
                  onClick={reveal}
                >
                  {ui.diagnostics.reveal}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Copy size={13} />}
                  onClick={() => void copy(bundle.path)}
                >
                  {ui.diagnostics.copyPath}
                </Button>
              </>
            )}
          </div>
        </div>

        {bundle && (
          <div className="settings-diag-bundle">
            <span>{ui.diagnostics.bundleReady(bundle.path)}</span>
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              aria-label={ui.common.close}
              onClick={() => setBundle(null)}
            >
              <X size={13} />
            </button>
          </div>
        )}

        <div className="settings-diag-meta">
          <span className="settings-diag-badge">
            <ShieldCheck size={13} />
            {ui.diagnostics.notSent}
          </span>
          <span className="settings-diag-recipient">{ui.diagnostics.sendTo(SUPPORT_EMAIL)}</span>
        </div>
      </section>

      <div className="settings-diag-grid">
        <section className="settings-card settings-diag-stream-card">
          <div className="settings-diag-header">
            <div className="settings-diag-head">
              <span className="settings-diag-icon settings-diag-icon--warning" aria-hidden="true">
                <Bug size={16} />
              </span>
              <div className="settings-diag-copy">
                <span className="settings-diag-title-row">
                  <span className="settings-diag-title">{ui.diagnostics.errorsTitle}</span>
                  <span className="settings-diag-count">{errors.length}</span>
                </span>
                <span className="settings-diag-hint">{ui.diagnostics.hint}</span>
              </div>
            </div>

            <div className="settings-diag-actions">
              <Button
                size="sm"
                variant="secondary"
                icon={<RefreshCw size={13} />}
                onClick={refresh}
              >
                {ui.common.refresh}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<Copy size={13} />}
                onClick={() => void copy(formatErrorLog(errors))}
                disabled={errors.length === 0}
              >
                {ui.diagnostics.copyAll}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<ExternalLink size={13} />}
                onClick={report}
              >
                {ui.diagnostics.report}
              </Button>
            </div>
          </div>

          {errors.length === 0 ? (
            <div className="settings-diag-empty">
              <span className="settings-diag-empty-icon" aria-hidden="true">
                <ShieldCheck size={18} />
              </span>
              <span>{ui.diagnostics.empty}</span>
            </div>
          ) : (
            <ul className="about-diag-list">
              {errors.map((entry) => (
                <li key={entry.id} className="about-diag-row">
                  <div className="about-diag-row-head">
                    <span className="about-diag-source">{entry.source}</span>
                    <span className="about-diag-time">
                      {formatDiagnosticTime(entry.at, locale)}
                    </span>
                  </div>
                  <p className="about-diag-message">
                    {entry.code && <span className="about-diag-code">{entry.code}</span>}
                    {entry.message}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="settings-card settings-diag-stream-card">
          <div className="settings-diag-header">
            <div className="settings-diag-head">
              <span className="settings-diag-icon" aria-hidden="true">
                <FileArchive size={16} />
              </span>
              <div className="settings-diag-copy">
                <span className="settings-diag-title-row">
                  <span className="settings-diag-title">{ui.diagnostics.systemTitle}</span>
                  <span className="settings-diag-count">{system.length}</span>
                </span>
                <span className="settings-diag-hint">{ui.diagnostics.systemHint}</span>
              </div>
            </div>

            <div className="settings-diag-actions">
              <Button
                size="sm"
                variant="secondary"
                icon={<RefreshCw size={13} />}
                onClick={refresh}
              >
                {ui.common.refresh}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 size={13} />}
                onClick={clear}
                disabled={errors.length === 0 && system.length === 0}
              >
                {ui.diagnostics.clearAll}
              </Button>
            </div>
          </div>

          {system.length === 0 ? (
            <div className="settings-diag-empty">
              <span className="settings-diag-empty-icon" aria-hidden="true">
                <ShieldCheck size={18} />
              </span>
              <span>{ui.diagnostics.noSystem}</span>
            </div>
          ) : (
            <ul className="about-diag-list">
              {system.map((entry) => (
                <li key={entry.id} className="about-diag-row">
                  <div className="about-diag-row-head">
                    <span className={`about-diag-source settings-diag-level--${entry.level}`}>
                      {entry.level}
                    </span>
                    <span className="about-diag-time">
                      {formatDiagnosticTime(entry.at, locale)}
                    </span>
                  </div>
                  <p className="about-diag-message">{entry.message}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};
