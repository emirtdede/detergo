import { usePreferencesStore } from "@/stores/preferences-store";
import { EN } from "./en";
import { TR } from "./tr";
import { DICTIONARIES } from "@/locales/dictionaries";

export { SUPPORTED_UI_LOCALES, resolveUiLocale, type UiLocale } from "@/lib/ui-locale";

import { resolveUiLocale } from "@/lib/ui-locale";
import { translateBackendText, translateActionDescription } from "./backend-i18n";

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
    scan: string;
    scanning: string;
    cancel: string;
    rescan: string;
    chooseFolder: string;
    refresh: string;
    open: string;
    close: string;
    back: string;
    browse: string;
    skipToContent: string;
    confirm: string;
    loading: string;
    none: string;
    clear: string;
    allDrives: string;
    save: string;
    add: string;
    remove: string;
    stop: string;
    increase: string;
    decrease: string;
    on: string;
    off: string;
    items: (n: number) => string;
    showing: (n: number) => string;
  };
  header: {
    changeLocation: string;
    folderNotSelected: string;
    chooseFolderSub: string;
    defaultLocations: string;
    favorites: string;
    recent: string;
    noFavorites: string;
    addFavorite: string;
    removeFavorite: string;
    favoriteAdded: string;
    favoriteRemoved: string;
  };
  window: { minimize: string; maximize: string; restore: string; close: string };
  locations: {
    desktop: string;
    documents: string;
    projects: string;
    code: string;
    dev: string;
    repos: string;
    workspace: string;
    workspaces: string;
  };
  overview: {
    title: string;
    subtitle: string;
    cleanable: string;
    protected: string;
    candidates: string;
    projects: string;
    scanFirst: string;
    topItems: string;
    breakdown: string;
    partial: string;
    noScan: string;
    startHint: string;
    stopReason: string;
    warnings: string;
    errors: string;
    resetUi: string;
    restoreLastScan: string;
    resetToast: string;
    restoreSuccessToast: string;
    noLastScanToast: string;
    resetConfirmTitle: string;
    resetConfirmDesc: string;
    resetConfirmBtn: string;
    restoreConfirmTitle: string;
    restoreConfirmDesc: string;
    restoreConfirmBtn: string;
    pageTitle: string;
    pageSubtitle: string;
    statusScanning: string;
    statusReady: string;
    statusIdle: string;
    kpiCleanable: string;
    kpiCleanableSub: string;
    kpiSafeReclaim: string;
    kpiSafeReclaimSub: string;
    kpiTargets: string;
    kpiTargetsSubActive: (count: number) => string;
    kpiTargetsSubIdle: string;
    kpiLifetime: string;
    kpiLifetimeSubRuns: (count: number) => string;
    kpiLifetimeSubIdle: string;
    distTitle: string;
    distSubtitleActive: string;
    distSubtitleIdle: string;
    distEmptyTitle: string;
    distEmptyDesc: string;
    topItemsTitle: string;
    topItemsSubtitle: string;
    viewAll: string;
    topItemsEmpty: string;
    hubProjectsTitle: string;
    hubProjectsDesc: string;
    hubAgentsTitle: string;
    hubAgentsDesc: string;
    hubCachesTitle: string;
    hubCachesDesc: string;
    hubHistoryTitle: string;
    hubHistoryDescActive: (bytes: string) => string;
    hubHistoryDescIdle: string;
    ecoNode: string;
    ecoRust: string;
    ecoPython: string;
    ecoAgent: string;
    ecoCache: string;
    ecoOther: string;
    distTotalBadge: (size: string) => string;
  };
  table: {
    label: string;
    name: string;
    project: string;
    category: string;
    size: string;
    reclaim: string;
    safety: string;
    method: string;
    modified: string;
    actions: string;
    selectAll: string;
    selected: (n: number) => string;
    noResults: string;
    noItems: string;
    clearFilters: string;
    searchPlaceholder: string;
    allSafety: string;
    selectSafe: string;
    clearSelection: string;
    openFolder: string;
    selectRow: string;
    unmeasured: string;
    details: string;
    allProjects: string;
    allCategories: string;
    projectFilter: string;
    categoryFilter: string;
    sortHint: string;
    officialTool: string;
    sizeHint: string;
    reclaimHint: string;
    selectVisible: string;
  };
  stale: {
    bannerTitle: string;
    bannerBody: (date: string) => string;
    warningTitle: string;
    warningBody: (date: string) => string;
    rescan: string;
    continueAnyway: string;
    dismiss: string;
    previousComparison: string;
    cleanableDelta: (value: string) => string;
    itemsDelta: (delta: number) => string;
    restoredAt: (date: string) => string;
    savedLocally: string;
  };
  closeGuard: {
    title: string;
    body: string;
    minimize: string;
    quit: string;
    stay: string;
    trayHint: string;
    remember: string;
    rememberHint: string;
  };
  safety: { safe: string; regenerate: string; review: string; keep: string };
  plan: {
    title: string;
    subtitle: string;
    method: string;
    trash: string;
    permanent: string;
    trashNote: string;
    permanentNote: string;
    eligible: string;
    blocked: string;
    estimated: string;
    logical: string;
    confirmTrash: string;
    confirmPermanent: string;
    permanentAck: string;
    blockedReasons: string;
    expires: string;
    close: string;
    working: string;
    runInBackground: string;
    cancelRun: string;
    cancelling: string;
    progress: (processed: number, total: number) => string;
    currentItem: (path: string) => string;
    alreadyRunning: string;
  };
  result: {
    title: string;
    success: string;
    failed: string;
    moved: string;
    reclaimed: string;
    trashNote: string;
    permanentNote: string;
    volumeDelta: string;
    close: string;
    verified: string;
    cancelled: string;
    cancelledNote: (processed: number, skipped: number) => string;
    processed: string;
    skipped: string;
    viewResults: string;
    dismiss: string;
  };
  agents: {
    title: string;
    subtitle: string;
    scan: string;
    active: string;
    readOnly: string;
    protectedBytes: string;
    growth: string;
    noProviders: string;
    notInstalled: string;
    providerNote: string;
    growthEmpty: string;
    loadError: string;
    addTool: string;
    addToolHint: string;
    toolName: string;
    toolNamePlaceholder: string;
    toolRoots: string;
    addRoot: string;
    removeTool: string;
    removeToolConfirm: string;
    hide: string;
    showHidden: string;
    hiddenTools: string;
    customTool: string;
    keepOnly: string;
    manageTitle: string;
    saveError: string;
    added: string;
    removed: string;
    hidden: string;
    shown: string;
    kpiStorage: string;
    kpiSafeReclaim: string;
    kpiSafeReclaimSub: string;
    kpiInstalled: string;
    notScanned: string;
    itemsSub: (count: number) => string;
    scanHint: string;
    emptyTitleClean: string;
    emptyTitleIdle: string;
    emptyDescClean: string;
    emptyDescIdle: string;
    toastRefreshed: string;
    toastError: (err: string) => string;
    tabItems: string;
    tabProviders: string;
  };
  caches: {
    title: string;
    subtitle: string;
    refresh: string;
    notFound: string;
    runAction: string;
    previewTitle: string;
    warning: string;
    running: string;
    result: string;
    before: string;
    after: string;
    delta: string;
    readOnly: string;
    detectorNote: string;
    executable: string;
    networkWarning: string;
    succeeded: string;
    failed: string;
    exitCode: string;
    loadError: string;
    auditError: string;
    noProviders: string;
    measure: string;
    measuring: string;
    measureProgress: (done: number, total: number) => string;
    cancelMeasure: string;
    measured: string;
    notMeasured: string;
    measureHint: string;
    measureCancelled: string;
    kpiTotal: string;
    kpiMeasured: string;
    kpiActions: string;
    kpiActionsSub: string;
    actionsReady: (n: number) => string;
    terminalTitle: string;
    terminalRunning: string;
    terminalCompleted: string;
    terminalError: string;
    terminalReady: string;
    terminalBackground: string;
    terminalFinished: (ms: number, code: number) => string;
  };
  history: {
    title: string;
    empty: string;
    timestamp: string;
    mode: string;
    success: string;
    errors: string;
    reclaim: string;
    duration: string;
    details: string;
    records: (n: number) => string;
    loadError: string;
    moved: string;
    clear: string;
    clearConfirm: string;
    clearHint: string;
    actions: string;
    actionLabel: string;
    actionsEmpty: string;
    subtitle: string;
    tabCleanups: string;
    tabActions: string;
    totalReclaimed: string;
    totalRuns: string;
    lastRun: string;
    tabScans: string;
    emptyScans: string;
    colScope: string;
    colPath: string;
    colEntries: string;
    statusCompleted: string;
    statusCancelled: string;
    restoreScanTooltip: string;
    restoreScanBtn: string;
    prevScan: string;
    clearScansTitle: string;
    clearCleanupsTitle: string;
    clearActionsTitle: string;
    clearScansDesc: string;
    clearCleanupsDesc: string;
    clearActionsDesc: string;
    clearAllBtn: string;
    clearCurrentBtn: string;
    toastCleanupsCleared: string;
    toastActionsCleared: string;
    toastScansCleared: string;
    toastAllCleared: string;
    clearCleanupsTooltip: string;
    clearActionsTooltip: string;
    clearScansTooltip: string;
    clearCleanupsBtn: string;
    clearActionsBtn: string;
    clearScansBtn: string;
    scopeProjects: string;
    scopeAgents: string;
    scopeAllDrives: string;
  };
  settings: {
    general: string;
    scan: string;
    protections: string;
    agents: string;
    privacy: string;
    legal: string;
    theme: string;
    language: string;
    reduceMotion: string;
    scanProfile: string;
    profileBalanced: string;
    profileFast: string;
    profileDeep: string;
    maxDepth: string;
    maxCandidates: string;
    timeout: string;
    minSize: string;
    maskPaths: string;
    historyEnabled: string;
    protectedPaths: string;
    addPath: string;
    remove: string;
    excludedNames: string;
    agentCacheCleanup: string;
    browserRecordings: string;
    saved: string;
    saveError: string;
    about: string;
    version: string;
    buildCommit: string;
    buildProfile: string;
    buildDirty: string;
    buildProfileRelease: string;
    buildProfileDev: string;
    buildProfileUnknown: string;
    rules: string;
    ecosystems: string;
    categories: string;
    subtitle: string;
    generalHint: string;
    scanHint: string;
    protectionsHint: string;
    agentsHint: string;
    privacyHint: string;
    aboutHint: string;
    sidebar: string;
    sidebarExpanded: string;
    sidebarCollapsed: string;
    closeAction: string;
    closeAsk: string;
    closeTray: string;
    closeQuit: string;
    cacheMeasure: string;
    cacheMeasureFast: string;
    cacheMeasureFull: string;
    themeDark: string;
    themeLight: string;
    themeBlack: string;
    themeGray: string;
    themeWhite: string;
    themeBlue: string;
    themePurple: string;
    themeGreen: string;
    themeRed: string;
    themeOrange: string;
    themeYellow: string;
    themeTransparent: string;
    webhookPlaceholder: string;
    webhookUrl: string;
    legalHint: string;
    aboutTagline: string;
    aboutMadeBy: string;
    aboutVisit: string;
    aboutTitleBy: string;
    aboutBuildTitle: string;
    aboutCatalogTitle: string;
    aboutLegalTitle: string;
    aboutLegalHint: string;
    aboutLocalFirst: string;
    aboutCopyright: string;
    aboutBuiltAt: string;
    aboutLegalRevision: string;
    aboutOpenDoc: string;
    scToggleSidebar: string;
    scToggleSidebarHint: string;
    scFocusSearch: string;
    scFocusSearchHint: string;
    scStartStopScan: string;
    scStartStopScanHint: string;
    scNavOverview: string;
    scNavOverviewHint: string;
    scNavProjects: string;
    scNavProjectsHint: string;
    scNavAgents: string;
    scNavAgentsHint: string;
    scNavCaches: string;
    scNavCachesHint: string;
    scNavDocs: string;
    scNavDocsHint: string;
    scNavHistory: string;
    scNavHistoryHint: string;
    scNavSettings: string;
    scNavSettingsHint: string;
    shortcutsTitle: string;
    shortcutsDesc: string;
    resetShortcuts: string;
    thAction: string;
    thDesc: string;
    thShortcut: string;
    pressKey: string;
    changeKey: string;
    reservedWarning: (key: string) => string;
    conflictWarning: (key: string, name: string) => string;
    toastShortcutUpdated: (key: string) => string;
    toastShortcutsReset: string;
    notifTitle: string;
    notifDesc: string;
    testDesktop: string;
    testInApp: string;
    notifSounds: string;
    notifSoundsHint: string;
    eventMatrixTitle: string;
    evScanDone: string;
    evScanDoneHint: string;
    evCleanDone: string;
    evCleanDoneHint: string;
    evDiskAlert: string;
    evDiskAlertHint: string;
    evLockConflict: string;
    evLockConflictHint: string;
    evAutomation: string;
    evAutomationHint: string;
    chBoth: string;
    chInApp: string;
    chDesktop: string;
    chNone: string;
    webhookTitle: string;
    webhookDesc: string;
    webhookTestBtn: string;
    webhookSending: string;
    webhookScanDone: string;
    webhookScanDoneHint: string;
    webhookCleanDone: string;
    webhookCleanDoneHint: string;
    mcpDestructiveTitle: string;
    mcpDestructiveHint: string;
    webhookUrlEmpty: string;
    webhookSent: string;
    kpiAppearance: string;
    kpiScanProfile: string;
    kpiSecurity: string;
    kpiFoldersDefined: (count: number) => string;
    kpiRulesDefined: (count: number) => string;
    reducedMotion: string;
    standardMotion: string;
  };
  legal: {
    docTabsLabel: string;
    contact: string;
    rights: string;
    directTitle: string;
    directHint: string;
    colEcosystem: string;
    colComponent: string;
    colVersion: string;
    colLicense: string;
    groupsTitle: string;
    groupsHint: string;
    groupsRust: string;
    groupsNpm: string;
    statRustCrates: string;
    statJsPackages: string;
    statDirectDeps: string;
    lastUpdated: (date: string) => string;
  };
  projects: {
    title: string;
    subtitle: string;
    kpiArtifacts: string;
    kpiSafeReclaim: string;
    kpiSafeReclaimSub: string;
    kpiDetected: string;
    kpiDetectedSub: string;
    emptyTitleClean: string;
    emptyTitleIdle: string;
    emptyDescClean: string;
    emptyDescIdle: string;
  };
  about: {
    kpiVersion: string;
    kpiCatalog: string;
    kpiRulesSub: string;
    kpiEco: string;
    kpiEcoSub: string;
    kpiLicense: string;
    kpiLicenseValue: string;
    kpiLicenseSub: string;
    gitCommitHash: string;
    ecoRustScope: string;
    ecoCacheScope: string;
    contactPrivacy: string;
    contactSupportDesc: string;

    appVersion: string;
    builtAt: string;
    localSafeNote: string;
    catalogTitle: string;
    ruleAgents: string;
    ruleCaches: string;
    ruleBuild: string;
    ruleBuildScope: string;
    schemaVerified: string;
    safetyEngine: string;
    safetyActive: string;
    contactsTitle: string;
    contactsSubtitle: string;
    contactGeneral: string;
    contactGeneralDesc: string;
    contactLegal: string;
    contactLegalDesc: string;
    contactSecurity: string;
    contactSecurityDesc: string;
    contactSupport: string;
    contactBillingDesc: string;
    contactPrivacyDesc: string;
  };
  docs: {
    catGuide: string;
    catCli: string;
    catMcp: string;
    catWebhook: string;
    catSafety: string;
    searchPlaceholder: string;
    noSearchResults: string;
    copy: string;
    copied: string;
    overviewPill: string;
    manifestoPill: string;
    englishNotice: string;
  };
  notifications: {
    scanDoneTitle: string;
    scanDoneBody: (targets: number, bytes: string) => string;
    cleanDoneTitle: string;
    cleanDoneBody: (count: number, dest: string, bytes: string) => string;
    diskAlertTitle: string;
    diskAlertBody: (drive: string, percent: number, free: string) => string;
    lockAlertTitle: string;
    lockAlertBody: (path: string) => string;
    webhookSuccess: string;
    webhookSuccessBody: (url: string) => string;
    webhookError: string;
    webhookErrorBody: (err: string) => string;
    testDesktopTitle: string;
    testDesktopBody: string;
    testInAppToast: string;
    destTrash: string;
    destPermanent: string;
  };
  errors: {
    title: string;
    blocked: string;
    retry: string;
    invalidPath: string;
    accessDenied: string;
    pathNotFound: string;
    scanCancelled: string;
    scanFailed: string;
    unsafeDeleteTarget: string;
    recycleBinFailed: string;
    permanentDeleteFailed: string;
    settingsReadFailed: string;
    settingsWriteFailed: string;
    platformUnsupported: string;
    network: string;
    sessionInvalid: string;
    sessionExpired: string;
    planInvalid: string;
    planExpired: string;
    planChanged: string;
    contentChanged: string;
    notMeasured: string;
    recycleBinTooSmall: string;
    recycleBinDisabled: string;
    recycleBinNotFound: string;
    recycleBinPathTooLong: string;
    recycleBinSharingViolation: string;
    recycleBinAccessDenied: string;
    recycleBinAborted: string;
    recycleBinComFailed: string;
    unknown: string;
  };
  warnings: {
    userProtected: string;
    targetActive: string;
    providerActive: string;
    recordingActive: string;
    agentCacheDisabled: string;
    protectedTarget: string;
    noProjectMarker: string;
    belowMinSize: string;
    verificationFailed: string;
    other: (code: string) => string;
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
      if (
        typeof val === "object" &&
        val !== null &&
        !Array.isArray(val) &&
        typeof fallbackVal === "object"
      ) {
        return createFallbackProxy(val, fallbackVal);
      }
      return val;
    },
  });
}

function adaptDictionaryToUIText(dict: any, fallback: UIText): UIText {
  if (!dict) return fallback;

  // Locale JSON files are authored against the same UIText schema as the
  // English dictionary, so they can be used directly. The fallback proxy
  // fills in any missing or empty leaf with the English text.
  return createFallbackProxy(dict, fallback);
}

const LOCALE_MODULES = import.meta.glob("./locales/*.json", { eager: true }) as Record<
  string,
  { default?: any } | any
>;

const FUNCTION_PARAM_MAP: Record<string, string[]> = {
  "common.items": ["n"],
  "common.showing": ["n"],
  "overview.kpiTargetsSubActive": ["count"],
  "overview.kpiLifetimeSubRuns": ["count"],
  "overview.hubHistoryDescActive": ["bytes"],
  "overview.distTotalBadge": ["size"],
  "table.selected": ["n"],
  "stale.bannerBody": ["date"],
  "stale.warningBody": ["date"],
  "stale.cleanableDelta": ["value"],
  "stale.itemsDelta": ["delta"],
  "stale.restoredAt": ["date"],
  "agents.itemsSub": ["count"],
  "agents.toastError": ["err"],
  "caches.measureProgress": ["done", "total"],
  "caches.actionsReady": ["n"],
  "caches.terminalFinished": ["ms", "code"],
  "history.records": ["n"],
  "settings.reservedWarning": ["key"],
  "settings.conflictWarning": ["key", "name"],
  "settings.toastShortcutUpdated": ["key"],
  "settings.kpiFoldersDefined": ["count"],
  "settings.kpiRulesDefined": ["count"],
  "legal.lastUpdated": ["date"],
  "plan.progress": ["processed", "total"],
  "plan.currentItem": ["path"],
  "result.cancelledNote": ["processed", "skipped"],
  "notifications.scanDoneBody": ["targets", "bytes"],
  "notifications.cleanDoneBody": ["count", "dest", "bytes"],
  "notifications.diskAlertBody": ["drive", "percent", "free"],
  "notifications.lockAlertBody": ["path"],
  "notifications.webhookSuccessBody": ["url"],
  "notifications.webhookErrorBody": ["err"],
  "warnings.other": ["code"],
};

function hydrateLocale(raw: any): UIText {
  const result: any = {};
  for (const [cat, keys] of Object.entries(raw)) {
    if (typeof keys !== "object" || keys === null) continue;
    result[cat] = {};
    for (const [k, val] of Object.entries(keys as Record<string, any>)) {
      const fullPath = `${cat}.${k}`;
      const params = FUNCTION_PARAM_MAP[fullPath];
      if (params) {
        const template = String(val);
        result[cat][k] = (...args: any[]) => {
          let str = template;
          params.forEach((param, idx) => {
            str = str.replaceAll(`{${param}}`, String(args[idx] ?? ""));
          });
          return str;
        };
      } else {
        result[cat][k] = val;
      }
    }
  }
  return result as UIText;
}

const UI_TEXT_CACHE = new Map<string, UIText>();
UI_TEXT_CACHE.set("tr", TR);
UI_TEXT_CACHE.set("en", EN);

export function getUIText(language?: string | null): UIText {
  // Callers that run outside React (stores, event handlers, dialogs) omit the
  // language argument. Falling back to English here would leak English text into
  // every non-English UI, so resolve against the persisted preference instead.
  const resolved = resolveUiLocale(language ?? usePreferencesStore.getState().language);
  if (resolved === "tr") return TR;
  if (resolved === "en") return EN;

  let cached = UI_TEXT_CACHE.get(resolved);
  if (!cached) {
    const rawModule = LOCALE_MODULES[`./locales/${resolved}.json`];
    const raw = rawModule?.default ?? rawModule;
    if (raw) {
      // A partially translated locale file must never surface raw keys to the
      // user: fall back to English leaf-by-leaf.
      cached = createFallbackProxy(hydrateLocale(raw), EN);
      UI_TEXT_CACHE.set(resolved, cached);
    } else {
      const dict = DICTIONARIES[resolved];
      cached = adaptDictionaryToUIText(dict, EN);
      UI_TEXT_CACHE.set(resolved, cached);
    }
  }
  return cached;
}

export function useUIText(): UIText {
  const language = usePreferencesStore((s) => s.language);
  return getUIText(language);
}

/**
 * Rust Recycle Bin errors carry a machine-readable context payload (the target
 * path, an `HRESULT 0x...` code or an OS error number). Those tokens are
 * language-neutral, so they can be appended to the localized message without
 * leaking English prose while preserving the diagnostic detail.
 */
const TECHNICAL_CONTEXT_PATTERN =
  /(?:[A-Za-z]:\\|\\\\\?\\|^~\/|HRESULT 0x[0-9A-Fa-f]{8}|COM 0x[0-9A-Fa-f]{8}|OS error \d+|windows-only|worker-thread|\d+ UTF-16 units)/;

function withTechnicalContext(message: string, rawMsg?: string): string {
  const detail = rawMsg?.trim();
  if (!detail || detail === message) return message;
  // Guard against older/persisted English payloads: only expose context that
  // is provably machine-readable. Anything else stays behind the localized
  // message so no source language can leak.
  if (!TECHNICAL_CONTEXT_PATTERN.test(detail)) return message;
  return `${message} (${detail})`;
}

export function localizeAppError(err: unknown, ui?: UIText): string {
  const activeUi = ui ?? getUIText();
  if (!err) return activeUi.errors.unknown;

  let code: string | undefined;
  let rawMsg: string | undefined;

  if (typeof err === "object" && err !== null) {
    if ("code" in err && typeof (err as any).code === "string") {
      code = (err as any).code;
    }
    if ("message" in err && typeof (err as any).message === "string") {
      rawMsg = (err as any).message;
    }
  } else if (typeof err === "string") {
    rawMsg = err;
    code = err;
  }

  switch (code) {
    case "InvalidPath":
      return activeUi.errors.invalidPath;
    case "AccessDenied":
      return activeUi.errors.accessDenied;
    case "PathNotFound":
      return activeUi.errors.pathNotFound;
    case "ScanCancelled":
      return activeUi.errors.scanCancelled;
    case "ScanFailed":
      return activeUi.errors.scanFailed;
    case "UnsafeDeleteTarget":
      return activeUi.errors.unsafeDeleteTarget;
    case "RecycleBinFailed":
      return withTechnicalContext(activeUi.errors.recycleBinFailed, rawMsg);
    case "RecycleBinTooSmall":
      return withTechnicalContext(activeUi.errors.recycleBinTooSmall, rawMsg);
    case "RecycleBinDisabled":
      return withTechnicalContext(activeUi.errors.recycleBinDisabled, rawMsg);
    case "RecycleBinNotFound":
      return withTechnicalContext(activeUi.errors.recycleBinNotFound, rawMsg);
    case "RecycleBinPathTooLong":
      return withTechnicalContext(activeUi.errors.recycleBinPathTooLong, rawMsg);
    case "RecycleBinSharingViolation":
      return withTechnicalContext(activeUi.errors.recycleBinSharingViolation, rawMsg);
    case "RecycleBinAccessDenied":
      return withTechnicalContext(activeUi.errors.recycleBinAccessDenied, rawMsg);
    case "RecycleBinAborted":
      return withTechnicalContext(activeUi.errors.recycleBinAborted, rawMsg);
    case "RecycleBinComFailed":
      return withTechnicalContext(activeUi.errors.recycleBinComFailed, rawMsg);
    case "PermanentDeleteFailed":
      return activeUi.errors.permanentDeleteFailed;
    case "SettingsReadFailed":
      return activeUi.errors.settingsReadFailed;
    case "SettingsWriteFailed":
      return activeUi.errors.settingsWriteFailed;
    case "PlatformUnsupported":
      return activeUi.errors.platformUnsupported;
    case "Network":
      return withTechnicalContext(activeUi.errors.network, rawMsg);
    case "SessionInvalid":
      return activeUi.errors.sessionInvalid;
    case "SessionExpired":
      return activeUi.errors.sessionExpired;
    case "PlanInvalid":
      return activeUi.errors.planInvalid;
    case "PlanExpired":
      return activeUi.errors.planExpired;
    case "PlanChanged":
    case "PLAN_CHANGED":
      return activeUi.errors.planChanged;
    case "CONTENT_CHANGED":
      return activeUi.errors.contentChanged;
    case "NOT_MEASURED":
      return activeUi.errors.notMeasured;
    case "Blocked":
      return activeUi.errors.blocked;
    case "GIT_GUARD":
      return activeUi.warnings.protectedTarget;
    case "AGENT_POLICY":
      return activeUi.warnings.agentCacheDisabled;
    case "IN_USE":
    case "PROCESS_LOCK":
      return activeUi.warnings.targetActive;
    case "PERMISSION_DENIED":
      return activeUi.errors.accessDenied;
    case "NOT_FOUND":
      return activeUi.errors.pathNotFound;
  }

  if (rawMsg) {
    if (rawMsg.includes("Access denied") || rawMsg.includes("Permission denied"))
      return activeUi.errors.accessDenied;
    if (rawMsg.includes("Path not found") || rawMsg.includes("not found"))
      return activeUi.errors.pathNotFound;
    if (rawMsg.includes("Invalid path")) return activeUi.errors.invalidPath;
    if (rawMsg.includes("Scan cancelled")) return activeUi.errors.scanCancelled;
    if (rawMsg.includes("Scan failed")) return activeUi.errors.scanFailed;
    if (
      rawMsg.includes("Unsafe delete target") ||
      rawMsg.includes("Parent target already selected")
    )
      return activeUi.errors.unsafeDeleteTarget;
    if (rawMsg.includes("Recycle bin operation failed") || rawMsg.includes("RecycleBinFailed"))
      return activeUi.errors.recycleBinFailed;
    if (rawMsg.includes("Recycle bin capacity is too small"))
      return activeUi.errors.recycleBinTooSmall;
    if (rawMsg.includes("Recycle bin is disabled")) return activeUi.errors.recycleBinDisabled;
    if (
      rawMsg.includes("Recycle bin not found") ||
      rawMsg.includes("Recycle Bin could not be found")
    )
      return activeUi.errors.recycleBinNotFound;
    if (rawMsg.includes("Path is too long for the recycle bin"))
      return activeUi.errors.recycleBinPathTooLong;
    if (rawMsg.includes("Recycle bin target is in use"))
      return activeUi.errors.recycleBinSharingViolation;
    if (rawMsg.includes("Recycle bin access denied")) return activeUi.errors.recycleBinAccessDenied;
    if (rawMsg.includes("Recycle bin operation was aborted"))
      return activeUi.errors.recycleBinAborted;
    if (rawMsg.includes("Recycle bin shell operation failed"))
      return activeUi.errors.recycleBinComFailed;
    if (rawMsg.includes("Target content changed after preview"))
      return activeUi.errors.contentChanged;
    if (rawMsg.includes("Target could not be measured")) return activeUi.errors.notMeasured;
    if (rawMsg.includes("Permanent delete failed")) return activeUi.errors.permanentDeleteFailed;
    if (rawMsg.includes("Settings read failed")) return activeUi.errors.settingsReadFailed;
    if (rawMsg.includes("Settings write failed")) return activeUi.errors.settingsWriteFailed;
    if (
      rawMsg.includes("Operation blocked for safety") ||
      rawMsg.includes("Protected data; cannot be deleted")
    )
      return activeUi.errors.blocked;
    if (rawMsg.includes("holds an open handle") || rawMsg.includes("currently in use"))
      return activeUi.warnings.targetActive;
    if (rawMsg.includes("Target is tracked by Git")) return activeUi.warnings.protectedTarget;
    if (rawMsg.includes("Size not measured")) return activeUi.table.unmeasured;
    if (rawMsg.includes("smaller than minimum item size")) return activeUi.warnings.protectedTarget;
    const warningLocalized = localizeWarningCode(code || rawMsg, activeUi);
    if (warningLocalized !== (code || rawMsg) && warningLocalized !== activeUi.plan.blocked) {
      return warningLocalized;
    }
    // Backend diagnostics are English-only. Returning them verbatim would leak
    // the source language into the UI, so unknown messages collapse to the
    // localized generic error instead.
    return activeUi.errors.unknown;
  }

  return activeUi.errors.unknown;
}

export function localizeWarningCode(code: string | null | undefined, ui?: UIText): string {
  const activeUi = ui ?? getUIText();
  if (!code) return activeUi.plan.blocked;

  const normalized = code.toUpperCase().replace(/[-_\s]/g, "");
  switch (normalized) {
    case "USERPROTECTED":
      return activeUi.warnings.userProtected;
    case "TARGETACTIVE":
    case "INUSE":
    case "PROCESSLOCK":
      return activeUi.warnings.targetActive;
    case "PROVIDERACTIVE":
      return activeUi.warnings.providerActive;
    case "RECORDINGACTIVE":
      return activeUi.warnings.recordingActive;
    case "AGENTCACHEDISABLED":
    case "AGENTPOLICY":
      return activeUi.warnings.agentCacheDisabled;
    case "PROTECTEDTARGET":
    case "GITGUARD":
    case "PROTECTED":
      return activeUi.warnings.protectedTarget;
    case "PATHGUARD":
      return activeUi.errors.unsafeDeleteTarget;
    case "NOPROJECTMARKER":
      return activeUi.warnings.noProjectMarker;
    case "PLANCHANGED":
      return activeUi.errors.planChanged;
    case "CONTENTCHANGED":
      return activeUi.errors.contentChanged;
    case "NOTMEASURED":
      return activeUi.errors.notMeasured;
    case "BELOWMINSIZE":
      return activeUi.warnings.belowMinSize;
    case "VERIFYFAILED":
      return activeUi.warnings.verificationFailed;
    case "RECYCLEFAILED":
      return activeUi.errors.recycleBinFailed;
    case "RECYCLEBINTOOSMALL":
      return activeUi.errors.recycleBinTooSmall;
    case "RECYCLEBINDISABLED":
      return activeUi.errors.recycleBinDisabled;
    case "RECYCLEBINNOTFOUND":
      return activeUi.errors.recycleBinNotFound;
    case "RECYCLEBINPATHTOOLONG":
      return activeUi.errors.recycleBinPathTooLong;
    case "RECYCLEBINSHARINGVIOLATION":
      return activeUi.errors.recycleBinSharingViolation;
    case "RECYCLEBINACCESSDENIED":
      return activeUi.errors.recycleBinAccessDenied;
    case "RECYCLEBINABORTED":
      return activeUi.errors.recycleBinAborted;
    case "RECYCLEBINCOMFAILED":
      return activeUi.errors.recycleBinComFailed;
    case "PERMANENTFAILED":
    case "DELETEFAILED":
      return activeUi.errors.permanentDeleteFailed;
    case "ACCESSDENIED":
      return activeUi.errors.accessDenied;
    default:
      return activeUi.warnings.other ? activeUi.warnings.other(code) : code;
  }
}

export function localizeBackendNote(note: string | null | undefined, _ui?: UIText): string {
  if (!note) return "";
  return translateBackendText(note);
}

export function localizeActionDescription(
  actionIdOrDesc: string | null | undefined,
  _ui?: UIText,
): string {
  if (!actionIdOrDesc) return "";
  return translateActionDescription(actionIdOrDesc);
}

export function localizeUnavailableReason(reason: string | null | undefined): string {
  if (!reason) return "";
  return translateBackendText(reason);
}

const CATEGORY_NAMES: Record<string, { tr: string; en: string }> = {
  build: { en: "Build", tr: "Derleme" },
  // The frontend fallback scanner emits these more specific slugs. Map them
  // onto canonical, fully translated categories so a demo/offline scan never
  // shows a raw English slug such as "build-output" or "environments".
  "build-output": { en: "Build", tr: "Derleme" },
  environments: { en: "Dependencies", tr: "Bağımlılıklar" },
  cache: { en: "Cache", tr: "Önbellek" },
  dependencies: { en: "Dependencies", tr: "Bağımlılıklar" },
  protected: { en: "Protected", tr: "Korumalı" },
  test: { en: "Test", tr: "Test" },
  tooling: { en: "Tooling", tr: "Araçlar" },
  "browser-recordings": { en: "Browser Recordings", tr: "Tarayıcı Kayıtları" },
  backups: { en: "Backups", tr: "Yedekler" },
  configuration: { en: "Configuration", tr: "Yapılandırma" },
  custom: { en: "Custom", tr: "Özel" },
  "package-cache": { en: "Package Cache", tr: "Paket Önbelleği" },
  sessions: { en: "Sessions", tr: "Oturumlar" },
};

export function localizeCategory(
  category: string | null | undefined,
  langOverride?: string | null,
): string {
  if (!category) return "";
  const lang = langOverride || usePreferencesStore.getState().language || "en";
  const mapped = CATEGORY_NAMES[category.toLowerCase().trim()];
  if (mapped) {
    return translateBackendText(mapped.en, lang);
  }
  // Unknown categories are usually backend- or user-supplied. Route them
  // through the same dictionary so a catalog change cannot leak English.
  return translateBackendText(category, lang);
}
