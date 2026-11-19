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
  "GitHub",
  "Sponsor",
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
  // "Information" is the native spelling in de/fr/da/sv (cognate, not a leak).
  "Information",
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
  // Awaiting translation: the catalog explorer, update check and error log
  // shipped in 1.0.0 with English source so no unreviewed machine translation
  // reaches users. Turkish is translated (tr.ts is a source dictionary). Delete
  // an entry here as soon as every locale file carries a real translation.
  "Rule details",
  "Pick an ecosystem to see every rule it contributes, what it matches and how safe it is.",
  "Matches",
  "Regenerate with",
  "Note",
  "This catalog has no rules.",
  "Software updates",
  "Ask GitHub for the newest release. Nothing is downloaded automatically.",
  "Check for updates",
  "Checking…",
  "You are running the latest version.",
  "Release notes",
  "Open the download page",
  "Could not reach the update server. Check your connection and try again.",
  "Runs only when you press the button. It asks api.github.com for the latest release tag and sends nothing about your device.",
  "Error log",
  "Problems caught in this session. Stored only on this device, never uploaded.",
  "No errors recorded.",
  "Report an issue",
  // Awaiting translation: the 1.0.0 settings dialogs, the support bundle flow
  // and the About page's side navigation. Turkish is translated in tr.ts.
  "Thorough",
  "Maximum",
  "Skips deep folders and stops early. Best for a quick estimate.",
  "The default: matches the catalog everywhere without crawling the whole disk.",
  "Wider and slower than Balanced. Useful after a large dependency install.",
  "Crawls deeply nested monorepos and large drives.",
  "No practical limit. Slow and disk-heavy; use it for a one-off audit.",
  "A profile only pre-fills the limits below; you can still fine-tune them.",
  "Default",
  "Open security settings",
  "System messages",
  "Warnings and lifecycle messages written by the app on this device.",
  "Error reports",
  "Send diagnostics to support",
  "Creates one ZIP with the logs below, the build details and a settings summary, then opens a ready mail draft to support@vellium.dev. Nothing is sent until you press Send in your mail app.",
  "Create bundle and open draft",
  "Creating bundle…",
  "Bundle ready: {path}",
  "Your mail app is open with the bundle attached. Press Send there.",
  "The mail app did not accept the attachment automatically. The bundle is in Explorer and its path was copied; attach it to the draft.",
  "Could not open a mail draft. The bundle is ready in Explorer.",
  "Show in Explorer",
  "Copy path",
  "Recipient: {email}",
  "Copy everything",
  "Clear logs",
  "No system messages recorded.",
  "Never uploaded automatically.",
  "On this page",
  "Application",
  "Rule catalog",
  "Updates & health",
  "Contact",
  "Legal",
  // Awaiting translation: the C: drive cleaner shipped in 1.0.0 with English
  // source so no unreviewed machine translation reaches users. Turkish is
  // translated in tr.ts. Delete these entries as each locale gains a real
  // translation.
  "C: drive cleaner",
  "Clear Windows temp folders, Prefetch data and update leftovers. Your projects, documents and Downloads are never touched.",
  "Quick clean",
  "Clean selected",
  "Select all",
  "Clear selection",
  "Reclaimable",
  "Freed",
  "Not measured",
  "Reported by Windows",
  "Administrator",
  "Administrator rights are needed",
  "Windows blocks system folders for standard users. Restart the app as administrator to clean them; your selection is kept.",
  "Restart as administrator",
  "Running as administrator",
  "Delete the selected system files?",
  "They are removed permanently, not moved to the Recycle Bin. Items marked as regenerable are rebuilt by Windows automatically.",
  "Stop after the current Windows step",
  "Show Windows output",
  "Hide Windows output",
  "Automatic cleanup",
  "Windows Task Scheduler runs a quick cleanup on a schedule, with the highest rights your account allows and without any prompt. The app can remove the task again at any time.",
  "Frequency",
  "Daily",
  "Weekly",
  "Time",
  "Day",
  "Scope",
  "Quick",
  "Standard",
  "Deep",
  "Save schedule",
  "Remove schedule",
  "Scheduled task installed",
  "Windows has no task for this schedule. Save again to repair it.",
  "Schedule saved",
  "Schedule removed",
  "System cleaner",
  "Run now",
  "Last run",
  "Never",
  "Your temporary files",
  "Windows temporary files",
  "Prefetch data",
  "Windows Update leftovers",
  "Windows error reports",
  "Recycle Bin",
  "Windows Disk Cleanup",
  "Component store cleanup",
  // Awaiting translation: 1.0.0 settings sidebar groups, Full scan profile,
  // About health heading, Update latest-version label, and native cleanmgr actions.
  // Turkish is translated in tr.ts.
  "Full",
  "Scans complete workspaces and large repositories with generous limits.",
  "Preferences",
  "Safety & Integrations",
  "Maintenance & Support",
  "System health & storage",
  "Audit totals, last snapshot age and local storage integrity.",
  "Latest version",
  "Free space",
  "Windows Disk Cleanup (cleanmgr)",
  "Launch the built-in Windows Disk Cleanup wizard or configure and run saved profile 1 without typing CMD commands.",
  "Open Disk Cleanup (C:)",
  "Configure profile 1",
  "Run profile 1",
  "Windows Disk Cleanup launched.",
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
  // Awaiting translation: the C: drive cleaner documentation shipped in 1.0.0
  // with English source. Delete these as each docs locale gains a translation.
  "C: Drive Cleaner & Scheduled Automation",
  "Windows Maintenance",
  "Guide",
  "Reclaim space on the system drive without typing a single command. Every action is measured before anything is deleted.",
  "What it cleans",
  "The cleaner covers your temporary files, Windows temporary files, Prefetch data, Windows Update leftovers, Windows error reports, the Recycle Bin, the Windows Disk Cleanup profile and the component store (WinSxS). Project folders, documents and Downloads sit outside every audited root and can never be selected.",
  "Administrator rights",
  "Windows blocks system folders for standard users. When an action needs elevation the page offers a single restart button; the app reopens on the same page with your selection intact. The app itself still starts without administrator rights, so scanning and cleaning your own files never needs a prompt.",
  "Safe by design",
  "The interface only sends action identifiers; paths are resolved and re-verified on the native side against a fixed audited list. Deletion never follows junctions or symbolic links, locked files are skipped and reported, and every run is written to the local audit history.",
  "Nothing is uploaded. Sizes, logs and audit records stay on this device.",
  "Automatic cleanup",
  "A Windows scheduled task can run the quick or standard profile daily or weekly. The task runs with the highest rights your account allows and asks nothing; remove the schedule from the same panel at any time. Prefetch, the Recycle Bin and the component store are never chosen automatically.",
  "Command line",
  "The same actions are available headlessly for scripts and CI: dev-cleaner system --list, dev-cleaner system --clean quick --yes, or --dry-run to measure only.",
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

// The error-boundary copy is keyed by locale id; its English values are the
// reference. These three strings per language must be translated too, because
// the fallback screen is exactly where a half-translated UI is most obvious.
{
  const bundle = JSON.parse(
    readFileSync(join(root, "src/lib/ui-text/error-boundary.json"), "utf8"),
  );
  const reference = flatten(bundle.en);
  for (const [locale, dict] of Object.entries(bundle)) {
    if (locale === "en") continue;
    const flat = flatten(dict);
    for (const [key, source] of Object.entries(reference)) {
      if (flat[key] !== source) continue;
      checkedFiles++;
      checkedLeaves++;
      if (ALLOWED_IDENTICAL_VALUES.has(source)) continue;
      findings.push({ locale, key, value: source });
    }
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
