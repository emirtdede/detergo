import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Plus,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { Checkbox } from "@/components/primitives/Checkbox";
import { NumberField } from "@/components/primitives/NumberField";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore } from "@/stores/ui-store";
import { useUIText } from "@/lib/ui-text";
import { LANGUAGES_LIST } from "@/locales/languages";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { countCatalogStats } from "@/lib/catalog-stats";
import { CatalogDto, BuildInfo, SupportedLanguage, ThemeMode } from "@/types";
import { UIText } from "@/lib/ui-text";
import { useSettingsSections } from "./settings-sections";
import "../items/items.css";
import "../shell/shell.css";

const THEMES: ThemeMode[] = [
  "dark-black", "dark-gray", "dark-blue", "dark-purple", "dark-green",
  "dark-red", "dark-orange", "dark-yellow",
  "light-white", "light-gray", "light-blue", "light-purple", "light-green",
  "light-red", "light-orange", "light-yellow",
];

/**
 * Turns a theme id such as `dark-blue` into a readable label. The raw ids were
 * shown in the select, which read like configuration keys rather than choices.
 */
function themeLabel(theme: ThemeMode, ui: UIText): string {
  const t = ui.settings;
  const colorMap: Record<string, string> = {
    black: t.themeBlack,
    gray: t.themeGray,
    white: t.themeWhite,
    blue: t.themeBlue,
    purple: t.themePurple,
    green: t.themeGreen,
    red: t.themeRed,
    orange: t.themeOrange,
    yellow: t.themeYellow,
  };
  const [mode, color] = theme.split("-");
  const modeLabel = mode === "dark" ? t.themeDark : t.themeLight;
  return `${modeLabel} · ${colorMap[color] ?? color}`;
}

const PROFILE_DEFAULTS: Record<string, { maxDepth: number; maxCandidates: number; timeoutMinutes: number }> = {
  fast: { maxDepth: 16, maxCandidates: 10000, timeoutMinutes: 5 },
  balanced: { maxDepth: 32, maxCandidates: 50000, timeoutMinutes: 15 },
  deep: { maxDepth: 64, maxCandidates: 200000, timeoutMinutes: 30 },
};

export const SettingsView: React.FC = () => {
  const ui = useUIText();
  const prefs = usePreferencesStore();
  const showToast = useUiStore((s) => s.showToast);
  const section = useUiStore((s) => s.settingsSection);
  const [protectedInput, setProtectedInput] = useState("");
  const [excludedInput, setExcludedInput] = useState("");
  const [catalog, setCatalog] = useState<CatalogDto | null>(null);
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);

  useEffect(() => {
    scannerApi
      .getCatalog()
      .then(setCatalog)
      .catch(() => showToast(ui.errors.title, "error"));
  }, [showToast, ui.errors.title]);

  // Which commit this binary was compiled from. Shown in About so a support
  // report and the audited revision can be compared without guessing.
  useEffect(() => {
    scannerApi
      .getBuildInfo()
      .then(setBuildInfo)
      .catch(() => setBuildInfo(null));
  }, []);

  // The catalog holds one entry per cleanup rule; ecosystems and categories are
  // distinct values across those rules, not the rule count itself.
  const catalogStats = useMemo(() => countCatalogStats(catalog?.rules ?? []), [catalog]);

  // The section list lives in the sidebar flyout; the view only needs the
  // active entry for its heading and hint.
  const sections = useSettingsSections();

  const activeSection = sections.find((s) => s.id === section) ?? sections[0];

  const save = async (patch: Parameters<typeof prefs.updateSettings>[0]) => {
    prefs.updateSettings(patch);
    try {
      await usePreferencesStore.getState().persistSettings();
      showToast(ui.settings.saved, "success", 1500);
    } catch (err) {
      const detail =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : String(err);
      showToast(`${ui.settings.saveError}: ${detail}`, "error", 6000);
    }
  };

  const setProfile = (profile: string) => {
    const defaults = PROFILE_DEFAULTS[profile] ?? PROFILE_DEFAULTS.balanced;
    save({ scanProfile: profile, ...defaults });
  };

  return (
    <div>
      {catalog && !catalog.valid && (
        <p className="items-warning" style={{ marginBottom: 12 }}>
          <AlertTriangle size={13} /> {catalog.error}
        </p>
      )}

      <div className="subpage-content">
        <header className="subpage-header">
          <span className="subpage-header-icon" aria-hidden="true">{activeSection.icon}</span>
          <div className="subpage-header-text">
            <span className="subpage-eyebrow">{ui.nav.settings}</span>
            <h1 className="subpage-title">{activeSection.label}</h1>
            <p className="subpage-hint">{activeSection.hint}</p>
          </div>
        </header>

        {activeSection.id === "general" && (
          <section className="settings-card">
            <label className="form-row">
              <span>{ui.settings.theme}</span>
              <select value={prefs.theme} onChange={(e) => prefs.setTheme(e.target.value)}>
                {THEMES.map((theme) => (
                  <option key={theme} value={theme}>{themeLabel(theme, ui)}</option>
                ))}
              </select>
            </label>
            <label className="form-row">
              <span>{ui.settings.language}</span>
              <select
                value={prefs.language ?? "en"}
                onChange={(e) => prefs.setLanguage(e.target.value as SupportedLanguage)}
              >
                {LANGUAGES_LIST.map((language) => (
                  <option key={language.id} value={language.id}>{language.nativeName}</option>
                ))}
              </select>
            </label>
            <div className="form-row">
              <span>{ui.settings.reduceMotion}</span>
              <Checkbox
                checked={prefs.reduceMotion}
                aria-label={ui.settings.reduceMotion}
                onChange={(v) => prefs.setReduceMotion(v)}
              />
            </div>
            <label className="form-row">
              <span>{ui.settings.sidebar}</span>
              <select
                value={prefs.sidebarMode}
                onChange={(e) => prefs.setSidebarMode(e.target.value === "collapsed" ? "collapsed" : "expanded")}
              >
                <option value="expanded">{ui.settings.sidebarExpanded}</option>
                <option value="collapsed">{ui.settings.sidebarCollapsed}</option>
              </select>
            </label>
            <label className="form-row">
              <span>{ui.settings.cacheMeasure}</span>
              <select
                value={prefs.cacheMeasureMode}
                onChange={(e) => prefs.setCacheMeasureMode(e.target.value === "full" ? "full" : "fast")}
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
                min={1}
                max={128}
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
                min={1000}
                max={500000}
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
                min={1}
                max={120}
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
                min={0}
                max={1024 * 1024}
                ariaLabel={ui.settings.minSize}
                increaseLabel={ui.common.increase}
                decreaseLabel={ui.common.decrease}
                onCommit={(v) => save({ minSizeBytes: v * 1024 * 1024 })}
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
                <Button variant="secondary" size="sm" icon={<Plus size={12} />} onClick={() => {
                  const value = protectedInput.trim();
                  if (!value) return;
                  if (!prefs.protectedPaths.some((p) => p.toLowerCase() === value.toLowerCase())) {
                    save({ protectedPaths: [...prefs.protectedPaths, value] });
                  }
                  setProtectedInput("");
                }}>{ui.common.add}</Button>
              </div>
              <div className="list-editor">
                {prefs.protectedPaths.length === 0 && <span className="plan-note">{ui.common.none}</span>}
                {prefs.protectedPaths.map((path) => (
                  <div key={path} className="list-row">
                    <span>{path}</span>
                    <button type="button" className="icon-btn icon-btn-sm" aria-label={ui.settings.remove}
                      onClick={() => save({ protectedPaths: prefs.protectedPaths.filter((p) => p !== path) })}>
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
                <Button variant="secondary" size="sm" icon={<Plus size={12} />} onClick={() => {
                  const value = excludedInput.trim();
                  if (!value) return;
                  save({ excludedNames: [...prefs.excludedNames, value] });
                  setExcludedInput("");
                }}>{ui.common.add}</Button>
              </div>
              <div className="list-editor">
                {prefs.excludedNames.length === 0 && <span className="plan-note">{ui.common.none}</span>}
                {prefs.excludedNames.map((name) => (
                  <div key={name} className="list-row">
                    <span>{name}</span>
                    <button type="button" className="icon-btn icon-btn-sm" aria-label={ui.settings.remove}
                      onClick={() => save({ excludedNames: prefs.excludedNames.filter((n) => n !== name) })}>
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
              <Checkbox
                checked={prefs.agentPolicy.allowCacheCleanup}
                aria-label={ui.settings.agentCacheCleanup}
                onChange={(v) => save({ agentPolicy: { ...prefs.agentPolicy, allowCacheCleanup: v } })}
              />
            </div>
            <div className="form-row">
              <span>{ui.settings.browserRecordings}</span>
              <Checkbox
                checked={prefs.agentPolicy.protectBrowserRecordings}
                aria-label={ui.settings.browserRecordings}
                onChange={(v) => save({ agentPolicy: { ...prefs.agentPolicy, protectBrowserRecordings: v } })}
              />
            </div>
            <div className="plan-note" style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
              <ShieldCheck size={14} /> {ui.agents.subtitle}
            </div>
          </section>
        )}

        {activeSection.id === "privacy" && (
          <section className="settings-card">
            <div className="form-row">
              <span>{ui.settings.maskPaths}</span>
              <Checkbox
                checked={prefs.maskPaths}
                aria-label={ui.settings.maskPaths}
                onChange={(v) => save({ maskPaths: v })}
              />
            </div>
            <div className="form-row">
              <span>{ui.settings.historyEnabled}</span>
              <Checkbox
                checked={prefs.historyEnabled}
                aria-label={ui.settings.historyEnabled}
                onChange={(v) => save({ historyEnabled: v })}
              />
            </div>
            <p className="plan-note">{ui.history.clearHint}</p>
          </section>
        )}

        {activeSection.id === "about" && (
          <section className="settings-card">
            <div className="form-row"><span>{ui.settings.version}</span><strong>2.0.0</strong></div>
            <div className="form-row">
              <span>{ui.settings.buildCommit}</span>
              <span>
                {buildInfo
                  ? `${buildInfo.commitShort}${buildInfo.dirty ? ` (${ui.settings.buildDirty})` : ""}`
                  : "—"}
              </span>
            </div>
            {buildInfo && (
              <div className="form-row">
                <span>{ui.settings.buildProfile}</span>
                <span>{buildInfo.profile}</span>
              </div>
            )}
            <div className="form-row">
              <span><Sparkles size={12} /> Node Cleaner</span>
              <span>Vellium</span>
            </div>
            {catalog && (
              <>
                <div className="form-row"><span>{ui.settings.rules}</span><span>{catalogStats.rules}</span></div>
                <div className="form-row">
                  <span>{ui.settings.ecosystems}</span>
                  <span>{catalogStats.ecosystems}</span>
                </div>
                <div className="form-row">
                  <span>{ui.settings.categories}</span>
                  <span>{catalogStats.categories}</span>
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
};
