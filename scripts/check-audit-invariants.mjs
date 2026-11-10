#!/usr/bin/env node
/**
 * Audit invariant gate.
 *
 * The pre-deployment audit (docs/audit/PRE_DEPLOYMENT_QA_AUDIT_TR.md) found a
 * handful of patterns that caused real defects: a stale search haystack, a
 * cross-origin fetch that the CSP silently blocked, native `confirm()` calls
 * that bypass the app dialog, hardcoded release versions and unsafe `as any`
 * casts around navigation. They must not come back.
 *
 * Every rule is an exact regular expression plus a human-readable reason. The
 * file that defines the rules excludes itself so the patterns can be spelled
 * out literally.
 *
 * Run with: npm run check:audit
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SELF = relative(root, fileURLToPath(import.meta.url)).replaceAll("\\", "/");

const RULES = [
  {
    id: "stale-search-haystack",
    pattern: /_searchHaystack/,
    reason: "Search must read the current item fields, not a cached haystack.",
  },
  {
    id: "no-cors-fetch",
    pattern: /["'`]?no-cors["'`]?/,
    reason: "CSP forbids cross-origin fetches; use the Rust webhook command instead.",
    allow: ["scripts/verify-ipc.mjs"],
    allowReason:
      "The CSP verification script intentionally probes that a no-cors fetch is blocked.",
  },
  {
    id: "native-confirm",
    pattern: /window\.confirm\s*\(/,
    reason: "Use the app Dialog primitive so the action is translatable and themed.",
  },
  {
    id: "hardcoded-version",
    pattern: /["'`]2\.2\.0["'`]/,
    reason: "Read the version from build info / CARGO_PKG_VERSION; stale literals drift.",
  },
  {
    id: "as-any-navigation",
    pattern: /\bas any\b[^\n]*\b(view|route|navigat)\w*/i,
    reason: "Navigation types must be modelled, not cast with `as any`.",
  },
];

const ROOTS = ["src", "scripts", "src-tauri/src"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".rs"]);
const SKIP_DIRS = new Set(["node_modules", "target", "dist", ".git"]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) yield* walk(full);
    else if (EXTENSIONS.has(extname(entry))) yield full;
  }
}

const violations = [];
for (const relRoot of ROOTS) {
  const absRoot = join(root, relRoot);
  for (const file of walk(absRoot)) {
    const rel = relative(root, file).replaceAll("\\", "/");
    if (rel === SELF) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const rule of RULES) {
        if (!rule.pattern.test(line)) continue;
        if (rule.allow?.includes(rel)) continue;
        violations.push({
          rule: rule.id,
          file: rel,
          line: index + 1,
          text: line.trim(),
          reason: rule.reason,
        });
      }
    });
  }
}

if (violations.length === 0) {
  console.log(`Audit invariant gate passed: ${RULES.length} rules, no violations.`);
  process.exit(0);
}

console.error(`Audit invariant gate failed: ${violations.length} violation(s).`);
for (const v of violations) {
  console.error(`  ${v.file}:${v.line} [${v.rule}] ${v.text}`);
  console.error(`    -> ${v.reason}`);
}
process.exit(1);
