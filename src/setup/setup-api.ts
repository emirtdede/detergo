export type SetupMode = "install" | "uninstall";

export interface SetupContext {
  mode: SetupMode;
  appVersion: string;
  installedVersion: string | null;
  defaultInstallDir: string;
  userDataDir: string;
  requiredMb: number;
  systemLanguage: string;
}

export interface InstallOptions {
  installDir: string;
  language: string;
  createDesktopShortcut: boolean;
  createStartMenuShortcut: boolean;
  startOnLogin: boolean;
  addToPath: boolean;
}

export interface UninstallOptions {
  installDir: string;
  deleteUserData: boolean;
}

export interface SetupProgressEvent {
  stepKey: string;
  percent: number;
}

export interface SetupBridge {
  getContext(): Promise<SetupContext>;
  pickInstallDir(currentDir: string): Promise<string | null>;
  startInstall(
    options: InstallOptions,
    onProgress: (event: SetupProgressEvent) => void,
  ): Promise<void>;
  startUninstall(
    options: UninstallOptions,
    onProgress: (event: SetupProgressEvent) => void,
  ): Promise<void>;
  launchInstalledApp(installDir: string): Promise<void>;
  minimizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
}

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
  );
}

async function createTauriSetupBridge(): Promise<SetupBridge> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const { open } = await import("@tauri-apps/plugin-dialog");

  return {
    async getContext() {
      return await invoke<SetupContext>("get_setup_context");
    },

    async pickInstallDir(currentDir: string) {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: currentDir || undefined,
      });
      return typeof selected === "string" && selected.trim().length > 0 ? selected : null;
    },

    async startInstall(options, onProgress) {
      const unlisten = await listen<SetupProgressEvent>("setup-progress", (ev) => {
        onProgress(ev.payload);
      });
      try {
        await invoke("start_install", { options });
      } finally {
        unlisten();
      }
    },

    async startUninstall(options, onProgress) {
      const unlisten = await listen<SetupProgressEvent>("setup-progress", (ev) => {
        onProgress(ev.payload);
      });
      try {
        await invoke("start_uninstall", { options });
      } finally {
        unlisten();
      }
    },

    async launchInstalledApp(installDir: string) {
      await invoke("launch_installed_app", { installDir });
    },

    async minimizeWindow() {
      await getCurrentWindow().minimize();
    },

    async closeWindow() {
      await getCurrentWindow().close();
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createMockSetupBridge(overrides?: Partial<SetupContext>): SetupBridge {
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const queryMode = params?.get("mode") === "uninstall" ? "uninstall" : "install";
  const queryInstalled = params?.get("installed") || null;
  const queryLang = params?.get("lang") || null;
  const fastMs = params?.get("fast") === "1" ? 10 : 90;

  return {
    async getContext() {
      return {
        mode: overrides?.mode ?? queryMode,
        appVersion: overrides?.appVersion ?? "1.0.0",
        installedVersion:
          overrides?.installedVersion !== undefined ? overrides.installedVersion : queryInstalled,
        defaultInstallDir:
          overrides?.defaultInstallDir ?? "C:\\Users\\User\\AppData\\Local\\Programs\\Detergo",
        userDataDir: overrides?.userDataDir ?? "C:\\Users\\User\\AppData\\Roaming\\detergo",
        requiredMb: overrides?.requiredMb ?? 24,
        systemLanguage:
          overrides?.systemLanguage ??
          queryLang ??
          (typeof navigator !== "undefined" ? navigator.language : "en"),
      };
    },

    async pickInstallDir(currentDir: string) {
      return currentDir ? `${currentDir}\\Custom` : "C:\\Tools\\Detergo";
    },

    async startInstall(_options, onProgress) {
      const steps: SetupProgressEvent[] = [
        { stepKey: "stepPreparing", percent: 12 },
        { stepKey: "stepExtracting", percent: 48 },
        { stepKey: "stepUninstaller", percent: 72 },
        { stepKey: "stepShortcuts", percent: 90 },
        { stepKey: "stepRefreshing", percent: 100 },
      ];
      for (const step of steps) {
        onProgress(step);
        await delay(fastMs);
      }
    },

    async startUninstall(options, onProgress) {
      const steps: SetupProgressEvent[] = [
        { stepKey: "stepRemovingFiles", percent: 35 },
        { stepKey: "stepRemovingShortcuts", percent: 70 },
        ...(options.deleteUserData ? [{ stepKey: "stepRemovingData", percent: 88 }] : []),
        { stepKey: "stepRefreshing", percent: 100 },
      ];
      for (const step of steps) {
        onProgress(step);
        await delay(fastMs);
      }
    },

    async launchInstalledApp() {
      return;
    },

    async minimizeWindow() {
      return;
    },

    async closeWindow() {
      return;
    },
  };
}

let cachedBridge: Promise<SetupBridge> | null = null;

export function getSetupBridge(): Promise<SetupBridge> {
  if (!cachedBridge) {
    cachedBridge = isTauriRuntime()
      ? createTauriSetupBridge()
      : Promise.resolve(createMockSetupBridge());
  }
  return cachedBridge;
}
