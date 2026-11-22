import { LANGUAGES_LIST, detectSystemLanguage, isRtlLanguage } from "@/locales/languages";
import { SupportedLanguage } from "@/types";
import localePacks from "./setup-locales.json";

export interface SetupStrings {
  titleInstall: string;
  titleUninstall: string;
  minimize: string;
  close: string;
  welcomeDesc: string;
  updateDesc: string;
  install: string;
  update: string;
  options: string;
  hide: string;
  footerNote: string;
  languageLabel: string;
  installDirLabel: string;
  changeDir: string;
  taskDesktop: string;
  taskStartMenu: string;
  taskStartup: string;
  taskPath: string;
  requiredSpace: string;
  installingTitle: string;
  uninstallingTitle: string;
  stepPreparing: string;
  stepExtracting: string;
  stepUninstaller: string;
  stepShortcuts: string;
  stepRefreshing: string;
  stepRemovingFiles: string;
  stepRemovingShortcuts: string;
  stepRemovingData: string;
  doneTitle: string;
  doneDesc: string;
  launchApp: string;
  uninstallTitle: string;
  uninstallDesc: string;
  deleteUserData: string;
  cancel: string;
  uninstallBtn: string;
  uninstalledTitle: string;
  uninstalledDesc: string;
  errorTitle: string;
  retry: string;
}

const PACKS = localePacks as Record<string, Partial<SetupStrings>>;
const EN_PACK = PACKS.en as SetupStrings;

export function resolveSetupLanguage(raw?: string | null): SupportedLanguage {
  if (!raw) return detectSystemLanguage();
  const normalized = raw.trim().toLowerCase().replace(/_/g, "-");
  if (
    normalized.startsWith("zh") &&
    (normalized.includes("hant") ||
      normalized.includes("-tw") ||
      normalized.includes("-hk") ||
      normalized.includes("-mo"))
  ) {
    return "zh-tw";
  }
  if (normalized.startsWith("zh")) return "zh";
  const exact = LANGUAGES_LIST.find((item) => item.id === normalized);
  if (exact) return exact.id;
  const prefix = normalized.split("-")[0];
  const byPrefix = LANGUAGES_LIST.find((item) => item.id === prefix);
  return byPrefix ? byPrefix.id : "en";
}

export function getSetupStrings(lang: SupportedLanguage): SetupStrings {
  const pack = PACKS[lang];
  if (!pack) return EN_PACK;
  return { ...EN_PACK, ...pack };
}

export function formatSetupTemplate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : `{${key}}`,
  );
}

export function applySetupDocumentLocale(lang: SupportedLanguage): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang;
  document.documentElement.dir = isRtlLanguage(lang) ? "rtl" : "ltr";
}

export { LANGUAGES_LIST, isRtlLanguage };
