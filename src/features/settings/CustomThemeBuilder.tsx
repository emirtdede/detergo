import React, { useEffect, useMemo, useState } from "react";
import { Check, Moon, Palette, Plus, ShieldCheck, Sparkles, Sun } from "lucide-react";
import {
  buildCustomThemeTokens,
  CUSTOM_THEME_ID,
  CUSTOM_THEME_PRESETS,
  normalizeHexColor,
} from "@/lib/theme/custom-theme";
import type { UIText } from "@/lib/ui-text";
import type { CustomThemeConfig, SelectableTheme, ThemeMode } from "@/types";

const THEME_SWATCH_PREVIEW: Record<ThemeMode, { bg: string; accent: string }> = {
  "dark-black": { bg: "#0c0c0e", accent: "#f4f4f5" },
  "dark-gray": { bg: "#16171b", accent: "#d4d4d8" },
  "dark-blue": { bg: "#0a1120", accent: "#38bdf8" },
  "dark-purple": { bg: "#120a1e", accent: "#c084fc" },
  "dark-green": { bg: "#081611", accent: "#34d399" },
  "dark-red": { bg: "#18090b", accent: "#f87171" },
  "dark-orange": { bg: "#180e07", accent: "#fb923c" },
  "dark-yellow": { bg: "#161307", accent: "#facc15" },
  "light-white": { bg: "#f8fafc", accent: "#18181b" },
  "light-gray": { bg: "#eaecef", accent: "#27272a" },
  "light-blue": { bg: "#eff6ff", accent: "#0369a1" },
  "light-purple": { bg: "#faf5ff", accent: "#6d28d9" },
  "light-green": { bg: "#f0fdf4", accent: "#047857" },
  "light-red": { bg: "#fff1f2", accent: "#be123c" },
  "light-orange": { bg: "#fff7ed", accent: "#c2400c" },
  "light-yellow": { bg: "#fefce8", accent: "#a16207" },
};

export function getThemeSwatchPreview(theme: ThemeMode): { bg: string; accent: string } {
  return THEME_SWATCH_PREVIEW[theme];
}

interface CustomThemeStudioProps {
  ui: UIText;
  isActive?: boolean;
  customTheme: CustomThemeConfig;
  onActivateCustom?: () => void;
  onChangeCustomTheme: (patch: Partial<CustomThemeConfig>) => void;
  compact?: boolean;
}

export const CustomThemeStudio: React.FC<CustomThemeStudioProps> = ({
  ui,
  isActive = true,
  customTheme,
  onActivateCustom,
  onChangeCustomTheme,
  compact = false,
}) => {
  const [hexDraft, setHexDraft] = useState(customTheme.accent);
  const [invalidHex, setInvalidHex] = useState(false);

  useEffect(() => {
    setHexDraft(customTheme.accent);
    setInvalidHex(false);
  }, [customTheme.accent]);

  const palette = useMemo(() => buildCustomThemeTokens(customTheme), [customTheme]);
  const minContrast = Math.min(palette.onAccentContrast, palette.accentForegroundContrast);

  const handleHexInput = (raw: string) => {
    setHexDraft(raw);
    const normalized = normalizeHexColor(raw);
    if (normalized) {
      setInvalidHex(false);
      onChangeCustomTheme({ accent: normalized });
    } else {
      setInvalidHex(raw.trim().length > 0);
    }
  };

  const handleHexBlur = () => {
    const normalized = normalizeHexColor(hexDraft);
    if (normalized) {
      setHexDraft(normalized);
      setInvalidHex(false);
    } else {
      setHexDraft(customTheme.accent);
      setInvalidHex(false);
    }
  };

  return (
    <div
      className={`custom-theme-studio ${compact ? "custom-theme-studio--compact" : ""} ${
        isActive ? "is-active" : ""
      }`}
      role="region"
      aria-label={ui.settings.customThemeTitle}
    >
      <div className="custom-theme-studio-header">
        <div className="custom-theme-studio-heading">
          <span
            className="custom-theme-studio-badge-chip"
            style={{
              backgroundColor: customTheme.base === "light" ? "#F8FAFC" : "#12141A",
              borderColor: customTheme.accent,
            }}
            aria-hidden="true"
          >
            <span
              className="custom-theme-studio-badge-dot"
              style={{ backgroundColor: customTheme.accent }}
            />
          </span>
          <div className="custom-theme-studio-copy">
            <div className="custom-theme-studio-title-row">
              <span className="custom-theme-studio-title">{ui.settings.customThemeTitle}</span>
              <span
                className="custom-theme-contrast-badge"
                title={ui.settings.customThemeContrastOk}
              >
                <ShieldCheck size={12} aria-hidden="true" />
                <span>
                  {ui.settings.customThemeContrastOk} · {minContrast.toFixed(1)}:1
                </span>
              </span>
            </div>
            {!compact && <p className="custom-theme-studio-hint">{ui.settings.customThemeHint}</p>}
          </div>
        </div>

        <button
          type="button"
          className={`theme-swatch-btn theme-swatch-btn--custom ${isActive ? "is-active" : ""}`}
          aria-pressed={isActive}
          onClick={() => onActivateCustom?.()}
          data-testid="custom-theme-add-btn"
        >
          <span
            className="theme-swatch-chip theme-swatch-chip--custom"
            style={
              isActive
                ? {
                    backgroundColor: customTheme.base === "light" ? "#F8FAFC" : "#12141A",
                    borderColor: customTheme.accent,
                  }
                : undefined
            }
            aria-hidden="true"
          >
            {isActive ? (
              <span className="theme-swatch-dot" style={{ backgroundColor: customTheme.accent }} />
            ) : (
              <Plus size={13} />
            )}
          </span>
          <span className="theme-swatch-name">
            {isActive
              ? `${ui.settings.customThemeAdd} (${customTheme.accent})`
              : ui.settings.themeCustom}
          </span>
          {isActive && <Check size={13} className="theme-swatch-check" aria-hidden="true" />}
        </button>
      </div>

      <div className="custom-theme-workbench">
        <div className="custom-theme-control-card">
          <span className="custom-theme-label">{ui.settings.customThemeBase}</span>
          <div
            className="custom-theme-base-toggle"
            role="group"
            aria-label={ui.settings.customThemeBase}
          >
            <button
              type="button"
              className={`custom-theme-base-btn ${customTheme.base === "dark" ? "is-active" : ""}`}
              aria-pressed={customTheme.base === "dark"}
              onClick={() => onChangeCustomTheme({ base: "dark" })}
            >
              <Moon size={13} aria-hidden="true" />
              <span>{ui.settings.themeDark}</span>
            </button>
            <button
              type="button"
              className={`custom-theme-base-btn ${customTheme.base === "light" ? "is-active" : ""}`}
              aria-pressed={customTheme.base === "light"}
              onClick={() => onChangeCustomTheme({ base: "light" })}
            >
              <Sun size={13} aria-hidden="true" />
              <span>{ui.settings.themeLight}</span>
            </button>
          </div>
        </div>

        <div className="custom-theme-control-card">
          <label
            className="custom-theme-label"
            htmlFor={compact ? "onboarding-hex-input" : "settings-hex-input"}
          >
            {ui.settings.customThemeColor}
          </label>
          <div className="custom-theme-hex-row">
            <input
              type="color"
              className="custom-theme-color-picker"
              value={customTheme.accent}
              aria-label={ui.settings.customThemeColor}
              onChange={(e) => {
                const normalized = normalizeHexColor(e.target.value);
                if (normalized) {
                  setHexDraft(normalized);
                  setInvalidHex(false);
                  onChangeCustomTheme({ accent: normalized });
                }
              }}
            />
            <input
              id={compact ? "onboarding-hex-input" : "settings-hex-input"}
              type="text"
              className={`custom-theme-hex-input ${invalidHex ? "is-invalid" : ""}`}
              value={hexDraft}
              maxLength={7}
              spellCheck={false}
              autoComplete="off"
              placeholder="#3B82F6"
              aria-invalid={invalidHex}
              onChange={(e) => handleHexInput(e.target.value)}
              onBlur={handleHexBlur}
            />
          </div>
          {invalidHex && (
            <span className="custom-theme-error" role="alert">
              {ui.settings.customThemeInvalidHex}
            </span>
          )}
        </div>

        <div className="custom-theme-control-card custom-theme-control-card--presets">
          <span className="custom-theme-label">{ui.settings.themeCustom}</span>
          <div
            className="custom-theme-presets"
            role="group"
            aria-label={ui.settings.customThemeColor}
          >
            {CUSTOM_THEME_PRESETS.map((preset) => {
              const active = customTheme.accent.toUpperCase() === preset.hex.toUpperCase();
              return (
                <button
                  key={preset.hex}
                  type="button"
                  className={`custom-theme-preset-dot ${active ? "is-active" : ""}`}
                  style={{ backgroundColor: preset.hex }}
                  title={`${preset.label} (${preset.hex})`}
                  aria-label={`${preset.label} ${preset.hex}`}
                  aria-pressed={active}
                  onClick={() => onChangeCustomTheme({ accent: preset.hex })}
                >
                  {active && <Check size={12} color="#FFFFFF" strokeWidth={3} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

interface ThemeQuickStripProps {
  ui: UIText;
  theme: string;
  customTheme: CustomThemeConfig;
  themes: readonly ThemeMode[];
  themeLabelFn: (theme: SelectableTheme | string, ui: UIText) => string;
  onSelectTheme: (theme: SelectableTheme) => void;
  onChangeCustomTheme: (patch: Partial<CustomThemeConfig>) => void;
  compact?: boolean;
}

/**
 * Structured two-zone theme selector:
 * 1. Preset Themes (4x4 symmetrical grid of 16 built-in themes)
 * 2. Custom Theme Studio (3-column balanced workbench for custom hex themes)
 */
export const ThemeQuickStrip: React.FC<ThemeQuickStripProps> = ({
  ui,
  theme,
  customTheme,
  themes,
  themeLabelFn,
  onSelectTheme,
  onChangeCustomTheme,
  compact = false,
}) => {
  const isCustomActive = theme === CUSTOM_THEME_ID;

  return (
    <div className="theme-strip-wrap">
      <div className="theme-section-group">
        <div className="theme-section-header">
          <span className="theme-section-label">
            <Palette size={13} aria-hidden="true" />
            <span>{ui.settings.theme}</span>
          </span>
        </div>
        <div className={`theme-swatch-grid ${compact ? "theme-swatch-grid--compact" : ""}`}>
          {themes.map((candidate) => {
            const swatch = getThemeSwatchPreview(candidate);
            const active = theme === candidate;
            return (
              <button
                key={candidate}
                type="button"
                className={`theme-swatch-btn ${active ? "is-active" : ""}`}
                aria-pressed={active}
                onClick={() => onSelectTheme(candidate)}
              >
                <span
                  className="theme-swatch-chip"
                  style={{ backgroundColor: swatch.bg, borderColor: swatch.accent }}
                  aria-hidden="true"
                >
                  <span className="theme-swatch-dot" style={{ backgroundColor: swatch.accent }} />
                </span>
                <span className="theme-swatch-name">{themeLabelFn(candidate, ui)}</span>
                {active && <Check size={13} className="theme-swatch-check" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="theme-section-group">
        <div className="theme-section-header">
          <span className="theme-section-label">
            <Sparkles size={13} aria-hidden="true" />
            <span>{ui.settings.themeCustom}</span>
          </span>
        </div>
        <CustomThemeStudio
          ui={ui}
          isActive={isCustomActive}
          customTheme={customTheme}
          onActivateCustom={() => onSelectTheme(CUSTOM_THEME_ID)}
          onChangeCustomTheme={onChangeCustomTheme}
          compact={compact}
        />
      </div>
    </div>
  );
};
