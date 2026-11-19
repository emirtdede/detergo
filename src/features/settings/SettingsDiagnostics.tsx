import React, { useCallback, useEffect, useState } from "react";
import {
  Bug,
  Copy,
  ExternalLink,
  FileArchive,
  Mail,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/primitives/Button";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore } from "@/stores/ui-store";
import { useUIText, resolveUiLocale } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { log } from "@/lib/logging";
import { BUG_REPORT_TEMPLATE, NEW_ISSUE_URL, SUPPORT_EMAIL } from "@/lib/links";
import {
  clearErrorLog,
  formatErrorLog,
  readErrorLog,
  type ErrorLogEntry,
} from "@/lib/diagnostics/error-log";
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

/** The issue body is a URL parameter, so it must stay well under 8 KB. */
const MAX_ISSUE_BODY = 6000;

function buildIssueUrl(entries: readonly ErrorLogEntry[], version: string): string {
  const body = [
    "### What happened",
    "<!-- Describe what you were doing when the problem appeared. -->",
    "",
    "### Environment",
    `- Dev Cleaner: ${version}`,
    `- Platform: ${navigator.platform || "unknown"}`,
    "",
    "### In-app error log",
    "<!-- Written locally by the app. Paths and URLs are already masked. -->",
    "```",
    formatErrorLog(entries).slice(0, MAX_ISSUE_BODY),
    "```",
  ].join("\n");

  const params = new URLSearchParams({
    template: BUG_REPORT_TEMPLATE,
    title: "[Bug] ",
    body,
  });
  return `${NEW_ISSUE_URL}?${params.toString()}`;
}

function formatTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return date.toLocaleString(locale, { dateStyle: "short", timeStyle: "medium" });
  } catch {
    return iso;
  }
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

  const refresh = useCallback(() => {
    setErrors(readErrorLog());
    setSystem(readSystemLog());
  }, []);

  useEffect(() => {
    refresh();
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
      showToast(ui.errors.title, "error");
    });
  };

  const buildBundle = async () => {
    setBusy(true);
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

      const created = await scannerApi.createSupportBundle({
        version,
        locale,
        generatedAt: new Date().toISOString(),
        errorLog: formatErrorLog(errors),
        systemLog: formatSystemLog(system),
        settingsSummary,
        systemInfo,
      });
      setBundle(created);

      const result = await scannerApi.composeSupportMail(created.path, version);
      if (result.mode === "draft") {
        showToast(ui.diagnostics.mailOpened, "success");
      } else if (result.mode === "mailto") {
        showToast(ui.diagnostics.mailFallback, "warning");
      } else {
        showToast(ui.diagnostics.mailFailed, "error");
      }
    } catch (err) {
      log.error("Could not create the support bundle", err);
      showToast(ui.diagnostics.mailFailed, "error");
    } finally {
      setBusy(false);
    }
  };

  const reveal = () => {
    if (!bundle) return;
    scannerApi.openPathInExplorer(bundle.path).catch((err) => {
      log.warn("Could not reveal the support bundle", err);
    });
  };

  return (
    <div className="settings-diagnostics">
      <section className="settings-card">
        <div className="settings-diag-head">
          <span className="settings-diag-icon">
            <Mail size={15} />
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
        <div className="settings-diag-meta">
          <span className="settings-diag-badge">
            <ShieldCheck size={13} />
            {ui.diagnostics.notSent}
          </span>
          <span>{ui.diagnostics.sendTo(SUPPORT_EMAIL)}</span>
        </div>
        {bundle && (
          <p className="settings-diag-bundle">{ui.diagnostics.bundleReady(bundle.path)}</p>
        )}
      </section>

      <section className="settings-card">
        <div className="settings-diag-head">
          <span className="settings-diag-icon settings-diag-icon--warning">
            <Bug size={15} />
          </span>
          <div className="settings-diag-copy">
            <span className="settings-diag-title">{ui.diagnostics.errorsTitle}</span>
            <span className="settings-diag-hint">{ui.diagnostics.hint}</span>
          </div>
        </div>
        <div className="settings-diag-actions">
          <Button size="sm" variant="secondary" icon={<RefreshCw size={13} />} onClick={refresh}>
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
          <Button size="sm" variant="secondary" icon={<ExternalLink size={13} />} onClick={report}>
            {ui.diagnostics.report}
          </Button>
        </div>
        {errors.length === 0 ? (
          <div className="about-trust-strip about-diag-empty">
            <ShieldCheck size={18} className="about-trust-icon" />
            <span>{ui.diagnostics.empty}</span>
          </div>
        ) : (
          <ul className="about-diag-list">
            {errors.map((entry) => (
              <li key={entry.id} className="about-diag-row">
                <div className="about-diag-row-head">
                  <span className="about-diag-source">{entry.source}</span>
                  <span className="about-diag-time">{formatTime(entry.at, locale)}</span>
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

      <section className="settings-card">
        <div className="settings-diag-head">
          <span className="settings-diag-icon">
            <FileArchive size={15} />
          </span>
          <div className="settings-diag-copy">
            <span className="settings-diag-title">{ui.diagnostics.systemTitle}</span>
            <span className="settings-diag-hint">{ui.diagnostics.systemHint}</span>
          </div>
        </div>
        {system.length === 0 ? (
          <div className="about-trust-strip about-diag-empty">
            <ShieldCheck size={18} className="about-trust-icon" />
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
                  <span className="about-diag-time">{formatTime(entry.at, locale)}</span>
                </div>
                <p className="about-diag-message">{entry.message}</p>
              </li>
            ))}
          </ul>
        )}
        <div className="settings-diag-actions">
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
      </section>
    </div>
  );
};
