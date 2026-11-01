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
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore } from "@/stores/ui-store";
import { useUIText } from "@/lib/ui-text";
import { LANGUAGES_LIST } from "@/locales/languages";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { countCatalogStats } from "@/lib/catalog-stats";
import { CatalogDto, SupportedLanguage, ThemeMode } from "@/types";
import { useSettingsSections } from "./settings-sections";
import "../items/items.css";
import "../shell/shell.css";

const THEMES: ThemeMode[] = [
  "dark-black", "dark-gray", "dark-blue", "dark-purple", "dark-green",
  "dark-red", "dark-orange", "dark-yellow",
  "light-white", "light-gray", "light-blue", "light-purple", "light-green",
  "light-red", "light-orange", "light-yellow",
];

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

  useEffect(() => {
    scannerApi
      .getCatalog()
      .then(setCatalog)
      .catch(() => showToast(ui.errors.title, "error"));
  }, [showToast, ui.errors.title]);

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
      <header className="view-header">
        <div>
          <h1 className="view-title">{ui.nav.settings}</h1>
          <p className="view-subtitle">{ui.settings.subtitle}</p>
        </div>
      </header>

      {catalog && !catalog.valid && (
        <p className="items-warning" style={{ marginBottom: 12 }}>
          <AlertTriangle size={13} /> {catalog.error}
        </p>
      )}

      <div className="subpage-content">
        <p className="subpage-hint">{activeSection.hint}</p>

        {activeSection.id === "general" && (
          <section className="settings-card">
            <h2>{ui.settings.general}</h2>
            <label className="form-row">
              <span>{ui.settings.theme}</span>
              <select value={prefs.theme} onChange={(e) => prefs.setTheme(e.target.value)}>
                {THEMES.map((theme) => (
                  <option key={theme} value={theme}>{theme}</option>
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
            <label className="form-row">
              <span>{ui.settings.reduceMotion}</span>
              <Checkbox checked={prefs.reduceMotion} onChange={(v) => prefs.setReduceMotion(v)} />
            </label>
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
            <h2>{ui.settings.scan}</h2>
            <label className="form-row">
              <span>{ui.settings.scanProfile}</span>
              <select value={prefs.scanProfile} onChange={(e) => setProfile(e.target.value)}>
                <option value="fast">{ui.settings.profileFast}</option>
                <option value="balanced">{ui.settings.profileBalanced}</option>
                <option value="deep">{ui.settings.profileDeep}</option>
              </select>
            </label>
            <label className="form-row">
              <span>{ui.settings.maxDepth}</span>
              <input type="number" min={1} max={128} value={prefs.maxDepth}
                onChange={(e) => save({ maxDepth: Number(e.target.value) || 1 })} />
            </label>
            <label className="form-row">
              <span>{ui.settings.maxCandidates}</span>
              <input type="number" min={1000} max={500000} step={1000} value={prefs.maxCandidates}
                onChange={(e) => save({ maxCandidates: Number(e.target.value) || 1000 })} />
            </label>
            <label className="form-row">
              <span>{ui.settings.timeout}</span>
              <input type="number" min={1} max={120} value={prefs.timeoutMinutes}
                onChange={(e) => save({ timeoutMinutes: Number(e.target.value) || 1 })} />
            </label>
            <label className="form-row">
              <span>{ui.settings.minSize}</span>
              <input type="number" min={0} value={Math.round(prefs.minSizeBytes / (1024 * 1024))}
                onChange={(e) => save({ minSizeBytes: (Number(e.target.value) || 0) * 1024 * 1024 })} />
            </label>
          </section>
        )}

        {activeSection.id === "protections" && (
          <section className="settings-card">
            <h2>{ui.settings.protections}</h2>
            <div className="form-row">
              <input type="text" placeholder={ui.settings.addPath} value={protectedInput}
                onChange={(e) => setProtectedInput(e.target.value)} style={{ flex: 1 }} />
              <Button variant="secondary" size="sm" icon={<Plus size={12} />} onClick={() => {
                const value = protectedInput.trim();
                if (!value) return;
                if (!prefs.protectedPaths.some((p) => p.toLowerCase() === value.toLowerCase())) {
                  save({ protectedPaths: [...prefs.protectedPaths, value] });
                }
                setProtectedInput("");
              }}>{ui.settings.addPath}</Button>
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

            <div className="form-row">
              <input type="text" placeholder={ui.settings.excludedNames} value={excludedInput}
                onChange={(e) => setExcludedInput(e.target.value)} style={{ flex: 1 }} />
              <Button variant="secondary" size="sm" icon={<Plus size={12} />} onClick={() => {
                const value = excludedInput.trim();
                if (!value) return;
                save({ excludedNames: [...prefs.excludedNames, value] });
                setExcludedInput("");
              }}>{ui.settings.addPath}</Button>
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
        )}

        {activeSection.id === "agents" && (
          <section className="settings-card">
            <h2>{ui.settings.agents}</h2>
            <label className="form-row">
              <span>{ui.settings.agentCacheCleanup}</span>
              <Checkbox checked={prefs.agentPolicy.allowCacheCleanup}
                onChange={(v) => save({ agentPolicy: { ...prefs.agentPolicy, allowCacheCleanup: v } })} />
            </label>
            <label className="form-row">
              <span>{ui.settings.browserRecordings}</span>
              <Checkbox checked={prefs.agentPolicy.protectBrowserRecordings}
                onChange={(v) => save({ agentPolicy: { ...prefs.agentPolicy, protectBrowserRecordings: v } })} />
            </label>
            <div className="plan-note" style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
              <ShieldCheck size={14} /> {ui.agents.subtitle}
            </div>
          </section>
        )}

        {activeSection.id === "privacy" && (
          <section className="settings-card">
            <h2>{ui.settings.privacy}</h2>
            <label className="form-row">
              <span>{ui.settings.maskPaths}</span>
              <Checkbox checked={prefs.maskPaths} onChange={(v) => save({ maskPaths: v })} />
            </label>
            <label className="form-row">
              <span>{ui.settings.historyEnabled}</span>
              <Checkbox checked={prefs.historyEnabled} onChange={(v) => save({ historyEnabled: v })} />
            </label>
            <p className="plan-note">{ui.history.clearHint}</p>
          </section>
        )}

        {activeSection.id === "about" && (
          <section className="settings-card">
            <h2>{ui.settings.about}</h2>
            <div className="form-row"><span>{ui.settings.version}</span><strong>2.0.0</strong></div>
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
