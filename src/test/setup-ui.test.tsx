// @vitest-environment jsdom
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetupApp } from "@/setup/SetupApp";
import { createMockSetupBridge, InstallOptions, UninstallOptions } from "@/setup/setup-api";
import { LANGUAGES_LIST, getSetupStrings, resolveSetupLanguage } from "@/setup/i18n/setup-i18n";
import setupLocales from "@/setup/i18n/setup-locales.json";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function flushUi(ticks = 4): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

describe("Frameless Monochrome Setup & Uninstaller UI", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    document.documentElement.dir = "ltr";
    document.documentElement.lang = "en";
  });

  it("supports all 73 languages with fallback to English and zero long dashes", () => {
    expect(LANGUAGES_LIST.length).toBe(73);
    expect(resolveSetupLanguage("tr-TR")).toBe("tr");
    expect(resolveSetupLanguage("ar-SA")).toBe("ar");
    expect(resolveSetupLanguage("zh-Hant-TW")).toBe("zh-tw");
    expect(resolveSetupLanguage("xx-UNKNOWN")).toBe("en");

    for (const [locale, dict] of Object.entries(setupLocales)) {
      for (const [key, val] of Object.entries(dict)) {
        expect(val, `${locale}.${key} must not contain em/en dash`).not.toMatch(
          /[\u2013\u2014\u2015]/,
        );
      }
    }
    expect(getSetupStrings("tr").titleInstall).toBe("Detergo Kurulumu");
    expect(getSetupStrings("en").titleInstall).toBe("Detergo Setup");
  });

  it("renders welcome screen, slides open options sheet, switches language + RTL live, and completes install", async () => {
    const capturedInstall: InstallOptions[] = [];
    const launchSpy = vi.fn().mockResolvedValue(undefined);
    const closeSpy = vi.fn().mockResolvedValue(undefined);

    const baseBridge = createMockSetupBridge({
      mode: "install",
      appVersion: "1.0.0",
      installedVersion: null,
      systemLanguage: "tr-TR",
      requiredMb: 24,
    });

    const bridge = {
      ...baseBridge,
      async startInstall(
        options: InstallOptions,
        onProgress: (ev: { stepKey: string; percent: number }) => void,
      ) {
        capturedInstall.push(options);
        onProgress({ stepKey: "stepExtracting", percent: 50 });
        onProgress({ stepKey: "stepRefreshing", percent: 100 });
      },
      launchInstalledApp: launchSpy,
      closeWindow: closeSpy,
    };

    await act(async () => {
      root.render(<SetupApp bridge={bridge} />);
    });
    await flushUi();

    const byTestId = (id: string) =>
      container.querySelector(`[data-testid="${id}"]`) as HTMLElement;

    expect(byTestId("setup-version-pill").textContent).toBe("1.0.0");
    expect(byTestId("setup-primary-install").textContent).toBe("Kur");
    // TitleBar has strictly 2 buttons (Minimize & Close, no Maximize)
    expect(container.querySelectorAll(".setup-win-btn").length).toBe(2);

    // Open Options Sheet
    const sheet = byTestId("setup-options-sheet");
    expect(sheet.className).not.toContain("is-open");
    await act(async () => {
      byTestId("setup-options-toggle").click();
    });
    expect(sheet.className).toContain("is-open");

    // Verify 73 languages in selector and live RTL switch to Arabic
    const langSelect = byTestId("setup-language-select") as HTMLSelectElement;
    expect(langSelect.options.length).toBe(73);

    const setSelectValue = async (select: HTMLSelectElement, value: string) => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
        setter?.call(select, value);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };

    await setSelectValue(langSelect, "ar");
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.documentElement.lang).toBe("ar");

    await setSelectValue(langSelect, "en");
    expect(document.documentElement.dir).toBe("ltr");
    expect(byTestId("setup-sheet-install").textContent).toBe("Install");

    // Toggle startup checkbox & pick custom folder
    await act(async () => {
      byTestId("setup-task-startup").click();
      byTestId("setup-dir-browse").click();
    });
    await flushUi();
    expect((byTestId("setup-dir-input") as HTMLInputElement).value).toContain("Custom");

    // Trigger install from Options Sheet -> Done screen
    await act(async () => {
      byTestId("setup-sheet-install").click();
    });
    await flushUi();

    expect(byTestId("setup-done-title").textContent).toBe("Detergo is ready");
    expect(capturedInstall).toHaveLength(1);
    expect(capturedInstall[0].startOnLogin).toBe(true);
    expect(capturedInstall[0].language).toBe("en");
    expect(capturedInstall[0].addToPath).toBe(true);

    // Launch app button launches installed binary and closes setup
    await act(async () => {
      byTestId("setup-done-launch").click();
    });
    await flushUi();
    expect(launchSpy).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it("renders uninstall screen, honors delete user data checkbox, and transitions to uninstalled", async () => {
    const capturedUninstall: UninstallOptions[] = [];
    const baseBridge = createMockSetupBridge({
      mode: "uninstall",
      appVersion: "1.0.0",
      systemLanguage: "tr-TR",
      userDataDir: "C:\\Users\\Dev\\AppData\\Roaming\\detergo",
    });

    const bridge = {
      ...baseBridge,
      async startUninstall(
        options: UninstallOptions,
        onProgress: (ev: { stepKey: string; percent: number }) => void,
      ) {
        capturedUninstall.push(options);
        onProgress({ stepKey: "stepRemovingFiles", percent: 45 });
        onProgress({ stepKey: "stepRemovingData", percent: 90 });
        onProgress({ stepKey: "stepRefreshing", percent: 100 });
      },
    };

    await act(async () => {
      root.render(<SetupApp bridge={bridge} />);
    });
    await flushUi();

    const byTestId = (id: string) =>
      container.querySelector(`[data-testid="${id}"]`) as HTMLElement;

    expect(byTestId("setup-uninstall-title").textContent).toBe("Detergo'yu kaldır");
    expect(byTestId("setup-user-data-path").textContent).toContain("detergo");

    const deleteBox = byTestId("setup-delete-user-data") as HTMLInputElement;
    expect(deleteBox.checked).toBe(false);
    await act(async () => {
      deleteBox.click();
    });
    expect(deleteBox.checked).toBe(true);

    await act(async () => {
      byTestId("setup-uninstall-confirm").click();
    });
    await flushUi();

    expect(byTestId("setup-uninstalled-title").textContent).toBe("Detergo kaldırıldı");
    expect(capturedUninstall).toHaveLength(1);
    expect(capturedUninstall[0].deleteUserData).toBe(true);
  });
});
