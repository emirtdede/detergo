import { create } from "zustand";
import {
  AppSettings,
  CacheMeasureMode,
  CloseAction,
  FavoriteLocation,
  SidebarMode,
  SortOption,
  SupportedLanguage,
  DEFAULT_SHORTCUTS,
} from "@/types";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { useUiStore } from "@/stores/ui-store";
import { detectSystemLanguage } from "@/locales/languages";
import { resolveUiLocale } from "@/lib/ui-locale";
import { getUIText } from "@/lib/ui-text";
import { log } from "@/lib/logging";

interface PreferencesState extends AppSettings {
  isLoaded: boolean;
  setTheme: (theme: string) => void;
  setLanguage: (language: SupportedLanguage) => void;
  setReduceMotion: (reduce: boolean) => void;
  setSort: (sort: SortOption) => void;
  setSidebarMode: (mode: SidebarMode) => void;
  setCacheMeasureMode: (mode: CacheMeasureMode) => void;
  setCloseAction: (action: CloseAction) => void;
  addFavorite: (path: string, label?: string) => FavoriteLocation;
  removeFavorite: (id: string) => void;
  renameFavorite: (id: string, newLabel: string) => void;
  addRecentLocation: (path: string) => void;
  removeRecentLocation: (path: string) => void;
  clearRecentLocations: () => void;
  setLastScanPath: (path: string | null) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
  persistSettings: () => Promise<void>;
  shortcuts: Record<string, string>;
  setShortcut: (id: string, shortcut: string) => void;
  resetShortcuts: () => void;
  loadPreferences: (prefs: Partial<AppSettings>) => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 4,
  theme: "dark-black",
  language: resolveUiLocale(detectSystemLanguage()),
  reduceMotion: false,
  favorites: [],
  recentLocations: [],
  lastScanPath: null,
  sort: { field: "size", direction: "desc" },
  protectedPaths: [],
  excludedNames: [],
  scanProfile: "balanced",
  maxDepth: 32,
  maxCandidates: 50000,
  timeoutMinutes: 15,
  minSizeBytes: 0,
  maskPaths: false,
  historyEnabled: true,
  agentPolicy: { allowCacheCleanup: true, protectBrowserRecordings: true },
  sidebarMode: "expanded",
  cacheMeasureMode: "fast",
  closeAction: "ask",
  customAgentProviders: [],
  hiddenBuiltinProviders: [],
  notifications: {
    scanComplete: "both",
    cleanComplete: "both",
    diskPressure: "both",
    processLock: "in_app",
    automationWebhook: "both",
    soundEnabled: true,
  },
  webhookUrl: null,
  webhookOnScan: true,
  webhookOnClean: true,
  shortcuts: { ...DEFAULT_SHORTCUTS },
  mcpAllowDestructive: false,
};

const LEGACY_THEME_MAP: Record<string, string> = {
  black: "dark-black",
  transparent: "dark-black",
  "dark-transparent": "dark-black",
  white: "light-white",
  "white-transparent": "light-white",
  "light-transparent": "light-white",
};

const VERIFIED_THEMES = new Set([
  "dark-black",
  "dark-gray",
  "dark-blue",
  "dark-purple",
  "dark-green",
  "dark-red",
  "dark-orange",
  "dark-yellow",
  "light-white",
  "light-gray",
  "light-blue",
  "light-purple",
  "light-green",
  "light-red",
  "light-orange",
  "light-yellow",
]);

export function normalizeTheme(theme: string): string {
  const mapped = LEGACY_THEME_MAP[theme] ?? theme;
  return VERIFIED_THEMES.has(mapped) ? mapped : "dark-black";
}

function applyThemeToDom(theme: string) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", normalizeTheme(theme));
  }
}

function applyLanguageToDom(language: SupportedLanguage) {
  if (typeof document !== "undefined") {
    // The document language must describe the language the UI is actually
    // rendered in, not a locale whose dictionary is incomplete.
    const uiLanguage = resolveUiLocale(language);
    document.documentElement.lang = uiLanguage;
    document.documentElement.dir = "ltr";
  }
}

function applyReduceMotionToDom(reduceMotion: boolean) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-reduce-motion", String(reduceMotion));
  }
}

const SORT_FIELDS: Array<SortOption["field"]> = [
  "size",
  "modified",
  "name",
  "safety",
  "project",
  "category",
];

/** Persisted settings may still contain the removed reclaim/method columns. */
function normalizeSort(sort?: SortOption): SortOption {
  if (!sort || !SORT_FIELDS.includes(sort.field)) {
    return DEFAULT_SETTINGS.sort;
  }
  return {
    field: sort.field,
    direction: sort.direction === "asc" ? "asc" : "desc",
  };
}

function toSettings(state: PreferencesState): AppSettings {
  return {
    schemaVersion: 3,
    theme: state.theme,
    language: state.language ?? "en",
    reduceMotion: state.reduceMotion,
    favorites: state.favorites,
    recentLocations: state.recentLocations,
    lastScanPath: state.lastScanPath,
    sort: state.sort,
    protectedPaths: state.protectedPaths,
    excludedNames: state.excludedNames,
    scanProfile: state.scanProfile,
    maxDepth: state.maxDepth,
    maxCandidates: state.maxCandidates,
    timeoutMinutes: state.timeoutMinutes,
    minSizeBytes: state.minSizeBytes,
    maskPaths: state.maskPaths,
    historyEnabled: state.historyEnabled,
    agentPolicy: state.agentPolicy,
    sidebarMode: state.sidebarMode,
    cacheMeasureMode: state.cacheMeasureMode,
    closeAction: state.closeAction,
    customAgentProviders: state.customAgentProviders,
    hiddenBuiltinProviders: state.hiddenBuiltinProviders,
    notifications: state.notifications ?? DEFAULT_SETTINGS.notifications,
    webhookUrl: state.webhookUrl ?? null,
    webhookOnScan: state.webhookOnScan ?? true,
    webhookOnClean: state.webhookOnClean ?? true,
    shortcuts: state.shortcuts ?? DEFAULT_SHORTCUTS,
    mcpAllowDestructive: state.mcpAllowDestructive ?? false,
  };
}

const SETTINGS_DEBOUNCE_MS = 250;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let writeChain: Promise<void> = Promise.resolve();
let lastErrorAt = 0;

function reportSaveError(language?: string | null) {
  const now = Date.now();
  // A burst of failing writes must not stack identical toasts.
  if (now - lastErrorAt < 5000) return;
  lastErrorAt = now;
  useUiStore.getState().showToast(getUIText(language).settings.saveError, "error", 5000);
}

/**
 * Persists the current settings. Writes are serialized so a slow first write
 * cannot be overtaken by a later one. The returned promise rejects on failure
 * for explicit callers; the internal chain stays alive and reports the error
 * once so a burst cannot stack toasts.
 */
export function flushPreferences(): Promise<void> {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const state = usePreferencesStore.getState();
  if (!state.isLoaded) return writeChain;

  const snapshot = toSettings(state);
  const write = writeChain.then(() => scannerApi.saveAppSettings(snapshot));
  writeChain = write.catch((err) => {
    log.error("Failed to persist settings", err);
    reportSaveError(state.language);
  });
  return write;
}

function syncPreferences(state: PreferencesState) {
  if (!state.isLoaded) return;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flushPreferences().catch(() => {
      // The shared chain already logged and reported this failure.
    });
  }, SETTINGS_DEBOUNCE_MS);
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  isLoaded: false,

  setTheme: (theme: string) => {
    const normalized = normalizeTheme(theme);
    applyThemeToDom(normalized);
    set({ theme: normalized });
    syncPreferences(get());
  },

  setLanguage: (language: SupportedLanguage) => {
    const uiLanguage = resolveUiLocale(language) as SupportedLanguage;
    applyLanguageToDom(uiLanguage);
    set({ language: uiLanguage });
    syncPreferences(get());
  },

  setReduceMotion: (reduceMotion: boolean) => {
    applyReduceMotionToDom(reduceMotion);
    set({ reduceMotion });
    syncPreferences(get());
  },

  setSort: (sort: SortOption) => {
    set({ sort });
    syncPreferences(get());
  },

  setSidebarMode: (sidebarMode: SidebarMode) => {
    set({ sidebarMode });
    syncPreferences(get());
  },

  setCacheMeasureMode: (cacheMeasureMode: CacheMeasureMode) => {
    set({ cacheMeasureMode });
    syncPreferences(get());
  },

  setCloseAction: (closeAction: CloseAction) => {
    set({ closeAction });
    syncPreferences(get());
  },

  addFavorite: (path: string, label?: string) => {
    const existing = get().favorites.find((f) => f.path.toLowerCase() === path.toLowerCase());
    if (existing) return existing;

    const parts = path.split(/[/\\]/);
    const computedLabel = label || parts[parts.length - 1] || path;
    const newFav: FavoriteLocation = {
      id: "fav-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      path,
      label: computedLabel,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
    };

    set((state) => ({ favorites: [...state.favorites, newFav] }));
    syncPreferences(get());
    return newFav;
  },

  removeFavorite: (id: string) => {
    set((state) => ({ favorites: state.favorites.filter((f) => f.id !== id) }));
    syncPreferences(get());
  },

  renameFavorite: (id: string, newLabel: string) => {
    set((state) => ({
      favorites: state.favorites.map((f) => (f.id === id ? { ...f, label: newLabel } : f)),
    }));
    syncPreferences(get());
  },

  addRecentLocation: (path: string) => {
    set((state) => {
      const filtered = state.recentLocations.filter((p) => p.toLowerCase() !== path.toLowerCase());
      return {
        recentLocations: [path, ...filtered].slice(0, 20),
        lastScanPath: path,
      };
    });
    syncPreferences(get());
  },

  removeRecentLocation: (path: string) => {
    set((state) => {
      const nextRecent = state.recentLocations.filter(
        (p) => p.toLowerCase() !== path.toLowerCase(),
      );
      const nextLastScan =
        state.lastScanPath?.toLowerCase() === path.toLowerCase()
          ? (nextRecent[0] ?? null)
          : state.lastScanPath;
      return { recentLocations: nextRecent, lastScanPath: nextLastScan };
    });
    syncPreferences(get());
  },

  clearRecentLocations: () => {
    set({ recentLocations: [], lastScanPath: null });
    syncPreferences(get());
  },

  setLastScanPath: (path: string | null) => {
    set({ lastScanPath: path });
    syncPreferences(get());
  },

  shortcuts: { ...DEFAULT_SHORTCUTS },

  setShortcut: (id: string, shortcut: string) => {
    const current = get().shortcuts ?? { ...DEFAULT_SHORTCUTS };
    const updated = { ...current, [id]: shortcut };
    set({ shortcuts: updated });
    get().persistSettings();
  },

  resetShortcuts: () => {
    set({ shortcuts: { ...DEFAULT_SHORTCUTS } });
    get().persistSettings();
  },

  updateSettings: (patch: Partial<AppSettings>) => {
    // Persistence is awaited by the settings view so the UI never reports a
    // successful save before the backend has accepted it.
    set(patch as Partial<PreferencesState>);
  },

  persistSettings: () => {
    // Routed through the debounced writer so an explicit save cannot race a
    // pending write and land out of order.
    return flushPreferences();
  },

  loadPreferences: (prefs: Partial<AppSettings>) => {
    const resolvedLanguage = resolveUiLocale(
      (prefs.language as SupportedLanguage) || detectSystemLanguage(),
    ) as SupportedLanguage;
    const merged: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...prefs,
      theme: normalizeTheme(prefs.theme || DEFAULT_SETTINGS.theme),
      language: resolvedLanguage,
      favorites: prefs.favorites ?? [],
      recentLocations: prefs.recentLocations ?? [],
      sort: normalizeSort(prefs.sort),
      protectedPaths: prefs.protectedPaths ?? [],
      excludedNames: prefs.excludedNames ?? [],
      agentPolicy: prefs.agentPolicy ?? DEFAULT_SETTINGS.agentPolicy,
      sidebarMode: prefs.sidebarMode === "collapsed" ? "collapsed" : "expanded",
      cacheMeasureMode: prefs.cacheMeasureMode === "full" ? "full" : "fast",
      closeAction:
        prefs.closeAction === "tray" || prefs.closeAction === "quit" ? prefs.closeAction : "ask",
      customAgentProviders: prefs.customAgentProviders ?? [],
      hiddenBuiltinProviders: prefs.hiddenBuiltinProviders ?? [],
      shortcuts: prefs.shortcuts
        ? { ...DEFAULT_SHORTCUTS, ...prefs.shortcuts }
        : { ...DEFAULT_SHORTCUTS },
      mcpAllowDestructive: prefs.mcpAllowDestructive ?? false,
    };
    applyThemeToDom(merged.theme);
    applyLanguageToDom(resolvedLanguage);
    applyReduceMotionToDom(merged.reduceMotion);
    set({ ...merged, isLoaded: true });
  },
}));

export { DEFAULT_SETTINGS };
