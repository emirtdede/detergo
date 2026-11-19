import { useEffect, useReducer, useState } from "react";
import { usePreferencesStore } from "@/stores/preferences-store";
import { EN } from "./en";
import { TR } from "./tr";
import { maskPath } from "@/lib/format/path";
import { log } from "@/lib/logging";

import { resolveUiLocale } from "@/lib/ui-locale";
// Public alias kept because views import the locale resolver from this module.
export { resolveUiLocale };
import {
  translateBackendText,
  translateActionDescription,
  loadBackendLocale,
  getBackendLocaleRevision,
  subscribeBackendLocale,
} from "./backend-i18n";

export interface UIText {
  nav: {
    primary: string;
    overview: string;
    projects: string;
    agents: string;
    caches: string;
    system: string;
    docs: string;
    history: string;
    settings: string;
    about: string;
    github: string;
    sponsor: string;
  };
  system: {
    title: string;
    subtitle: string;
    quickClean: string;
    cleanSelected: string;
    selectAll: string;
    clearSelection: string;
    reclaimable: string;
    freed: string;
    notMeasured: string;
    windowsReported: string;
    adminBadge: string;
    adminTitle: string;
    adminBody: string;
    restartAdmin: string;
    elevated: string;
    confirmTitle: string;
    confirmBody: string;
    stopAfterStep: string;
    showLog: string;
    hideLog: string;
    automatedTitle: string;
    automatedBody: string;
    frequency: string;
    daily: string;
    weekly: string;
    time: string;
    weekday: string;
    scope: string;
    scopeQuick: string;
    scopeStandard: string;
    scopeDeep: string;
    saveSchedule: string;
    removeSchedule: string;
    scheduleInstalled: string;
    scheduleMissing: string;
    scheduleSaved: string;
    scheduleRemoved: string;
    runNow: string;
    lastRun: string;
    never: string;
    freeSpace: string;
    cleanmgrTitle: string;
    cleanmgrBody: string;
    cleanmgrOpen: string;
    cleanmgrConfigure: string;
    cleanmgrRunProfile: string;
    cleanmgrLaunched: string;
    actions: {
      userTemp: string;
      windowsTemp: string;
      prefetch: string;
      windowsUpdate: string;
      errorReports: string;
      recycleBin: string;
      diskCleanup: string;
      componentStore: string;
    };
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
    /** Top bar action: one pass over projects, AI storage and caches. */
    scanAll: string;
    scanAllDesc: string;
  };
  header: {
    changeLocation: string;
    changeLocationConfirmDesc: string;
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
    kpiTargetsSubActive: (count: string) => string;
    kpiTargetsSubIdle: string;
    /** Severity-separated scan notices. */
    noticeInfoTitle: string;
    noticeInfoHint: string;
    noticeIssueHint: string;
    copyDetails: string;
    detailsCopied: string;
    /** Per-step outcome of a combined ("scan everything") run. */
    coverage: string;
    sectionSkipped: string;
    sectionFailed: string;
    sectionPartial: string;
    sectionNoRoot: string;
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
    coveredByParent: string;
    noMethod: string;
    officialActionRequired: string;
    modeNotAllowed: string;
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
    progressIncomplete: (count: number) => string;
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
    totalCleaned: string;
    totalRuns: string;
    lastRun: string;
    tabScans: string;
    emptyScans: string;
    colScope: string;
    colPath: string;
    colEntries: string;
    statusCompleted: string;
    statusDepthLimited: string;
    statusCancelled: string;
    statusPartial: string;
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
    profileFull: string;
    profileThorough: string;
    profileDeep: string;
    profileMaximum: string;
    profileFastHint: string;
    profileBalancedHint: string;
    profileFullHint: string;
    profileThoroughHint: string;
    profileDeepHint: string;
    profileMaximumHint: string;
    profileDialogHint: string;
    profileDefaultBadge: string;
    groupPreferences: string;
    groupSafety: string;
    groupMaintenance: string;
    securityOpen: string;
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
    resetAppDataTitle: string;
    resetAppDataHint: string;
    resetAppDataConfirmBtn: string;
    resetAppDataBusy: string;
    resetAppDataSuccess: string;
    resetAppDataBlocked: string;
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
    pathMustBeAbsolute: string;
    excludedNameInvalid: string;
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
    shortcutNeedsModifier: string;
    shortcutsResetWarning: (count: number) => string;
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
    /** Real "how many targets can I clean" number, not a row count. */
    kpiTargets: string;
    kpiTargetsSub: (count: string) => string;
    kpiTargetsUnknown: string;
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
    contactBilling: string;
    contactBillingDesc: string;
    contactPrivacyDesc: string;
    navTitle: string;
    navOverview: string;
    navCatalog: string;
    navHealth: string;
    navContacts: string;
    navLegal: string;
    healthTitle: string;
    healthSubtitle: string;
  };
  catalog: {
    details: string;
    hint: string;
    matches: string;
    regenerate: string;
    note: string;
    empty: string;
  };
  updates: {
    title: string;
    hint: string;
    latestVersion: string;
    check: string;
    checking: string;
    upToDate: string;
    available: (version: string) => string;
    notes: string;
    download: string;
    failed: string;
    privacy: string;
  };
  diagnostics: {
    title: string;
    hint: string;
    empty: string;
    report: string;
    systemTitle: string;
    systemHint: string;
    errorsTitle: string;
    supportTitle: string;
    supportHint: string;
    createBundle: string;
    creating: string;
    bundleReady: (path: string) => string;
    mailOpened: string;
    mailFallback: string;
    mailFailed: string;
    reveal: string;
    copyPath: string;
    sendTo: (email: string) => string;
    copyAll: string;
    clearAll: string;
    noSystem: string;
    notSent: string;
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

/**
 * A locale dictionary is a tree of leaves. A leaf is either a finished string
 * or a template function built from its `{placeholder}` tokens.
 */
type LocaleLeaf = string | ((...args: unknown[]) => string);
interface LocaleTree {
  [key: string]: LocaleLeaf | LocaleTree;
}

function isLocaleTree(value: unknown): value is LocaleTree {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Fills missing/empty leaves of `target` from `fallback`.
 *
 * Both sides are re-checked at every level: a locale file is untrusted JSON, so
 * a key that is an object in English may be `null` in a translation. Treating
 * `typeof null === "object"` as a nested tree used to forward a `null` target
 * into the next proxy and throw inside the `get` trap, which took the whole
 * React tree down.
 */
function createFallbackProxy(target: LocaleTree, fallback: LocaleTree): LocaleTree {
  return new Proxy(target, {
    get(obj, prop) {
      if (typeof prop === "symbol") return Reflect.get(obj, prop);
      const value = obj[prop];
      const fallbackValue = fallback[prop];
      if (value === undefined || value === null || value === "") {
        return fallbackValue;
      }
      if (isLocaleTree(value) && isLocaleTree(fallbackValue)) {
        return createFallbackProxy(value, fallbackValue);
      }
      return value;
    },
  });
}

/**
 * Locale JSON files are split into per-language chunks by Vite. `import.meta.glob`
 * without `eager` yields `() => import(...)` per file, so only the active
 * language is fetched and parsed.
 */
const LOCALE_LOADERS = import.meta.glob("./locales/*.json") as Record<
  string,
  () => Promise<{ default?: unknown }>
>;

/** In-flight language loads, keyed by resolved locale. */
const pendingLocales = new Map<string, Promise<UIText>>();

/**
 * Turns one parsed JSON node into the runtime shape.
 *
 * A string becomes a finished value or a template function; an object is
 * hydrated recursively. Anything else (number, boolean, array) is dropped: it
 * cannot be rendered and silently copying it would only hide a broken locale
 * file until a call site tried to use it.
 */
function hydrateNode(raw: unknown): LocaleLeaf | LocaleTree | null {
  if (typeof raw === "string") {
    // Parameterised keys are derived from the `{placeholder}` tokens in the
    // template. A hand-maintained key list silently turned a new key into a
    // plain string, and the call site then threw "not a function".
    const params = [...new Set(Array.from(raw.matchAll(/\{(\w+)\}/g), (m) => m[1]))];
    if (params.length === 0) return raw;
    return (...args: unknown[]) => {
      let str = raw;
      params.forEach((param, index) => {
        str = str.replaceAll(`{${param}}`, String(args[index] ?? ""));
      });
      return str;
    };
  }
  if (!isLocaleTree(raw)) return null;

  const node: LocaleTree = {};
  for (const [key, value] of Object.entries(raw)) {
    const child = hydrateNode(value);
    if (child !== null) node[key] = child;
  }
  return node;
}

/** Hydrates a parsed locale file, or reports an unusable shape. */
function hydrateLocale(raw: unknown): LocaleTree | null {
  const node = hydrateNode(raw);
  return isLocaleTree(node) ? node : null;
}

/**
 * `UIText` is a hand-written interface while the runtime value is built from
 * JSON. Keeping the single bridge here means the rest of the module never
 * needs `any`.
 */
function asLocaleTree(text: UIText): LocaleTree {
  return text as unknown as LocaleTree;
}

const UI_TEXT_CACHE = new Map<string, UIText>();
UI_TEXT_CACHE.set("tr", TR);
UI_TEXT_CACHE.set("en", EN);

/**
 * Loads and caches a locale dictionary.
 *
 * A missing or broken file resolves to English instead of rejecting: the UI
 * must stay usable, and English is the documented fallback at leaf level.
 */
export function loadUIText(language?: string | null): Promise<UIText> {
  const resolved = resolveUiLocale(language ?? usePreferencesStore.getState().language);
  const cached = UI_TEXT_CACHE.get(resolved);
  if (cached) return Promise.resolve(cached);

  const inflight = pendingLocales.get(resolved);
  if (inflight) return inflight;

  const load = LOCALE_LOADERS[`./locales/${resolved}.json`];
  const promise = (load ? load() : Promise.reject(new Error("missing-locale")))
    .then((mod) => {
      const raw = (mod as { default?: unknown }).default ?? mod;
      const hydrated = hydrateLocale(raw);
      if (hydrated === null) {
        // A structurally broken chunk must not poison the cache: log it once and
        // stay on English for this locale.
        log.warn(`Locale "${resolved}" has an unexpected shape; using English`);
        UI_TEXT_CACHE.set(resolved, EN);
        return EN;
      }
      const text = createFallbackProxy(hydrated, asLocaleTree(EN)) as unknown as UIText;
      UI_TEXT_CACHE.set(resolved, text);
      return text;
    })
    .catch(() => EN)
    .finally(() => {
      pendingLocales.delete(resolved);
    });

  pendingLocales.set(resolved, promise);
  return promise;
}

/**
 * Synchronous accessor for non-React callers (stores, event handlers, dialogs).
 * Returns English until `loadUIText` finished for the requested language; React
 * components use `useUIText`, which re-renders once the dictionary arrives.
 */
export function getUIText(language?: string | null): UIText {
  // Callers that run outside React omit the language argument. Falling back to
  // English here would leak English text into every non-English UI, so resolve
  // against the persisted preference instead.
  const resolved = resolveUiLocale(language ?? usePreferencesStore.getState().language);
  if (resolved === "tr") return TR;
  if (resolved === "en") return EN;
  return UI_TEXT_CACHE.get(resolved) ?? EN;
}

export function useUIText(): UIText {
  const language = usePreferencesStore((s) => s.language);
  const [, forceRender] = useReducer((tick: number) => tick + 1, 0);

  useEffect(() => {
    let alive = true;
    // The backend dictionary is a separate per-language chunk; loading it in
    // the same phase means one re-render swaps both UI and backend strings
    // instead of leaving catalog text in English until the next state change.
    void Promise.all([loadUIText(language), loadBackendLocale(language)]).then(() => {
      if (alive) forceRender();
    });
    return () => {
      alive = false;
    };
  }, [language]);

  return getUIText(language);
}

/**
 * Revision counter for the lazily loaded backend catalog dictionary.
 *
 * `localizeCategory`/`localizeBackendNote`/`compareItems` are synchronous and
 * read a module-level cache. Components that derive localized values inside a
 * `useMemo` must include this value so the memo recomputes when the chunk
 * arrives instead of keeping English labels.
 */
export function useBackendLocaleRevision(): number {
  const [revision, setRevision] = useState(getBackendLocaleRevision);
  useEffect(() => {
    // A load may have finished between render and subscribe.
    setRevision(getBackendLocaleRevision());
    return subscribeBackendLocale(() => setRevision(getBackendLocaleRevision()));
  }, []);
  return revision;
}

/**
 * Rust Recycle Bin errors carry a machine-readable context payload (the target
 * path, an `HRESULT 0x...` code or an OS error number). Those tokens are
 * language-neutral, so they can be appended to the localized message without
 * leaking English prose while preserving the diagnostic detail.
 */
const TECHNICAL_CONTEXT_PATTERN =
  /(?:[A-Za-z]:\\|\\\\\?\\|^~\/|HRESULT 0x[0-9A-Fa-f]{8}|COM 0x[0-9A-Fa-f]{8}|OS error \d+|windows-only|worker-thread|\d+ UTF-16 units)/;

/**
 * Language-neutral, machine-readable diagnostics worth appending verbatim.
 * Everything else (paths, English prose) either gets masked or dropped.
 */
const TECHNICAL_TOKEN_PATTERN =
  /HRESULT 0x[0-9A-Fa-f]{8}|COM 0x[0-9A-Fa-f]{8}|OS error \d+|\d+ UTF-16 units/g;

function withTechnicalContext(message: string, rawMsg?: string): string {
  const detail = rawMsg?.trim();
  if (!detail || detail === message) return message;
  // Guard against older/persisted English payloads: only expose context that
  // is provably machine-readable. Anything else stays behind the localized
  // message so no source language can leak.
  if (!TECHNICAL_CONTEXT_PATTERN.test(detail)) return message;

  const tokens = detail.match(TECHNICAL_TOKEN_PATTERN);
  if (tokens && tokens.length > 0) return `${message} (${tokens.join(", ")})`;

  // No opaque token: the remainder is prose or a path. Honour the masking
  // preference so a full home directory never reaches a toast.
  const masked = usePreferencesStore.getState().maskPaths ? maskPath(detail) : detail;
  return `${message} (${masked})`;
}

/**
 * Cleanup failures use stable SCREAMING_SNAKE_CASE codes while command errors
 * use PascalCase enum variants. Normalise the former so both reach the same
 * translated message instead of falling through to "unknown".
 */
function canonicalErrorCode(code: string): string {
  // Already a PascalCase variant such as `RecycleBinTooSmall`.
  if (!/[_-]/.test(code) && /[a-z]/.test(code)) return code;
  return (
    code
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join("") || code
  );
}

/**
 * True when the backend rejected the scan session because it is unknown or
 * expired. A restored snapshot has no live session after a restart, so the UI
 * must offer a rescan instead of a generic "cleanup failed" toast.
 */
export function isScanSessionError(err: unknown): boolean {
  let code: string | undefined;
  if (typeof err === "object" && err !== null && "code" in err) {
    const candidate = (err as { code?: unknown }).code;
    if (typeof candidate === "string") code = candidate;
  } else if (typeof err === "string") {
    code = err;
  }
  if (!code) return false;
  const normalized = canonicalErrorCode(code);
  return normalized === "SessionInvalid" || normalized === "SessionExpired";
}

export function localizeAppError(err: unknown, ui?: UIText): string {
  const activeUi = ui ?? getUIText();
  if (!err) return activeUi.errors.unknown;

  let code: string | undefined;
  let rawMsg: string | undefined;

  if (typeof err === "object" && err !== null) {
    // Narrow once instead of asserting `any` at every read: the payload may
    // arrive from Rust, a rejected promise, or a synthetic test object.
    const candidate = err as { code?: unknown; message?: unknown };
    if (typeof candidate.code === "string") {
      code = candidate.code;
    }
    if (typeof candidate.message === "string") {
      rawMsg = candidate.message;
    }
  } else if (typeof err === "string") {
    rawMsg = err;
    code = err;
  }

  const normalizedCode = code ? canonicalErrorCode(code) : undefined;

  switch (normalizedCode) {
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
    case "RecycleFailed":
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
    case "PermanentFailed":
    case "DeleteFailed":
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
      return activeUi.errors.planChanged;
    case "ContentChanged":
      return activeUi.errors.contentChanged;
    case "NotMeasured":
      return activeUi.errors.notMeasured;
    case "Blocked":
      return activeUi.errors.blocked;
    case "GitGuard":
    case "ProtectedTarget":
      return activeUi.warnings.protectedTarget;
    case "AgentPolicy":
    case "AgentCacheDisabled":
      return activeUi.warnings.agentCacheDisabled;
    case "InUse":
    case "ProcessLock":
    case "TargetActive":
      return activeUi.warnings.targetActive;
    case "PermissionDenied":
      return activeUi.errors.accessDenied;
    case "NotFound":
      return activeUi.errors.pathNotFound;
    case "PathGuard":
      return activeUi.errors.unsafeDeleteTarget;
  }

  // Warning codes share the same vocabulary (IN_USE, GIT_GUARD, ...). When the
  // error carries no message, let the warning lookup cover the remaining codes
  // instead of collapsing a known condition to "unknown".
  if (!rawMsg && code) {
    const warningLocalized = tryLocalizeWarningCode(code, activeUi);
    if (warningLocalized) return warningLocalized;
  }

  if (rawMsg) {
    if (rawMsg.includes("Access denied") || rawMsg.includes("Permission denied"))
      return activeUi.errors.accessDenied;
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
    // A bare "… not found" is not proof of a missing filesystem path: missing
    // tools, catalog lookups and search misses all use that wording, and the
    // generic test used to run *before* the specific recycle-bin/delete rules
    // and shadow them. Only the explicit path error (or the Windows / ENOENT
    // system message) maps to "path not found"; everything else falls through
    // to the specific rules above or the generic error below.
    if (/^(Path not found|The system cannot find the (path|file)|ENOENT)/i.test(rawMsg)) {
      return activeUi.errors.pathNotFound;
    }
    const warningLocalized = tryLocalizeWarningCode(code || rawMsg, activeUi);
    if (warningLocalized) return warningLocalized;
    // Backend diagnostics are English-only. Returning them verbatim would leak
    // the source language into the UI, so unknown messages collapse to the
    // localized generic error. Machine-readable detail (paths, HRESULT/OS
    // codes) is still appended when present so the user can act on it.
    return withTechnicalContext(activeUi.errors.unknown, rawMsg);
  }

  return activeUi.errors.unknown;
}

/**
 * Maps a machine stop reason (`timeout`, `candidate-limit`, `depth-limit`,
 * `cancelled`) to an already-localized phrase. Rendering the raw code leaked
 * English identifiers into every locale.
 */
export function localizeStopReason(code: string | null | undefined, ui?: UIText): string {
  const activeUi = ui ?? getUIText();
  if (!code) return activeUi.overview.partial;
  switch (
    code
      .trim()
      .toLowerCase()
      .replace(/[_\s]+/g, "-")
  ) {
    case "candidate-limit":
      return activeUi.settings.maxCandidates;
    case "depth-limit":
      return activeUi.settings.maxDepth;
    case "timeout":
      return activeUi.settings.timeout;
    case "cancelled":
      return activeUi.errors.scanCancelled;
    default:
      return activeUi.overview.partial;
  }
}

function tryLocalizeWarningCode(code: string, activeUi: UIText): string | null {
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
    case "COVEREDBYPARENT":
      return activeUi.plan.coveredByParent;
    case "NOMETHOD":
      return activeUi.plan.noMethod;
    case "OFFICIALACTIONREQUIRED":
    case "OFFICIALTOOL":
      return activeUi.plan.officialActionRequired;
    case "MODENOTALLOWED":
      return activeUi.plan.modeNotAllowed;
    case "ACTIVEUSE":
      return activeUi.warnings.targetActive;
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
      // Never leak a raw machine code (for example `COVERED_BY_PARENT`) into
      // the UI. Unknown codes are reported as `null` so callers can try their
      // own fallback before the generic localized reason is used.
      return null;
  }
}

/**
 * Localizes a warning/block code. Unknown codes intentionally collapse to a
 * localized generic reason instead of echoing the raw identifier.
 */
export function localizeWarningCode(code: string | null | undefined, ui?: UIText): string {
  const activeUi = ui ?? getUIText();
  if (!code) return activeUi.plan.blocked;
  const localized = tryLocalizeWarningCode(code, activeUi);
  if (localized) return localized;
  return activeUi.warnings.other ? activeUi.warnings.other(code) : activeUi.plan.blocked;
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
