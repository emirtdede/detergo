import fs from "node:fs";

/**
 * Regenerates `src/components/common/error-boundary-text.ts` from
 * `src/lib/ui-text/error-boundary.json`.
 *
 * The boundary renders when the React tree — possibly the locale loader itself
 * — has failed, so it cannot call the async dictionary loader or any hook, and
 * it must not import a 73-language bundle: these three strings per language are
 * the only ones the fallback screen needs. Keeping them in their own JSON makes
 * the source auditable by the same gates as every other locale surface without
 * pulling the whole dictionary into the entry chunk.
 */
const SOURCE = "src/lib/ui-text/error-boundary.json";
const OUT = "src/components/common/error-boundary-text.ts";

const dictionary = JSON.parse(fs.readFileSync(SOURCE, "utf8"));

const lines = Object.entries(dictionary).map(
  ([id, t]) =>
    `  ${JSON.stringify(id)}: ${JSON.stringify(t, null, 0)
      .replace(/":/g, '": ')
      .replace(/,"/g, ', "')},`,
);

const content = `/**
 * Static copy for the top-level error boundary.
 *
 * The boundary renders when the React tree — possibly the locale loader itself
 * — has failed, so it cannot call the async dictionary loader or any hook. It
 * also must not import the UI dictionary bundle: that dragged all 73
 * translation files into the entry chunk (finding Y-1). These three strings per
 * language are the only ones the fallback screen needs.
 *
 * Generated from \`src/lib/ui-text/error-boundary.json\`; run
 * \`node scripts/generate-error-boundary-text.mjs\` when a language is added.
 */
export interface ErrorBoundaryText {
  title: string;
  unknownError: string;
  reload: string;
}

export const ERROR_BOUNDARY_TEXT: Record<string, ErrorBoundaryText> = {
${lines.join("\n")}
};

/** Keys the app has used for the persisted language at some point. */
const LANGUAGE_KEYS = ["dev_cleaner_lang", "dev_cleaner_language", "node_cleaner_language"];

function readStoredLanguage(): string | null {
  try {
    for (const key of LANGUAGE_KEYS) {
      const value = localStorage.getItem(key);
      if (value) return value;
    }
  } catch {
    // Storage can be unavailable in hardened contexts; fall through.
  }
  return null;
}

/**
 * Resolves the boundary copy without touching React state or the async locale
 * loader. Falls back to English, then Turkish, then the first available entry.
 */
export function getErrorBoundaryText(language?: string | null): ErrorBoundaryText {
  const candidate = language ?? readStoredLanguage() ?? "en";
  return (
    ERROR_BOUNDARY_TEXT[candidate] ??
    ERROR_BOUNDARY_TEXT[candidate.split("-")[0]] ??
    ERROR_BOUNDARY_TEXT.en ??
    ERROR_BOUNDARY_TEXT.tr
  );
}
`;

fs.writeFileSync(OUT, content);
console.log("languages:", Object.keys(dictionary).length, "bytes:", content.length);
