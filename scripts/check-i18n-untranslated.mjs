#!/usr/bin/env node
/**
 * Untranslated-value gate.
 *
 * `check-i18n-coverage.mjs` proves that every key *exists*. It cannot prove that
 * the value was actually translated: a locale file may contain the English
 * source verbatim and the fallback proxy happily renders it. That is the
 * "language leak" this gate closes.
 *
 * The reference is `src/lib/ui-text/en.ts`. Every string leaf in a locale that
 * is byte-identical to English is reported, unless the English value is listed
 * in `ALLOWED_IDENTICAL_VALUES` below.
 *
 * The allowlist is value-based on purpose: brand names, code identifiers,
 * URLs and words that are genuinely spelled the same in the target language
 * (cognates such as "Version", "Contact" or "Details") are language-neutral.
 * When you add a new value here, leave a one-line reason so the next reviewer
 * can tell a real translation from a cognate.
 *
 * Run with: npm run check:i18n:untranslated
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, basename } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Values that may legitimately stay identical to English in any locale. */
const ALLOWED_IDENTICAL_VALUES = new Set([
  // Brand, product and platform names.
  "Dev Cleaner",
  "Dev Cleaner Terminal",
  "Web / Node.js",
  "Python / venv",
  "Rust / Cargo",
  "vellium.dev",
  // Code identifiers, technical labels and URLs.
  "https://webhook.example.com/dev-cleaner",
  "Code",
  "Dev",
  "Desktop",
  "Executable",
  "Webhook URL",
  "Terminal & CLI",
  "MIT / Open",
  // Cognates: the word is spelled the same in at least one supported language
  // (fr/de/nl/da/sv/ca/es/it/ro/pt/gl...) or is a long-standing UI loanword.
  "Actions",
  "Build",
  "Caches",
  "Categories",
  "Component",
  "Contact",
  "Description",
  "Details",
  "Documents",
  "Error",
  "Errors",
  "Impact",
  "Legal",
  "Mode",
  "Notes",
  "On",
  "Orange",
  "Permanent",
  "Path",
  "Privacy",
  "Profile",
  "Project",
  "Revision",
  "Scan",
  "Stable",
  "Stop",
  "Target",
  "Transparent",
  "Version",
  "Workspace",
  "Web, Rust, Python, Agents...",
]);

const findings = [];
let checkedFiles = 0;
let checkedLeaves = 0;
let checkedDocumentLeaves = 0;

/**
 * Documentation and legal dictionaries are keyed by the English source string,
 * so an untranslated entry is a value identical to its own key. Only technical
 * labels and cognates may stay as-is.
 */
const ALLOWED_SOURCE_KEYED_VALUES = new Set([
  "AI CLI",
  "AI IDE",
  "Terminal CLI",
  "Default",
  "Description",
  "Editor",
  "Extension",
  "Integration",
  "Plugin",
  "Type",
  "Privacy",
  "3. Restrictions",
  "12. Contact",
  "13. Contact",
]);

/**
 * Technical terms that legitimately keep their English spelling. They may be
 * recased to match the target language's capitalisation rules (for example
 * "MCP Server" -> "MCP server"), which is a real translation convention rather
 * than a language leak.
 */
const ALLOWED_CASE_ONLY_SOURCES = new Set([
  "ai agent",
  "ai agent ide",
  "ai protocol",
  "cli agent",
  "mcp server",
  "parameter (flag)",
]);

/**
 * Per-locale exceptions for source strings that are spelled the same as English
 * and are already correct in that language (the difference is only casing).
 * Unlike `ALLOWED_CASE_ONLY_SOURCES` these are scoped to one locale so other
 * locales must still produce a real translation.
 */
const ALLOWED_CASE_ONLY_BY_LOCALE = new Map([
  // Italian and Lithuanian use "schema" as a native word.
  ["json schema", new Set(["it", "lt"])],
]);

async function loadTypeScriptDictionary(file) {
  const ts = await import(
    new URL(`file://${join(root, "node_modules/typescript/lib/typescript.js").replace(/\\/g, "/")}`)
      .href
  ).then((mod) => mod.default);
  const source = readFileSync(file, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "module", "require", js)(module.exports, module, () => ({}));
  return module.exports;
}

function flatten(node, prefix = "", acc = {}) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, path, acc);
    } else if (typeof value === "string") {
      acc[path] = value;
    }
  }
  return acc;
}

const en = flatten((await loadTypeScriptDictionary(join(root, "src/lib/ui-text/en.ts"))).EN);
const dir = join(root, "src/lib/ui-text/locales");

for (const name of readdirSync(dir)) {
  if (!name.endsWith(".json")) continue;
  checkedFiles++;
  const locale = basename(name, ".json");
  const dict = flatten(JSON.parse(readFileSync(join(dir, name), "utf8")));

  for (const [key, source] of Object.entries(en)) {
    if (dict[key] !== source) continue;
    checkedLeaves++;
    if (ALLOWED_IDENTICAL_VALUES.has(source)) continue;
    findings.push({ locale, key, value: source });
  }
}

for (const relativeDir of ["src/features/docs/docs-locales", "src/features/legal/legal-locales"]) {
  const surface = join(root, relativeDir);
  for (const name of readdirSync(surface)) {
    if (!name.endsWith(".json")) continue;
    checkedFiles++;
    const locale = basename(name, ".json");
    const dict = JSON.parse(readFileSync(join(surface, name), "utf8"));

    for (const [source, value] of Object.entries(dict)) {
      if (typeof value !== "string") continue;
      const identical = value === source;
      const caseOnly = !identical && value.trim().toLowerCase() === source.trim().toLowerCase();
      if (!identical && !caseOnly) continue;
      checkedDocumentLeaves++;
      if (identical && ALLOWED_SOURCE_KEYED_VALUES.has(source)) continue;
      if (caseOnly) {
        const normalized = source.trim().toLowerCase();
        if (ALLOWED_CASE_ONLY_SOURCES.has(normalized)) continue;
        if (ALLOWED_CASE_ONLY_BY_LOCALE.get(normalized)?.has(locale)) continue;
      }
      findings.push({ locale, key: source, value, kind: caseOnly ? "case-only" : "identical" });
    }
  }
}

/*
 * Legacy dictionaries (`src/locales/langs`). They back the deprecated `tr`
 * proxy and some older views, so an English value there is just as visible as
 * one in `ui-text`. They were previously unaudited, which is how the literal
 * `settings.platform: "Tauri v2 + React 18 + Rust"` survived in 72 languages.
 */
const LEGACY_TECHNICAL_LEAF = /^legal\.licensesList\[\d+\]\.(name|version|license|url)$/;

const legacyDir = join(root, "src/locales/langs");
const legacyEn = flatten(
  Object.values(await loadTypeScriptDictionary(join(legacyDir, "en.ts")))[0],
);

for (const name of readdirSync(legacyDir)) {
  if (!name.endsWith(".ts") || name === "en.ts") continue;
  checkedFiles++;
  const locale = basename(name, ".ts");
  const dict = flatten(Object.values(await loadTypeScriptDictionary(join(legacyDir, name)))[0]);

  for (const [key, source] of Object.entries(legacyEn)) {
    if (dict[key] !== source) continue;
    // Dependency names, versions, licence ids and URLs are product data, not UI
    // copy: translating them would be wrong, not a coverage gap.
    if (LEGACY_TECHNICAL_LEAF.test(key)) continue;
    checkedLeaves++;
    if (ALLOWED_IDENTICAL_VALUES.has(source)) continue;
    findings.push({ locale, key, value: source });
  }
}

if (findings.length > 0) {
  console.error(
    `i18n untranslated audit failed: ${findings.length} value(s) are identical to English` +
      " or differ only by capitalisation.\n",
  );
  for (const finding of findings) {
    const label = finding.kind === "case-only" ? "case-only" : "identical";
    console.error(
      `  [${finding.locale}] (${label}) ${finding.key} = ${JSON.stringify(finding.value)}`,
    );
  }
  console.error(
    "\nTranslate the value, or add it to an allowlist in" +
      " scripts/check-i18n-untranslated.mjs if it is a brand, code identifier," +
      " a genuine cognate or a technical term whose casing is language-specific.",
  );
  process.exit(1);
}

console.log(
  `i18n untranslated audit passed: ${checkedFiles} locale files, ` +
    `${checkedLeaves} UI leaf value(s) and ${checkedDocumentLeaves} docs/legal ` +
    `value(s) identical to English or differing only by capitalisation, all allowlisted.`,
);
