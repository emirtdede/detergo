import { usePreferencesStore } from "@/stores/preferences-store";
import { EN } from "./en";
import { TR } from "./tr";

export interface UIText {
  nav: { overview: string; projects: string; agents: string; caches: string; history: string; settings: string };
  common: {
    scan: string; scanning: string; cancel: string; rescan: string; chooseFolder: string;
    refresh: string; open: string; close: string; confirm: string; loading: string; none: string;
    clear: string;
    items: (n: number) => string; showing: (n: number) => string;
  };
  overview: {
    title: string; subtitle: string; cleanable: string; protected: string; candidates: string;
    projects: string; scanFirst: string; topItems: string; breakdown: string; partial: string;
    noScan: string; startHint: string; stopReason: string; warnings: string; errors: string;
  };
  table: {
    name: string; project: string; category: string; size: string; reclaim: string;
    safety: string; method: string; modified: string; actions: string; selectAll: string;
    selected: (n: number) => string; noResults: string; searchPlaceholder: string;
    allSafety: string; selectSafe: string; clearSelection: string; openFolder: string;
    selectRow: string; unmeasured: string; details: string;
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
  };
  caches: {
    title: string; subtitle: string; refresh: string; notFound: string; runAction: string;
    previewTitle: string; warning: string; running: string; result: string; before: string;
    after: string; delta: string; readOnly: string; detectorNote: string;
    executable: string; networkWarning: string; succeeded: string; failed: string;
    exitCode: string; loadError: string; auditError: string; noProviders: string;
  };
  history: {
    title: string; empty: string; timestamp: string; mode: string; success: string;
    errors: string; reclaim: string; duration: string; details: string; records: (n: number) => string;
    loadError: string; moved: string; clear: string; clearConfirm: string; clearHint: string;
    actions: string; actionLabel: string; actionsEmpty: string;
  };
  settings: {
    general: string; scan: string; protections: string; agents: string; privacy: string;
    theme: string; language: string; reduceMotion: string; scanProfile: string;
    profileBalanced: string; profileFast: string; profileDeep: string; maxDepth: string;
    maxCandidates: string; timeout: string; minSize: string; maskPaths: string;
    historyEnabled: string; protectedPaths: string; addPath: string; remove: string;
    excludedNames: string; agentCacheCleanup: string; browserRecordings: string;
    saved: string; saveError: string; about: string; version: string;
    rules: string; ecosystems: string; categories: string;
  };
  errors: { title: string; blocked: string; retry: string };
  warnings: {
    userProtected: string; targetActive: string; providerActive: string;
    recordingActive: string; agentCacheDisabled: string; protectedTarget: string;
    noProjectMarker: string; other: (code: string) => string;
  };
}

export function getUIText(language?: string): UIText {
  return language === "tr" ? TR : EN;
}

export function useUIText(): UIText {
  const language = usePreferencesStore((s) => s.language);
  return getUIText(language ?? undefined);
}
