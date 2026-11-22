import React, { useEffect, useMemo, useState } from "react";
import { SupportedLanguage } from "@/types";
import { CheckBurst } from "./components/CheckBurst";
import { SetupLogo } from "./components/SetupLogo";
import { ShimmerBar } from "./components/ShimmerBar";
import { SoftBackdrop } from "./components/SoftBackdrop";
import {
  LANGUAGES_LIST,
  applySetupDocumentLocale,
  formatSetupTemplate,
  getSetupStrings,
  resolveSetupLanguage,
} from "./i18n/setup-i18n";
import { SetupBridge, SetupContext, getSetupBridge } from "./setup-api";
import "./setup.css";

export type SetupScreen = "welcome" | "progress" | "done" | "uninstall" | "uninstalled" | "error";

export interface SetupAppProps {
  /** Optional injected bridge for deterministic Vitest / Storybook testing. */
  bridge?: SetupBridge;
}

export const SetupApp: React.FC<SetupAppProps> = ({ bridge: injectedBridge }) => {
  const [bridge, setBridge] = useState<SetupBridge | null>(injectedBridge ?? null);
  const [context, setContext] = useState<SetupContext | null>(null);
  const [screen, setScreen] = useState<SetupScreen>("welcome");
  const [activeOperation, setActiveOperation] = useState<"install" | "uninstall">("install");
  const [optionsOpen, setOptionsOpen] = useState(false);

  const [language, setLanguage] = useState<SupportedLanguage>("en");
  const [installDir, setInstallDir] = useState("");
  const [createDesktopShortcut, setCreateDesktopShortcut] = useState(true);
  const [createStartMenuShortcut, setCreateStartMenuShortcut] = useState(true);
  const [startOnLogin, setStartOnLogin] = useState(false);
  const [addToPath, setAddToPath] = useState(true);
  const [deleteUserData, setDeleteUserData] = useState(false);

  const [stepKey, setStepKey] = useState("stepPreparing");
  const [percent, setPercent] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const init = async () => {
      const resolvedBridge = injectedBridge ?? (await getSetupBridge());
      if (!active) return;
      setBridge(resolvedBridge);

      const ctx = await resolvedBridge.getContext();
      if (!active) return;
      const detectedLang = resolveSetupLanguage(ctx.systemLanguage);
      setContext(ctx);
      setLanguage(detectedLang);
      applySetupDocumentLocale(detectedLang);
      setInstallDir(ctx.defaultInstallDir);
      setActiveOperation(ctx.mode);
      setScreen(ctx.mode === "uninstall" ? "uninstall" : "welcome");
    };
    void init();
    return () => {
      active = false;
    };
  }, [injectedBridge]);

  const strings = useMemo(() => getSetupStrings(language), [language]);

  const handleLanguageChange = (nextLang: SupportedLanguage) => {
    setLanguage(nextLang);
    applySetupDocumentLocale(nextLang);
  };

  const titleText =
    activeOperation === "uninstall" || screen === "uninstall" || screen === "uninstalled"
      ? strings.titleUninstall
      : strings.titleInstall;

  const isUpdate = Boolean(context?.installedVersion);
  const appVersion = context?.appVersion ?? "1.0.0";

  const welcomeDescription = isUpdate
    ? formatSetupTemplate(strings.updateDesc, {
        existing: context?.installedVersion ?? "",
        version: appVersion,
      })
    : formatSetupTemplate(strings.welcomeDesc, { version: appVersion });

  const stepLabel =
    (strings as unknown as Record<string, string>)[stepKey] ?? strings.stepPreparing;

  const handlePickDir = async () => {
    if (!bridge) return;
    const picked = await bridge.pickInstallDir(installDir);
    if (picked) {
      setInstallDir(picked);
    }
  };

  const handleStartInstall = async () => {
    if (!bridge) return;
    setOptionsOpen(false);
    setActiveOperation("install");
    setErrorMessage(null);
    setStepKey("stepPreparing");
    setPercent(4);
    setScreen("progress");
    try {
      await bridge.startInstall(
        {
          installDir: installDir.trim() || context?.defaultInstallDir || "",
          language,
          createDesktopShortcut,
          createStartMenuShortcut,
          startOnLogin,
          addToPath,
        },
        (ev) => {
          setStepKey(ev.stepKey);
          setPercent(ev.percent);
        },
      );
      setPercent(100);
      setScreen("done");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setScreen("error");
    }
  };

  const handleStartUninstall = async () => {
    if (!bridge) return;
    setActiveOperation("uninstall");
    setErrorMessage(null);
    setStepKey("stepRemovingFiles");
    setPercent(6);
    setScreen("progress");
    try {
      await bridge.startUninstall(
        {
          installDir: installDir.trim() || context?.defaultInstallDir || "",
          deleteUserData,
        },
        (ev) => {
          setStepKey(ev.stepKey);
          setPercent(ev.percent);
        },
      );
      setPercent(100);
      setScreen("uninstalled");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setScreen("error");
    }
  };

  const handleLaunchApp = async () => {
    if (!bridge) return;
    try {
      await bridge.launchInstalledApp(installDir.trim() || context?.defaultInstallDir || "");
    } finally {
      await bridge.closeWindow();
    }
  };

  const handleMinimize = () => {
    void bridge?.minimizeWindow();
  };

  const handleClose = () => {
    void bridge?.closeWindow();
  };

  return (
    <div className="setup-viewport">
      <div className="setup-card" data-testid="setup-card" data-screen={screen}>
        <SoftBackdrop />

        <header className="setup-titlebar" data-tauri-drag-region>
          <span className="setup-titlebar-text" data-tauri-drag-region>
            {titleText}
          </span>
          <div className="setup-window-controls" data-tauri-drag-region="false">
            <button
              type="button"
              className="setup-win-btn"
              onClick={handleMinimize}
              aria-label={strings.minimize}
              title={strings.minimize}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                <line x1="1.5" y1="5.5" x2="9.5" y2="5.5" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </button>
            <button
              type="button"
              className="setup-win-btn setup-win-btn--close"
              onClick={handleClose}
              aria-label={strings.close}
              title={strings.close}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                <line x1="2" y1="2" x2="9" y2="9" stroke="currentColor" strokeWidth="1.4" />
                <line x1="9" y1="2" x2="2" y2="9" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </button>
          </div>
        </header>

        {/* 1. Welcome Screen (One-Click Install / Update) */}
        {screen === "welcome" && (
          <main className="setup-stage" key="welcome">
            <div className="setup-center">
              <SetupLogo size={96} />
              <div className="setup-brand-row">
                <h1 className="setup-app-name">Detergo</h1>
                <span className="setup-version-pill" data-testid="setup-version-pill">
                  {appVersion}
                </span>
              </div>
              <p className="setup-lead" data-testid="setup-welcome-desc">
                {welcomeDescription}
              </p>

              <button
                type="button"
                className="setup-primary-cta"
                data-testid="setup-primary-install"
                onClick={() => void handleStartInstall()}
              >
                {isUpdate ? strings.update : strings.install}
              </button>

              <button
                type="button"
                className="setup-options-link"
                data-testid="setup-options-toggle"
                aria-expanded={optionsOpen}
                onClick={() => setOptionsOpen(true)}
              >
                <span>{strings.options}</span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path
                    d="M3 7.5L6 4.5L9 7.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
            <p className="setup-footer-note">{strings.footerNote}</p>
          </main>
        )}

        {/* 2. Slide-Up Options Sheet */}
        {screen === "welcome" && (
          <section
            className={`setup-options-sheet ${optionsOpen ? "is-open" : ""}`}
            data-testid="setup-options-sheet"
            aria-hidden={!optionsOpen}
          >
            <div className="setup-sheet-header">
              <h2 className="setup-sheet-title">{strings.options}</h2>
              <button
                type="button"
                className="setup-sheet-hide"
                data-testid="setup-options-hide"
                onClick={() => setOptionsOpen(false)}
              >
                <span>{strings.hide}</span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path
                    d="M3 4.5L6 7.5L9 4.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>

            <div className="setup-sheet-body">
              <label className="setup-field">
                <span className="setup-field-label">{strings.languageLabel}</span>
                <select
                  className="setup-select"
                  data-testid="setup-language-select"
                  value={language}
                  onChange={(e) => handleLanguageChange(e.target.value as SupportedLanguage)}
                >
                  {LANGUAGES_LIST.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.nativeName} ({item.name})
                    </option>
                  ))}
                </select>
              </label>

              <div className="setup-field">
                <label className="setup-field-label" htmlFor="setup-install-dir">
                  {strings.installDirLabel}
                </label>
                <div className="setup-dir-row">
                  <input
                    id="setup-install-dir"
                    className="setup-input"
                    data-testid="setup-dir-input"
                    type="text"
                    value={installDir}
                    onChange={(e) => setInstallDir(e.target.value)}
                  />
                  <button
                    type="button"
                    className="setup-browse-btn"
                    data-testid="setup-dir-browse"
                    onClick={() => void handlePickDir()}
                  >
                    {strings.changeDir}
                  </button>
                </div>
              </div>

              <div className="setup-tasks-grid">
                <label className="setup-checkbox-row">
                  <input
                    type="checkbox"
                    data-testid="setup-task-desktop"
                    checked={createDesktopShortcut}
                    onChange={(e) => setCreateDesktopShortcut(e.target.checked)}
                  />
                  <span>{strings.taskDesktop}</span>
                </label>

                <label className="setup-checkbox-row">
                  <input
                    type="checkbox"
                    data-testid="setup-task-startmenu"
                    checked={createStartMenuShortcut}
                    onChange={(e) => setCreateStartMenuShortcut(e.target.checked)}
                  />
                  <span>{strings.taskStartMenu}</span>
                </label>

                <label className="setup-checkbox-row">
                  <input
                    type="checkbox"
                    data-testid="setup-task-startup"
                    checked={startOnLogin}
                    onChange={(e) => setStartOnLogin(e.target.checked)}
                  />
                  <span>{strings.taskStartup}</span>
                </label>

                <label className="setup-checkbox-row">
                  <input
                    type="checkbox"
                    data-testid="setup-task-path"
                    checked={addToPath}
                    onChange={(e) => setAddToPath(e.target.checked)}
                  />
                  <span>{strings.taskPath}</span>
                </label>
              </div>
            </div>

            <div className="setup-sheet-footer">
              <span className="setup-disk-note" data-testid="setup-disk-space">
                {formatSetupTemplate(strings.requiredSpace, {
                  mb: context?.requiredMb ?? 24,
                })}
              </span>
              <button
                type="button"
                className="setup-sheet-cta"
                data-testid="setup-sheet-install"
                onClick={() => void handleStartInstall()}
              >
                {isUpdate ? strings.update : strings.install}
              </button>
            </div>
          </section>
        )}

        {/* 3. Progress Screen (Install / Uninstall) */}
        {screen === "progress" && (
          <main className="setup-stage" key="progress">
            <div className="setup-center">
              <SetupLogo size={84} />
              <h1 className="setup-progress-title" data-testid="setup-progress-title">
                {activeOperation === "uninstall"
                  ? strings.uninstallingTitle
                  : strings.installingTitle}
              </h1>
            </div>

            <div className="setup-progress-footer">
              <div className="setup-progress-meta">
                <span data-testid="setup-progress-step">{stepLabel}</span>
                <span className="setup-progress-pct" data-testid="setup-progress-pct">
                  {Math.round(percent)}%
                </span>
              </div>
              <ShimmerBar percent={percent} />
            </div>
          </main>
        )}

        {/* 4. Done Screen */}
        {screen === "done" && (
          <main className="setup-stage" key="done">
            <div className="setup-center">
              <CheckBurst />
              <h1 className="setup-done-title" data-testid="setup-done-title">
                {strings.doneTitle}
              </h1>
              <p className="setup-lead">
                {formatSetupTemplate(strings.doneDesc, { version: appVersion })}
              </p>
            </div>

            <div className="setup-action-row">
              <button
                type="button"
                className="setup-soft-cta"
                data-testid="setup-done-close"
                onClick={handleClose}
              >
                {strings.close}
              </button>
              <button
                type="button"
                className="setup-primary-cta"
                data-testid="setup-done-launch"
                onClick={() => void handleLaunchApp()}
              >
                {strings.launchApp}
              </button>
            </div>
          </main>
        )}

        {/* 5a. Uninstall Confirmation Screen */}
        {screen === "uninstall" && (
          <main className="setup-stage" key="uninstall">
            <div className="setup-center">
              <SetupLogo size={72} />
              <h1 className="setup-uninstall-title" data-testid="setup-uninstall-title">
                {strings.uninstallTitle}
              </h1>
              <p className="setup-lead">{strings.uninstallDesc}</p>

              <div className="setup-uninstall-card">
                <label className="setup-checkbox-row">
                  <input
                    type="checkbox"
                    data-testid="setup-delete-user-data"
                    checked={deleteUserData}
                    onChange={(e) => setDeleteUserData(e.target.checked)}
                  />
                  <span>{strings.deleteUserData}</span>
                </label>
                <p className="setup-uninstall-path" data-testid="setup-user-data-path">
                  {context?.userDataDir ?? "%APPDATA%\\detergo"}
                </p>
              </div>
            </div>

            <div className="setup-action-row">
              <button
                type="button"
                className="setup-soft-cta"
                data-testid="setup-uninstall-cancel"
                onClick={handleClose}
              >
                {strings.cancel}
              </button>
              <button
                type="button"
                className="setup-primary-cta"
                data-testid="setup-uninstall-confirm"
                onClick={() => void handleStartUninstall()}
              >
                {strings.uninstallBtn}
              </button>
            </div>
          </main>
        )}

        {/* 5b. Uninstalled Completion Screen */}
        {screen === "uninstalled" && (
          <main className="setup-stage" key="uninstalled">
            <div className="setup-center">
              <CheckBurst />
              <h1 className="setup-done-title" data-testid="setup-uninstalled-title">
                {strings.uninstalledTitle}
              </h1>
              <p className="setup-lead">{strings.uninstalledDesc}</p>
            </div>

            <div className="setup-action-row">
              <button
                type="button"
                className="setup-primary-cta"
                data-testid="setup-uninstalled-close"
                onClick={handleClose}
              >
                {strings.close}
              </button>
            </div>
          </main>
        )}

        {/* Error Recovery Screen */}
        {screen === "error" && (
          <main className="setup-stage" key="error">
            <div className="setup-center">
              <SetupLogo size={72} />
              <h1 className="setup-uninstall-title">{strings.errorTitle}</h1>
              {errorMessage && <div className="setup-error-box">{errorMessage}</div>}
            </div>

            <div className="setup-action-row">
              <button type="button" className="setup-soft-cta" onClick={handleClose}>
                {strings.close}
              </button>
              <button
                type="button"
                className="setup-primary-cta"
                onClick={() => setScreen(activeOperation === "uninstall" ? "uninstall" : "welcome")}
              >
                {strings.retry}
              </button>
            </div>
          </main>
        )}
      </div>
    </div>
  );
};
