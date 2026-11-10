#!/usr/bin/env node
/**
 * Locale key-coverage gate.
 *
 * `check-i18n-scripts.mjs` validates the script/mojibake integrity of strings
 * that exist. It cannot see strings that are *absent*: the runtime fallback
 * proxy silently fills missing UI leaves with English, so a locale can be 80%
 * translated and still look "fine" in tests.
 *
 * This gate closes that hole. It compares every translation surface against its
 * reference dictionary and fails when a key is missing or empty.
 *
 * Surfaces and rules:
 *   - src/lib/ui-text/locales/*.json          -> must cover every en.ts leaf.
 *   - src/lib/ui-text/backend-locales/*.json  -> same key set as en.json.
 *   - src/features/legal/legal-locales/*.json -> same key set as af.json (the
 *     de-facto reference; en legal text lives in legal-content.ts).
 *   - src/features/docs/docs-locales/*.json   -> same key set as af.json, with
 *     `tr` exempt: Turkish docs ship as a JSX component (DocsContentTr.tsx),
 *     not as a dictionary.
 *   - src/locales/langs/*.ts                  -> same key set as en.ts except
 *     `legal.*`, which types.ts documents as optional and LegalView now reads
 *     from legal-locales instead.
 *   - src-tauri/assets/cli-locales.json       -> same key set as the reference
 *     locale (locales are keyed by English source string).
 *   - src-tauri/assets/tray-locales.json      -> same key set as the reference
 *     locale.
 *
 * Run with: npm run check:i18n:coverage
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, basename } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const findings = [];
let checkedFiles = 0;
let checkedKeys = 0;

function addFinding(file, locale, key, reason) {
  findings.push({ file, locale, key, reason });
}

function flatten(node, prefix = "", acc = {}) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, path, acc);
    } else {
      acc[path] = value;
    }
  }
  return acc;
}

function isEmpty(value) {
  return (
    value === undefined || value === null || (typeof value === "string" && value.trim() === "")
  );
}

/** Compare one locale dictionary against a reference leaf map. */
function compareDictionary(file, locale, dict, reference, { ignorePrefixes = [] } = {}) {
  checkedFiles++;
  const flat = flatten(dict);
  for (const key of Object.keys(reference)) {
    if (ignorePrefixes.some((prefix) => key.startsWith(prefix))) continue;
    checkedKeys++;
    if (isEmpty(flat[key])) addFinding(file, locale, key, "missing or empty");
  }
}

/** Load a TypeScript dictionary module and return its named export. */
async function loadTypeScriptDictionary(file) {
  const ts = await loadTypeScript();
  const source = readFileSync(file, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  // The dictionaries only contain plain data, so a minimal require stub is safe.
  new Function("exports", "module", "require", js)(module.exports, module, () => ({}));
  return module.exports;
}

let typescriptModule;
async function loadTypeScript() {
  if (typescriptModule) return typescriptModule;
  try {
    const entry = join(root, "node_modules/typescript/lib/typescript.js");
    typescriptModule = (await import(new URL(`file://${entry.replace(/\\/g, "/")}`).href)).default;
  } catch {
    console.error(
      "i18n coverage audit requires the `typescript` dev dependency. Run `npm install` first.",
    );
    process.exit(2);
  }
  return typescriptModule;
}

/** Compare every JSON dictionary in a directory against the union of all keys. */
function auditJsonDirectory(relativeDir, { exempt = [], ignorePrefixes = [] } = {}) {
  const dir = join(root, relativeDir);
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .filter((name) => !exempt.includes(basename(name, ".json")));
  if (entries.length === 0) return;

  // The union is the required key set: a key present in any locale must be
  // present everywhere, so drift in either direction is caught.
  const required = {};
  const dictionaries = new Map();
  for (const name of entries) {
    const dict = JSON.parse(readFileSync(join(dir, name), "utf8"));
    dictionaries.set(name, dict);
    Object.assign(required, flatten(dict));
  }
  for (const [name, dict] of dictionaries) {
    compareDictionary(`${relativeDir}/${name}`, basename(name, ".json"), dict, required, {
      ignorePrefixes,
    });
  }
}

/** Compare every locale-keyed bundle in a single JSON file. */
function auditLocaleBundle(relativeFile) {
  const file = join(root, relativeFile);
  if (!existsSync(file)) return;
  const bundle = JSON.parse(readFileSync(file, "utf8"));
  const required = {};
  for (const dict of Object.values(bundle)) Object.assign(required, flatten(dict));
  for (const [locale, dict] of Object.entries(bundle)) {
    compareDictionary(relativeFile, locale, dict, required);
  }
}

// 1. Primary UI dictionaries must cover every English leaf.
{
  const enModule = await loadTypeScriptDictionary(join(root, "src/lib/ui-text/en.ts"));
  const reference = flatten(enModule.EN);
  const dir = join(root, "src/lib/ui-text/locales");
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const locale = basename(name, ".json");
    const dict = JSON.parse(readFileSync(join(dir, name), "utf8"));
    compareDictionary(`src/lib/ui-text/locales/${name}`, locale, dict, reference);
  }
}

// 2. Backend strings are keyed by the English source sentence.
auditJsonDirectory("src/lib/ui-text/backend-locales");

// 3. Turkish documentation ships as a JSX component, so only its dictionary is exempt.
auditJsonDirectory("src/features/docs/docs-locales", { exempt: ["tr"] });

// 4. Legal documents: the English source lives in legal-content.ts.
auditJsonDirectory("src/features/legal/legal-locales");

// 5. Rust-side terminal output and tray menu labels.
auditLocaleBundle("src-tauri/assets/cli-locales.json");
auditLocaleBundle("src-tauri/assets/tray-locales.json");

// 6. Legacy dictionaries. `legal.*` is optional by design (see src/locales/types.ts).
{
  const enModule = await loadTypeScriptDictionary(join(root, "src/locales/langs/en.ts"));
  const reference = flatten(enModule.en);
  const dir = join(root, "src/locales/langs");
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".ts")) continue;
    const locale = basename(name, ".ts");
    if (locale === "en") continue;
    const module = await loadTypeScriptDictionary(join(dir, name));
    const dict = module[locale] ?? module.default;
    if (!dict) {
      addFinding(`src/locales/langs/${name}`, locale, "(module)", "no dictionary export");
      continue;
    }
    compareDictionary(`src/locales/langs/${name}`, locale, dict, reference, {
      ignorePrefixes: ["legal."],
    });
  }
}

if (findings.length > 0) {
  console.error(`i18n coverage audit failed: ${findings.length} defect(s).\n`);
  const byFile = new Map();
  for (const finding of findings) {
    const list = byFile.get(finding.file) ?? [];
    list.push(finding);
    byFile.set(finding.file, list);
  }
  for (const [file, list] of byFile) {
    console.error(`  ${file} (${list.length})`);
    for (const finding of list.slice(0, 12)) {
      console.error(`    [${finding.locale}] ${finding.key}: ${finding.reason}`);
    }
    if (list.length > 12) console.error(`    … ${list.length - 12} more`);
  }
  process.exit(1);
}

console.log(
  `i18n coverage audit passed: ${checkedKeys} key checks across ${checkedFiles} locale files, no missing keys.`,
);
