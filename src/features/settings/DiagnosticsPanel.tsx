import React, { useCallback, useEffect, useState } from "react";
import { Bug, Copy, RefreshCw, ShieldCheck, Trash2, ExternalLink } from "lucide-react";

import { Button } from "@/components/primitives/Button";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore } from "@/stores/ui-store";
import { useUIText, resolveUiLocale, localizeAppError } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { log } from "@/lib/logging";
import {
  clearErrorLog,
  formatErrorLog,
  readErrorLog,
  type ErrorLogEntry,
} from "@/lib/diagnostics/error-log";
import { buildIssueUrl, formatDiagnosticTime } from "@/lib/diagnostics/issue-url";

interface DiagnosticsPanelProps {
  version: string;
}

/**
 * "Diagnostics" panel for the About page.
 *
 * Shows the local error log. There is no upload path on purpose: the only way
 * this leaves the device is the "Report an issue" button, which opens a
 * pre-filled GitHub issue in the user's browser where they can still edit or
 * discard it.
 */
export const DiagnosticsPanel: React.FC<DiagnosticsPanelProps> = ({ version }) => {
  const ui = useUIText();
  const language = usePreferencesStore((s) => s.language);
  const locale = resolveUiLocale(language);
  const showToast = useUiStore((s) => s.showToast);

  const [entries, setEntries] = useState<ErrorLogEntry[]>([]);

  const refresh = useCallback(() => setEntries(readErrorLog()), []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const copyDetails = async () => {
    const text = formatErrorLog(entries);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        showToast(ui.overview.detailsCopied, "success");
      }
    } catch (err) {
      // A denied clipboard is not worth a dialog; the rows stay on screen.
      log.warn("Could not copy the diagnostics log", err);
    }
  };

  const clear = () => {
    clearErrorLog();
    setEntries([]);
  };

  const report = () => {
    scannerApi.openUrl(buildIssueUrl(entries, version)).catch((err) => {
      log.warn("Could not open the issue form", err);
      showToast(`${ui.errors.title}: ${localizeAppError(err, ui)}`, "error");
    });
  };

  const formatTime = (iso: string) => formatDiagnosticTime(iso, locale);

  return (
    <section className="about-bento-panel about-diagnostics-panel">
      <div className="about-panel-header">
        <div className="about-panel-icon about-panel-icon--warning">
          <Bug size={18} />
        </div>
        <div className="about-panel-title-group">
          <h2 className="about-panel-title">{ui.diagnostics.title}</h2>
          <span className="about-panel-desc">{ui.diagnostics.hint}</span>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="about-trust-strip about-diag-empty">
          <ShieldCheck size={18} className="about-trust-icon" />
          <span>{ui.diagnostics.empty}</span>
        </div>
      ) : (
        <ul className="about-diag-list">
          {entries.map((entry) => (
            <li key={entry.id} className="about-diag-row">
              <div className="about-diag-row-head">
                <span className="about-diag-source">{entry.source}</span>
                <span className="about-diag-time">{formatTime(entry.at)}</span>
              </div>
              <p className="about-diag-message">
                {entry.code && <span className="about-diag-code">{entry.code}</span>}
                {entry.message}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="about-diag-actions">
        <Button size="sm" variant="secondary" icon={<RefreshCw size={13} />} onClick={refresh}>
          {ui.common.refresh}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon={<Copy size={13} />}
          onClick={copyDetails}
          disabled={entries.length === 0}
        >
          {ui.overview.copyDetails}
        </Button>
        <Button size="sm" variant="secondary" icon={<ExternalLink size={13} />} onClick={report}>
          {ui.diagnostics.report}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Trash2 size={13} />}
          onClick={clear}
          disabled={entries.length === 0}
        >
          {ui.common.clear}
        </Button>
      </div>
    </section>
  );
};
