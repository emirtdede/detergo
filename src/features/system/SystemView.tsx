import React, { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  CalendarClock,
  Check,
  ChevronDown,
  HardDrive,
  Lock,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Trash2,
  Wrench,
  X,
} from "lucide-react";

import { Button } from "@/components/primitives/Button";
import { Checkbox } from "@/components/primitives/Checkbox";
import { Dialog } from "@/components/primitives/Dialog";
import { PageHeader } from "@/components/primitives/PageHeader";
import { Switch } from "@/components/primitives/Switch";

import { formatBytes } from "@/lib/formatters";
import { localizeAppError, useUIText } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useSystemStore } from "@/stores/system-store";
import { useUiStore } from "@/stores/ui-store";
import { SystemActionId, SystemAutomationConfig } from "@/types";

import "../shell/shell.css";
import "./system.css";

const QUICK_ACTIONS: SystemActionId[] = ["userTemp", "windowsUpdate"];
const PROFILE_ACTIONS: Record<string, SystemActionId[]> = {
  quick: ["userTemp", "windowsUpdate"],
  standard: ["userTemp", "windowsUpdate", "windowsTemp", "prefetch", "errorReports"],
  deep: [
    "userTemp",
    "windowsUpdate",
    "windowsTemp",
    "prefetch",
    "errorReports",
    "diskCleanup",
    "componentStore",
  ],
};
const WEEKDAY_REFERENCE = Date.UTC(2024, 0, 7); // a Sunday

function isSelectable(
  action: { available: boolean; requiresAdmin: boolean },
  elevated: boolean,
): boolean {
  return action.available && (!action.requiresAdmin || elevated);
}

export const SystemView: React.FC = () => {
  const ui = useUIText();
  const language = usePreferencesStore((state) => state.language);
  const {
    report,
    automation,
    loading,
    running,
    previewing,
    current,
    error,
    lastReport,
    selected,
    load,
    loadAutomation,
    toggle,
    selectAll,
    setSelection,
    clear,
    run,
    cancel,
    restartElevated,
    saveAutomation,
    removeAutomation,
    dismissResult,
    clearError,
  } = useSystemStore(
    useShallow((state) => ({
      report: state.report,
      automation: state.automation,
      loading: state.loading,
      running: state.running,
      previewing: state.previewing,
      current: state.current,
      error: state.error,
      lastReport: state.lastReport,
      selected: state.selected,
      load: state.load,
      loadAutomation: state.loadAutomation,
      toggle: state.toggle,
      selectAll: state.selectAll,
      setSelection: state.setSelection,
      clear: state.clear,
      run: state.run,
      cancel: state.cancel,
      restartElevated: state.restartElevated,
      saveAutomation: state.saveAutomation,
      removeAutomation: state.removeAutomation,
      dismissResult: state.dismissResult,
      clearError: state.clearError,
    })),
  );

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [expandedLog, setExpandedLog] = useState<SystemActionId | null>(null);
  const [draft, setDraft] = useState<SystemAutomationConfig | null>(null);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    void load();
    void loadAutomation();
    return () => {
      unmountedRef.current = true;
    };
  }, [load, loadAutomation]);

  useEffect(() => {
    if (automation) setDraft(automation);
  }, [automation]);

  const elevated = report?.elevated ?? false;
  const actions = report?.actions ?? [];

  const selectableIds = useMemo(
    () => actions.filter((action) => isSelectable(action, elevated)).map((action) => action.id),
    [actions, elevated],
  );

  const selectedActions = useMemo(
    () => actions.filter((action) => selected.includes(action.id)),
    [actions, selected],
  );
  const selectedBytes = useMemo(
    () => selectedActions.reduce((sum, action) => sum + (action.measured ? action.bytes : 0), 0),
    [selectedActions],
  );

  const quickIds = useMemo(
    () =>
      actions
        .filter((action) => QUICK_ACTIONS.includes(action.id) && isSelectable(action, elevated))
        .map((action) => action.id),
    [actions, elevated],
  );

  const disk = report?.disk;
  const canRun = !running && !previewing && selectedActions.length > 0;

  const onRun = async (ids: SystemActionId[]) => {
    setConfirmOpen(false);
    await run(ids);
    const failure = useSystemStore.getState().error;
    if (failure) {
      useUiStore
        .getState()
        .showToast(`${ui.errors.title}: ${localizeAppError(failure, ui)}`, "error", 6000);
    }
  };

  const onRestart = async () => {
    await restartElevated();
    const failure = useSystemStore.getState().error;
    if (failure) {
      useUiStore.getState().showToast(localizeAppError(failure, ui), "error");
    }
  };

  const onSaveSchedule = async () => {
    if (!draft) return;
    setSavingSchedule(true);
    try {
      const ok = await saveAutomation(draft);
      const failure = useSystemStore.getState().error;
      useUiStore
        .getState()
        .showToast(
          ok
            ? ui.system.scheduleSaved
            : `${ui.errors.title}: ${failure ? localizeAppError(failure, ui) : ui.errors.unknown}`,
          ok ? "success" : "error",
          ok ? 3500 : 6000,
        );
    } finally {
      if (!unmountedRef.current) setSavingSchedule(false);
    }
  };

  const onRemoveSchedule = async () => {
    setSavingSchedule(true);
    try {
      const ok = await removeAutomation();
      const failure = useSystemStore.getState().error;
      useUiStore
        .getState()
        .showToast(
          ok
            ? ui.system.scheduleRemoved
            : `${ui.errors.title}: ${failure ? localizeAppError(failure, ui) : ui.errors.unknown}`,
          ok ? "success" : "error",
          ok ? 3500 : 6000,
        );
    } finally {
      if (!unmountedRef.current) setSavingSchedule(false);
    }
  };

  const onLaunchCleanmgr = async (mode: "dialog" | "sageset" | "sagerun") => {
    try {
      await scannerApi.systemLaunchCleanmgr(mode);
      useUiStore.getState().showToast(ui.system.cleanmgrLaunched, "info");
    } catch (err) {
      useUiStore.getState().showToast(localizeAppError(err, ui), "error", 6000);
    }
  };

  const onRunProfileNow = () => {
    const wanted = PROFILE_ACTIONS[draft?.profile ?? "quick"] ?? QUICK_ACTIONS;
    const ids = actions
      .filter((action) => wanted.includes(action.id) && isSelectable(action, elevated))
      .map((action) => action.id);
    if (ids.length === 0) return;
    setSelection(ids);
    setConfirmOpen(true);
  };

  const weekdayLabel = (index: number) =>
    new Intl.DateTimeFormat(language ?? "en", { weekday: "long" }).format(
      new Date(WEEKDAY_REFERENCE + index * 86_400_000),
    );

  const actionLabel = (id: SystemActionId) => ui.system.actions[id];

  return (
    <div className="page-view system-view">
      <PageHeader
        title={ui.system.title}
        description={ui.system.subtitle}
        actions={
          <>
            {elevated ? (
              <span className="system-status system-status--elevated">
                <ShieldCheck size={13} /> {ui.system.elevated}
              </span>
            ) : (
              <span className="system-status">
                <ShieldAlert size={13} /> {ui.system.adminBadge}
              </span>
            )}
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={13} />}
              onClick={() => void load()}
              disabled={loading || running}
            >
              {ui.common.refresh}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Trash2 size={13} />}
              onClick={() => setConfirmOpen(true)}
              disabled={!canRun}
            >
              {ui.system.cleanSelected}
            </Button>
            {running ? (
              <Button
                variant="danger-outline"
                size="sm"
                icon={<Square size={11} fill="currentColor" />}
                onClick={() => void cancel()}
              >
                {ui.system.stopAfterStep}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                icon={<ShieldCheck size={13} />}
                onClick={() => {
                  // Quick clean pre-selects the smallest safe set but still
                  // goes through the same confirmation dialog as any other run.
                  setSelection(quickIds);
                  setConfirmOpen(true);
                }}
                disabled={previewing || quickIds.length === 0}
              >
                {ui.system.quickClean}
              </Button>
            )}
          </>
        }
      />

      {error && (
        <div className="items-warning system-warning" role="alert">
          <span>{localizeAppError(error, ui)}</span>
          <Button variant="ghost" size="sm" onClick={clearError}>
            {ui.common.close}
          </Button>
        </div>
      )}

      {!elevated && report && (
        <section className="system-admin-banner">
          <div className="system-admin-copy">
            <strong>{ui.system.adminTitle}</strong>
            <p>{ui.system.adminBody}</p>
          </div>
          <Button
            variant="primary"
            size="sm"
            icon={<ShieldCheck size={13} />}
            onClick={() => void onRestart()}
          >
            {ui.system.restartAdmin}
          </Button>
        </section>
      )}

      <div className="nc-bento-strip nc-bento-strip--3">
        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{ui.system.reclaimable}</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--accent">
              <Trash2 size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {loading && !report
                ? ui.caches.measuring
                : formatBytes(
                    actions.reduce((sum, action) => sum + (action.measured ? action.bytes : 0), 0),
                    language,
                  )}
            </span>
            <span className="nc-kpi-card-sub">
              {ui.common.showing(actions.filter((action) => action.measured).length)}
            </span>
          </div>
        </div>

        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{disk?.drive ?? "C:"}</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--success">
              <HardDrive size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {disk ? formatBytes(disk.freeBytes, language) : "—"}
            </span>
            <span className="nc-kpi-card-sub">
              {disk
                ? `${ui.system.freeSpace}: ${Math.max(0, 100 - disk.percentUsed).toFixed(1)}% · ${formatBytes(disk.totalBytes, language)}`
                : loading && !report
                  ? ui.caches.measuring
                  : ui.system.notMeasured}
            </span>
          </div>
        </div>

        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{ui.system.cleanSelected}</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--warning">
              <CalendarClock size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">{formatBytes(selectedBytes, language)}</span>
            <span className="nc-kpi-card-sub">{ui.common.items(selectedActions.length)}</span>
          </div>
        </div>
      </div>

      <section className="system-panel-card system-targets-card">
        <header className="system-card-header">
          <div className="system-card-head-left">
            <span className="system-card-icon system-card-icon--accent" aria-hidden="true">
              <HardDrive size={16} />
            </span>
            <div className="system-card-copy">
              <h2 className="system-card-title">{ui.system.reclaimable}</h2>
              <p className="system-card-subtitle">
                {running ? (
                  <span aria-live="polite">
                    {ui.plan.working}
                    {current ? ` · ${actionLabel(current)}` : ""}
                  </span>
                ) : loading ? (
                  <span aria-live="polite">{ui.caches.measuring}</span>
                ) : previewing ? (
                  <span aria-live="polite">{ui.common.loading}</span>
                ) : (
                  <span>
                    {ui.common.items(actions.length)} · {formatBytes(selectedBytes, language)}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="system-card-head-actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={selected.length === selectableIds.length ? clear : selectAll}
              disabled={selectableIds.length === 0 || running}
            >
              {selected.length === selectableIds.length
                ? ui.system.clearSelection
                : ui.system.selectAll}
            </Button>
          </div>
        </header>

        {loading && actions.length === 0 ? (
          <div className="system-actions" aria-busy="true" aria-label={ui.caches.measuring}>
            {[0, 1, 2, 3, 4].map((index) => (
              <div key={index} className="system-action-skeleton">
                <span className="system-skeleton-box" />
                <div className="system-skeleton-lines">
                  <span className="system-skeleton-line system-skeleton-line--title" />
                  <span className="system-skeleton-line system-skeleton-line--path" />
                </div>
                <span className="system-skeleton-line system-skeleton-line--size" />
              </div>
            ))}
          </div>
        ) : actions.length > 0 ? (
          <div className="system-actions">
            {actions.map((action) => {
              const selectable = isSelectable(action, elevated);
              const checked = selected.includes(action.id);
              const inputId = `system-action-${action.id}`;
              return (
                <div
                  key={action.id}
                  className={[
                    "system-action",
                    checked ? "is-selected" : "",
                    selectable ? "" : "is-locked",
                    current === action.id ? "is-running" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <Checkbox
                    id={inputId}
                    checked={checked}
                    disabled={!selectable || running}
                    onChange={() => toggle(action.id)}
                    aria-label={actionLabel(action.id)}
                  />
                  <label htmlFor={inputId} className="system-action-copy">
                    <span className="system-action-title">
                      {actionLabel(action.id)}
                      {action.requiresAdmin && (
                        <span className="chip system-chip">
                          <Lock size={10} /> {ui.system.adminBadge}
                        </span>
                      )}
                      <span className={`chip system-chip system-chip--${action.safety}`}>
                        {ui.safety[action.safety]}
                      </span>
                    </span>
                    {action.path && (
                      <span className="system-action-path" title={action.path}>
                        {action.path}
                      </span>
                    )}
                  </label>
                  <span className="system-action-size">
                    {action.measured ? (
                      formatBytes(action.bytes, language)
                    ) : action.reason === "windowsReports" ? (
                      <span className="system-size-muted">{ui.system.windowsReported}</span>
                    ) : action.reason === "needsAdmin" ? (
                      <span className="system-size-muted">{ui.system.adminBadge}</span>
                    ) : (
                      <span className="system-size-muted">{ui.system.notMeasured}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="system-empty-box">
            <span className="plan-note">{ui.system.notMeasured}</span>
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={13} />}
              onClick={() => void load()}
            >
              {ui.common.refresh}
            </Button>
          </div>
        )}
      </section>

      <section className="system-panel-card system-cleanmgr-card">
        <div className="system-card-header system-cleanmgr-row">
          <div className="system-card-head-left">
            <span className="system-card-icon system-card-icon--warning" aria-hidden="true">
              <Wrench size={16} />
            </span>
            <div className="system-card-copy">
              <h2 className="system-card-title">{ui.system.cleanmgrTitle}</h2>
              <p className="system-card-subtitle">{ui.system.cleanmgrBody}</p>
            </div>
          </div>

          <div className="system-cleanmgr-actions">
            <Button
              variant="secondary"
              size="sm"
              icon={<HardDrive size={13} />}
              onClick={() => void onLaunchCleanmgr("dialog")}
              disabled={running}
            >
              {ui.system.cleanmgrOpen}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<SlidersHorizontal size={13} />}
              onClick={() => void onLaunchCleanmgr("sageset")}
              disabled={running}
            >
              {ui.system.cleanmgrConfigure}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Play size={12} />}
              onClick={() => void onLaunchCleanmgr("sagerun")}
              disabled={running}
            >
              {ui.system.cleanmgrRunProfile}
            </Button>
          </div>
        </div>
      </section>

      <section className="system-panel-card system-automation-card">
        <header className="system-card-header">
          <div className="system-card-head-left">
            <span className="system-card-icon system-card-icon--success" aria-hidden="true">
              <CalendarClock size={16} />
            </span>
            <div className="system-card-copy">
              <h2 className="system-card-title">{ui.system.automatedTitle}</h2>
              <p className="system-card-subtitle">{ui.system.automatedBody}</p>
            </div>
          </div>

          <div className="system-card-head-actions">
            {automation?.installed && (
              <span className="chip system-chip system-chip--safe">
                <Check size={10} /> {ui.system.scheduleInstalled}
              </span>
            )}
            {draft && (
              <Switch
                checked={draft.enabled}
                onLabel={ui.common.on}
                offLabel={ui.common.off}
                aria-label={ui.system.automatedTitle}
                onChange={(enabled) => setDraft({ ...draft, enabled })}
                disabled={savingSchedule}
              />
            )}
          </div>
        </header>

        {draft && (
          <div
            className={`system-automation-form ${
              draft.frequency === "weekly"
                ? "system-automation-form--4"
                : "system-automation-form--3"
            }`}
          >
            <label className="system-field">
              <span>{ui.system.frequency}</span>
              <select
                value={draft.frequency}
                onChange={(event) => setDraft({ ...draft, frequency: event.target.value })}
                disabled={savingSchedule || running}
              >
                <option value="daily">{ui.system.daily}</option>
                <option value="weekly">{ui.system.weekly}</option>
              </select>
            </label>

            {draft.frequency === "weekly" && (
              <label className="system-field">
                <span>{ui.system.weekday}</span>
                <select
                  value={draft.weekday}
                  onChange={(event) => setDraft({ ...draft, weekday: Number(event.target.value) })}
                  disabled={savingSchedule || running}
                >
                  {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                    <option key={day} value={day}>
                      {weekdayLabel(day)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="system-field">
              <span>{ui.system.time}</span>
              <input
                type="time"
                value={draft.time}
                onChange={(event) => setDraft({ ...draft, time: event.target.value })}
                disabled={savingSchedule || running}
              />
            </label>

            <label className="system-field">
              <span>{ui.system.scope}</span>
              <select
                value={draft.profile}
                onChange={(event) => setDraft({ ...draft, profile: event.target.value })}
                disabled={savingSchedule || running}
              >
                <option value="quick">{ui.system.scopeQuick}</option>
                <option value="standard">{ui.system.scopeStandard}</option>
                <option value="deep">{ui.system.scopeDeep}</option>
              </select>
            </label>
          </div>
        )}

        {automation?.enabled && !automation.installed && (
          <p className="items-warning system-warning">{ui.system.scheduleMissing}</p>
        )}

        <footer className="system-card-footer">
          <span className="system-last-run">
            <CalendarClock size={13} aria-hidden="true" />
            <span>
              {ui.system.lastRun}:{" "}
              {automation?.lastRun
                ? `${new Date(automation.lastRun).toLocaleString(language ?? "en")} · ${formatBytes(
                    automation.lastFreedBytes ?? 0,
                    language,
                  )}`
                : ui.system.never}
            </span>
          </span>

          {draft && (
            <div className="system-automation-actions">
              {automation?.installed && (
                <Button
                  variant="danger-outline"
                  size="sm"
                  onClick={() => void onRemoveSchedule()}
                  disabled={savingSchedule}
                >
                  {ui.system.removeSchedule}
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                icon={<Play size={12} />}
                onClick={onRunProfileNow}
                disabled={running || previewing || selectableIds.length === 0}
              >
                {ui.system.runNow}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void onSaveSchedule()}
                disabled={savingSchedule}
              >
                {ui.system.saveSchedule}
              </Button>
            </div>
          )}
        </footer>
      </section>

      <Dialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={ui.system.confirmTitle}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              {ui.common.cancel}
            </Button>
            <Button
              variant="danger"
              icon={<Trash2 size={13} />}
              onClick={() => {
                const ids = selected.length > 0 ? selected : quickIds;
                void onRun(ids);
              }}
              disabled={!canRun}
            >
              {ui.plan.confirmPermanent}
            </Button>
          </>
        }
      >
        <p>{ui.system.confirmBody}</p>
        <p className="plan-note">{ui.plan.permanentNote}</p>
        <ul className="system-confirm-list">
          {selectedActions.map((action) => (
            <li key={action.id}>
              <span>{actionLabel(action.id)}</span>
              <strong>
                {action.measured ? formatBytes(action.bytes, language) : ui.system.notMeasured}
              </strong>
            </li>
          ))}
        </ul>
        <p className="system-confirm-total">
          {ui.system.reclaimable}: <strong>{formatBytes(selectedBytes, language)}</strong>
        </p>
      </Dialog>

      <Dialog
        isOpen={Boolean(lastReport)}
        onClose={dismissResult}
        title={ui.result.title}
        maxWidth="620px"
        footer={
          <Button variant="primary" onClick={dismissResult}>
            {ui.result.close}
          </Button>
        }
      >
        {lastReport && (
          <>
            <p className="system-result-total">
              {ui.system.freed}: <strong>{formatBytes(lastReport.freedBytes, language)}</strong>
            </p>
            {lastReport.cancelled && <p className="plan-note">{ui.result.cancelled}</p>}
            <ul className="system-result-list">
              {lastReport.results.map((result) => (
                <li key={result.id} className={result.success ? "is-ok" : "is-failed"}>
                  <span className="system-result-icon">
                    {result.success ? <Check size={13} /> : <X size={13} />}
                  </span>
                  <span className="system-result-name">{actionLabel(result.id)}</span>
                  <span className="system-result-bytes">
                    {formatBytes(result.freedBytes, language)}
                  </span>
                  {result.skipped > 0 && (
                    <span className="chip system-chip">
                      {result.skipped} · {ui.result.skipped}
                    </span>
                  )}
                  {result.logTail && (
                    <button
                      type="button"
                      className="link-button system-log-toggle"
                      onClick={() => setExpandedLog(expandedLog === result.id ? null : result.id)}
                    >
                      {expandedLog === result.id ? ui.system.hideLog : ui.system.showLog}
                      <ChevronDown
                        size={12}
                        className={expandedLog === result.id ? "is-open" : ""}
                      />
                    </button>
                  )}
                  {expandedLog === result.id && result.logTail && (
                    <pre className="system-log">{result.logTail}</pre>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Dialog>
    </div>
  );
};

/** Re-exported for the view tests that need the same list. */
export { QUICK_ACTIONS };
