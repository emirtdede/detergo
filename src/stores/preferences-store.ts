import { create } from "zustand";
import {
  AppSettings,
  CacheMeasureMode,
  CloseAction,
  FavoriteLocation,
  SidebarMode,
  SortOption,
  SupportedLanguage,
} from "@/types";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { useUiStore } from "@/stores/ui-store";
import { detectSystemLanguage } from "@/locales/languages";
import { resolveUiLocale } from "@/lib/ui-locale";

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
  loadPreferences: (prefs: Partial<AppSettings>) => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 3,
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
};

const LEGACY_THEME_MAP: Record<string, string> = {
  black: "dark-black",
  "dark-transparent": "dark-black",
  transparent: "dark-black",
  "dark-blue": "dark-gray",
  "dark-purple": "dark-gray",
  "dark-green": "dark-gray",
  "dark-red": "dark-gray",
  "dark-orange": "dark-gray",
  "dark-yellow": "dark-gray",
  white: "light-white",
  "white-transparent": "light-white",
  "light-blue": "light-gray",
  "light-purple": "light-gray",
  "light-green": "light-gray",
  "light-red": "light-gray",
  "light-orange": "light-gray",
  "light-yellow": "light-gray",
};

const VERIFIED_THEMES = new Set([
  "dark-black",
  "dark-gray",
  "light-white",
  "light-gray",
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
  };
}

function syncPreferences(state: PreferencesState) {
  if (!state.isLoaded) return;
  scannerApi.saveAppSettings(toSettings(state)).catch((err) => {
    console.error("Failed to persist settings:", err);
    useUiStore.getState().showToast(
      state.language === "tr" ? "Ayarlar kaydedilemedi" : "Could not save settings",
      "error",
      5000
    );
  });
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
      const nextRecent = state.recentLocations.filter((p) => p.toLowerCase() !== path.toLowerCase());
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

  updateSettings: (patch: Partial<AppSettings>) => {
    // Persistence is awaited by the settings view so the UI never reports a
    // successful save before the backend has accepted it.
    set(patch as Partial<PreferencesState>);
  },

  persistSettings: () => {
    const state = get();
    if (!state.isLoaded) return Promise.resolve();
    return scannerApi.saveAppSettings(toSettings(state));
  },

  loadPreferences: (prefs: Partial<AppSettings>) => {
    const resolvedLanguage = resolveUiLocale(
      (prefs.language as SupportedLanguage) || detectSystemLanguage()
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
        prefs.closeAction === "tray" || prefs.closeAction === "quit"
          ? prefs.closeAction
          : "ask",
      customAgentProviders: prefs.customAgentProviders ?? [],
      hiddenBuiltinProviders: prefs.hiddenBuiltinProviders ?? [],
    };
    applyThemeToDom(merged.theme);
    applyLanguageToDom(resolvedLanguage);
    applyReduceMotionToDom(merged.reduceMotion);
    set({ ...merged, isLoaded: true });
  },
}));

export { DEFAULT_SETTINGS };
