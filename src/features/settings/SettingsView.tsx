import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Cpu,
  Eye,
  Minus,
  Palette,
  Plus,
  RotateCcw,
  Settings,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { Switch } from "@/components/primitives/Switch";
import { NumberField } from "@/components/primitives/NumberField";
import { PageHeader } from "@/components/primitives/PageHeader";
import {
  usePreferencesStore,
  SETTING_LIMITS,
  UI_SCALE_LIMITS,
  UI_SCALE_PRESETS,
} from "@/stores/preferences-store";
import { CUSTOM_THEME_ID } from "@/lib/theme/custom-theme";
import { useScanStore } from "@/stores/scan-store";
import { useShallow } from "zustand/react/shallow";
import { useUiStore } from "@/stores/ui-store";
import { useUIText, resolveUiLocale, localizeAppError, getUIText } from "@/lib/ui-text";
import { translateBackendText } from "@/lib/ui-text/backend-i18n";
import { LANGUAGES_LIST } from "@/locales/languages";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { normalizeWebhookUrl } from "@/lib/validation/webhook-url";
import { classifyWebhookFailure, describeWebhookFailure } from "@/lib/errors/webhook-failure";
import {
  BuildInfo,
  CatalogDto,
  DEFAULT_SHORTCUTS,
  NotificationChannel,
  NotificationPreferences,
  SupportedLanguage,
} from "@/types";
import { comboFromEvent, validateShortcut } from "@/lib/shortcuts";
import { log } from "@/lib/logging";
import { APP_VERSION } from "@/lib/app-version";
import { useSettingsSections } from "./settings-sections";
import { PrivacySection } from "./PrivacySection";
import { UpdatePanel } from "./UpdatePanel";
import { SettingsDiagnostics } from "./SettingsDiagnostics";
import { SettingsNotificationsSection } from "./SettingsNotificationsSection";
import { SettingsShortcutsSection } from "./SettingsShortcutsSection";
import { SettingsAutomationSection } from "./SettingsAutomationSection";
import { SettingsProtectionsSection } from "./SettingsProtectionsSection";
import {
  PROFILE_DEFAULTS,
  PROFILE_KEYS,
  profileLabel,
  SettingsDialogs,
  THEMES,
  themeLabel,
} from "./SettingsDialogs";
import { ThemeQuickStrip } from "./CustomThemeBuilder";
import { AppIconPicker } from "./AppIconPicker";
import "../items/items.css";
import "../shell/shell.css";
import "./settings.css";

function persistWebhookDraft(draft: string, reportFailure = false): boolean {
  const store = usePreferencesStore.getState();
  const result = normalizeWebhookUrl(draft, { allowPrivate: store.allowPrivateWebhooks ?? false });
  if (!result.ok) return false;
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
  const prefs = usePreferencesStore(
    useShallow((s) => ({
      theme: s.theme,
      customTheme: s.customTheme,
      appIcon: s.appIcon,
      uiScale: s.uiScale,
      highContrast: s.highContrast,
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
      allowPrivateWebhooks: s.allowPrivateWebhooks,
      agentPolicy: s.agentPolicy,
      updateSettings: s.updateSettings,
      setTheme: s.setTheme,
      setCustomTheme: s.setCustomTheme,
      setAppIcon: s.setAppIcon,
      setUiScale: s.setUiScale,
      setHighContrast: s.setHighContrast,
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
  const openOnboarding = useUiStore((s) => s.openOnboarding);
  const scanStatus = useScanStore((s) => s.status);
  const scanBusy =
    scanStatus === "scanning" || scanStatus === "measuring" || scanStatus === "cancelling";

  const [catalog, setCatalog] = useState<CatalogDto | null>(null);
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [appearanceTab, setAppearanceTab] = useState<"theme" | "icon" | "language">("theme");
  const [profileOpen, setProfileOpen] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [webhookTestStatus, setWebhookTestStatus] = useState<{
    success: boolean;
    text: string;
  } | null>(null);
  const [webhookDraft, setWebhookDraft] = useState<string | null>(null);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    scannerApi
      .getCatalog()
      .then((cat) => {
        if (!cancelled) setCatalog(cat);
      })
      .catch((err) => {
        if (cancelled) return;
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

  const webhookDraftRef = useRef(webhookDraft);
  useEffect(() => {
    webhookDraftRef.current = webhookDraft;
  }, [webhookDraft]);

  useEffect(() => {
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
      { id: "navSystem", label: ui.nav.system, hint: ui.system.subtitle },
    ],
    [ui.settings, ui.nav.system, ui.system.subtitle],
  );

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
  }, [recordingId, prefs.shortcuts, prefs.setShortcut, shortcutDefs, showToast, ui]);

  const save = async (patch: Parameters<typeof prefs.updateSettings>[0]) => {
    prefs.updateSettings(patch);
    try {
      await usePreferencesStore.getState().persistSettings();
    } catch (err) {
      showToast(`${ui.settings.saveError}: ${localizeAppError(err, ui)}`, "error", 6000);
    }
  };

  const updateNotify = (
    key: keyof NotificationPreferences,
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
    void save({ notifications: { ...current, [key]: channel } });
  };

  const commitWebhook = (): boolean => {
    if (webhookDraft === null) return true;
    if (!persistWebhookDraft(webhookDraft, true)) {
      showToast(ui.settings.webhookUrlEmpty, "warning");
      return false;
    }
    setWebhookDraft(null);
    return true;
  };

  const handleTestWebhook = async () => {
    if (!commitWebhook()) return;
    const storeState = usePreferencesStore.getState();
    const url = storeState.webhookUrl?.trim();
    if (!url) {
      showToast(ui.settings.webhookUrlEmpty, "warning");
      return;
    }
    setTestingWebhook(true);
    setWebhookTestStatus(null);
    try {
      const result = await scannerApi.testWebhook(
        url,
        {
          event: "test_ping",
          timestamp: new Date().toISOString(),
          product: "Detergo by Vellium",
          message: ui.settings.webhookSent,
        },
        storeState.allowPrivateWebhooks ?? false,
      );
      if (result.ok) {
        setWebhookTestStatus({ success: true, text: ui.settings.webhookSent });
        showToast(ui.settings.webhookSent, "success");
      } else {
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

  const setProfile = (profile: string) => {
    const defaults = PROFILE_DEFAULTS[profile] ?? PROFILE_DEFAULTS.balanced;
    void save({ scanProfile: profile, ...defaults });
  };

  const sections = useSettingsSections();
  const activeSection = sections.find((s) => s.id === section) ?? sections[0];

  const sectionGroups = useMemo(
    () => [
      {
        id: "preferences",
        title: ui.settings.groupPreferences,
        items: sections.filter((s) =>
          ["general", "scan", "notifications", "shortcuts"].includes(s.id),
        ),
      },
      {
        id: "safety",
        title: ui.settings.groupSafety,
        items: sections.filter((s) =>
          ["protections", "agents", "automation", "privacy"].includes(s.id),
        ),
      },
      {
        id: "maintenance",
        title: ui.settings.groupMaintenance,
        items: sections.filter((s) => ["updates", "diagnostics"].includes(s.id)),
      },
    ],
    [sections, ui.settings],
  );

  const flatGroupedSections = useMemo(() => sectionGroups.flatMap((g) => g.items), [sectionGroups]);

  const moveGroupedTab = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = (index + 1) % flatGroupedSections.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (index - 1 + flatGroupedSections.length) % flatGroupedSections.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = flatGroupedSections.length - 1;
    else return;
    event.preventDefault();
    setSettingsSection(flatGroupedSections[next].id);
    document.getElementById(`settings-tab-${flatGroupedSections[next].id}`)?.focus();
  };

  const appVersion = buildInfo?.version ?? APP_VERSION;

  return (
    <div className="split-layout settings-split-layout">
      <aside className="split-sidebar" aria-label={ui.nav.settings}>
        <div className="split-sidebar-header">
          <Settings size={18} className="split-sidebar-header-icon" aria-hidden="true" />
          <h2 className="split-sidebar-title">{ui.nav.settings}</h2>
        </div>

        <div
          className="split-sidebar-scroll"
          role="tablist"
          aria-orientation="vertical"
          aria-label={ui.nav.settings}
        >
          {sectionGroups.map((group) => (
            <div key={group.id} className="split-nav-group">
              <span className="split-nav-group-title">{group.title}</span>
              {group.items.map((item) => {
                const active = item.id === activeSection.id;
                const flatIndex = flatGroupedSections.findIndex((s) => s.id === item.id);
                return (
                  <button
                    key={item.id}
                    id={`settings-tab-${item.id}`}
                    type="button"
                    role="tab"
                    className={`split-nav-link ${active ? "active" : ""}`}
                    onClick={() => setSettingsSection(item.id)}
                    onKeyDown={(event) => moveGroupedTab(event, flatIndex)}
                    aria-selected={active}
                    aria-controls="settings-panel"
                    tabIndex={active ? 0 : -1}
                  >
                    <span className="split-nav-link-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span className="split-nav-link-label">{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </aside>

      <div className="split-content-pane">
        <div className="split-content-inner settings-page">
          <PageHeader title={activeSection.label} description={activeSection.hint} />

          {catalog && !catalog.valid && (
            <details className="items-warning catalog-warning" style={{ marginBottom: 4 }}>
              <summary>
                <AlertTriangle size={13} /> {ui.about.kpiCatalog} · {ui.errors.title}
              </summary>
              <p style={{ margin: "var(--space-2) 0 0" }}>
                {translateBackendText(catalog.error ?? "", prefs.language)}
              </p>
            </details>
          )}

          <div className="nc-bento-strip nc-bento-strip--3">
            <button
              type="button"
              className="nc-kpi-card settings-kpi-action"
              onClick={() => {
                setAppearanceTab("theme");
                setAppearanceOpen(true);
              }}
              aria-haspopup="dialog"
            >
              <div className="nc-kpi-card-header">
                <span className="nc-kpi-card-label">{ui.settings.kpiAppearance}</span>
                <span className="nc-kpi-card-icon nc-kpi-card-icon--accent">
                  <Palette size={14} />
                </span>
              </div>
              <div className="nc-kpi-card-body">
                <span className="nc-kpi-card-value">{themeLabel(prefs.theme, ui)}</span>
                <span className="nc-kpi-card-sub">
                  {ui.settings.language}: {resolveUiLocale(prefs.language).toUpperCase()} ·{" "}
                  {prefs.uiScale}% ·{" "}
                  {prefs.reduceMotion ? ui.settings.reducedMotion : ui.settings.standardMotion}
                </span>
              </div>
            </button>

            <button
              type="button"
              className="nc-kpi-card settings-kpi-action"
              onClick={() => setProfileOpen(true)}
              aria-haspopup="dialog"
            >
              <div className="nc-kpi-card-header">
                <span className="nc-kpi-card-label">{ui.settings.kpiScanProfile}</span>
                <span className="nc-kpi-card-icon nc-kpi-card-icon--success">
                  <Cpu size={14} />
                </span>
              </div>
              <div className="nc-kpi-card-body">
                <span className="nc-kpi-card-value">
                  {profileLabel(prefs.scanProfile || "balanced", ui)}
                </span>
                <span className="nc-kpi-card-sub">
                  {ui.settings.maxDepth}: {prefs.maxDepth} · {ui.settings.maxCandidates}:{" "}
                  {(prefs.maxCandidates / 1000).toFixed(0)}k
                </span>
              </div>
            </button>

            <button
              type="button"
              className="nc-kpi-card settings-kpi-action"
              onClick={() => setSettingsSection("protections")}
              title={ui.settings.securityOpen}
            >
              <div className="nc-kpi-card-header">
                <span className="nc-kpi-card-label">{ui.settings.kpiSecurity}</span>
                <span className="nc-kpi-card-icon nc-kpi-card-icon--purple">
                  <ShieldCheck size={14} />
                </span>
              </div>
              <div className="nc-kpi-card-body">
                <span className="nc-kpi-card-value">
                  {ui.settings.kpiFoldersDefined(prefs.protectedPaths.length)}
                </span>
                <span className="nc-kpi-card-sub">
                  {ui.settings.kpiRulesDefined(prefs.excludedNames.length)}
                </span>
              </div>
            </button>
          </div>

          <div
            className="settings-body"
            id="settings-panel"
            role="tabpanel"
            aria-labelledby={`settings-tab-${activeSection.id}`}
          >
            {activeSection.id === "general" && (
              <>
                <section className="settings-card">
                  <label className="form-row">
                    <span>{ui.settings.theme}</span>
                    <select value={prefs.theme} onChange={(e) => prefs.setTheme(e.target.value)}>
                      {THEMES.map((theme) => (
                        <option key={theme} value={theme}>
                          {themeLabel(theme, ui)}
                        </option>
                      ))}
                      <option value={CUSTOM_THEME_ID}>{ui.settings.themeCustom}</option>
                    </select>
                  </label>

                  <ThemeQuickStrip
                    ui={ui}
                    theme={prefs.theme}
                    customTheme={prefs.customTheme}
                    themes={THEMES}
                    themeLabelFn={themeLabel}
                    onSelectTheme={prefs.setTheme}
                    onChangeCustomTheme={prefs.setCustomTheme}
                  />

                  <label className="form-row">
                    <span>{ui.settings.language}</span>
                    <select
                      value={resolveUiLocale(prefs.language)}
                      onChange={(e) => prefs.setLanguage(e.target.value as SupportedLanguage)}
                    >
                      {LANGUAGES_LIST.map((language) => (
                        <option key={language.id} value={language.id}>
                          {language.nativeName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="form-row">
                    <span>{ui.settings.sidebar}</span>
                    <select
                      value={prefs.sidebarMode}
                      onChange={(e) =>
                        prefs.setSidebarMode(
                          e.target.value === "collapsed" ? "collapsed" : "expanded",
                        )
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
                          e.target.value === "tray" || e.target.value === "quit"
                            ? e.target.value
                            : "ask",
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

                <section className="settings-card" aria-label={ui.settings.appIconTitle}>
                  <AppIconPicker
                    ui={ui}
                    appIcon={prefs.appIcon}
                    activeTheme={prefs.theme}
                    customTheme={prefs.customTheme}
                    themes={THEMES}
                    themeLabelFn={themeLabel}
                    onSelectAppIcon={prefs.setAppIcon}
                  />
                </section>

                <section className="settings-card" aria-label={ui.settings.accessibilityTitle}>
                  <div className="settings-card-section-head">
                    <h3 className="settings-group-title">
                      <Eye size={15} aria-hidden="true" />
                      <span>{ui.settings.accessibilityTitle}</span>
                    </h3>
                    <p className="settings-hint">{ui.settings.accessibilityHint}</p>
                  </div>

                  <div className="form-row form-row--wrap">
                    <div className="form-row-copy">
                      <span className="form-row-label">{ui.settings.uiScale}</span>
                      <span className="settings-hint">{ui.settings.uiScaleHint}</span>
                    </div>
                    <div className="zoom-controls" role="group" aria-label={ui.settings.uiScale}>
                      <div className="zoom-stepper">
                        <button
                          type="button"
                          className="zoom-step-btn"
                          aria-label={ui.common.decrease}
                          disabled={prefs.uiScale <= UI_SCALE_LIMITS.min}
                          onClick={() => prefs.setUiScale(prefs.uiScale - 10)}
                        >
                          <Minus size={14} aria-hidden="true" />
                        </button>
                        <span className="zoom-value-badge" data-testid="ui-scale-value">
                          {prefs.uiScale}%
                        </span>
                        <button
                          type="button"
                          className="zoom-step-btn"
                          aria-label={ui.common.increase}
                          disabled={prefs.uiScale >= UI_SCALE_LIMITS.max}
                          onClick={() => prefs.setUiScale(prefs.uiScale + 10)}
                        >
                          <Plus size={14} aria-hidden="true" />
                        </button>
                        {prefs.uiScale !== 100 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<RotateCcw size={12} />}
                            onClick={() => prefs.setUiScale(100)}
                          >
                            {ui.settings.uiScaleReset}
                          </Button>
                        )}
                      </div>
                      <div className="zoom-presets">
                        {UI_SCALE_PRESETS.map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            className={`zoom-preset-pill ${prefs.uiScale === preset ? "is-active" : ""}`}
                            aria-pressed={prefs.uiScale === preset}
                            onClick={() => prefs.setUiScale(preset)}
                          >
                            {preset}%
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-row-copy">
                      <span className="form-row-label">{ui.settings.highContrast}</span>
                      <span className="settings-hint">{ui.settings.highContrastHint}</span>
                    </div>
                    <Switch
                      checked={prefs.highContrast}
                      onLabel={ui.common.on}
                      offLabel={ui.common.off}
                      aria-label={ui.settings.highContrast}
                      onChange={(v) => prefs.setHighContrast(v)}
                    />
                  </div>

                  <div className="form-row">
                    <span className="form-row-label">{ui.settings.reduceMotion}</span>
                    <Switch
                      checked={prefs.reduceMotion}
                      onLabel={ui.common.on}
                      offLabel={ui.common.off}
                      aria-label={ui.settings.reduceMotion}
                      onChange={(v) => prefs.setReduceMotion(v)}
                    />
                  </div>

                  <div className="form-row">
                    <div className="form-row-copy">
                      <span className="form-row-label">{ui.settings.welcomeGuideTitle}</span>
                      <span className="settings-hint">{ui.settings.welcomeGuideHint}</span>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Sparkles size={13} />}
                      onClick={openOnboarding}
                    >
                      {ui.settings.welcomeGuideOpen}
                    </Button>
                  </div>
                </section>
              </>
            )}

            {activeSection.id === "scan" && (
              <section className="settings-card">
                <label className="form-row">
                  <span>{ui.settings.scanProfile}</span>
                  <select
                    value={prefs.scanProfile || "balanced"}
                    onChange={(e) => setProfile(e.target.value)}
                  >
                    {PROFILE_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {profileLabel(key, ui)}
                      </option>
                    ))}
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
                    onCommit={(v) => void save({ maxDepth: v })}
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
                    onCommit={(v) => void save({ maxCandidates: v })}
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
                    onCommit={(v) => void save({ timeoutMinutes: v })}
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
                    onCommit={(v) => void save({ minSizeBytes: v * 1024 * 1024 })}
                  />
                </div>
              </section>
            )}

            {activeSection.id === "notifications" && (
              <SettingsNotificationsSection
                ui={ui}
                notifications={prefs.notifications}
                onUpdate={updateNotify}
              />
            )}

            {activeSection.id === "shortcuts" && (
              <SettingsShortcutsSection
                ui={ui}
                shortcuts={prefs.shortcuts}
                shortcutDefs={shortcutDefs}
                recordingId={recordingId}
                conflictWarning={conflictWarning}
                onStartStopRecord={(id) => {
                  setConflictWarning(null);
                  setRecordingId(id);
                }}
                onResetShortcuts={() => {
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
              />
            )}

            {activeSection.id === "automation" && (
              <SettingsAutomationSection
                ui={ui}
                webhookUrl={prefs.webhookUrl}
                webhookDraft={webhookDraft}
                webhookOnScan={prefs.webhookOnScan}
                webhookOnClean={prefs.webhookOnClean}
                allowPrivateWebhooks={prefs.allowPrivateWebhooks}
                mcpAllowDestructive={prefs.mcpAllowDestructive}
                testingWebhook={testingWebhook}
                webhookTestStatus={webhookTestStatus}
                onDraftChange={setWebhookDraft}
                onCommitWebhook={commitWebhook}
                onTestWebhook={() => void handleTestWebhook()}
                onSave={(patch) => void save(patch)}
              />
            )}

            {activeSection.id === "protections" && (
              <SettingsProtectionsSection
                ui={ui}
                protectedPaths={prefs.protectedPaths}
                excludedNames={prefs.excludedNames}
                onSave={(patch) => void save(patch)}
                onShowToast={showToast}
              />
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
                      void save({ agentPolicy: { ...prefs.agentPolicy, allowCacheCleanup: v } })
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
                      void save({
                        agentPolicy: { ...prefs.agentPolicy, protectBrowserRecordings: v },
                      })
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

            {activeSection.id === "updates" && <UpdatePanel version={appVersion} hideHeader />}

            {activeSection.id === "diagnostics" && <SettingsDiagnostics version={appVersion} />}
          </div>
        </div>
      </div>

      <SettingsDialogs
        ui={ui}
        theme={prefs.theme}
        customTheme={prefs.customTheme}
        appIcon={prefs.appIcon}
        language={prefs.language}
        reduceMotion={prefs.reduceMotion}
        scanProfile={prefs.scanProfile}
        appearanceOpen={appearanceOpen}
        appearanceTab={appearanceTab}
        profileOpen={profileOpen}
        onCloseAppearance={() => setAppearanceOpen(false)}
        onChangeAppearanceTab={setAppearanceTab}
        onCloseProfile={() => setProfileOpen(false)}
        onSelectTheme={(t) => prefs.setTheme(t)}
        onChangeCustomTheme={(patch) => prefs.setCustomTheme(patch)}
        onSelectAppIcon={(id) => prefs.setAppIcon(id)}
        onSelectLanguage={(l) => prefs.setLanguage(l)}
        onToggleReduceMotion={(v) => prefs.setReduceMotion(v)}
        onSelectProfile={setProfile}
      />
    </div>
  );
};
