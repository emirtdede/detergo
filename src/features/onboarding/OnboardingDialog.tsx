import React, { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Boxes,
  CheckCircle2,
  Eye,
  Lock,
  Rocket,
  ShieldCheck,
  Terminal,
  Trash2,
  ZoomIn,
} from "lucide-react";
import { Dialog } from "@/components/primitives/Dialog";
import { Button } from "@/components/primitives/Button";
import { Switch } from "@/components/primitives/Switch";
import { Logo } from "@/components/brand/Logo";
import { AppIconPreview } from "@/components/brand/AppIconPreview";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore } from "@/stores/ui-store";
import { useShallow } from "zustand/react/shallow";
import { resolveUiLocale, useUIText } from "@/lib/ui-text";
import { LANGUAGES_LIST } from "@/locales/languages";
import { ThemeQuickStrip } from "@/features/settings/CustomThemeBuilder";
import { AppIconPicker } from "@/features/settings/AppIconPicker";
import { THEMES, themeLabel } from "@/features/settings/SettingsDialogs";
import type { SupportedLanguage, ThemeMode } from "@/types";
import "@/features/settings/settings.css";
import "./onboarding.css";

const TOTAL_STEPS = 4;
const ONBOARDING_THEMES: readonly ThemeMode[] = [
  "dark-black",
  "dark-blue",
  "dark-green",
  "light-white",
  "light-blue",
];
const ONBOARDING_ZOOM_PRESETS = [90, 100, 110, 125] as const;

export const OnboardingDialog: React.FC = () => {
  const ui = useUIText();
  const prefs = usePreferencesStore(
    useShallow((s) => ({
      isLoaded: s.isLoaded,
      onboardingCompleted: s.onboardingCompleted,
      language: s.language,
      theme: s.theme,
      customTheme: s.customTheme,
      appIcon: s.appIcon,
      uiScale: s.uiScale,
      highContrast: s.highContrast,
      setLanguage: s.setLanguage,
      setTheme: s.setTheme,
      setCustomTheme: s.setCustomTheme,
      setAppIcon: s.setAppIcon,
      setUiScale: s.setUiScale,
      setHighContrast: s.setHighContrast,
      setOnboardingCompleted: s.setOnboardingCompleted,
      persistSettings: s.persistSettings,
    })),
  );
  const forcedOpen = useUiStore((s) => s.onboardingForcedOpen);
  const closeForced = useUiStore((s) => s.closeOnboarding);

  const [step, setStep] = useState(0);
  const isOpen = prefs.isLoaded && (!prefs.onboardingCompleted || forcedOpen);

  const finish = () => {
    setStep(0);
    closeForced();
    if (!prefs.onboardingCompleted) {
      prefs.setOnboardingCompleted(true);
      void prefs.persistSettings().catch(() => {});
    }
  };

  const stepDots = useMemo(() => Array.from({ length: TOTAL_STEPS }, (_, idx) => idx), []);

  if (!isOpen) return null;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={finish}
      title={
        <span className="onboarding-dialog-title">
          <Logo size={18} showWordmark={false} />
          <span>{ui.onboarding.title}</span>
          <span className="onboarding-step-pill">
            {ui.onboarding.stepOf(step + 1, TOTAL_STEPS)}
          </span>
        </span>
      }
      maxWidth="680px"
      footer={
        <div className="onboarding-footer">
          <Button variant="ghost" size="sm" onClick={finish}>
            {ui.onboarding.skip}
          </Button>
          <div className="onboarding-footer-nav">
            {step > 0 && (
              <Button
                variant="secondary"
                size="sm"
                icon={<ArrowLeft size={14} />}
                onClick={() => setStep((s) => Math.max(0, s - 1))}
              >
                {ui.common.back}
              </Button>
            )}
            {step < TOTAL_STEPS - 1 ? (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1))}
              >
                <span>{ui.onboarding.next}</span>
                <ArrowRight size={14} />
              </Button>
            ) : (
              <Button variant="primary" size="sm" icon={<Rocket size={14} />} onClick={finish}>
                {ui.onboarding.finish}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="onboarding-body">
        <div className="onboarding-progress" aria-hidden="true">
          {stepDots.map((idx) => (
            <span
              key={idx}
              className={`onboarding-progress-bar ${idx <= step ? "is-active" : ""}`}
            />
          ))}
        </div>

        {step === 0 && (
          <div className="onboarding-step">
            <div className="onboarding-hero">
              <div className="onboarding-hero-mark onboarding-hero-mark--icon" aria-hidden="true">
                <AppIconPreview
                  iconId={prefs.appIcon}
                  activeTheme={prefs.theme}
                  customTheme={prefs.customTheme}
                  size={56}
                />
              </div>
              <h3 className="onboarding-heading">{ui.onboarding.step1Title}</h3>
              <p className="onboarding-lead">{ui.onboarding.step1Body}</p>
            </div>

            <div className="onboarding-card-grid">
              <div className="onboarding-card">
                <span className="onboarding-card-icon">
                  <Boxes size={18} aria-hidden="true" />
                </span>
                <strong className="onboarding-card-title">{ui.onboarding.step1Card1Title}</strong>
                <p className="onboarding-card-desc">{ui.onboarding.step1Card1Desc}</p>
              </div>
              <div className="onboarding-card">
                <span className="onboarding-card-icon">
                  <Bot size={18} aria-hidden="true" />
                </span>
                <strong className="onboarding-card-title">{ui.onboarding.step1Card2Title}</strong>
                <p className="onboarding-card-desc">{ui.onboarding.step1Card2Desc}</p>
              </div>
              <div className="onboarding-card">
                <span className="onboarding-card-icon">
                  <ShieldCheck size={18} aria-hidden="true" />
                </span>
                <strong className="onboarding-card-title">{ui.onboarding.step1Card3Title}</strong>
                <p className="onboarding-card-desc">{ui.onboarding.step1Card3Desc}</p>
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="onboarding-step">
            <h3 className="onboarding-heading">{ui.onboarding.step2Title}</h3>
            <p className="onboarding-lead">{ui.onboarding.step2Body}</p>

            <div className="onboarding-safety-list">
              <div className="onboarding-safety-row">
                <span className="onboarding-safety-icon">
                  <Trash2 size={17} aria-hidden="true" />
                </span>
                <div className="onboarding-safety-copy">
                  <strong>{ui.onboarding.step2Item1Title}</strong>
                  <p>{ui.onboarding.step2Item1Desc}</p>
                </div>
              </div>
              <div className="onboarding-safety-row">
                <span className="onboarding-safety-icon">
                  <Lock size={17} aria-hidden="true" />
                </span>
                <div className="onboarding-safety-copy">
                  <strong>{ui.onboarding.step2Item2Title}</strong>
                  <p>{ui.onboarding.step2Item2Desc}</p>
                </div>
              </div>
              <div className="onboarding-safety-row">
                <span className="onboarding-safety-icon">
                  <CheckCircle2 size={17} aria-hidden="true" />
                </span>
                <div className="onboarding-safety-copy">
                  <strong>{ui.onboarding.step2Item3Title}</strong>
                  <p>{ui.onboarding.step2Item3Desc}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="onboarding-step">
            <h3 className="onboarding-heading">{ui.onboarding.step3Title}</h3>
            <p className="onboarding-lead">{ui.onboarding.step3Body}</p>

            <div className="onboarding-prefs-block">
              <label className="onboarding-pref-row">
                <span className="onboarding-pref-label">{ui.settings.language}</span>
                <select
                  className="onboarding-select"
                  value={resolveUiLocale(prefs.language)}
                  onChange={(e) => prefs.setLanguage(e.target.value as SupportedLanguage)}
                >
                  {LANGUAGES_LIST.map((lang) => (
                    <option key={lang.id} value={lang.id}>
                      {lang.nativeName}
                    </option>
                  ))}
                </select>
              </label>

              <div className="onboarding-pref-section">
                <span className="onboarding-pref-label">{ui.settings.theme}</span>
                <ThemeQuickStrip
                  ui={ui}
                  theme={prefs.theme}
                  customTheme={prefs.customTheme}
                  themes={ONBOARDING_THEMES}
                  themeLabelFn={themeLabel}
                  onSelectTheme={prefs.setTheme}
                  onChangeCustomTheme={prefs.setCustomTheme}
                  compact
                />
              </div>

              <div className="onboarding-pref-section">
                <span className="onboarding-pref-label">{ui.settings.appIconTitle}</span>
                <AppIconPicker
                  ui={ui}
                  appIcon={prefs.appIcon}
                  activeTheme={prefs.theme}
                  customTheme={prefs.customTheme}
                  themes={THEMES}
                  themeLabelFn={themeLabel}
                  onSelectAppIcon={prefs.setAppIcon}
                  compact
                />
              </div>

              <div className="onboarding-pref-row onboarding-pref-row--wrap">
                <span className="onboarding-pref-label">
                  <ZoomIn size={14} aria-hidden="true" />
                  <span>
                    {ui.settings.uiScale}: {prefs.uiScale}%
                  </span>
                </span>
                <div
                  className="onboarding-zoom-pills"
                  role="group"
                  aria-label={ui.settings.uiScale}
                >
                  {ONBOARDING_ZOOM_PRESETS.map((preset) => (
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

              <div className="onboarding-pref-row">
                <span className="onboarding-pref-label">
                  <Eye size={14} aria-hidden="true" />
                  <span>{ui.settings.highContrast}</span>
                </span>
                <Switch
                  checked={prefs.highContrast}
                  onLabel={ui.common.on}
                  offLabel={ui.common.off}
                  aria-label={ui.settings.highContrast}
                  onChange={prefs.setHighContrast}
                />
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="onboarding-step">
            <div className="onboarding-hero onboarding-hero--compact">
              <div className="onboarding-hero-mark onboarding-hero-mark--ready" aria-hidden="true">
                <Rocket size={26} />
              </div>
              <h3 className="onboarding-heading">{ui.onboarding.step4Title}</h3>
              <p className="onboarding-lead">{ui.onboarding.step4Body}</p>
            </div>

            <ul className="onboarding-tips-list">
              <li>
                <CheckCircle2 size={15} className="onboarding-tip-icon" aria-hidden="true" />
                <span>{ui.onboarding.step4Tip1}</span>
              </li>
              <li>
                <ZoomIn size={15} className="onboarding-tip-icon" aria-hidden="true" />
                <span>{ui.onboarding.step4Tip2}</span>
              </li>
              <li>
                <Terminal size={15} className="onboarding-tip-icon" aria-hidden="true" />
                <span>{ui.onboarding.step4Tip3}</span>
              </li>
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
};
