import { usePreferencesStore } from "@/stores/preferences-store";
import { EN } from "./en";
import { TR } from "./tr";
import { DICTIONARIES } from "@/locales/dictionaries";

export {
  SUPPORTED_UI_LOCALES,
  resolveUiLocale,
  type UiLocale,
} from "@/lib/ui-locale";

import { resolveUiLocale } from "@/lib/ui-locale";

export interface UIText {
  nav: {
    primary: string;
    overview: string;
    projects: string;
    agents: string;
    caches: string;
    docs: string;
    history: string;
    settings: string;
    about: string;
  };
  common: {
    scan: string; scanning: string; cancel: string; rescan: string; chooseFolder: string;
    refresh: string; open: string; close: string; back: string; browse: string; skipToContent: string; confirm: string; loading: string; none: string;
    clear: string; allDrives: string; save: string; add: string; remove: string;
    stop: string; increase: string; decrease: string;
    on: string; off: string;
    items: (n: number) => string; showing: (n: number) => string;
  };
  header: {
    changeLocation: string; folderNotSelected: string; chooseFolderSub: string;
    defaultLocations: string; favorites: string; recent: string; noFavorites: string;
    addFavorite: string; removeFavorite: string;
    favoriteAdded: string; favoriteRemoved: string;
  };
  window: { minimize: string; maximize: string; restore: string; close: string };
  locations: {
    desktop: string; documents: string; projects: string;
    code: string; dev: string; repos: string;
  };
  overview: {
    title: string; subtitle: string; cleanable: string; protected: string; candidates: string;
    projects: string; scanFirst: string; topItems: string; breakdown: string; partial: string;
    noScan: string; startHint: string; stopReason: string; warnings: string; errors: string;
    resetUi: string; restoreLastScan: string; resetToast: string; restoreSuccessToast: string; noLastScanToast: string;
    resetConfirmTitle: string; resetConfirmDesc: string; resetConfirmBtn: string; restoreConfirmTitle: string; restoreConfirmDesc: string; restoreConfirmBtn: string;
  };
  table: {
    label: string;
    name: string; project: string; category: string; size: string; reclaim: string;
    safety: string; method: string; modified: string; actions: string; selectAll: string;
    selected: (n: number) => string; noResults: string; noItems: string;
    clearFilters: string; searchPlaceholder: string;
    allSafety: string; selectSafe: string; clearSelection: string; openFolder: string;
    selectRow: string; unmeasured: string; details: string;
    allProjects: string; allCategories: string; projectFilter: string; categoryFilter: string;
    sortHint: string; officialTool: string; sizeHint: string; reclaimHint: string;
    selectVisible: string;
  };
  stale: {
    bannerTitle: string; bannerBody: (date: string) => string; warningTitle: string;
    warningBody: (date: string) => string; rescan: string; continueAnyway: string;
    dismiss: string; previousComparison: string; cleanableDelta: (value: string) => string;
    itemsDelta: (delta: number) => string; restoredAt: (date: string) => string;
    savedLocally: string;
  };
  closeGuard: {
    title: string; body: string; minimize: string; quit: string; stay: string; trayHint: string;
    remember: string; rememberHint: string;
  };
  safety: { safe: string; regenerate: string; review: string; keep: string };
  plan: {
    title: string; subtitle: string; method: string; trash: string; permanent: string;
    trashNote: string; permanentNote: string; eligible: string; blocked: string;
    estimated: string; logical: string; confirmTrash: string; confirmPermanent: string;
    permanentAck: string; blockedReasons: string; expires: string; close: string; working: string;
  };
  result: {
    title: string; success: string; failed: string; moved: string; reclaimed: string;
    trashNote: string; permanentNote: string; volumeDelta: string; close: string; verified: string;
  };
  agents: {
    title: string; subtitle: string; scan: string; active: string; readOnly: string;
    protectedBytes: string; growth: string; noProviders: string; notInstalled: string;
    providerNote: string; growthEmpty: string; loadError: string;
    addTool: string; addToolHint: string; toolName: string; toolNamePlaceholder: string;
    toolRoots: string; addRoot: string; removeTool: string; removeToolConfirm: string;
    hide: string; showHidden: string; hiddenTools: string; customTool: string;
    keepOnly: string; manageTitle: string; saveError: string; added: string;
    removed: string; hidden: string; shown: string;
  };
  caches: {
    title: string; subtitle: string; refresh: string; notFound: string; runAction: string;
    previewTitle: string; warning: string; running: string; result: string; before: string;
    after: string; delta: string; readOnly: string; detectorNote: string;
    executable: string; networkWarning: string; succeeded: string; failed: string;
    exitCode: string; loadError: string; auditError: string; noProviders: string;
    measure: string; measuring: string; measureProgress: (done: number, total: number) => string;
    cancelMeasure: string; measured: string; notMeasured: string; measureHint: string;
    measureCancelled: string;
  };
  history: {
    title: string; empty: string; timestamp: string; mode: string; success: string;
    errors: string; reclaim: string; duration: string; details: string; records: (n: number) => string;
    loadError: string; moved: string; clear: string; clearConfirm: string; clearHint: string;
    actions: string; actionLabel: string; actionsEmpty: string;
    subtitle: string; tabCleanups: string; tabActions: string; totalReclaimed: string;
    totalRuns: string; lastRun: string;
  };
  settings: {
    general: string; scan: string; protections: string; agents: string; privacy: string;
    legal: string;
    theme: string; language: string; reduceMotion: string; scanProfile: string;
    profileBalanced: string; profileFast: string; profileDeep: string; maxDepth: string;
    maxCandidates: string; timeout: string; minSize: string; maskPaths: string;
    historyEnabled: string; protectedPaths: string; addPath: string; remove: string;
    excludedNames: string; agentCacheCleanup: string; browserRecordings: string;
    saved: string; saveError: string; about: string; version: string;
    buildCommit: string; buildProfile: string; buildDirty: string;
    rules: string; ecosystems: string; categories: string;
    subtitle: string; generalHint: string; scanHint: string; protectionsHint: string;
    agentsHint: string; privacyHint: string; aboutHint: string;
    sidebar: string; sidebarExpanded: string; sidebarCollapsed: string;
    closeAction: string; closeAsk: string; closeTray: string; closeQuit: string;
    cacheMeasure: string; cacheMeasureFast: string; cacheMeasureFull: string;
    themeDark: string; themeLight: string; themeBlack: string; themeGray: string;
    themeWhite: string; themeBlue: string; themePurple: string; themeGreen: string;
    themeRed: string; themeOrange: string; themeYellow: string;
    legalHint: string;
    aboutTagline: string; aboutMadeBy: string; aboutVisit: string;
    aboutBuildTitle: string; aboutCatalogTitle: string; aboutLegalTitle: string;
    aboutLegalHint: string; aboutLocalFirst: string; aboutCopyright: string;
    aboutBuiltAt: string; aboutLegalRevision: string; aboutOpenDoc: string;
  };
  legal: {
    docTabsLabel: string; contact: string; rights: string;
    directTitle: string; directHint: string;
    colEcosystem: string; colComponent: string; colVersion: string; colLicense: string;
    groupsTitle: string; groupsHint: string; groupsRust: string; groupsNpm: string;
  };
  errors: { title: string; blocked: string; retry: string };
  warnings: {
    userProtected: string; targetActive: string; providerActive: string;
    recordingActive: string; agentCacheDisabled: string; protectedTarget: string;
    noProjectMarker: string; other: (code: string) => string;
  };
}

function createFallbackProxy<T extends object>(target: any, fallback: T): T {
  return new Proxy(target, {
    get(obj, prop: string | symbol) {
      if (typeof prop === "symbol") return obj[prop];
      const val = obj[prop];
      const fallbackVal = (fallback as any)[prop];
      if (val === undefined || val === null || val === "") {
        return fallbackVal;
      }
      if (typeof val === "object" && val !== null && !Array.isArray(val) && typeof fallbackVal === "object") {
        return createFallbackProxy(val, fallbackVal);
      }
      return val;
    },
  });
}

function adaptDictionaryToUIText(dict: any, fallback: UIText): UIText {
  if (!dict) return fallback;

  const adapted: any = {
    nav: {
      primary: dict.app?.title || fallback.nav.primary,
      overview: dict.scan?.idleTitle || fallback.nav.overview,
      projects: dict.table?.project || fallback.nav.projects,
      agents: fallback.nav.agents,
      caches: fallback.nav.caches,
      docs: fallback.nav.docs,
      history: dict.recent?.title || fallback.nav.history,
      settings: dict.header?.settings || fallback.nav.settings,
      about: dict.legal?.title || fallback.nav.about,
    },
    common: {
      ...fallback.common,
      scan: dict.header?.scan || fallback.common.scan,
      scanning: dict.header?.scanning || fallback.common.scanning,
      cancel: dict.header?.stopScan || fallback.common.cancel,
      rescan: dict.header?.rescan || fallback.common.rescan,
      chooseFolder: dict.header?.chooseFolder || fallback.common.chooseFolder,
      clear: dict.common?.clear || fallback.common.clear,
      save: dict.settings?.save || fallback.common.save,
      stop: dict.header?.stopScan || fallback.common.stop,
    },
    header: {
      ...fallback.header,
      changeLocation: dict.header?.changeLocation || fallback.header.changeLocation,
      folderNotSelected: dict.header?.folderNotSelected || fallback.header.folderNotSelected,
      chooseFolderSub: dict.header?.chooseFolderSub || fallback.header.chooseFolderSub,
      defaultLocations: dict.header?.defaultLocations || fallback.header.defaultLocations,
      favorites: dict.header?.favorites || fallback.header.favorites,
      recent: dict.header?.recent || fallback.header.recent,
      noFavorites: dict.header?.noFavorites || fallback.header.noFavorites,
    },
    window: {
      minimize: dict.window?.minimize || fallback.window.minimize,
      maximize: dict.window?.maximize || fallback.window.maximize,
      restore: dict.window?.restore || fallback.window.restore,
      close: dict.window?.close || fallback.window.close,
    },
    locations: {
      desktop: dict.quickLocations?.desktop || fallback.locations.desktop,
      documents: dict.quickLocations?.documents || fallback.locations.documents,
      projects: dict.quickLocations?.projects || fallback.locations.projects,
      code: dict.quickLocations?.code || fallback.locations.code,
      dev: dict.quickLocations?.dev || fallback.locations.dev,
      repos: dict.quickLocations?.repos || fallback.locations.repos,
    },
    overview: {
      ...fallback.overview,
      title: dict.scan?.idleTitle || fallback.overview.title,
      subtitle: dict.scan?.idleSubtitle || fallback.overview.subtitle,
      cleanable: dict.overview?.cleanable || fallback.overview.cleanable,
      protected: dict.overview?.protected || fallback.overview.protected,
      candidates: dict.overview?.candidates || fallback.overview.candidates,
      projects: dict.overview?.projects || fallback.overview.projects,
    },
    table: {
      ...fallback.table,
      selectAll: dict.table?.selectAll || fallback.table.selectAll,
      selectRow: dict.table?.selectRow || fallback.table.selectRow,
      project: dict.table?.project || fallback.table.project,
      size: dict.table?.size || fallback.table.size,
      modified: dict.table?.modified || fallback.table.modified,
      actions: dict.table?.actions || fallback.table.actions,
      searchPlaceholder: dict.table?.searchPlaceholder || fallback.table.searchPlaceholder,
    },
    settings: {
      ...fallback.settings,
      general: dict.settings?.general || fallback.settings.general,
      theme: dict.settings?.theme || fallback.settings.theme,
      themeDark: dict.settings?.themeDark || fallback.settings.themeDark,
      themeLight: dict.settings?.themeLight || fallback.settings.themeLight,
      language: dict.settings?.language || fallback.settings.language,
      scan: dict.settings?.scan || fallback.settings.scan,
    },
  };

  return createFallbackProxy(adapted, fallback);
}

const UI_TEXT_CACHE = new Map<string, UIText>();
UI_TEXT_CACHE.set("tr", TR);
UI_TEXT_CACHE.set("en", EN);

export function getUIText(language?: string | null): UIText {
  const resolved = resolveUiLocale(language);
  if (resolved === "tr") return TR;
  if (resolved === "en") return EN;

  let cached = UI_TEXT_CACHE.get(resolved);
  if (!cached) {
    const dict = DICTIONARIES[resolved];
    cached = adaptDictionaryToUIText(dict, EN);
    UI_TEXT_CACHE.set(resolved, cached);
  }
  return cached;
}

export function useUIText(): UIText {
  const language = usePreferencesStore((s) => s.language);
  return getUIText(language);
}
