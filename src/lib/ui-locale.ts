export type UiLocale = "tr" | "en";

/** Only locales with a complete UI string catalogue may appear in Settings. */
export const SUPPORTED_UI_LOCALES: readonly UiLocale[] = ["tr", "en"];

/** Resolve any persisted locale to the UI language we can actually render. */
export function resolveUiLocale(language?: string | null): UiLocale {
  return language === "tr" ? "tr" : "en";
}
