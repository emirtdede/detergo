import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useUIText, localizeWarningCode, localizeStopReason } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { formatBytes, formatSignedBytes } from "@/lib/formatters";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore, HistoryTab } from "@/stores/ui-store";
import { useScanStore, clearPersistedLastScan, viewForScanScope } from "@/stores/scan-store";
import { useAppStore } from "@/stores/app-store";
import { maskPath } from "@/lib/format/path";
import { formatSavedAt, latestTimestampMs } from "@/lib/format/date";
import { describeError } from "@/lib/errors/user-message";
import { lifetimeCleanedBytes } from "@/lib/cleanup-totals";
import { ActionAuditRecord, AuditRecord, CleanupTotals } from "@/types";
import {
  readScanHistory,
  clearScanHistory,
  isScanHistoryStorageKey,
  ScanHistoryRecord,
  ScanHistoryStatus,
  SCAN_HISTORY_CHANGED_EVENT,
} from "./scan-history";
import "../items/items.css";
import "../shell/shell.css";

export const HistoryView: React.FC = () => {
  const ui = useUIText();
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [actions, setActions] = useState<ActionAuditRecord[]>([]);
  // Reading localStorage in a state initializer ran JSON parsing and 50 record
  // validations on the render path, then `load()` repeated the same work. The
  // first load inside `load()` is enough.
  const [scans, setScans] = useState<ScanHistoryRecord[]>([]);
  // Distinguishes "nothing recorded yet" from "the stored file is broken".
  const [scanHistoryStatus, setScanHistoryStatus] = useState<ScanHistoryStatus>("empty");
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cleanupTotals, setCleanupTotals] = useState<CleanupTotals | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  // The restore button is only meaningful when the backend actually has a
  // snapshot. Rendering it unconditionally offered an action that always ended
  // in the "no last scan" error toast.
  const [hasLastSnapshot, setHasLastSnapshot] = useState(false);
  const maskPaths = usePreferencesStore((s) => s.maskPaths);
  const language = usePreferencesStore((s) => s.language);
  const tab = useUiStore((s) => s.historyTab);
  const setTab = useUiStore((s) => s.setHistoryTab);
  const showToast = useUiStore((s) => s.showToast);
  const setView = useAppStore((s) => s.setView);
  // Persisted-scan signals: a finished scan bumps `lastSavedAt`, while clearing
  // the snapshot elsewhere bumps `persistedRevision`. Both must refresh this
  // view even when it already mounted.
  const lastSavedAt = useScanStore((s) => s.lastSavedAt);
  const persistedRevision = useScanStore((s) => s.persistedRevision);

  // All three histories load together: the KPI strip summarises lifetime
  // activity, so scoping the fetch to the active tab made the cards change
  // meaning (and jump) just because the user switched tabs.
  //
  // Two quick refreshes must not interleave: the generation drops a response
  // whose request was superseded, and the unmount flag keeps a late response
  // from writing into a detached component.
  const loadGenerationRef = useRef(0);
  const unmountedRef = useRef(false);

  const load = useCallback(() => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    const current = () => generation === loadGenerationRef.current && !unmountedRef.current;

    setLoading(true);
    setError(null);
    const scanHistory = readScanHistory();
    setScans(scanHistory.records);
    setScanHistoryStatus(scanHistory.status);
    return Promise.all([
      scannerApi.getCleanupHistory(200),
      scannerApi.getOfficialActionHistory(200),
      // The lifetime card must reflect the whole history file, not the capped
      // page the table displays. Fetching it with the page keeps the two in
      // sync; a separate effect keyed on `records` fired a second IPC on every
      // refresh and could leave totals from an older file on screen.
      scannerApi.getCleanupTotals().catch(() => null),
    ])
      .then(([nextRecords, nextActions, nextTotals]) => {
        if (!current()) return;
        setRecords(nextRecords);
        setActions(nextActions);
        setCleanupTotals(nextTotals);
      })
      .catch((err) => {
        if (current()) setError(describeError(err));
      })
      .finally(() => {
        if (current()) setLoading(false);
      });
  }, []);

  useEffect(() => {
    unmountedRef.current = false;
    void load();
    return () => {
      unmountedRef.current = true;
      loadGenerationRef.current += 1;
    };
  }, [load]);

  const refreshScans = useCallback(() => {
    const scanHistory = readScanHistory();
    setScans(scanHistory.records);
    setScanHistoryStatus(scanHistory.status);
  }, []);

  // The `storage` event never fires in the window that wrote the value, so the
  // same-tab `CustomEvent` is what keeps this view live after a scan finishes
  // or another view clears the history/snapshot.
  useEffect(() => {
    const handleSameTabChange = () => refreshScans();
    const handleStorage = (event: StorageEvent) => {
      if (isScanHistoryStorageKey(event.key)) refreshScans();
    };
    window.addEventListener(SCAN_HISTORY_CHANGED_EVENT, handleSameTabChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(SCAN_HISTORY_CHANGED_EVENT, handleSameTabChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, [refreshScans]);

  useEffect(() => {
    refreshScans();
  }, [lastSavedAt, persistedRevision, refreshScans]);

  // Re-checked whenever the scan list changes: clearing the scan history also
  // deletes the persisted snapshot.
  useEffect(() => {
    let cancelled = false;
    scannerApi
      .getLastScan()
      .then((snapshot) => {
        if (!cancelled) setHasLastSnapshot(Boolean(snapshot && snapshot.summary));
      })
      .catch(() => {
        if (!cancelled) setHasLastSnapshot(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scans, persistedRevision]);

  const handleClearCurrentTab = async () => {
    setConfirmOpen(false);
    setError(null);
    // Invalidate any in-flight `load` and hold the refresh lock for the whole
    // clear: a Refresh clicked during the IPC used to resolve afterwards and
    // repaint records the backend had just deleted.
    loadGenerationRef.current += 1;
    setLoading(true);
    try {
      if (tab === "cleanups") {
        await scannerApi.clearCleanupsHistory();
        setRecords([]);
        setCleanupTotals(null);
        showToast(ui.history.toastCleanupsCleared, "success");
      } else if (tab === "actions") {
        await scannerApi.clearActionsHistory();
        setActions([]);
        setCleanupTotals(null);
        showToast(ui.history.toastActionsCleared, "success");
      } else if (tab === "scans") {
        const localCleared = clearScanHistory();
        // The persisted snapshot is the "last scan" the History page restores
        // from; clearing the list without it left a restorable scan behind and
        // re-enabled the Restore button after a reload.
        const snapshotCleared = await clearPersistedLastScan();
        if (!localCleared || !snapshotCleared) {
          // Do not empty the UI and announce success: both stores still hold
          // the data, and a reload would bring it back.
          setError(ui.history.errors);
          return;
        }
        setScans([]);
        setScanHistoryStatus("empty");
        setHasLastSnapshot(false);
        showToast(ui.history.toastScansCleared, "success");
      }
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleClearAllHistory = async () => {
    setConfirmOpen(false);
    setError(null);
    loadGenerationRef.current += 1;
    setLoading(true);
    try {
      // `clearCleanupHistory` maps to Rust `clear_all_history`, which removes
      // the cleanup records, storage snapshots and official-action records.
      await scannerApi.clearCleanupHistory();
      const localCleared = clearScanHistory();
      // The persisted last-scan snapshot is user-visible data too; leaving it
      // behind made "Clear all history" look like a no-op after a restart.
      const snapshotCleared = await clearPersistedLastScan();
      if (!localCleared || !snapshotCleared) {
        setError(ui.history.errors);
        return;
      }
      setRecords([]);
      setActions([]);
      setScans([]);
      setScanHistoryStatus("empty");
      setHasLastSnapshot(false);
      setCleanupTotals(null);
      showToast(ui.history.toastAllCleared, "success");
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreLatestScan = async () => {
    try {
      const snapshot = await scannerApi.getLastScan();
      if (snapshot && useScanStore.getState().restoreScan(snapshot)) {
        showToast(ui.overview.restoreSuccessToast, "success");
        // An agent-scope snapshot has no project rows; route to the view that
        // can actually show the restored data.
        setView(viewForScanScope(snapshot.summary.scope));
      } else {
        setHasLastSnapshot(false);
        showToast(ui.overview.noLastScanToast, "error");
      }
    } catch (err) {
      showToast(`${ui.history.loadError}: ${describeError(err)}`, "error");
    }
  };

  const summary = useMemo(() => {
    // Fall back to the loaded page when the backend totals are unavailable
    // (e.g. outside Tauri), but prefer the full-file numbers.
    const pageMoved = records.reduce((total, record) => total + record.movedBytes, 0);
    const pageReclaimed = records.reduce((total, record) => total + record.reclaimBytes, 0);
    const moved = cleanupTotals?.movedBytes ?? pageMoved;
    const reclaimed = cleanupTotals?.reclaimedBytes ?? pageReclaimed;
    // Which history produced the newest entry? The card's subtitle used to
    // repeat its own title ("Last operation · Last operation"); the kind is the
    // information that is actually missing there.
    const candidates: Array<{ kind: HistoryTab; at: number }> = [
      { kind: "cleanups", at: latestTimestampMs(records) },
      { kind: "actions", at: latestTimestampMs(actions) },
      { kind: "scans", at: latestTimestampMs(scans) },
    ];
    const newest = candidates.reduce(
      (best, candidate) => (candidate.at > best.at ? candidate : best),
      { kind: null as HistoryTab | null, at: 0 },
    );
    // The newest entry across all three lists. This used to be
    // `Math.max(...timestamps)` after building a combined array: that allocated
    // twice and spread every record as a function argument, which throws a
    // RangeError past the engine's argument limit. The candidate reduce already
    // carries the same maximum.
    const last = newest.at;
    return {
      lastKind: newest.at > 0 ? newest.kind : null,
      // `movedBytes` already covers both modes (Recycle Bin and permanent);
      // `reclaimedBytes` only covers permanent deletes. Keep the two figures
      // distinct instead of presenting the recycle-bin total as "reclaimed"
      // space, which is not free until the bin is emptied. Old records without
      // `movedBytes` fall back to `reclaimedBytes`.
      cleaned: lifetimeCleanedBytes(moved, reclaimed),
      permanent: reclaimed,
      runs: cleanupTotals
        ? cleanupTotals.runs + cleanupTotals.actionRuns
        : records.length + actions.length,
      last: last > 0 ? new Date(last).toLocaleString(language || undefined) : ui.common.none,
    };
  }, [records, actions, scans, cleanupTotals, language, ui.common.none]);

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
            {tab === "scans" && hasLastSnapshot && (
              <Button
                variant="primary"
                size="sm"
                icon={<RotateCcw size={13} />}
                onClick={handleRestoreLatestScan}
                title={ui.history.restoreScanTooltip}
              >
                {ui.history.restoreScanBtn}
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              icon={<Trash2 size={13} />}
              onClick={() => {
                setConfirmAll(false);
                setConfirmOpen(true);
              }}
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
            <span className="nc-kpi-card-label">{ui.history.totalCleaned}</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--success">
              <TrendingDown size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">{formatBytes(summary.cleaned, language)}</span>
            <span className="nc-kpi-card-sub">
              {ui.history.reclaim}: {formatBytes(summary.permanent, language)}
            </span>
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
              {ui.history.tabScans}: {scans.length}
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
            {summary.lastKind && (
              <span className="nc-kpi-card-sub">
                {summary.lastKind === "cleanups"
                  ? ui.history.tabCleanups
                  : summary.lastKind === "actions"
                    ? ui.history.tabActions
                    : ui.history.tabScans}
              </span>
            )}
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
      {tab === "scans" &&
        (scanHistoryStatus === "corrupt" || scanHistoryStatus === "unavailable") && (
          <p className="items-warning" role="status">
            {ui.history.loadError}
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
                        <td>{formatSavedAt(record.timestamp, language)}</td>
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
                            aria-label={`${ui.history.details}: ${formatSavedAt(
                              record.timestamp,
                              language,
                            )}`}
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
                      <td>{formatSavedAt(action.timestamp, language)}</td>
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
                  {scans.map((scan) => (
                    <tr key={scan.id}>
                      <td>{formatSavedAt(scan.timestamp, language)}</td>
                      <td>
                        <span className="chip">
                          {scan.scope === "project"
                            ? ui.history.scopeProjects
                            : scan.scope === "agents"
                              ? ui.history.scopeAgents
                              : scan.scope === "combined"
                                ? ui.common.scanAll
                                : ui.history.scopeAllDrives}
                        </span>
                      </td>
                      <td
                        style={{ maxWidth: 220 }}
                        title={maskPaths ? maskPath(scan.rootPath) : scan.rootPath}
                      >
                        <span className="items-path">
                          {scan.rootPath === "allDrives" || scan.scope === "allDrives"
                            ? ui.common.allDrives
                            : scan.rootPath === "combined"
                              ? ui.common.scanAll
                              : scan.rootPath === "agents"
                                ? ui.nav.agents
                                : maskPaths
                                  ? maskPath(scan.rootPath)
                                  : scan.rootPath}
                        </span>
                      </td>
                      <td className="num">{scan.itemCount}</td>
                      <td className="num">{formatBytes(scan.cleanableBytes, language)}</td>
                      <td className="num">{scan.durationMs} ms</td>
                      <td>
                        <span
                          className={`chip ${
                            scan.status === "completed"
                              ? scan.stopReason === "depth-limit"
                                ? "warn"
                                : "ok"
                              : scan.status === "partial"
                                ? "warn"
                                : "muted"
                          }`}
                          title={
                            scan.stopReason
                              ? `${ui.overview.stopReason}: ${localizeStopReason(scan.stopReason, ui)}`
                              : scan.status === "partial"
                                ? ui.overview.partial
                                : undefined
                          }
                        >
                          {scan.status === "completed"
                            ? scan.stopReason === "depth-limit"
                              ? ui.history.statusDepthLimited
                              : ui.history.statusCompleted
                            : scan.status === "partial"
                              ? ui.history.statusPartial
                              : ui.history.statusCancelled}
                        </span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {ui.history.prevScan}
                        </span>
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
          confirmAll
            ? ui.history.clearAllBtn
            : tab === "cleanups"
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
              variant="danger"
              onClick={() => {
                void (confirmAll ? handleClearAllHistory() : handleClearCurrentTab());
              }}
            >
              {confirmAll ? ui.history.clearAllBtn : ui.history.clearCurrentBtn}
            </Button>
          </>
        }
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
            color: "var(--text-primary)",
            fontSize: "var(--text-sm)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={confirmAll}
            onChange={(event) => setConfirmAll(event.target.checked)}
          />
          {ui.history.clearAllBtn}
        </label>
        {confirmAll ? (
          // Be explicit: this scope erases all three histories, not just the
          // tab the dialog was opened from.
          <>
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
              <li>{ui.history.tabCleanups}</li>
              <li>{ui.history.tabActions}</li>
              <li>{ui.history.tabScans}</li>
            </ul>
            <p className="plan-note">{ui.history.clearHint}</p>
          </>
        ) : (
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
        )}
      </Dialog>
    </div>
  );
};
