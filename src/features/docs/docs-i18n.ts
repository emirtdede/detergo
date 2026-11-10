import { useCallback } from "react";
import { usePreferencesStore } from "@/stores/preferences-store";
import { resolveUiLocale } from "@/lib/ui-text";

/**
 * Documentation body translations.
 *
 * Each JSON file maps an English source string (exactly as written in the
 * documentation JSX) to its localized text. Unknown strings fall back to the
 * English source, so code identifiers, commands and paths stay untouched.
 */
const modules = import.meta.glob("./docs-locales/*.json", {
  eager: true,
  import: "default",
}) as Record<string, Record<string, string>>;

const dictionaries: Record<string, Record<string, string>> = {};
for (const [path, data] of Object.entries(modules)) {
  const locale = path.split("/").pop()?.replace(/\.json$/, "");
  if (locale) dictionaries[locale] = data as Record<string, string>;
}

export function translateDocs(locale: string, text: string): string {
  const resolved = resolveUiLocale(locale as never);
  if (resolved === "en") return text;
  return dictionaries[resolved]?.[text] ?? text;
}

/** Whether a generated documentation dictionary exists for this locale. */
export function hasDocsLocale(locale: string): boolean {
  return dictionaries[resolveUiLocale(locale as never)] !== undefined;
}

export function useDocsT(): (text: string) => string {
  const language = usePreferencesStore((s) => s.language);
  return useCallback((text: string) => translateDocs(language ?? "en", text), [language]);
}
