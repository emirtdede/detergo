import React from "react";
import { Check, Globe, Palette, Sparkles } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { Dialog } from "@/components/primitives/Dialog";
import { Switch } from "@/components/primitives/Switch";
import { resolveUiLocale, UIText } from "@/lib/ui-text";
import { LANGUAGES_LIST } from "@/locales/languages";
import { CUSTOM_THEME_ID } from "@/lib/theme/custom-theme";
import {
  AppIconMode,
  CustomThemeConfig,
  SelectableTheme,
  SupportedLanguage,
  THEME_MODES,
  ThemeMode,
} from "@/types";
import { ThemeQuickStrip } from "./CustomThemeBuilder";
import { AppIconPicker } from "./AppIconPicker";

export const THEMES: readonly ThemeMode[] = THEME_MODES;

export const PROFILE_DEFAULTS: Record<
  string,
  { maxDepth: number; maxCandidates: number; timeoutMinutes: number }
> = {
  fast: { maxDepth: 16, maxCandidates: 10000, timeoutMinutes: 5 },
  balanced: { maxDepth: 32, maxCandidates: 50000, timeoutMinutes: 15 },
  full: { maxDepth: 40, maxCandidates: 80000, timeoutMinutes: 20 },
  thorough: { maxDepth: 48, maxCandidates: 100000, timeoutMinutes: 25 },
  deep: { maxDepth: 64, maxCandidates: 200000, timeoutMinutes: 30 },
  maximum: { maxDepth: 128, maxCandidates: 500000, timeoutMinutes: 60 },
};

export const PROFILE_KEYS = ["fast", "balanced", "full", "thorough", "deep", "maximum"] as const;

export function themeLabel(theme: SelectableTheme | string, ui: UIText): string {
  const t = ui.settings;
  if (theme === CUSTOM_THEME_ID) {
    return t.themeCustom || "Custom color";
  }
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

export function profileLabel(profile: string, ui: UIText): string {
  const labels: Record<string, string> = {
    fast: ui.settings.profileFast,
    balanced: ui.settings.profileBalanced,
    full: ui.settings.profileFull,
    thorough: ui.settings.profileThorough,
    deep: ui.settings.profileDeep,
    maximum: ui.settings.profileMaximum,
  };
  return labels[profile] ?? profile;
}

export function profileHint(profile: string, ui: UIText): string {
  const hints: Record<string, string> = {
    fast: ui.settings.profileFastHint,
    balanced: ui.settings.profileBalancedHint,
    full: ui.settings.profileFullHint,
    thorough: ui.settings.profileThoroughHint,
    deep: ui.settings.profileDeepHint,
    maximum: ui.settings.profileMaximumHint,
  };
  return hints[profile] ?? "";
}

interface SettingsDialogsProps {
  ui: UIText;
  theme: string;
  customTheme: CustomThemeConfig;
  appIcon: string;
  language?: SupportedLanguage | null;
  reduceMotion: boolean;
  scanProfile: string;
  appearanceOpen: boolean;
  appearanceTab: "theme" | "icon" | "language";
  profileOpen: boolean;
  onCloseAppearance: () => void;
  onChangeAppearanceTab: (tab: "theme" | "icon" | "language") => void;
  onCloseProfile: () => void;
  onSelectTheme: (theme: SelectableTheme) => void;
  onChangeCustomTheme: (patch: Partial<CustomThemeConfig>) => void;
  onSelectAppIcon: (icon: AppIconMode) => void;
  onSelectLanguage: (language: SupportedLanguage) => void;
  onToggleReduceMotion: (reduce: boolean) => void;
  onSelectProfile: (profile: string) => void;
}

export const SettingsDialogs: React.FC<SettingsDialogsProps> = ({
  ui,
  theme,
  customTheme,
  appIcon,
  language,
  reduceMotion,
  scanProfile,
  appearanceOpen,
  appearanceTab,
  profileOpen,
  onCloseAppearance,
  onChangeAppearanceTab,
  onCloseProfile,
  onSelectTheme,
  onChangeCustomTheme,
  onSelectAppIcon,
  onSelectLanguage,
  onToggleReduceMotion,
  onSelectProfile,
}) => (
  <>
    <Dialog
      isOpen={appearanceOpen}
      onClose={onCloseAppearance}
      title={ui.settings.kpiAppearance}
      maxWidth="680px"
      footer={
        <Button variant="secondary" size="sm" onClick={onCloseAppearance}>
          {ui.common.close}
        </Button>
      }
    >
      <div className="settings-dialog-tabs" role="tablist" aria-label={ui.settings.kpiAppearance}>
        {(
          [
            ["theme", ui.settings.theme, <Palette key="t" size={14} />],
            ["icon", ui.settings.tabIcon, <Sparkles key="i" size={14} />],
            ["language", ui.settings.language, <Globe key="l" size={14} />],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={appearanceTab === id}
            className={`settings-dialog-tab ${appearanceTab === id ? "is-active" : ""}`}
            onClick={() => onChangeAppearanceTab(id)}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {appearanceTab === "theme" ? (
        <div role="tabpanel">
          <ThemeQuickStrip
            ui={ui}
            theme={theme}
            customTheme={customTheme}
            themes={THEMES}
            themeLabelFn={themeLabel}
            onSelectTheme={onSelectTheme}
            onChangeCustomTheme={onChangeCustomTheme}
          />
        </div>
      ) : appearanceTab === "icon" ? (
        <div role="tabpanel">
          <AppIconPicker
            ui={ui}
            appIcon={appIcon}
            activeTheme={theme}
            customTheme={customTheme}
            themes={THEMES}
            themeLabelFn={themeLabel}
            onSelectAppIcon={onSelectAppIcon}
          />
        </div>
      ) : (
        <div role="tabpanel" className="settings-language-panel">
          <label className="form-row">
            <span>{ui.settings.language}</span>
            <select
              value={resolveUiLocale(language)}
              onChange={(e) => onSelectLanguage(e.target.value as SupportedLanguage)}
            >
              {LANGUAGES_LIST.map((lang) => (
                <option key={lang.id} value={lang.id}>
                  {lang.nativeName}
                </option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <span>{ui.settings.reduceMotion}</span>
            <Switch
              checked={reduceMotion}
              onLabel={ui.common.on}
              offLabel={ui.common.off}
              aria-label={ui.settings.reduceMotion}
              onChange={onToggleReduceMotion}
            />
          </div>
        </div>
      )}
    </Dialog>

    <Dialog
      isOpen={profileOpen}
      onClose={onCloseProfile}
      title={ui.settings.scanProfile}
      maxWidth="620px"
      footer={
        <Button variant="secondary" size="sm" onClick={onCloseProfile}>
          {ui.common.close}
        </Button>
      }
    >
      <p className="settings-dialog-hint">{ui.settings.profileDialogHint}</p>
      <div className="settings-profile-list">
        {PROFILE_KEYS.map((key) => {
          const active = (scanProfile || "balanced") === key;
          return (
            <button
              key={key}
              type="button"
              className={`settings-profile-option ${active ? "is-active" : ""}`}
              aria-pressed={active}
              onClick={() => {
                onSelectProfile(key);
                onCloseProfile();
              }}
            >
              <span className="settings-profile-name">
                {profileLabel(key, ui)}
                {key === "balanced" && (
                  <span className="settings-profile-default">
                    {ui.settings.profileDefaultBadge}
                  </span>
                )}
              </span>
              <span className="settings-profile-hint">{profileHint(key, ui)}</span>
              <span className="settings-profile-limits">
                {ui.settings.maxDepth} {PROFILE_DEFAULTS[key].maxDepth} ·{" "}
                {ui.settings.maxCandidates} {PROFILE_DEFAULTS[key].maxCandidates / 1000}k ·{" "}
                {ui.settings.timeout} {PROFILE_DEFAULTS[key].timeoutMinutes}
              </span>
              {active && <Check size={16} className="settings-profile-check" />}
            </button>
          );
        })}
      </div>
    </Dialog>
  </>
);
