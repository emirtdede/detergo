import { create } from "zustand";
import {
  AppIconMode,
  AppSettings,
  CacheMeasureMode,
  CloseAction,
  CustomThemeConfig,
  FavoriteLocation,
  SelectableTheme,
  SidebarMode,
  SortOption,
  SupportedLanguage,
  DEFAULT_SHORTCUTS,
  THEME_MODES,
} from "@/types";
import {
  applyCustomThemeTokens,
  clearCustomThemeTokens,
  CUSTOM_THEME_ID,
  DEFAULT_CUSTOM_THEME,
  normalizeHexColor,
} from "@/lib/theme/custom-theme";
import {
  APP_ICON_CUSTOM,
  APP_ICON_MATCH_THEME,
  resolveAppIconId,
} from "@/components/brand/AppIconPreview";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { useUiStore } from "@/stores/ui-store";
import { detectSystemLanguage, LANGUAGES_LIST } from "@/locales/languages";
import { resolveUiLocale } from "@/lib/ui-locale";
import { getUIText } from "@/lib/ui-text";
import { log } from "@/lib/logging";
import { normalizeWebhookUrl } from "@/lib/validation/webhook-url";
import { validateShortcut } from "@/lib/shortcuts";
import { isAppDataResetting } from "@/lib/app-data-reset";

interface PreferencesState extends AppSettings {
  isLoaded: boolean;
  customTheme: CustomThemeConfig;
  appIcon: AppIconMode;
  uiScale: number;
  highContrast: boolean;
  onboardingCompleted: boolean;
  setTheme: (theme: SelectableTheme | string) => void;
  setCustomTheme: (config: Partial<CustomThemeConfig>) => void;
  setAppIcon: (icon: AppIconMode | string) => void;
  setUiScale: (scale: number) => void;
  setHighContrast: (enabled: boolean) => void;
  setOnboardingCompleted: (completed: boolean) => void;
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
  applyProviderSettings: (prefs: Partial<AppSettings>) => void;
}

const DEFAULT_SETTINGS: AppSettings & {
  customTheme: CustomThemeConfig;
  appIcon: AppIconMode;
  uiScale: number;
  highContrast: boolean;
  onboardingCompleted: boolean;
} = {
  schemaVersion: 5,
  theme: "dark-black",
  customTheme: { ...DEFAULT_CUSTOM_THEME },
  appIcon: APP_ICON_MATCH_THEME,
  uiScale: 100,
  highContrast: false,
  onboardingCompleted: false,
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
  allowPrivateWebhooks: false,
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

const VERIFIED_THEMES: ReadonlySet<string> = new Set<string>([...THEME_MODES, CUSTOM_THEME_ID]);
const VERIFIED_APP_ICONS: ReadonlySet<string> = new Set<string>([
  APP_ICON_MATCH_THEME,
  APP_ICON_CUSTOM,
  ...THEME_MODES,
]);

export function normalizeTheme(theme: string): SelectableTheme {
  const mapped = LEGACY_THEME_MAP[theme] ?? theme;
  return (VERIFIED_THEMES.has(mapped) ? mapped : "dark-black") as SelectableTheme;
}

export function normalizeAppIcon(icon: string | null | undefined): AppIconMode {
  const trimmed = icon?.trim() ?? "";
  return (VERIFIED_APP_ICONS.has(trimmed) ? trimmed : APP_ICON_MATCH_THEME) as AppIconMode;
}

export function normalizeCustomTheme(
  value: Partial<CustomThemeConfig> | null | undefined,
): CustomThemeConfig {
  const base = value?.base === "light" ? "light" : "dark";
  const accent = normalizeHexColor(value?.accent) ?? DEFAULT_CUSTOM_THEME.accent;
  return { base, accent };
}

export const UI_SCALE_LIMITS = { min: 80, max: 150 } as const;
export const UI_SCALE_PRESETS = [80, 90, 100, 110, 125, 150] as const;

export function normalizeUiScale(scale: number | undefined): number {
  if (typeof scale !== "number" || !Number.isFinite(scale)) return 100;
  return Math.min(UI_SCALE_LIMITS.max, Math.max(UI_SCALE_LIMITS.min, Math.round(scale)));
}

const THEME_CACHE_KEY = "detergo_theme";
const LEGACY_THEME_CACHE_KEY = "dev_cleaner_theme";
const CUSTOM_THEME_CACHE_KEY = "detergo_custom_theme";
const UI_SCALE_CACHE_KEY = "detergo_ui_scale";
const HIGH_CONTRAST_CACHE_KEY = "detergo_high_contrast";
const LANG_CACHE_KEY = "detergo_lang";
const LEGACY_LANG_CACHE_KEY = "dev_cleaner_lang";

function applyAppIconToRuntime(
  iconId: AppIconMode,
  activeTheme: string,
  customTheme: CustomThemeConfig,
) {
  const resolved = resolveAppIconId(iconId, activeTheme);
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-app-icon", resolved);
  }
  void scannerApi.applyAppIcon(iconId, activeTheme, customTheme).catch(() => {
    // Non-fatal in browser previews or restricted sandboxes.
  });
}

/**
 * Mirrors the theme into `localStorage` so `public/theme-boot.js` can apply it
 * before the first paint. This is a cache only: the Rust settings file stays
 * authoritative and is re-applied by `loadPreferences`.
 */
function applyThemeToDom(theme: string, customTheme?: CustomThemeConfig) {
  const normalized = normalizeTheme(theme);
  const custom = normalizeCustomTheme(customTheme);
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", normalized);
    if (normalized === CUSTOM_THEME_ID) {
      applyCustomThemeTokens(document.documentElement, custom);
    } else {
      clearCustomThemeTokens(document.documentElement);
    }
  }
  try {
    localStorage.setItem(THEME_CACHE_KEY, normalized);
    localStorage.setItem(LEGACY_THEME_CACHE_KEY, normalized);
    localStorage.setItem(CUSTOM_THEME_CACHE_KEY, JSON.stringify(custom));
  } catch {
    // Storage can be disabled or full; the Rust setting still drives the app.
  }
}

function applyUiScaleToDom(scale: number) {
  const normalized = normalizeUiScale(scale);
  if (typeof document !== "undefined") {
    document.documentElement.style.zoom = normalized === 100 ? "" : `${normalized}%`;
    document.documentElement.setAttribute("data-ui-scale", String(normalized));
  }
  try {
    localStorage.setItem(UI_SCALE_CACHE_KEY, String(normalized));
  } catch {
    // Best-effort cache.
  }
}

function applyHighContrastToDom(enabled: boolean) {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-high-contrast", String(Boolean(enabled)));
  }
  try {
    localStorage.setItem(HIGH_CONTRAST_CACHE_KEY, String(Boolean(enabled)));
  } catch {
    // Best-effort cache.
  }
}

function applyLanguageToDom(language: SupportedLanguage) {
  if (typeof document !== "undefined") {
    // The document language must describe the language the UI is actually
    // rendered in, not a locale whose dictionary is incomplete.
    const uiLanguage = resolveUiLocale(language);
    document.documentElement.lang = uiLanguage;
    // Arabic, Hebrew, Persian and Urdu are right-to-left; hard-coding "ltr"
    // rendered their layouts mirrored incorrectly.
    const meta = LANGUAGES_LIST.find((entry) => entry.id === uiLanguage);
    document.documentElement.dir = meta?.rtl ? "rtl" : "ltr";
    try {
      localStorage.setItem(LANG_CACHE_KEY, uiLanguage);
      localStorage.setItem(LEGACY_LANG_CACHE_KEY, uiLanguage);
    } catch {
      // See applyThemeToDom: the cache is best effort.
    }
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

const NOTIFICATION_CHANNELS = new Set(["both", "in_app", "desktop", "none"]);

/**
 * Normalizes persisted shortcuts to the known action set.
 *
 * Persisted settings are user-editable JSON: unknown action ids, modifier-only
 * chords and bare letters (which would swallow normal typing) are dropped. A
 * chord is only treated as "taken" by the action that actually claims it, so a
 * deliberate swap survives a restart instead of reverting silently.
 */
function normalizeShortcuts(value: unknown): Record<string, string> {
  const out: Record<string, string> = { ...DEFAULT_SHORTCUTS };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return out;
  }

  const raw = value as Record<string, unknown>;
  const ids = Object.keys(DEFAULT_SHORTCUTS);

  // Only known actions may be stored: a hand-edited file must not grow the
  // schema with arbitrary keys that are then written back on every save.
  for (const id of ids) {
    const combo = raw[id];
    if (typeof combo !== "string") continue;
    const trimmed = combo.trim();
    if (!trimmed) continue;
    const check = validateShortcut(trimmed);
    if (!check.ok) continue;
    out[id] = trimmed;
  }

  // Resolve duplicate chords: the action whose *default* owns a chord keeps it,
  // and a chord freed by moving that action stays available to whoever took it.
  // The old implementation reserved every default chord unconditionally, so a
  // deliberate swap worked until the next launch and then silently reverted.
  const claimed = new Map<string, string>();
  for (const id of ids) {
    if (DEFAULT_SHORTCUTS[id].toLowerCase() === out[id].toLowerCase()) {
      claimed.set(out[id].toLowerCase(), id);
    }
  }

  const result: Record<string, string> = {};
  for (const id of ids) {
    const chord = out[id].toLowerCase();
    const isDefault = DEFAULT_SHORTCUTS[id].toLowerCase() === chord;
    if (!isDefault && claimed.has(chord)) {
      // Someone else already owns this chord (its own default or an earlier
      // action). Never let a duplicate overwrite it.
      result[id] = DEFAULT_SHORTCUTS[id];
      continue;
    }
    if (!claimed.has(chord)) claimed.set(chord, id);
    result[id] = out[id];
  }
  return result;
}

/**
 * Numeric setting bounds. They mirror `AppSettings::normalize` in the Rust
 * backend exactly; the settings screen and the scan filter use the same values
 * that are persisted, so a value can never look saved while being clamped
 * somewhere else.
 */
export const SETTING_LIMITS = {
  maxDepth: { min: 1, max: 128 },
  maxCandidates: { min: 1_000, max: 500_000 },
  timeoutMinutes: { min: 1, max: 120 },
  minSizeBytes: { min: 0, max: 1024 * 1024 * 1024 },
} as const;

/**
 * Settings that require a matching `apply*ToDom` call. `updateSettings` rejects
 * them so a caller cannot change the value without updating the document.
 */
const DOM_BOUND_KEYS = new Set<string>([
  "theme",
  "customTheme",
  "appIcon",
  "uiScale",
  "highContrast",
  "language",
  "reduceMotion",
  "sidebarMode",
]);

function clampSetting(
  value: number | undefined,
  limits: { min: number; max: number },
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(limits.max, Math.max(limits.min, Math.round(value)));
}

/**
 * Persisted settings are user-editable JSON on disk. A hand-edited file (or an
 * older build) must not smuggle an unknown channel into a notification call or
 * a broken webhook URL into every delivery attempt.
 */
function normalizeNotifications(
  value: Partial<NonNullable<typeof DEFAULT_SETTINGS.notifications>> | undefined,
): NonNullable<typeof DEFAULT_SETTINGS.notifications> {
  const defaults = DEFAULT_SETTINGS.notifications!;
  const source = value ?? {};
  const channel = (candidate: unknown, fallback: string) =>
    typeof candidate === "string" && NOTIFICATION_CHANNELS.has(candidate)
      ? (candidate as typeof defaults.scanComplete)
      : (fallback as typeof defaults.scanComplete);

  return {
    scanComplete: channel(source.scanComplete, defaults.scanComplete),
    cleanComplete: channel(source.cleanComplete, defaults.cleanComplete),
    diskPressure: channel(source.diskPressure, defaults.diskPressure),
    processLock: channel(source.processLock, defaults.processLock),
    automationWebhook: channel(source.automationWebhook, defaults.automationWebhook),
    soundEnabled:
      typeof source.soundEnabled === "boolean" ? source.soundEnabled : defaults.soundEnabled,
  };
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

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
  const allowPrivateWebhooks = state.allowPrivateWebhooks ?? false;
  const webhook = normalizeWebhookUrl(state.webhookUrl, { allowPrivate: allowPrivateWebhooks });
  return {
    // Single source of truth: the default settings carry the schema version.
    schemaVersion: DEFAULT_SETTINGS.schemaVersion,
    theme: state.theme,
    customTheme: normalizeCustomTheme(state.customTheme),
    appIcon: normalizeAppIcon(state.appIcon),
    uiScale: normalizeUiScale(state.uiScale),
    highContrast: Boolean(state.highContrast),
    onboardingCompleted: Boolean(state.onboardingCompleted),
    language: state.language ?? "en",
    reduceMotion: state.reduceMotion,
    favorites: state.favorites,
    recentLocations: state.recentLocations,
    lastScanPath: state.lastScanPath,
    sort: state.sort,
    protectedPaths: state.protectedPaths,
    excludedNames: state.excludedNames,
    scanProfile: state.scanProfile,
    maxDepth: clampSetting(state.maxDepth, SETTING_LIMITS.maxDepth, DEFAULT_SETTINGS.maxDepth),
    maxCandidates: clampSetting(
      state.maxCandidates,
      SETTING_LIMITS.maxCandidates,
      DEFAULT_SETTINGS.maxCandidates,
    ),
    timeoutMinutes: clampSetting(
      state.timeoutMinutes,
      SETTING_LIMITS.timeoutMinutes,
      DEFAULT_SETTINGS.timeoutMinutes,
    ),
    minSizeBytes: clampSetting(
      state.minSizeBytes,
      SETTING_LIMITS.minSizeBytes,
      DEFAULT_SETTINGS.minSizeBytes,
    ),
    maskPaths: state.maskPaths,
    historyEnabled: state.historyEnabled,
    agentPolicy: state.agentPolicy,
    sidebarMode: state.sidebarMode,
    cacheMeasureMode: state.cacheMeasureMode,
    closeAction: state.closeAction,
    customAgentProviders: state.customAgentProviders,
    hiddenBuiltinProviders: state.hiddenBuiltinProviders,
    notifications: state.notifications ?? DEFAULT_SETTINGS.notifications,
    webhookUrl: webhook.ok ? webhook.value : null,
    webhookOnScan: state.webhookOnScan ?? true,
    webhookOnClean: state.webhookOnClean ?? true,
    allowPrivateWebhooks,
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
  if (isAppDataResetting()) return writeChain;
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const state = usePreferencesStore.getState();
  if (!state.isLoaded) return writeChain;

  const snapshot = toSettings(state);
  const write = writeChain.then(async () => {
    // The backend returns the normalised settings; the UI already applied the
    // same limits, so the response is informational here.
    await scannerApi.saveAppSettings(snapshot);
  });
  writeChain = write.catch((err) => {
    log.error("Failed to persist settings", err);
    reportSaveError(state.language);
  });
  return write;
}

/**
 * True when a debounced settings write is waiting. Keeping the flush paths
 * conditional means a StrictMode mount (which unmounts immediately) does not
 * write the settings file back unchanged on every launch.
 */
export function hasPendingPreferencesWrite(): boolean {
  return saveTimer !== null;
}

/**
 * Cancels a debounced save and resolves once writes already in flight settle.
 *
 * A factory reset calls this before deleting the settings file: without it a
 * queued save could run after the deletion and silently recreate `config.json`.
 */
export function quiescePreferencesWrites(): Promise<void> {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  return writeChain;
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

  setTheme: (theme: SelectableTheme | string) => {
    // Single validation gate: an unknown value (old config, hand-edited file)
    // falls back to the default instead of writing an invalid `data-theme`.
    const normalized = normalizeTheme(theme);
    const current = get();
    applyThemeToDom(normalized, current.customTheme);
    set({ theme: normalized });
    if (current.appIcon === APP_ICON_MATCH_THEME) {
      applyAppIconToRuntime(current.appIcon, normalized, current.customTheme);
    }
    syncPreferences(get());
  },

  setCustomTheme: (patch: Partial<CustomThemeConfig>) => {
    const current = get();
    const next = normalizeCustomTheme({ ...current.customTheme, ...patch });
    applyThemeToDom(CUSTOM_THEME_ID, next);
    set({ theme: CUSTOM_THEME_ID, customTheme: next });
    if (current.appIcon === APP_ICON_MATCH_THEME || current.appIcon === APP_ICON_CUSTOM) {
      applyAppIconToRuntime(current.appIcon, CUSTOM_THEME_ID, next);
    }
    syncPreferences(get());
  },

  setAppIcon: (icon: AppIconMode | string) => {
    const normalized = normalizeAppIcon(icon);
    const current = get();
    set({ appIcon: normalized });
    applyAppIconToRuntime(normalized, current.theme, current.customTheme);
    syncPreferences(get());
  },

  setUiScale: (scale: number) => {
    const normalized = normalizeUiScale(scale);
    applyUiScaleToDom(normalized);
    set({ uiScale: normalized });
    syncPreferences(get());
  },

  setHighContrast: (highContrast: boolean) => {
    applyHighContrastToDom(highContrast);
    set({ highContrast: Boolean(highContrast) });
    syncPreferences(get());
  },

  setOnboardingCompleted: (onboardingCompleted: boolean) => {
    set({ onboardingCompleted: Boolean(onboardingCompleted) });
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
    // Debounced like every other setting; callers that need a durability
    // guarantee await `persistSettings()` before reporting success.
    syncPreferences(get());
  },

  resetShortcuts: () => {
    set({ shortcuts: { ...DEFAULT_SHORTCUTS } });
    syncPreferences(get());
  },

  updateSettings: (patch: Partial<AppSettings>) => {
    // These keys have DOM side effects (data-theme, lang/dir attributes,
    // reduce-motion flag, rail width). Applying them here without the matching
    // `apply*ToDom` call left the document stale, so the dedicated setters are
    // the only supported path. Throwing used to abort the caller's entire save
    // (for example a webhook flush) because of one unrelated key, so drop just
    // the offending entries and leave a log line for developers.
    const sanitized: Partial<AppSettings> = { ...patch };
    const offending = Object.keys(patch).filter((key) => DOM_BOUND_KEYS.has(key));
    if (offending.length > 0) {
      log.error("updateSettings ignored DOM-bound keys; use the dedicated setter", offending);
      for (const key of offending) delete sanitized[key as keyof AppSettings];
    }
    if (Object.keys(sanitized).length === 0) return;
    // Persistence is awaited by the settings view so the UI never reports a
    // successful save before the backend has accepted it.
    set(sanitized as Partial<PreferencesState>);
    syncPreferences(get());
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
    const allowPrivateWebhooks = normalizeBoolean(
      prefs.allowPrivateWebhooks,
      DEFAULT_SETTINGS.allowPrivateWebhooks ?? false,
    );
    const webhook = normalizeWebhookUrl(prefs.webhookUrl, { allowPrivate: allowPrivateWebhooks });
    const agentPolicy = prefs.agentPolicy ?? DEFAULT_SETTINGS.agentPolicy;
    const customTheme = normalizeCustomTheme(prefs.customTheme);
    const appIcon = normalizeAppIcon(prefs.appIcon);
    const uiScale = normalizeUiScale(prefs.uiScale);
    const highContrast = normalizeBoolean(prefs.highContrast, false);
    const onboardingCompleted = normalizeBoolean(prefs.onboardingCompleted, false);
    const merged: AppSettings & {
      customTheme: CustomThemeConfig;
      appIcon: AppIconMode;
      uiScale: number;
      highContrast: boolean;
      onboardingCompleted: boolean;
    } = {
      ...DEFAULT_SETTINGS,
      ...prefs,
      theme: normalizeTheme(prefs.theme || DEFAULT_SETTINGS.theme),
      customTheme,
      appIcon,
      uiScale,
      highContrast,
      onboardingCompleted,
      language: resolvedLanguage,
      favorites: prefs.favorites ?? [],
      recentLocations: prefs.recentLocations ?? [],
      sort: normalizeSort(prefs.sort),
      maxDepth: clampSetting(prefs.maxDepth, SETTING_LIMITS.maxDepth, DEFAULT_SETTINGS.maxDepth),
      maxCandidates: clampSetting(
        prefs.maxCandidates,
        SETTING_LIMITS.maxCandidates,
        DEFAULT_SETTINGS.maxCandidates,
      ),
      timeoutMinutes: clampSetting(
        prefs.timeoutMinutes,
        SETTING_LIMITS.timeoutMinutes,
        DEFAULT_SETTINGS.timeoutMinutes,
      ),
      minSizeBytes: clampSetting(
        prefs.minSizeBytes,
        SETTING_LIMITS.minSizeBytes,
        DEFAULT_SETTINGS.minSizeBytes,
      ),
      protectedPaths: prefs.protectedPaths ?? [],
      excludedNames: prefs.excludedNames ?? [],
      agentPolicy: {
        allowCacheCleanup: normalizeBoolean(
          agentPolicy.allowCacheCleanup,
          DEFAULT_SETTINGS.agentPolicy.allowCacheCleanup,
        ),
        protectBrowserRecordings: normalizeBoolean(
          agentPolicy.protectBrowserRecordings,
          DEFAULT_SETTINGS.agentPolicy.protectBrowserRecordings,
        ),
      },
      sidebarMode: prefs.sidebarMode === "collapsed" ? "collapsed" : "expanded",
      cacheMeasureMode: prefs.cacheMeasureMode === "full" ? "full" : "fast",
      closeAction:
        prefs.closeAction === "tray" || prefs.closeAction === "quit" ? prefs.closeAction : "ask",
      customAgentProviders: prefs.customAgentProviders ?? [],
      hiddenBuiltinProviders: prefs.hiddenBuiltinProviders ?? [],
      notifications: normalizeNotifications(prefs.notifications),
      // A corrupt URL must never be persisted again; it would be retried on
      // every scan/cleanup event.
      webhookUrl: webhook.ok ? webhook.value : null,
      webhookOnScan: normalizeBoolean(prefs.webhookOnScan, DEFAULT_SETTINGS.webhookOnScan ?? true),
      webhookOnClean: normalizeBoolean(
        prefs.webhookOnClean,
        DEFAULT_SETTINGS.webhookOnClean ?? true,
      ),
      allowPrivateWebhooks,
      shortcuts: normalizeShortcuts(prefs.shortcuts),
      mcpAllowDestructive: prefs.mcpAllowDestructive ?? false,
    };
    applyThemeToDom(merged.theme, merged.customTheme);
    applyAppIconToRuntime(merged.appIcon, merged.theme, merged.customTheme);
    applyUiScaleToDom(merged.uiScale);
    applyHighContrastToDom(merged.highContrast);
    applyLanguageToDom(resolvedLanguage);
    applyReduceMotionToDom(merged.reduceMotion);
    // L12: a corrupt stored URL used to be dropped silently. Tell the user once
    // at load time instead of letting the value vanish on the next save.
    if (prefs.webhookUrl && !webhook.ok) {
      useUiStore
        .getState()
        .showToast(getUIText(resolvedLanguage).settings.webhookUrlEmpty, "warning", 6000);
    }
    if (prefs.recoveredFromCorrupt) {
      useUiStore
        .getState()
        .showToast(getUIText(resolvedLanguage).errors.settingsReadFailed, "warning", 7000);
    }
    // A stored shortcut that failed validation was replaced by its default.
    // Saying nothing made the binding look like it "randomly" reverted after a
    // restart; name the count instead of listing every id.
    const storedShortcuts = prefs.shortcuts ?? {};
    const dropped = Object.keys(DEFAULT_SHORTCUTS).filter(
      (id) =>
        typeof storedShortcuts[id] === "string" &&
        storedShortcuts[id] !== (merged.shortcuts?.[id] ?? DEFAULT_SHORTCUTS[id]),
    );
    if (dropped.length > 0) {
      log.warn("Replaced invalid stored shortcuts with defaults", dropped);
      useUiStore
        .getState()
        .showToast(
          getUIText(resolvedLanguage).settings.shortcutsResetWarning(dropped.length),
          "warning",
          7000,
        );
    }
    set({ ...merged, isLoaded: true });
  },

  // Provider mutations return the whole settings object, but overwriting the
  // full state with it erased unrelated edits that were still pending (typing
  // in a settings field, a favourite just added). Merge only the provider
  // slices that the mutation actually owns.
  applyProviderSettings: (prefs) => {
    set({
      customAgentProviders: prefs.customAgentProviders ?? get().customAgentProviders,
      hiddenBuiltinProviders: prefs.hiddenBuiltinProviders ?? get().hiddenBuiltinProviders,
    });
  },
}));

export { DEFAULT_SETTINGS };
