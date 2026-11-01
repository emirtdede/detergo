import React, { useEffect, useMemo, useState } from "react";
import { RefreshCw, History, Trash2, Terminal, TrendingDown } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { useUIText } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { formatBytes } from "@/lib/formatters";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore, HistoryTab } from "@/stores/ui-store";
import { maskPath } from "@/features/items/ItemTable";
import { ActionAuditRecord, AuditRecord } from "@/types";
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

function parseTimestamp(value: string): number {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export const HistoryView: React.FC = () => {
  const ui = useUIText();
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [actions, setActions] = useState<ActionAuditRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const maskPaths = usePreferencesStore((s) => s.maskPaths);
  const tab = useUiStore((s) => s.historyTab);
  const setTab = useUiStore((s) => s.setHistoryTab);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      scannerApi.getCleanupHistory(200),
      scannerApi.getOfficialActionHistory(200),
    ])
      .then(([nextRecords, nextActions]) => {
        setRecords(nextRecords);
        setActions(nextActions);
      })
      .catch((err) => setError(describeError(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const clearHistory = async () => {
    if (!window.confirm(ui.history.clearConfirm)) return;
    setError(null);
    try {
      await scannerApi.clearCleanupHistory();
      setRecords([]);
      setActions([]);
    } catch (err) {
      setError(describeError(err));
    }
  };

  const summary = useMemo(() => {
    const reclaimed = records.reduce((total, record) => total + record.reclaimBytes, 0);
    const timestamps = [...records, ...actions].map((entry) => parseTimestamp(entry.timestamp));
    const last = timestamps.length > 0 ? Math.max(...timestamps) : 0;
    return {
      reclaimed,
      runs: records.length + actions.length,
      last: last > 0 ? new Date(last).toLocaleString() : ui.common.none,
    };
  }, [records, actions, ui.common.none]);

  const tabs: Array<{ id: HistoryTab; label: string; icon: React.ReactNode }> = [
    { id: "cleanups", label: ui.history.tabCleanups, icon: <History size={14} /> },
    { id: "actions", label: ui.history.tabActions, icon: <Terminal size={14} /> },
  ];

  const activeEmpty = tab === "cleanups" ? ui.history.empty : ui.history.actionsEmpty;
  const activeCount = tab === "cleanups" ? records.length : actions.length;

  return (
    <div className="items-view">
      <header className="view-header">
        <div>
          <h1 className="view-title">{ui.history.title}</h1>
          <p className="view-subtitle">{ui.history.subtitle}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="secondary" size="sm" icon={<Trash2 size={13} />} onClick={clearHistory} disabled={loading}>
            {ui.history.clear}
          </Button>
          <Button variant="secondary" size="sm" icon={<RefreshCw size={13} />} onClick={load} disabled={loading}>
            {ui.common.refresh}
          </Button>
        </div>
      </header>

      <div className="history-summary">
        <div className="history-summary-card">
          <span className="history-summary-label">
            <TrendingDown size={13} /> {ui.history.totalReclaimed}
          </span>
          <strong className="history-summary-value">{formatBytes(summary.reclaimed)}</strong>
        </div>
        <div className="history-summary-card">
          <span className="history-summary-label">{ui.history.totalRuns}</span>
          <strong className="history-summary-value">{summary.runs}</strong>
        </div>
        <div className="history-summary-card">
          <span className="history-summary-label">{ui.history.lastRun}</span>
          <strong className="history-summary-value history-summary-value--text">{summary.last}</strong>
        </div>
      </div>

      <div className="subpage-toolbar" role="tablist" aria-label={ui.history.title}>
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`history-tab ${tab === item.id ? "active" : ""}`}
            onClick={() => {
              setTab(item.id);
              setExpanded(null);
            }}
          >
            {item.icon}
            <span>{item.label}</span>
            <span className="history-tab-count">
              {item.id === "cleanups" ? records.length : actions.length}
            </span>
          </button>
        ))}
      </div>

      <p className="plan-note">{ui.history.clearHint}</p>
      {error && <p className="items-warning">{ui.history.loadError} {error}</p>}

      {activeCount === 0 ? (
        <div className="items-empty">
          {tab === "cleanups" ? (
            <History size={22} style={{ marginBottom: 8 }} />
          ) : (
            <Terminal size={22} style={{ marginBottom: 8 }} />
          )}
          <div>{loading ? ui.common.loading : activeEmpty}</div>
        </div>
      ) : tab === "cleanups" ? (
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
              <th />
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <React.Fragment key={record.id}>
                <tr>
                  <td>{new Date(record.timestamp).toLocaleString()}</td>
                  <td>{record.mode === "permanent" ? ui.plan.permanent : ui.plan.trash}</td>
                  <td className="num">{record.successCount}</td>
                  <td className="num">{record.errorCount}</td>
                  <td className="num">{formatBytes(record.movedBytes)}</td>
                  <td className="num">{formatBytes(record.reclaimBytes)}</td>
                  <td className="num">{record.durationMs} ms</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setExpanded((prev) => (prev === record.id ? null : record.id))}
                    >
                      {ui.history.details}
                    </button>
                  </td>
                </tr>
                {expanded === record.id && (
                  <tr>
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
                                <span className="items-size">{formatBytes(entry.bytes)}</span>
                              ) : (
                                <span className="items-warning">{entry.errorCode}</span>
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
      ) : (
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
                <td>{new Date(action.timestamp).toLocaleString()}</td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{action.label}</td>
                <td>{action.success ? ui.caches.succeeded : ui.caches.failed}</td>
                <td className="num">{formatSignedBytes(action.deltaBytes)}</td>
                <td className="num">{action.durationMs} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
