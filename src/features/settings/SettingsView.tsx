import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  FolderOpen,
  Plus,
  ShieldCheck,
  Cpu,
  X,
  Check,
  Palette,
  Bell,
  Send,
  RotateCcw,
} from "lucide-react";
import { notificationService } from "@/lib/notifications/notification-service";
import { NotificationChannel } from "@/types";
import { Button } from "@/components/primitives/Button";
import { Switch } from "@/components/primitives/Switch";
import { NumberField } from "@/components/primitives/NumberField";
import { PageHeader } from "@/components/primitives/PageHeader";
import { usePreferencesStore, SETTING_LIMITS } from "@/stores/preferences-store";
import { useScanStore } from "@/stores/scan-store";
import { useShallow } from "zustand/react/shallow";
import { useUiStore } from "@/stores/ui-store";
import { useUIText, resolveUiLocale, UIText, localizeAppError, getUIText } from "@/lib/ui-text";
import { translateBackendText } from "@/lib/ui-text/backend-i18n";
import { LANGUAGES_LIST } from "@/locales/languages";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { countCatalogStats } from "@/lib/catalog-stats";
import { normalizeWebhookUrl } from "@/lib/validation/webhook-url";
import { classifyWebhookFailure, describeWebhookFailure } from "@/lib/errors/webhook-failure";
import {
  CatalogDto,
  BuildInfo,
  SupportedLanguage,
  ThemeMode,
  THEME_MODES,
  DEFAULT_SHORTCUTS,
} from "@/types";
import { comboFromEvent, validateShortcut } from "@/lib/shortcuts";
import { log } from "@/lib/logging";
import { useSettingsSections } from "./settings-sections";
import { AboutView } from "./AboutView";
import { PrivacySection } from "./PrivacySection";
import "../items/items.css";
import "../shell/shell.css";
import "./settings.css";

// Shortcuts are dynamically localized inside SettingsView via shortcutDefs

const THEMES: readonly ThemeMode[] = THEME_MODES;

function themeLabel(theme: ThemeMode | string, ui: UIText): string {
  const t = ui.settings;
  const isDark = theme.startsWith("dark");
  const modeLabel = isDark ? t.themeDark || "Dark" : t.themeLight || "Light";

  const nameMap: Record<string, string> = {
    black: t.themeBlack || "Black",
    gray: t.themeGray || "Gray",
    blue: t.themeBlue || "Blue",
    purple: t.themePurple || "Purple",
    green: t.themeGreen || "Green",
    red: t.themeRed || "Red",
    orange: t.themeOrange || "Orange",
    yellow: t.themeYellow || "Yellow",
    white: t.themeWhite || "White",
    transparent: t.themeTransparent || "Transparent",
  };

  const suffix = theme.replace(/^(dark|light)-/, "");
  const colorName = nameMap[suffix] ?? suffix;
  return `${modeLabel} - ${colorName}`;
}

const PROFILE_DEFAULTS: Record<
  string,
  { maxDepth: number; maxCandidates: number; timeoutMinutes: number }
> = {
  fast: { maxDepth: 16, maxCandidates: 10000, timeoutMinutes: 5 },
  balanced: { maxDepth: 32, maxCandidates: 50000, timeoutMinutes: 15 },
  deep: { maxDepth: 64, maxCandidates: 200000, timeoutMinutes: 30 },
};

/**
 * Validates a typed webhook draft and writes it through the store.
 *
 * Shared by the draft-flush effect, the explicit save and the test button so
 * all three accept exactly the same values. The write is fire-and-forget (the
 * user may already be leaving the page), but a failure is logged and, when the
 * user is still looking at the form, surfaced as a toast: a URL that silently
 * did not persist made every later webhook look broken.
 */
function persistWebhookDraft(draft: string, reportFailure = false): boolean {
  const result = normalizeWebhookUrl(draft);
  if (!result.ok) return false;
  const store = usePreferencesStore.getState();
  store.updateSettings({ webhookUrl: result.value });
  void store.persistSettings().catch((err) => {
    log.error("Could not persist the webhook draft", err);
    if (!reportFailure) return;
    const activeUi = getUIText();
    useUiStore
      .getState()
      .showToast(
        `${activeUi.settings.saveError}: ${localizeAppError(err, activeUi)}`,
        "error",
        6000,
      );
  });
  return true;
}

export const SettingsView: React.FC = () => {
  const ui = useUIText();
  // A no-selector subscription re-rendered the whole Settings page on every
  // unrelated preference write (the item table's sort, a new recent location,
  // favorites). Subscribe only to the fields this page reads.
  const prefs = usePreferencesStore(
    useShallow((s) => ({
      theme: s.theme,
      language: s.language,
      reduceMotion: s.reduceMotion,
      sidebarMode: s.sidebarMode,
      closeAction: s.closeAction,
      cacheMeasureMode: s.cacheMeasureMode,
      scanProfile: s.scanProfile,
      maxDepth: s.maxDepth,
      maxCandidates: s.maxCandidates,
      timeoutMinutes: s.timeoutMinutes,
      minSizeBytes: s.minSizeBytes,
      notifications: s.notifications,
      shortcuts: s.shortcuts,
      maskPaths: s.maskPaths,
      protectedPaths: s.protectedPaths,
      excludedNames: s.excludedNames,
      historyEnabled: s.historyEnabled,
      mcpAllowDestructive: s.mcpAllowDestructive,
      webhookUrl: s.webhookUrl,
      webhookOnScan: s.webhookOnScan,
      webhookOnClean: s.webhookOnClean,
      agentPolicy: s.agentPolicy,
      updateSettings: s.updateSettings,
      setTheme: s.setTheme,
      setLanguage: s.setLanguage,
      setReduceMotion: s.setReduceMotion,
      setSidebarMode: s.setSidebarMode,
      setCloseAction: s.setCloseAction,
      setCacheMeasureMode: s.setCacheMeasureMode,
      setShortcut: s.setShortcut,
      resetShortcuts: s.resetShortcuts,
    })),
  );
  const showToast = useUiStore((s) => s.showToast);
  const section = useUiStore((s) => s.settingsSection);
  const setSettingsSection = useUiStore((s) => s.setSettingsSection);
  const scanStatus = useScanStore((s) => s.status);
  const scanBusy =
    scanStatus === "scanning" || scanStatus === "measuring" || scanStatus === "cancelling";
  const [protectedInput, setProtectedInput] = useState("");
  const [excludedInput, setExcludedInput] = useState("");
  const [catalog, setCatalog] = useState<CatalogDto | null>(null);
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);

  useEffect(() => {
    // The catalogue is a large payload; leaving Settings before it lands must
    // not write state into a component that is already gone (and must not
    // overwrite a newer load after a fast remount).
    let cancelled = false;
    scannerApi
      .getCatalog()
      .then((catalog) => {
        if (!cancelled) setCatalog(catalog);
      })
      .catch((err) => {
        if (cancelled) return;
        // Keep the raw error out of the UI: it may contain filesystem paths.
        // The About card already renders a localized backend note, so a toast
        // with the localized message is the only place the user needs it.
        log.warn("Catalog could not be loaded", err);
        showToast(
          `${getUIText().errors.title}: ${localizeAppError(err, getUIText())}`,
          "error",
          7000,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  useEffect(() => {
    let cancelled = false;
    scannerApi
      .getBuildInfo()
      .then((info) => {
        if (!cancelled) setBuildInfo(info);
      })
      .catch(() => {
        if (!cancelled) setBuildInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const catalogStats = useMemo(() => countCatalogStats(catalog?.rules ?? []), [catalog]);

  const [testingWebhook, setTestingWebhook] = useState(false);
  const [webhookTestStatus, setWebhookTestStatus] = useState<{
    success: boolean;
    text: string;
  } | null>(null);
  // The URL is typed, not saved on every keystroke: a half-finished value like
  // `https://` was written to the settings file and then retried by every
  // notification. `null` means "follow the persisted value".
  const [webhookDraft, setWebhookDraft] = useState<string | null>(null);
  // A draft must survive leaving the settings page; otherwise a typed URL is
  // silently lost unless the user remembers to press Save.
  const webhookDraftRef = useRef(webhookDraft);
  useEffect(() => {
    // Written in an effect, not during render: a render-phase ref mutation is
    // unsafe under StrictMode/concurrent rendering.
    webhookDraftRef.current = webhookDraft;
  }, [webhookDraft]);
  useEffect(() => {
    // A draft must survive leaving the settings page. Committing it on unmount
    // alone was not enough: the webview can be torn down before an async IPC
    // round-trip completes, and a rejected write became an unhandled rejection
    // that lost the URL without telling anyone. Flush on `pagehide` as well and
    // report failures where the user can still see them.
    const flushDraft = (reportIfInvalid: boolean) => {
      const draft = webhookDraftRef.current;
      if (draft === null) return;
      if (persistWebhookDraft(draft)) return;
      if (!reportIfInvalid) return;
      const activeUi = getUIText();
      useUiStore
        .getState()
        .showToast(
          `${activeUi.settings.webhookTitle}: ${activeUi.settings.webhookUrlEmpty}`,
          "warning",
          5000,
        );
    };

    const onHide = () => flushDraft(false);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      flushDraft(true);
    };
  }, []);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);

  const shortcutDefs = useMemo(
    () => [
      {
        id: "toggleSidebar",
        label: ui.settings.scToggleSidebar,
        hint: ui.settings.scToggleSidebarHint,
      },
      { id: "focusSearch", label: ui.settings.scFocusSearch, hint: ui.settings.scFocusSearchHint },
      {
        id: "startStopScan",
        label: ui.settings.scStartStopScan,
        hint: ui.settings.scStartStopScanHint,
      },
      { id: "navOverview", label: ui.settings.scNavOverview, hint: ui.settings.scNavOverviewHint },
      { id: "navProjects", label: ui.settings.scNavProjects, hint: ui.settings.scNavProjectsHint },
      { id: "navAgents", label: ui.settings.scNavAgents, hint: ui.settings.scNavAgentsHint },
      { id: "navCaches", label: ui.settings.scNavCaches, hint: ui.settings.scNavCachesHint },
      { id: "navDocs", label: ui.settings.scNavDocs, hint: ui.settings.scNavDocsHint },
      { id: "navHistory", label: ui.settings.scNavHistory, hint: ui.settings.scNavHistoryHint },
      { id: "navSettings", label: ui.settings.scNavSettings, hint: ui.settings.scNavSettingsHint },
    ],
    [ui.settings],
  );

  const updateNotify = (
    key: keyof NonNullable<typeof prefs.notifications>,
    channel: NotificationChannel | boolean,
  ) => {
    const current = prefs.notifications ?? {
      scanComplete: "both",
      cleanComplete: "both",
      diskPressure: "both",
      processLock: "in_app",
      automationWebhook: "both",
      soundEnabled: true,
    };
    save({
      notifications: {
        ...current,
        [key]: channel,
      },
    });
  };

  /**
   * Persists the typed webhook only when it is a usable absolute http(s) URL.
   * Returns false when the draft is invalid so callers (test button) stop.
   */
  const commitWebhook = (): boolean => {
    if (webhookDraft === null) return true;
    // The user is still on the form here, so a failed write is worth a toast.
    if (!persistWebhookDraft(webhookDraft, true)) {
      showToast(ui.settings.webhookUrlEmpty, "warning");
      return false;
    }
    setWebhookDraft(null);
    return true;
  };

  const handleTestWebhook = async () => {
    if (!commitWebhook()) return;
    const url = usePreferencesStore.getState().webhookUrl?.trim();
    if (!url) {
      showToast(ui.settings.webhookUrlEmpty, "warning");
      return;
    }
    setTestingWebhook(true);
    setWebhookTestStatus(null);
    try {
      const result = await scannerApi.testWebhook(url, {
        event: "test_ping",
        timestamp: new Date().toISOString(),
        product: "Dev Cleaner by Vellium",
        message: ui.settings.webhookSent,
      });
      if (result.ok) {
        setWebhookTestStatus({ success: true, text: ui.settings.webhookSent });
        showToast(ui.settings.webhookSent, "success");
      } else {
        // `result.message` comes from `reqwest` and can embed the full webhook
        // URL (whose path is the bearer token) plus DNS/TLS detail. Only a
        // classified, token-free reason is allowed into the UI.
        const text = describeWebhookFailure(classifyWebhookFailure(result.status), ui);
        setWebhookTestStatus({ success: false, text });
        showToast(`${ui.settings.webhookTitle}: ${text}`, "error");
        log.debug("Webhook test rejected", { status: result.status });
      }
    } catch (err) {
      setWebhookTestStatus({ success: false, text: localizeAppError(err, ui) });
      showToast(`${ui.settings.webhookTitle}: ${localizeAppError(err, ui)}`, "error");
    } finally {
      setTestingWebhook(false);
    }
  };

  const sections = useSettingsSections();
  const uiLanguages = useMemo(() => LANGUAGES_LIST, []);

  const activeSection = sections.find((s) => s.id === section) ?? sections[0];

  useEffect(() => {
    if (!recordingId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setRecordingId(null);
        setConflictWarning(null);
        return;
      }

      const combo = comboFromEvent(e);
      // A bare modifier (`Control`, `Shift`, …) is not a chord yet.
      if (!combo) return;

      const validity = validateShortcut(combo);
      if (!validity.ok) {
        setConflictWarning(
          validity.reason === "reserved"
            ? ui.settings.reservedWarning(combo)
            : ui.settings.shortcutNeedsModifier,
        );
        return;
      }

      const activeShortcuts = prefs.shortcuts ?? DEFAULT_SHORTCUTS;
      const existing = Object.entries(activeShortcuts).find(
        ([id, val]) => id !== recordingId && val.toLowerCase() === combo.toLowerCase(),
      );

      if (existing) {
        const existingDef = shortcutDefs.find((d) => d.id === existing[0]);
        setConflictWarning(ui.settings.conflictWarning(combo, existingDef?.label ?? existing[0]));
        return;
      }

      setConflictWarning(null);
      prefs.setShortcut(recordingId, combo);
      setRecordingId(null);
      // Report success only after the write is durable; a failed save used to
      // show "updated" followed by no persisted shortcut after a restart.
      void (async () => {
        try {
          await usePreferencesStore.getState().persistSettings();
          showToast(ui.settings.toastShortcutUpdated(combo), "success", 2000);
        } catch (err) {
          showToast(`${ui.settings.saveError}: ${localizeAppError(err, ui)}`, "error", 6000);
        }
      })();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [recordingId, prefs.shortcuts, shortcutDefs, ui]);

  const moveTab = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = (index + 1) % sections.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (index - 1 + sections.length) % sections.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = sections.length - 1;
    else return;
    event.preventDefault();
    setSettingsSection(sections[next].id);
    document.getElementById(`settings-tab-${sections[next].id}`)?.focus();
  };

  const save = async (patch: Parameters<typeof prefs.updateSettings>[0]) => {
    prefs.updateSettings(patch);
    try {
      await usePreferencesStore.getState().persistSettings();
    } catch (err) {
      showToast(`${ui.settings.saveError}: ${localizeAppError(err, ui)}`, "error", 6000);
    }
  };

  /** Applies one of the scan-profile presets (depth/candidates/timeout). */
  const setProfile = (profile: string) => {
    const defaults = PROFILE_DEFAULTS[profile] ?? PROFILE_DEFAULTS.balanced;
    save({ scanProfile: profile, ...defaults });
  };

  return (
    <div className="settings-page">
      <PageHeader title={ui.nav.settings} description={ui.settings.subtitle} />

      {catalog && !catalog.valid && (
        <details className="items-warning catalog-warning" style={{ marginBottom: 12 }}>
          <summary>
            <AlertTriangle size={13} /> {ui.about.kpiCatalog} · {ui.errors.title}
          </summary>
          {/* The raw error comes from the backend, so it is translated through
              the shared backend dictionary before being shown. */}
          <p style={{ margin: "var(--space-2) 0 0" }}>
            {translateBackendText(catalog.error ?? "", prefs.language)}
          </p>
        </details>
      )}

      {/* Shared Bento KPI Strip for Settings */}
      <div className="nc-bento-strip nc-bento-strip--3">
        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{ui.settings.kpiAppearance}</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--accent">
              <Palette size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value" style={{ fontSize: "var(--text-lg)" }}>
              {themeLabel(prefs.theme, ui)}
            </span>
            <span className="nc-kpi-card-sub">
              {ui.settings.language}: {resolveUiLocale(prefs.language).toUpperCase()} ·{" "}
              {prefs.reduceMotion ? ui.settings.reducedMotion : ui.settings.standardMotion}
            </span>
          </div>
        </div>

        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{ui.settings.kpiScanProfile}</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--success">
              <Cpu size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value" style={{ fontSize: "var(--text-lg)" }}>
              {prefs.scanProfile.toUpperCase()}
            </span>
            <span className="nc-kpi-card-sub">
              {ui.settings.maxDepth}: {prefs.maxDepth} · {ui.settings.maxCandidates}:{" "}
              {(prefs.maxCandidates / 1000).toFixed(0)}k
            </span>
          </div>
        </div>

        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{ui.settings.kpiSecurity}</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--purple">
              <ShieldCheck size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value" style={{ fontSize: "var(--text-lg)" }}>
              {ui.settings.kpiFoldersDefined(prefs.protectedPaths.length)}
            </span>
            <span className="nc-kpi-card-sub">
              {ui.settings.kpiRulesDefined(prefs.excludedNames.length)}
            </span>
          </div>
        </div>
      </div>

      {/* Modern Subpage Horizontal Tabs */}
      <div className="settings-tabs" role="tablist" aria-label={ui.nav.settings}>
        {sections.map((item, index) => {
          const active = item.id === activeSection.id;
          return (
            <button
              key={item.id}
              id={`settings-tab-${item.id}`}
              type="button"
              role="tab"
              className={`settings-tab ${active ? "is-active" : ""}`}
              onClick={() => setSettingsSection(item.id)}
              onKeyDown={(event) => moveTab(event, index)}
              aria-selected={active}
              aria-controls="settings-panel"
              tabIndex={active ? 0 : -1}
            >
              <span className="settings-tab-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="settings-tab-label">{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className="settings-tabs-mobile">
        <label className="sr-only" htmlFor="settings-section-select">
          {ui.nav.settings}
        </label>
        <select
          id="settings-section-select"
          value={activeSection.id}
          onChange={(event) =>
            setSettingsSection(event.target.value as (typeof sections)[number]["id"])
          }
        >
          {sections.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      <div className="settings-section-header">
        <span className="settings-section-icon" aria-hidden="true">
          {activeSection.icon}
        </span>
        <div className="settings-section-copy">
          <span className="settings-section-title">{activeSection.label}</span>
          <span className="settings-section-hint">{activeSection.hint}</span>
        </div>
      </div>

      <div
        className="settings-body"
        id="settings-panel"
        role="tabpanel"
        aria-labelledby={`settings-tab-${activeSection.id}`}
      >
        {activeSection.id === "general" && (
          <section className="settings-card">
            <label className="form-row">
              <span>{ui.settings.theme}</span>
              <select value={prefs.theme} onChange={(e) => prefs.setTheme(e.target.value)}>
                {THEMES.map((theme) => (
                  <option key={theme} value={theme}>
                    {themeLabel(theme, ui)}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-row">
              <span>{ui.settings.language}</span>
              <select
                value={resolveUiLocale(prefs.language)}
                onChange={(e) => prefs.setLanguage(e.target.value as SupportedLanguage)}
              >
                {uiLanguages.map((language) => (
                  <option key={language.id} value={language.id}>
                    {language.nativeName}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-row">
              <span>{ui.settings.reduceMotion}</span>
              <Switch
                checked={prefs.reduceMotion}
                onLabel={ui.common.on}
                offLabel={ui.common.off}
                aria-label={ui.settings.reduceMotion}
                onChange={(v) => prefs.setReduceMotion(v)}
              />
            </div>
            <label className="form-row">
              <span>{ui.settings.sidebar}</span>
              <select
                value={prefs.sidebarMode}
                onChange={(e) =>
                  prefs.setSidebarMode(e.target.value === "collapsed" ? "collapsed" : "expanded")
                }
              >
                <option value="expanded">{ui.settings.sidebarExpanded}</option>
                <option value="collapsed">{ui.settings.sidebarCollapsed}</option>
              </select>
            </label>
            <label className="form-row">
              <span>{ui.settings.closeAction}</span>
              <select
                value={prefs.closeAction}
                onChange={(e) =>
                  prefs.setCloseAction(
                    e.target.value === "tray" || e.target.value === "quit" ? e.target.value : "ask",
                  )
                }
              >
                <option value="ask">{ui.settings.closeAsk}</option>
                <option value="tray">{ui.settings.closeTray}</option>
                <option value="quit">{ui.settings.closeQuit}</option>
              </select>
            </label>
            <label className="form-row">
              <span>{ui.settings.cacheMeasure}</span>
              <select
                value={prefs.cacheMeasureMode}
                onChange={(e) =>
                  prefs.setCacheMeasureMode(e.target.value === "full" ? "full" : "fast")
                }
              >
                <option value="fast">{ui.settings.cacheMeasureFast}</option>
                <option value="full">{ui.settings.cacheMeasureFull}</option>
              </select>
            </label>
          </section>
        )}

        {activeSection.id === "scan" && (
          <section className="settings-card">
            <label className="form-row">
              <span>{ui.settings.scanProfile}</span>
              <select value={prefs.scanProfile} onChange={(e) => setProfile(e.target.value)}>
                <option value="fast">{ui.settings.profileFast}</option>
                <option value="balanced">{ui.settings.profileBalanced}</option>
                <option value="deep">{ui.settings.profileDeep}</option>
              </select>
            </label>
            <div className="form-row">
              <span>{ui.settings.maxDepth}</span>
              <NumberField
                value={prefs.maxDepth}
                min={SETTING_LIMITS.maxDepth.min}
                max={SETTING_LIMITS.maxDepth.max}
                ariaLabel={ui.settings.maxDepth}
                increaseLabel={ui.common.increase}
                decreaseLabel={ui.common.decrease}
                onCommit={(v) => save({ maxDepth: v })}
              />
            </div>
            <div className="form-row">
              <span>{ui.settings.maxCandidates}</span>
              <NumberField
                value={prefs.maxCandidates}
                min={SETTING_LIMITS.maxCandidates.min}
                max={SETTING_LIMITS.maxCandidates.max}
                step={1000}
                ariaLabel={ui.settings.maxCandidates}
                increaseLabel={ui.common.increase}
                decreaseLabel={ui.common.decrease}
                onCommit={(v) => save({ maxCandidates: v })}
              />
            </div>
            <div className="form-row">
              <span>{ui.settings.timeout}</span>
              <NumberField
                value={prefs.timeoutMinutes}
                min={SETTING_LIMITS.timeoutMinutes.min}
                max={SETTING_LIMITS.timeoutMinutes.max}
                ariaLabel={ui.settings.timeout}
                increaseLabel={ui.common.increase}
                decreaseLabel={ui.common.decrease}
                onCommit={(v) => save({ timeoutMinutes: v })}
              />
            </div>
            <div className="form-row">
              <span>{ui.settings.minSize}</span>
              <NumberField
                value={Math.round(prefs.minSizeBytes / (1024 * 1024))}
                min={SETTING_LIMITS.minSizeBytes.min}
                max={SETTING_LIMITS.minSizeBytes.max / (1024 * 1024)}
                ariaLabel={ui.settings.minSize}
                increaseLabel={ui.common.increase}
                decreaseLabel={ui.common.decrease}
                onCommit={(v) => save({ minSizeBytes: v * 1024 * 1024 })}
              />
            </div>
          </section>
        )}

        {activeSection.id === "notifications" && (
          <section className="settings-card">
            <div
              className="settings-banner"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <div>
                <h3 className="settings-group-title" style={{ margin: 0 }}>
                  {ui.settings.notifTitle}
                </h3>
                <p className="settings-hint" style={{ margin: "4px 0 0" }}>
                  {ui.settings.notifDesc}
                </p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Bell size={13} />}
                  onClick={() => notificationService.testDesktopNotification()}
                >
                  {ui.settings.testDesktop}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => notificationService.testInAppNotification()}
                >
                  {ui.settings.testInApp}
                </Button>
              </div>
            </div>

            <div className="form-row">
              <div>
                <span>{ui.settings.notifSounds}</span>
                <p className="settings-hint">{ui.settings.notifSoundsHint}</p>
              </div>
              <Switch
                checked={prefs.notifications?.soundEnabled ?? true}
                onChange={(checked) => updateNotify("soundEnabled", checked)}
                aria-label={ui.settings.notifSounds}
              />
            </div>

            <h4 className="settings-group-title" style={{ marginTop: 20, marginBottom: 8 }}>
              {ui.settings.eventMatrixTitle}
            </h4>

            <label className="form-row">
              <div>
                <span>{ui.settings.evScanDone}</span>
                <p className="settings-hint">{ui.settings.evScanDoneHint}</p>
              </div>
              <select
                value={prefs.notifications?.scanComplete ?? "both"}
                onChange={(e) =>
                  updateNotify("scanComplete", e.target.value as NotificationChannel)
                }
              >
                <option value="both">{ui.settings.chBoth}</option>
                <option value="in_app">{ui.settings.chInApp}</option>
                <option value="desktop">{ui.settings.chDesktop}</option>
                <option value="none">{ui.settings.chNone}</option>
              </select>
            </label>

            <label className="form-row">
              <div>
                <span>{ui.settings.evCleanDone}</span>
                <p className="settings-hint">{ui.settings.evCleanDoneHint}</p>
              </div>
              <select
                value={prefs.notifications?.cleanComplete ?? "both"}
                onChange={(e) =>
                  updateNotify("cleanComplete", e.target.value as NotificationChannel)
                }
              >
                <option value="both">{ui.settings.chBoth}</option>
                <option value="in_app">{ui.settings.chInApp}</option>
                <option value="desktop">{ui.settings.chDesktop}</option>
                <option value="none">{ui.settings.chNone}</option>
              </select>
            </label>

            <label className="form-row">
              <div>
                <span>{ui.settings.evDiskAlert}</span>
                <p className="settings-hint">{ui.settings.evDiskAlertHint}</p>
              </div>
              <select
                value={prefs.notifications?.diskPressure ?? "both"}
                onChange={(e) =>
                  updateNotify("diskPressure", e.target.value as NotificationChannel)
                }
              >
                <option value="both">{ui.settings.chBoth}</option>
                <option value="in_app">{ui.settings.chInApp}</option>
                <option value="desktop">{ui.settings.chDesktop}</option>
                <option value="none">{ui.settings.chNone}</option>
              </select>
            </label>

            <label className="form-row">
              <div>
                <span>{ui.settings.evLockConflict}</span>
                <p className="settings-hint">{ui.settings.evLockConflictHint}</p>
              </div>
              <select
                value={prefs.notifications?.processLock ?? "in_app"}
                onChange={(e) => updateNotify("processLock", e.target.value as NotificationChannel)}
              >
                <option value="both">{ui.settings.chBoth}</option>
                <option value="in_app">{ui.settings.chInApp}</option>
                <option value="desktop">{ui.settings.chDesktop}</option>
                <option value="none">{ui.settings.chNone}</option>
              </select>
            </label>

            <label className="form-row">
              <div>
                <span>{ui.settings.evAutomation}</span>
                <p className="settings-hint">{ui.settings.evAutomationHint}</p>
              </div>
              <select
                value={prefs.notifications?.automationWebhook ?? "both"}
                onChange={(e) =>
                  updateNotify("automationWebhook", e.target.value as NotificationChannel)
                }
              >
                <option value="both">{ui.settings.chBoth}</option>
                <option value="in_app">{ui.settings.chInApp}</option>
                <option value="desktop">{ui.settings.chDesktop}</option>
                <option value="none">{ui.settings.chNone}</option>
              </select>
            </label>
          </section>
        )}

        {activeSection.id === "shortcuts" && (
          <section className="settings-card">
            <div className="shortcuts-header-row">
              <div>
                <h3 className="settings-group-title">{ui.settings.shortcutsTitle}</h3>
                <p className="settings-hint">{ui.settings.shortcutsDesc}</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  prefs.resetShortcuts();
                  setConflictWarning(null);
                  setRecordingId(null);
                  void (async () => {
                    try {
                      await usePreferencesStore.getState().persistSettings();
                      showToast(ui.settings.toastShortcutsReset, "info", 2000);
                    } catch (err) {
                      showToast(
                        `${ui.settings.saveError}: ${localizeAppError(err, ui)}`,
                        "error",
                        6000,
                      );
                    }
                  })();
                }}
              >
                <RotateCcw size={13} style={{ marginRight: 6 }} />
                {ui.settings.resetShortcuts}
              </Button>
            </div>

            {conflictWarning && (
              <div className="shortcut-conflict-alert" role="alert">
                <AlertTriangle size={15} />
                <span>{conflictWarning}</span>
              </div>
            )}

            <table className="shortcuts-table">
              <thead>
                <tr>
                  <th style={{ width: "35%" }}>{ui.settings.thAction}</th>
                  <th style={{ width: "40%" }}>{ui.settings.thDesc}</th>
                  <th style={{ width: "25%", textAlign: "right" }}>{ui.settings.thShortcut}</th>
                </tr>
              </thead>
              <tbody>
                {shortcutDefs.map((def) => {
                  const currentShortcut =
                    (prefs.shortcuts ?? DEFAULT_SHORTCUTS)[def.id] ?? DEFAULT_SHORTCUTS[def.id];
                  const isRecording = recordingId === def.id;

                  return (
                    <tr key={def.id}>
                      <td>
                        <span className="shortcut-action-name">{def.label}</span>
                      </td>
                      <td>
                        <span className="shortcut-action-hint">{def.hint}</span>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          {isRecording ? (
                            <span className="shortcut-recording-badge">{ui.settings.pressKey}</span>
                          ) : (
                            <span className="shortcut-key-badge">{currentShortcut}</span>
                          )}

                          <Button
                            variant={isRecording ? "primary" : "secondary"}
                            size="sm"
                            onClick={() => {
                              if (isRecording) {
                                setRecordingId(null);
                                setConflictWarning(null);
                              } else {
                                setConflictWarning(null);
                                setRecordingId(def.id);
                              }
                            }}
                          >
                            {isRecording ? ui.common.cancel : ui.settings.changeKey}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        {activeSection.id === "automation" && (
          <section className="settings-card">
            <h3 className="settings-group-title">{ui.settings.webhookTitle}</h3>
            <p className="settings-hint" style={{ marginBottom: 16 }}>
              {ui.settings.webhookDesc}
            </p>

            <div className="form-row form-row--stretch">
              <input
                type="url"
                placeholder={ui.settings.webhookPlaceholder}
                value={webhookDraft ?? prefs.webhookUrl ?? ""}
                onChange={(e) => setWebhookDraft(e.target.value)}
                onBlur={commitWebhook}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitWebhook();
                  }
                }}
                aria-label={ui.settings.webhookUrl}
              />
              <Button
                variant="primary"
                size="sm"
                icon={<Send size={13} />}
                onClick={handleTestWebhook}
                disabled={testingWebhook || (!prefs.webhookUrl && !webhookDraft?.trim())}
              >
                {testingWebhook ? ui.settings.webhookSending : ui.settings.webhookTestBtn}
              </Button>
            </div>

            {webhookTestStatus && (
              <p
                className="plan-note"
                style={{
                  marginTop: 8,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  color: webhookTestStatus.success ? "var(--color-success)" : "var(--color-danger)",
                }}
              >
                {webhookTestStatus.success ? <Check size={14} /> : <X size={14} />}
                <span>{webhookTestStatus.text}</span>
              </p>
            )}

            <div className="form-row" style={{ marginTop: 16 }}>
              <div>
                <span>{ui.settings.webhookScanDone}</span>
                <p className="settings-hint">{ui.settings.webhookScanDoneHint}</p>
              </div>
              <Switch
                checked={prefs.webhookOnScan ?? true}
                onChange={(checked) => save({ webhookOnScan: checked })}
                aria-label={ui.settings.webhookScanDone}
              />
            </div>

            <div className="form-row">
              <div>
                <span>{ui.settings.webhookCleanDone}</span>
                <p className="settings-hint">{ui.settings.webhookCleanDoneHint}</p>
              </div>
              <Switch
                checked={prefs.webhookOnClean ?? true}
                onChange={(checked) => save({ webhookOnClean: checked })}
                aria-label={ui.settings.webhookCleanDone}
              />
            </div>

            <div className="form-row">
              <div>
                <span>{ui.settings.mcpDestructiveTitle}</span>
                <p className="settings-hint">{ui.settings.mcpDestructiveHint}</p>
              </div>
              <Switch
                checked={prefs.mcpAllowDestructive ?? false}
                onChange={(checked) => save({ mcpAllowDestructive: checked })}
                aria-label={ui.settings.mcpDestructiveTitle}
              />
            </div>
          </section>
        )}

        {activeSection.id === "protections" && (
          <>
            <section className="settings-card">
              <h3 className="settings-group-title">{ui.settings.protectedPaths}</h3>
              <div className="form-row form-row--stretch">
                <input
                  type="text"
                  placeholder={ui.settings.addPath}
                  value={protectedInput}
                  aria-label={ui.settings.protectedPaths}
                  onChange={(e) => setProtectedInput(e.target.value)}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<FolderOpen size={12} />}
                  onClick={async () => {
                    const selected = await scannerApi.selectFolderDialog(
                      ui.settings.protectedPaths,
                    );
                    if (selected) setProtectedInput(selected);
                  }}
                >
                  {ui.common.browse}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={12} />}
                  onClick={() => {
                    const value = protectedInput.trim();
                    if (!value) return;
                    // A relative path never matches a scanned absolute path, so
                    // the user would believe a folder was protected while it
                    // was not. Reject it with an explanation instead of storing
                    // a rule that can never fire.
                    const isAbsolute = /^[A-Za-z]:\\/.test(value) || value.startsWith("\\\\");
                    if (!isAbsolute) {
                      showToast(ui.settings.pathMustBeAbsolute, "warning");
                      return;
                    }
                    const normalized = value.replace(/[\\/]+$/, "");
                    if (
                      !prefs.protectedPaths.some(
                        (p) => p.toLowerCase() === normalized.toLowerCase(),
                      )
                    ) {
                      save({ protectedPaths: [...prefs.protectedPaths, normalized] });
                    }
                    setProtectedInput("");
                  }}
                >
                  {ui.common.add}
                </Button>
              </div>
              <div className="list-editor">
                {prefs.protectedPaths.length === 0 && (
                  <span className="plan-note">{ui.common.none}</span>
                )}
                {prefs.protectedPaths.map((path) => (
                  <div key={path} className="list-row">
                    <span>{path}</span>
                    <button
                      type="button"
                      className="icon-btn icon-btn-sm"
                      aria-label={`${ui.settings.remove}: ${path}`}
                      onClick={() =>
                        save({ protectedPaths: prefs.protectedPaths.filter((p) => p !== path) })
                      }
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="settings-card">
              <h3 className="settings-group-title">{ui.settings.excludedNames}</h3>
              <div className="form-row form-row--stretch">
                <input
                  type="text"
                  placeholder={ui.settings.excludedNames}
                  value={excludedInput}
                  aria-label={ui.settings.excludedNames}
                  onChange={(e) => setExcludedInput(e.target.value)}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={12} />}
                  onClick={() => {
                    const value = excludedInput.trim();
                    if (!value) return;
                    // Rules are matched against a single path segment; a value
                    // containing a separator silently never matched.
                    if (/[\\/]/.test(value)) {
                      showToast(ui.settings.excludedNameInvalid, "warning");
                      return;
                    }
                    const normalized = value.toLowerCase();
                    if (!prefs.excludedNames.some((n) => n.toLowerCase() === normalized)) {
                      save({ excludedNames: [...prefs.excludedNames, value] });
                    }
                    setExcludedInput("");
                  }}
                >
                  {ui.common.add}
                </Button>
              </div>
              <div className="list-editor">
                {prefs.excludedNames.length === 0 && (
                  <span className="plan-note">{ui.common.none}</span>
                )}
                {prefs.excludedNames.map((name) => (
                  <div key={name} className="list-row">
                    <span>{name}</span>
                    <button
                      type="button"
                      className="icon-btn icon-btn-sm"
                      aria-label={`${ui.settings.remove}: ${name}`}
                      onClick={() =>
                        save({ excludedNames: prefs.excludedNames.filter((n) => n !== name) })
                      }
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {activeSection.id === "agents" && (
          <section className="settings-card">
            <div className="form-row">
              <span>{ui.settings.agentCacheCleanup}</span>
              <Switch
                checked={prefs.agentPolicy.allowCacheCleanup}
                onLabel={ui.common.on}
                offLabel={ui.common.off}
                aria-label={ui.settings.agentCacheCleanup}
                onChange={(v) =>
                  save({ agentPolicy: { ...prefs.agentPolicy, allowCacheCleanup: v } })
                }
              />
            </div>
            <div className="form-row">
              <span>{ui.settings.browserRecordings}</span>
              <Switch
                checked={prefs.agentPolicy.protectBrowserRecordings}
                onLabel={ui.common.on}
                offLabel={ui.common.off}
                aria-label={ui.settings.browserRecordings}
                onChange={(v) =>
                  save({ agentPolicy: { ...prefs.agentPolicy, protectBrowserRecordings: v } })
                }
              />
            </div>
            <div
              className="plan-note"
              style={{ display: "flex", gap: 6, alignItems: "flex-start" }}
            >
              <ShieldCheck size={14} /> {ui.agents.subtitle}
            </div>
          </section>
        )}

        {activeSection.id === "privacy" && (
          <PrivacySection
            maskPaths={prefs.maskPaths}
            historyEnabled={prefs.historyEnabled}
            scanBusy={scanBusy}
            onSave={(patch) => void save(patch)}
          />
        )}

        {activeSection.id === "about" && (
          <AboutView
            buildInfo={buildInfo}
            catalog={catalog}
            catalogStats={catalogStats}
            isStandalone={false}
          />
        )}
      </div>
    </div>
  );
};
