import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  History,
  Trash2,
  Terminal,
  TrendingDown,
  FolderTree,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { Dialog } from "@/components/primitives/Dialog";
import { EmptyState } from "@/components/primitives/EmptyState";
import { PageHeader } from "@/components/primitives/PageHeader";
import { useUIText, localizeWarningCode } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { formatBytes, formatSignedBytes } from "@/lib/formatters";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore, HistoryTab } from "@/stores/ui-store";
import { useScanStore } from "@/stores/scan-store";
import { useAppStore } from "@/stores/app-store";
import { maskPath } from "@/lib/format/path";
import { describeError } from "@/lib/errors/user-message";
import { ActionAuditRecord, AuditRecord } from "@/types";
import { getScanHistory, clearScanHistory, ScanHistoryRecord } from "./scan-history";
import "../items/items.css";
import "../shell/shell.css";

function parseTimestamp(value: string): number {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export const HistoryView: React.FC = () => {
  const ui = useUIText();
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [actions, setActions] = useState<ActionAuditRecord[]>([]);
  const [scans, setScans] = useState<ScanHistoryRecord[]>(() => getScanHistory());
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const maskPaths = usePreferencesStore((s) => s.maskPaths);
  const language = usePreferencesStore((s) => s.language);
  const tab = useUiStore((s) => s.historyTab);
  const setTab = useUiStore((s) => s.setHistoryTab);
  const showToast = useUiStore((s) => s.showToast);
  const setView = useAppStore((s) => s.setView);

  // Only the active tab is loaded. Fetching both histories on every visit made
  // the first paint wait on data the user was not looking at.
  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    if (tab === "scans") {
      setScans(getScanHistory());
      setLoading(false);
      return;
    }
    if (tab === "cleanups") {
      scannerApi
        .getCleanupHistory(200)
        .then(setRecords)
        .catch((err) => setError(describeError(err)))
        .finally(() => setLoading(false));
      return;
    }
    scannerApi
      .getOfficialActionHistory(200)
      .then(setActions)
      .catch((err) => setError(describeError(err)))
      .finally(() => setLoading(false));
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const handleClearCurrentTab = async () => {
    setConfirmOpen(false);
    setError(null);
    try {
      if (tab === "cleanups") {
        await scannerApi.clearCleanupsHistory();
        setRecords([]);
        showToast(ui.history.toastCleanupsCleared, "success");
      } else if (tab === "actions") {
        await scannerApi.clearActionsHistory();
        setActions([]);
        showToast(ui.history.toastActionsCleared, "success");
      } else if (tab === "scans") {
        clearScanHistory();
        setScans([]);
        showToast(ui.history.toastScansCleared, "success");
      }
    } catch (err) {
      setError(describeError(err));
    }
  };

  const handleClearAllHistory = async () => {
    setConfirmOpen(false);
    setError(null);
    try {
      await scannerApi.clearCleanupHistory();
      clearScanHistory();
      setRecords([]);
      setActions([]);
      setScans([]);
      showToast(ui.history.toastAllCleared, "success");
    } catch (err) {
      setError(describeError(err));
    }
  };

  const handleRestoreLatestScan = async () => {
    try {
      const snapshot = await scannerApi.getLastScan();
      if (snapshot && snapshot.summary) {
        useScanStore.getState().restoreScan(snapshot);
        showToast(ui.overview.restoreSuccessToast, "success");
        setView("projects");
      } else {
        showToast(ui.overview.noLastScanToast, "error");
      }
    } catch (err) {
      showToast(`${ui.history.loadError}: ${describeError(err)}`, "error");
    }
  };

  const summary = useMemo(() => {
    const reclaimed = records.reduce((total, record) => total + record.reclaimBytes, 0);
    const timestamps = [...records, ...actions].map((entry) => parseTimestamp(entry.timestamp));
    const last = timestamps.length > 0 ? Math.max(...timestamps) : 0;
    return {
      reclaimed,
      runs: records.length + actions.length,
      last: last > 0 ? new Date(last).toLocaleString(language || undefined) : ui.common.none,
    };
  }, [records, actions, ui.common.none]);

  const tabs: Array<{ id: HistoryTab; label: string; icon: React.ReactNode }> = [
    { id: "cleanups", label: ui.history.tabCleanups, icon: <History size={14} /> },
    { id: "actions", label: ui.history.tabActions, icon: <Terminal size={14} /> },
    { id: "scans", label: ui.history.tabScans, icon: <FolderTree size={14} /> },
  ];

  const activeEmpty =
    tab === "cleanups"
      ? ui.history.empty
      : tab === "actions"
        ? ui.history.actionsEmpty
        : ui.history.emptyScans;
  const activeCount =
    tab === "cleanups" ? records.length : tab === "actions" ? actions.length : scans.length;

  const moveTab = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    const target = tabs[next];
    setTab(target.id);
    setExpanded(null);
    document.getElementById(`history-tab-${target.id}`)?.focus();
  };

  return (
    <div className="page-view history-page-view">
      <PageHeader
        title={ui.history.title}
        description={ui.history.subtitle}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={<Trash2 size={13} />}
              onClick={() => setConfirmOpen(true)}
              disabled={
                loading ||
                (tab === "cleanups"
                  ? records.length === 0
                  : tab === "actions"
                    ? actions.length === 0
                    : scans.length === 0)
              }
              title={
                tab === "cleanups"
                  ? ui.history.clearCleanupsTooltip
                  : tab === "actions"
                    ? ui.history.clearActionsTooltip
                    : ui.history.clearScansTooltip
              }
            >
              {tab === "cleanups"
                ? ui.history.clearCleanupsBtn
                : tab === "actions"
                  ? ui.history.clearActionsBtn
                  : ui.history.clearScansBtn}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={13} className={loading ? "spin" : ""} />}
              onClick={load}
              disabled={loading}
            >
              {ui.common.refresh}
            </Button>
          </>
        }
      />

      {/* Shared Bento KPI Strip for History */}
      <div className="nc-bento-strip nc-bento-strip--3">
        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{ui.history.totalReclaimed}</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--success">
              <TrendingDown size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">{formatBytes(summary.reclaimed, language)}</span>
            <span className="nc-kpi-card-sub">{ui.history.totalReclaimed}</span>
          </div>
        </div>

        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{ui.history.totalRuns}</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--accent">
              <History size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">{ui.history.records(summary.runs)}</span>
            <span className="nc-kpi-card-sub">
              {scans.length} {ui.history.tabScans}
            </span>
          </div>
        </div>

        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{ui.history.lastRun}</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--purple">
              <RefreshCw size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value" style={{ fontSize: "var(--text-base)" }}>
              {summary.last}
            </span>
            <span className="nc-kpi-card-sub">{ui.history.lastRun}</span>
          </div>
        </div>
      </div>

      <div className="subpage-toolbar" role="tablist" aria-label={ui.history.title}>
        {tabs.map((item, index) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              id={`history-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="history-panel"
              tabIndex={active ? 0 : -1}
              className={`history-tab ${active ? "active" : ""}`}
              onClick={() => {
                setTab(item.id);
                setExpanded(null);
              }}
              onKeyDown={(event) => moveTab(event, index)}
            >
              {item.icon}
              <span>{item.label}</span>
              <span className="history-tab-count">
                {item.id === "cleanups"
                  ? records.length
                  : item.id === "actions"
                    ? actions.length
                    : scans.length}
              </span>
            </button>
          );
        })}
      </div>

      <p className="plan-note">{ui.history.clearHint}</p>
      {error && (
        <p className="items-warning">
          {ui.history.loadError} {error}
        </p>
      )}

      <div id="history-panel" role="tabpanel" aria-labelledby={`history-tab-${tab}`}>
        {activeCount === 0 ? (
          <div className="history-table-card history-table-card--empty">
            <EmptyState
              live={loading}
              icon={
                tab === "cleanups" ? (
                  <History size={26} />
                ) : tab === "actions" ? (
                  <Terminal size={26} />
                ) : (
                  <FolderTree size={26} />
                )
              }
              title={loading ? ui.common.loading : activeEmpty}
            />
          </div>
        ) : (
          <div className="history-table-card">
            {tab === "cleanups" ? (
              <table className="table-simple">
                <thead>
                  <tr>
                    <th>{ui.history.timestamp}</th>
                    <th>{ui.history.mode}</th>
                    <th className="num">{ui.history.success}</th>
                    <th className="num">{ui.history.errors}</th>
                    <th className="num">{ui.history.moved}</th>
                    <th className="num">{ui.history.reclaim}</th>
                    <th className="num">{ui.history.duration}</th>
                    <th style={{ width: 90, textAlign: "right" }} />
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <React.Fragment key={record.id}>
                      <tr>
                        <td>{new Date(record.timestamp).toLocaleString(language || undefined)}</td>
                        <td>{record.mode === "permanent" ? ui.plan.permanent : ui.plan.trash}</td>
                        <td className="num">{record.successCount}</td>
                        <td className="num">{record.errorCount}</td>
                        <td className="num">{formatBytes(record.movedBytes, language)}</td>
                        <td className="num">{formatBytes(record.reclaimBytes, language)}</td>
                        <td className="num">{record.durationMs} ms</td>
                        <td style={{ textAlign: "right" }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            aria-expanded={expanded === record.id}
                            aria-controls={
                              expanded === record.id ? `history-detail-${record.id}` : undefined
                            }
                            aria-label={`${ui.history.details}: ${new Date(
                              record.timestamp,
                            ).toLocaleString(language || undefined)}`}
                            onClick={() =>
                              setExpanded((prev) => (prev === record.id ? null : record.id))
                            }
                          >
                            {ui.history.details}
                          </button>
                        </td>
                      </tr>
                      {expanded === record.id && (
                        <tr id={`history-detail-${record.id}`}>
                          <td colSpan={8}>
                            <div className="plan-list" style={{ margin: 0 }}>
                              {record.entries.map((entry) => (
                                <div
                                  key={`${record.id}-${entry.targetId}`}
                                  className={`plan-row ${entry.success ? "" : "blocked"}`}
                                >
                                  <div className="plan-row-main">
                                    <strong>{entry.ruleId}</strong>
                                    <span className="items-path">
                                      {maskPaths ? maskPath(entry.path) : entry.path}
                                    </span>
                                  </div>
                                  <div className="plan-row-side">
                                    {entry.success ? (
                                      <span className="items-size">
                                        {formatBytes(entry.bytes, language)}
                                      </span>
                                    ) : (
                                      <span className="items-warning">
                                        {entry.errorCode
                                          ? localizeWarningCode(entry.errorCode, ui)
                                          : ui.errors.unknown}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            ) : tab === "actions" ? (
              <table className="table-simple">
                <thead>
                  <tr>
                    <th>{ui.history.timestamp}</th>
                    <th>{ui.history.actionLabel}</th>
                    <th>{ui.caches.result}</th>
                    <th className="num">{ui.caches.delta}</th>
                    <th className="num">{ui.history.duration}</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.map((action) => (
                    <tr key={action.id}>
                      <td>{new Date(action.timestamp).toLocaleString(language || undefined)}</td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                        {action.label}
                      </td>
                      <td>{action.success ? ui.caches.succeeded : ui.caches.failed}</td>
                      <td className="num">{formatSignedBytes(action.deltaBytes, language)}</td>
                      <td className="num">{action.durationMs} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="table-simple">
                <thead>
                  <tr>
                    <th>{ui.history.timestamp}</th>
                    <th>{ui.history.colScope}</th>
                    <th>{ui.history.colPath}</th>
                    <th className="num">{ui.history.colEntries}</th>
                    <th className="num">{ui.overview.cleanable}</th>
                    <th className="num">{ui.history.duration}</th>
                    <th>{ui.common.scan}</th>
                    <th style={{ width: 180, textAlign: "right" }} />
                  </tr>
                </thead>
                <tbody>
                  {scans.map((scan, index) => (
                    <tr key={scan.id}>
                      <td>{new Date(scan.timestamp).toLocaleString(language || undefined)}</td>
                      <td>
                        <span className="chip">
                          {scan.scope === "project"
                            ? ui.history.scopeProjects
                            : scan.scope === "agents"
                              ? ui.history.scopeAgents
                              : ui.history.scopeAllDrives}
                        </span>
                      </td>
                      <td style={{ maxWidth: 220 }} title={scan.rootPath}>
                        <span className="items-path">
                          {scan.rootPath === "allDrives" || scan.scope === "allDrives"
                            ? ui.common.allDrives
                            : maskPaths
                              ? maskPath(scan.rootPath)
                              : scan.rootPath}
                        </span>
                      </td>
                      <td className="num">{scan.itemCount}</td>
                      <td className="num">{formatBytes(scan.cleanableBytes, language)}</td>
                      <td className="num">{scan.durationMs} ms</td>
                      <td>
                        <span className={`chip ${scan.status === "completed" ? "ok" : "warn"}`}>
                          {scan.status === "completed"
                            ? ui.history.statusCompleted
                            : ui.history.statusCancelled}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {index === 0 ? (
                          <Button
                            variant="primary"
                            size="sm"
                            icon={<RotateCcw size={12} />}
                            onClick={handleRestoreLatestScan}
                            title={ui.history.restoreScanTooltip}
                          >
                            {ui.history.restoreScanBtn}
                          </Button>
                        ) : (
                          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                            {ui.history.prevScan}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <Dialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={
          tab === "cleanups"
            ? ui.history.clearCleanupsTitle
            : tab === "actions"
              ? ui.history.clearActionsTitle
              : ui.history.clearScansTitle
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              {ui.common.cancel}
            </Button>
            <Button
              variant="danger-outline"
              onClick={handleClearAllHistory}
              title={ui.history.clearAllBtn}
            >
              {ui.history.clearAllBtn}
            </Button>
            <Button variant="danger" onClick={handleClearCurrentTab}>
              {ui.history.clearCurrentBtn}
            </Button>
          </>
        }
      >
        <p
          style={{
            margin: 0,
            color: "var(--text-secondary)",
            fontSize: "var(--text-sm)",
            lineHeight: "var(--leading-relaxed)",
          }}
        >
          {tab === "cleanups"
            ? ui.history.clearCleanupsDesc
            : tab === "actions"
              ? ui.history.clearActionsDesc
              : ui.history.clearScansDesc}
        </p>
      </Dialog>
    </div>
  );
};
