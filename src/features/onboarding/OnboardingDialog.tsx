import React, { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Boxes,
  Check,
  CheckCircle2,
  Eye,
  Globe,
  Lock,
  Palette,
  Rocket,
  Search,
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
import type { SupportedLanguage } from "@/types";
import "@/features/settings/settings.css";
import "./onboarding.css";

const TOTAL_STEPS = 6;
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
  const [langQuery, setLangQuery] = useState("");
  const isOpen = prefs.isLoaded && (!prefs.onboardingCompleted || forcedOpen);

  const activeLocale = resolveUiLocale(prefs.language);
  const filteredLanguages = useMemo(() => {
    const q = langQuery.trim().toLowerCase();
    if (!q) return LANGUAGES_LIST;
    return LANGUAGES_LIST.filter(
      (lang) =>
        lang.nativeName.toLowerCase().includes(q) ||
        lang.name.toLowerCase().includes(q) ||
        lang.id.toLowerCase().includes(q),
    );
  }, [langQuery]);

  const finish = () => {
    setStep(0);
    setLangQuery("");
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
      maxWidth="720px"
      footer={
        <div className="onboarding-footer">
          <Button
            variant="ghost"
            size="sm"
            className="onboarding-footer-btn onboarding-footer-btn--skip"
            onClick={finish}
          >
            {ui.onboarding.skip}
          </Button>
          <div className="onboarding-footer-nav">
            {step > 0 && (
              <Button
                variant="secondary"
                size="sm"
                className="onboarding-footer-btn onboarding-footer-btn--nav"
                icon={<ArrowLeft size={15} />}
                onClick={() => setStep((s) => Math.max(0, s - 1))}
              >
                {ui.common.back}
              </Button>
            )}
            {step < TOTAL_STEPS - 1 ? (
              <Button
                variant="primary"
                size="sm"
                className="onboarding-footer-btn onboarding-footer-btn--nav"
                iconRight={<ArrowRight size={15} />}
                onClick={() => setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1))}
              >
                {ui.onboarding.next}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                className="onboarding-footer-btn onboarding-footer-btn--finish"
                icon={<Rocket size={15} />}
                onClick={finish}
              >
                {ui.onboarding.finish}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="onboarding-body" data-testid={`onboarding-step-${step + 1}`}>
        <div className="onboarding-progress" aria-hidden="true">
          {stepDots.map((idx) => (
            <span
              key={idx}
              className={`onboarding-progress-bar ${idx <= step ? "is-active" : ""}`}
            />
          ))}
        </div>

        {/* STEP 1: LANGUAGE SELECTION */}
        {step === 0 && (
          <div className="onboarding-step">
            <div className="onboarding-hero onboarding-hero--compact">
              <div className="onboarding-hero-mark onboarding-hero-mark--ready" aria-hidden="true">
                <Globe size={26} />
              </div>
              <h3 className="onboarding-heading">{ui.settings.language}</h3>
              <p className="onboarding-lead">{ui.settings.generalHint}</p>
            </div>

            <div className="onboarding-lang-toolbar">
              <div className="onboarding-lang-search-wrap">
                <Search size={14} className="onboarding-lang-search-icon" aria-hidden="true" />
                <input
                  type="search"
                  className="onboarding-lang-search"
                  value={langQuery}
                  onChange={(e) => setLangQuery(e.target.value)}
                  placeholder={`${ui.settings.language}...`}
                  aria-label={ui.settings.language}
                />
              </div>
              <select
                className="onboarding-select"
                aria-label={ui.settings.kpiAppearance}
                value={activeLocale}
                onChange={(e) => prefs.setLanguage(e.target.value as SupportedLanguage)}
              >
                {LANGUAGES_LIST.map((lang) => (
                  <option key={lang.id} value={lang.id}>
                    {lang.nativeName}
                  </option>
                ))}
              </select>
            </div>

            <div className="onboarding-lang-grid" role="listbox" aria-label={ui.settings.language}>
              {filteredLanguages.map((lang) => {
                const isSelected = activeLocale === lang.id;
                return (
                  <button
                    key={lang.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-testid={`onboarding-lang-${lang.id}`}
                    className={`onboarding-lang-option ${isSelected ? "is-active" : ""}`}
                    onClick={() => prefs.setLanguage(lang.id as SupportedLanguage)}
                  >
                    <span className="onboarding-lang-copy">
                      <span className="onboarding-lang-native">{lang.nativeName}</span>
                      <span className="onboarding-lang-code">{lang.id.toUpperCase()}</span>
                    </span>
                    {isSelected && (
                      <Check size={14} className="onboarding-lang-check" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 2: PRESET THEMES vs CUSTOM THEME STUDIO & DISPLAY */}
        {step === 1 && (
          <div className="onboarding-step onboarding-step--compact">
            <div className="onboarding-hero onboarding-hero--inline">
              <div className="onboarding-hero-mark onboarding-hero-mark--sm" aria-hidden="true">
                <Palette size={20} />
              </div>
              <div className="onboarding-hero-inline-copy">
                <h3 className="onboarding-heading">{ui.onboarding.step3Title}</h3>
                <p className="onboarding-lead">{ui.onboarding.step3Body}</p>
              </div>
            </div>

            <div className="onboarding-prefs-block">
              <ThemeQuickStrip
                ui={ui}
                theme={prefs.theme}
                customTheme={prefs.customTheme}
                themes={THEMES}
                themeLabelFn={themeLabel}
                onSelectTheme={prefs.setTheme}
                onChangeCustomTheme={prefs.setCustomTheme}
                compact
              />

              <div className="onboarding-a11y-row">
                <div className="onboarding-pref-row onboarding-pref-row--a11y">
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

                <div className="onboarding-pref-row onboarding-pref-row--a11y">
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
          </div>
        )}

        {/* STEP 3: APPLICATION ICON SELECTION (CLEAN HEADER + CUSTOM vs PRESET ICONS) */}
        {step === 2 && (
          <div className="onboarding-step">
            <div className="onboarding-hero onboarding-hero--compact">
              <div className="onboarding-hero-mark onboarding-hero-mark--icon" aria-hidden="true">
                <AppIconPreview
                  iconId={prefs.appIcon}
                  activeTheme={prefs.theme}
                  customTheme={prefs.customTheme}
                  size={56}
                />
              </div>
              <h3 className="onboarding-heading">{ui.settings.appIconTitle}</h3>
            </div>

            <div className="onboarding-prefs-block onboarding-icon-picker-scroll">
              <AppIconPicker
                ui={ui}
                appIcon={prefs.appIcon}
                activeTheme={prefs.theme}
                customTheme={prefs.customTheme}
                themes={THEMES}
                themeLabelFn={themeLabel}
                onSelectAppIcon={prefs.setAppIcon}
                hideHeader
              />
            </div>
          </div>
        )}

        {/* STEP 4: WELCOME TO DETERGO BY VELLIUM (2-LINE LEAD + SIDE-BY-SIDE ICON & TITLE) */}
        {step === 3 && (
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
              <p className="onboarding-lead onboarding-lead--two-line">{ui.onboarding.step1Body}</p>
            </div>

            <div className="onboarding-card-grid">
              <div className="onboarding-card">
                <div className="onboarding-card-head">
                  <span className="onboarding-card-icon">
                    <Boxes size={16} aria-hidden="true" />
                  </span>
                  <strong className="onboarding-card-title">{ui.onboarding.step1Card1Title}</strong>
                </div>
                <p className="onboarding-card-desc">{ui.onboarding.step1Card1Desc}</p>
              </div>
              <div className="onboarding-card">
                <div className="onboarding-card-head">
                  <span className="onboarding-card-icon">
                    <Bot size={16} aria-hidden="true" />
                  </span>
                  <strong className="onboarding-card-title">{ui.onboarding.step1Card2Title}</strong>
                </div>
                <p className="onboarding-card-desc">{ui.onboarding.step1Card2Desc}</p>
              </div>
              <div className="onboarding-card">
                <div className="onboarding-card-head">
                  <span className="onboarding-card-icon">
                    <ShieldCheck size={16} aria-hidden="true" />
                  </span>
                  <strong className="onboarding-card-title">{ui.onboarding.step1Card3Title}</strong>
                </div>
                <p className="onboarding-card-desc">{ui.onboarding.step1Card3Desc}</p>
              </div>
            </div>
          </div>
        )}

        {/* STEP 5: ZERO-DATA-LOSS SAFETY ARCHITECTURE */}
        {step === 4 && (
          <div className="onboarding-step">
            <div className="onboarding-hero onboarding-hero--compact">
              <div className="onboarding-hero-mark onboarding-hero-mark--ready" aria-hidden="true">
                <ShieldCheck size={26} />
              </div>
              <h3 className="onboarding-heading">{ui.onboarding.step2Title}</h3>
              <p className="onboarding-lead">{ui.onboarding.step2Body}</p>
            </div>

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

        {/* STEP 6: HOW TO USE DETERGO & QUICK START */}
        {step === 5 && (
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
