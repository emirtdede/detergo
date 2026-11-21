import React from "react";
import { Check, Layers, Sparkles } from "lucide-react";
import {
  APP_ICON_CUSTOM,
  APP_ICON_MATCH_THEME,
  AppIconPreview,
  resolveAppIconId,
} from "@/components/brand/AppIconPreview";
import type { UIText } from "@/lib/ui-text";
import type { AppIconMode, CustomThemeConfig, SelectableTheme, ThemeMode } from "@/types";

const COMPACT_ICON_THEMES: readonly ThemeMode[] = [
  "dark-black",
  "dark-blue",
  "dark-green",
  "light-white",
];

interface AppIconPickerProps {
  ui: UIText;
  appIcon: string;
  activeTheme: string;
  customTheme: CustomThemeConfig;
  themes: readonly ThemeMode[];
  themeLabelFn: (theme: SelectableTheme | string, ui: UIText) => string;
  onSelectAppIcon: (icon: AppIconMode) => void;
  compact?: boolean;
}

export const AppIconPicker: React.FC<AppIconPickerProps> = ({
  ui,
  appIcon,
  activeTheme,
  customTheme,
  themes,
  themeLabelFn,
  onSelectAppIcon,
  compact = false,
}) => {
  const resolvedId = resolveAppIconId(appIcon, activeTheme);
  const visibleThemes = compact ? COMPACT_ICON_THEMES : themes;

  const activeName =
    appIcon === APP_ICON_MATCH_THEME
      ? `${ui.settings.appIconMatchTheme} (${themeLabelFn(resolvedId, ui)})`
      : appIcon === APP_ICON_CUSTOM
        ? `${ui.settings.appIconCustom} (${customTheme.accent})`
        : themeLabelFn(appIcon, ui);

  return (
    <div
      className={`app-icon-picker ${compact ? "app-icon-picker--compact" : ""}`}
      role="region"
      aria-label={ui.settings.appIconTitle}
    >
      {!compact && (
        <div className="app-icon-picker-header">
          <div className="app-icon-live-preview">
            <AppIconPreview
              iconId={appIcon}
              activeTheme={activeTheme}
              customTheme={customTheme}
              size={48}
              className="app-icon-live-svg"
            />
            <div className="app-icon-live-copy">
              <div className="app-icon-live-title-row">
                <h3 className="settings-group-title">
                  <Sparkles size={15} aria-hidden="true" />
                  <span>{ui.settings.appIconTitle}</span>
                </h3>
                <span className="app-icon-active-pill" data-testid="active-app-icon-label">
                  {activeName}
                </span>
              </div>
              <p className="settings-hint">{ui.settings.appIconHint}</p>
            </div>
          </div>
          <div className="app-icon-surfaces-note">
            <Layers size={13} aria-hidden="true" />
            <span>{ui.settings.appIconSurfacesHint}</span>
          </div>
        </div>
      )}

      <div
        className={`app-icon-grid ${compact ? "app-icon-grid--compact" : ""}`}
        role="group"
        aria-label={ui.settings.appIconTitle}
      >
        <button
          type="button"
          className={`app-icon-option ${appIcon === APP_ICON_MATCH_THEME ? "is-active" : ""}`}
          aria-pressed={appIcon === APP_ICON_MATCH_THEME}
          data-testid="app-icon-match-theme"
          onClick={() => onSelectAppIcon(APP_ICON_MATCH_THEME)}
        >
          <AppIconPreview
            iconId={APP_ICON_MATCH_THEME}
            activeTheme={activeTheme}
            customTheme={customTheme}
            size={compact ? 28 : 34}
            className="app-icon-option-svg"
          />
          <span className="app-icon-option-copy">
            <span className="app-icon-option-name">{ui.settings.appIconMatchTheme}</span>
          </span>
          {appIcon === APP_ICON_MATCH_THEME && (
            <Check size={13} className="app-icon-option-check" aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          className={`app-icon-option app-icon-option--custom ${appIcon === APP_ICON_CUSTOM ? "is-active" : ""}`}
          aria-pressed={appIcon === APP_ICON_CUSTOM}
          data-testid="app-icon-custom"
          onClick={() => onSelectAppIcon(APP_ICON_CUSTOM)}
        >
          <AppIconPreview
            iconId={APP_ICON_CUSTOM}
            activeTheme={activeTheme}
            customTheme={customTheme}
            size={compact ? 28 : 34}
            className="app-icon-option-svg"
          />
          <span className="app-icon-option-copy">
            <span className="app-icon-option-name">
              {ui.settings.appIconCustom} ({customTheme.accent})
            </span>
          </span>
          {appIcon === APP_ICON_CUSTOM && (
            <Check size={13} className="app-icon-option-check" aria-hidden="true" />
          )}
        </button>

        {visibleThemes.map((candidate) => {
          const active = appIcon === candidate;
          return (
            <button
              key={candidate}
              type="button"
              className={`app-icon-option ${active ? "is-active" : ""}`}
              aria-pressed={active}
              data-testid={`app-icon-${candidate}`}
              onClick={() => onSelectAppIcon(candidate)}
            >
              <AppIconPreview
                iconId={candidate}
                activeTheme={activeTheme}
                customTheme={customTheme}
                size={compact ? 28 : 34}
                className="app-icon-option-svg"
              />
              <span className="app-icon-option-copy">
                <span className="app-icon-option-name">{themeLabelFn(candidate, ui)}</span>
              </span>
              {active && <Check size={13} className="app-icon-option-check" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
};
