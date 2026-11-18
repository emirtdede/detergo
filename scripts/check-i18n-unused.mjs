#!/usr/bin/env node
/**
 * Orphaned i18n key gate.
 *
 * `check-i18n-coverage.mjs` proves every locale has every key, and
 * `check-i18n-untranslated.mjs` proves the values are translated. Neither can
 * see a key that no code path reads any more: a removed feature leaves its
 * strings behind, and the next translator spends time on text nobody renders.
 *
 * Detection is deliberately name-based rather than AST-based:
 *
 *  - the full dotted path is searched first (`ui.history.tabCleanups`), which
 *    covers the common `ui.<category>.<leaf>` access;
 *  - if that does not match, the bare leaf name is searched anywhere in the
 *    source tree. This covers aliases (`const t = ui.settings; t.title`),
 *    destructuring, template interpolation and dynamic lookups, at the cost of
 *    being conservative: a key is only reported when its name appears nowhere.
 *
 * A conservative gate is the point — a false positive would block a release
 * for a key that is actually in use.
 *
 * Run with: npm run check:i18n:unused
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIRS = ["src", "src-tauri/src"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".rs"]);

/**
 * Keys that are read through a computed name and would otherwise be reported.
 * Keep this list short and comment each entry; it is a review marker, not a
 * dumping ground.
 */
const DYNAMIC_KEYS = new Set([
  // Settings sections are looked up by id from `settings-sections.ts`, so the
  // label is read as `ui.settings[section.id]`-style dynamic access.
  // (Currently unused, kept empty on purpose: add only with evidence.)
]);

function walk(dir, acc) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "target") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, acc);
    } else if (SOURCE_EXTENSIONS.has(full.slice(full.lastIndexOf(".")))) {
      acc.push(full);
    }
  }
  return acc;
}

/** Flattens a nested dictionary into `a.b.c` paths. */
function flatten(node, prefix = "", acc = []) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, path, acc);
    } else {
      acc.push(path);
    }
  }
  return acc;
}

/** Loads the English dictionary (the reference key set) as plain data. */
async function loadEnglishDictionary() {
  const ts = await import(
    new URL(`file://${join(root, "node_modules/typescript/lib/typescript.js").replace(/\\/g, "/")}`)
      .href
  ).then((module) => module.default);
  const source = readFileSync(join(root, "src/lib/ui-text/en.ts"), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "module", "require", js)(module.exports, module, () => ({}));
  return module.exports.EN;
}

const files = SOURCE_DIRS.flatMap((dir) => walk(join(root, dir), []));
// Concatenating the sources once is dramatically cheaper than scanning every
// file for every key (the dictionary has ~2,000 leaves).
const corpus = files
  .filter((file) => !file.replaceAll("\\", "/").includes("/lib/ui-text/locales/"))
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");

const en = await loadEnglishDictionary();
const keys = flatten(en);

const orphaned = [];
for (const key of keys) {
  if (DYNAMIC_KEYS.has(key)) continue;
  const leaf = key.slice(key.lastIndexOf(".") + 1);
  const dotted = `ui.${key}`;
  // A bare leaf is matched as a whole identifier so `title` does not match
  // `subtitle` and `load` does not match `loading`.
  const leafPattern = new RegExp(`\\b${leaf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
  if (corpus.includes(dotted)) continue;
  if (leafPattern.test(corpus)) continue;
  orphaned.push(key);
}

if (orphaned.length > 0) {
  console.error(`i18n orphan audit failed: ${orphaned.length} unused key(s).\n`);
  const byCategory = new Map();
  for (const key of orphaned) {
    const category = key.slice(0, key.indexOf("."));
    const list = byCategory.get(category) ?? [];
    list.push(key);
    byCategory.set(category, list);
  }
  for (const [category, list] of [...byCategory].sort((a, b) => b[1].length - a[1].length)) {
    console.error(`  ${category} (${list.length})`);
    for (const key of list.slice(0, 15)) console.error(`    ${key}`);
    if (list.length > 15) console.error(`    … ${list.length - 15} more`);
  }
  console.error(
    "\nRemove the key from en.ts and every locale, or add it to DYNAMIC_KEYS with a reason.",
  );
  process.exit(1);
}

console.log(
  `i18n orphan audit passed: all ${keys.length} English leaves are referenced by the source tree.`,
);
