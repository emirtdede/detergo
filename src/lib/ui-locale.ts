import { SupportedLanguage } from "@/types";
import { LANGUAGES_LIST } from "@/locales/languages";

/** Resolve any persisted locale to a supported language, falling back to English. */
export function resolveUiLocale(language?: string | null): SupportedLanguage {
  if (!language) return "en";
  const normalized = language.toLowerCase();
  const found = LANGUAGES_LIST.find((l) => l.id === normalized);
  return found ? found.id : "en";
}
