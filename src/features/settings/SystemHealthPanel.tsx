import React, { useEffect, useMemo, useState } from "react";
import { Activity, ShieldAlert, ShieldCheck } from "lucide-react";

import { usePreferencesStore } from "@/stores/preferences-store";
import { useUIText, resolveUiLocale } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { readScanHistory, ScanHistoryStatus } from "@/features/history/scan-history";
import { formatBytes } from "@/lib/formatters";
import type { CleanupTotals } from "@/types";

interface HealthState {
  totals: CleanupTotals | null;
  lastScanAt: string | null;
  historyStatus: ScanHistoryStatus;
  historyCount: number;
}

/**
 * "System health" panel for the About page.
 *
 * Everything shown is already produced by an existing command, so this adds no
 * IPC surface: the audit totals come from `getCleanupTotals`, the last-scan age
 * from `getLastScan`, and the local scan-history store is read through the same
 * `readScanHistory` the history view uses (which reports `corrupt` and
 * `unavailable` instead of pretending the list is empty).
 *
 * The purpose is support triage: a user reporting "my history disappeared" can
 * now see whether the store is healthy, whether settings had to be recovered
 * from a corrupt file, and how old the last snapshot is, without attaching logs.
 */
export const SystemHealthPanel: React.FC = () => {
  const ui = useUIText();
  const language = usePreferencesStore((s) => s.language);
  const recoveredFromCorrupt = usePreferencesStore((s) => s.recoveredFromCorrupt);
  const historyEnabled = usePreferencesStore((s) => s.historyEnabled);
  const maskPaths = usePreferencesStore((s) => s.maskPaths);
  const locale = resolveUiLocale(language);

  const [state, setState] = useState<HealthState | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      // Each source fails independently: a broken audit database must not blank
      // the last-scan row, which is the whole point of a diagnostics panel.
      const [totals, lastScan] = await Promise.all([
        scannerApi.getCleanupTotals().catch(() => null),
        scannerApi.getLastScan().catch(() => null),
      ]);
      const history = readScanHistory();
      if (!alive) return;
      setState({
        totals,
        lastScanAt: lastScan?.savedAt ?? null,
        historyStatus: history.status,
        historyCount: history.records.length,
      });
    })();
    return () => {
      alive = false;
    };
  }, []);

  const formattedLastScan = useMemo(() => {
    if (!state?.lastScanAt) return null;
    const date = new Date(state.lastScanAt);
    if (Number.isNaN(date.getTime())) return null;
    try {
      return date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
    } catch {
      return date.toISOString();
    }
  }, [state?.lastScanAt, locale]);

  const storeHealthy =
    state !== null && state.historyStatus !== "corrupt" && state.historyStatus !== "unavailable";
  const onOff = (value: boolean) => (value ? ui.common.on : ui.common.off);

  return (
    <section className="about-bento-panel about-health-panel">
      <div className="about-panel-header">
        <div className="about-panel-icon about-panel-icon--success">
          <Activity size={18} />
        </div>
        <div className="about-panel-title-group">
          <h2 className="about-panel-title">{ui.history.title}</h2>
          <span className="about-panel-desc">{ui.history.subtitle}</span>
        </div>
      </div>

      <div className="about-meta-list">
        <div className="about-meta-row">
          <span className="about-meta-label">{ui.history.totalRuns}</span>
          <span className="about-meta-value">
            {state ? (state.totals?.runs ?? 0).toLocaleString(locale) : "—"}
          </span>
        </div>
        <div className="about-meta-row">
          <span className="about-meta-label">{ui.history.errors}</span>
          <span className="about-meta-value">
            {state ? (state.totals?.errorCount ?? 0).toLocaleString(locale) : "—"}
          </span>
        </div>
        <div className="about-meta-row">
          <span className="about-meta-label">{ui.history.totalReclaimed}</span>
          <span className="about-meta-value">
            {state ? formatBytes(state.totals?.reclaimedBytes ?? 0, locale) : "—"}
          </span>
        </div>
        <div className="about-meta-row">
          <span className="about-meta-label">{ui.stale.bannerTitle}</span>
          <span className="about-meta-value">
            {formattedLastScan ?? (state ? ui.common.none : "—")}
          </span>
        </div>
        <div className="about-meta-row">
          <span className="about-meta-label">{ui.settings.historyEnabled}</span>
          <span className="about-meta-value">{onOff(historyEnabled)}</span>
        </div>
        <div className="about-meta-row">
          <span className="about-meta-label">{ui.settings.maskPaths}</span>
          <span className="about-meta-value">{onOff(maskPaths)}</span>
        </div>
      </div>

      {/* A single status line: the first problem found wins, because the panel
          has no room for a list and the user only needs the actionable one. */}
      {state !== null && !storeHealthy && (
        <p className="items-warning" role="status">
          <ShieldAlert size={13} aria-hidden="true" /> {ui.history.loadError}
        </p>
      )}
      {recoveredFromCorrupt && (
        <p className="items-warning" role="status">
          <ShieldAlert size={13} aria-hidden="true" /> {ui.errors.settingsReadFailed}
        </p>
      )}
      {state !== null && storeHealthy && !recoveredFromCorrupt && (
        <div className="about-trust-strip">
          <ShieldCheck size={18} className="about-trust-icon" />
          <span>{ui.about.safetyActive}</span>
        </div>
      )}
    </section>
  );
};
