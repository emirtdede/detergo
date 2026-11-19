#!/usr/bin/env node
/**
 * Regression gates for the findings of `docs/REMEDIATION_PLAN.md`.
 *
 * Each gate is a measurable property that the audit fixes introduced. They are
 * cheap to check and easy to break silently, so CI must fail when one returns:
 *
 *  - the entry chunk stays under 2 MB (finding Y-1: the eager locale import
 *    pulled all 73 dictionaries into the entry bundle);
 *  - Vite emits no `locales-bundle-*.js` (same finding: grouping every locale
 *    into one chunk defeated per-language lazy loading);
 *  - `dist/theme-boot.js` exists (K-2: the theme must be applied before React
 *    renders, and the CSP forbids an inline script);
 *  - `src/features/docs` contains no `?raw` import (O-7: 107 KB of JSX source
 *    shipped just to build a search index);
 *  - production code contains no `console.*` outside `src/lib/logging.ts`
 *    (log output must go through the wrapper);
 *  - production Rust contains no poisoned-mutex unwrap (O-2: one panic used to
 *    disable scans and cleanup for the rest of the process);
 *  - every `invoke("name")` call in `src/` names a command registered in
 *    `generate_handler!` (a typo previously failed only at runtime, in the
 *    packaged app);
 *  - optional heavyweight dependencies stay pinned and opt-in
 *    (`tauri-specta` exact rc version + `optional`, `rusqlite` without its
 *    default WASM feature set), so T-37/T-38 cannot regress production builds;
 *  - the generated IPC contract (`src/lib/tauri/bindings.ts`) exists and still
 *    carries the generator header instead of being hand-written.
 *
 * The dist gates are skipped when `dist/` does not exist yet; run `npm run
 * build` first to enforce them.
 *
 * Run with: npm run check:gates
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const violations = [];

const INDEX_BUDGET_BYTES = 2_097_152;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function scan(dir, extensions, inspect) {
  for (const file of walk(dir)) {
    if (!extensions.has(extname(file))) continue;
    const rel = relative(root, file).replaceAll("\\", "/");
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      const reason = inspect(line, rel);
      if (reason) violations.push({ file: rel, line: index + 1, text: line.trim(), reason });
    });
  }
}

// O-7: docs search must read the generated index, not the JSX source.
scan(join(root, "src/features/docs"), new Set([".ts", ".tsx"]), (line) =>
  line.includes("?raw")
    ? "Docs search must use docs-index.generated.json, not ?raw imports."
    : null,
);

// Logging must go through `src/lib/logging.ts` so production builds can drop it.
const isTestFile = (rel) => /\.(test|spec)\.[tj]sx?$/.test(rel) || rel.startsWith("scripts/");
scan(join(root, "src"), new Set([".ts", ".tsx"]), (line, rel) => {
  if (rel === "src/lib/logging.ts" || isTestFile(rel)) return null;
  return /console\.(log|warn|error|debug|info)\s*\(/.test(line)
    ? "Use the logging wrapper (src/lib/logging.ts) instead of console.*."
    : null;
});

// O-2: a poisoned mutex must be recovered, not unwrapped.
scan(join(root, "src-tauri/src"), new Set([".rs"]), (line, rel) => {
  if (rel.endsWith("tests.rs") || rel.includes("/tests/")) return null;
  return /\.lock\(\)\.unwrap\(\)/.test(line)
    ? "Use crate::lock!(…) instead of unwrapping the mutex result."
    : null;
});

// Typed IPC contract: an `invoke` name that is not in `generate_handler!`
// only fails when that code path runs in the packaged app.
const libSource = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
const handlerBlock = libSource.match(/generate_handler!\[([\s\S]*?)\]/);
if (!handlerBlock) {
  violations.push({
    file: "src-tauri/src/lib.rs",
    line: 0,
    text: "",
    reason: "Could not locate the generate_handler! list.",
  });
} else {
  const registered = new Set(
    handlerBlock[1]
      .split(/[\s,]+/)
      .map((name) => name.trim())
      .filter(Boolean),
  );
  for (const file of walk(join(root, "src"))) {
    if (![".ts", ".tsx"].includes(extname(file))) continue;
    const rel = relative(root, file).replaceAll("\\", "/");
    if (isTestFile(rel)) continue;
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const match of line.matchAll(/invoke(?:<[^>]*>)?\(\s*["'`]([a-z0-9_]+)["'`]/g)) {
        if (!registered.has(match[1])) {
          violations.push({
            file: rel,
            line: index + 1,
            text: line.trim(),
            reason: `invoke("${match[1]}") is not registered in src-tauri/src/lib.rs.`,
          });
        }
      }
    });
  }
}

// Optional dependency contracts for the deferred upgrades.
const cargoSource = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
const spectaLine = cargoSource.split(/\r?\n/).find((line) => /^\s*tauri-specta\s*=/.test(line));
if (!spectaLine) {
  violations.push({
    file: "src-tauri/Cargo.toml",
    line: 0,
    text: "",
    reason: "The optional tauri-specta dependency contract is missing entirely.",
  });
} else if (!(spectaLine.includes('"=2.0.0-rc.') && spectaLine.includes("optional = true"))) {
  violations.push({
    file: "src-tauri/Cargo.toml",
    line: 0,
    text: spectaLine.trim(),
    reason:
      "tauri-specta must be pinned to an exact 2.0.0-rc version and marked optional so release builds stay on stable code.",
  });
}
const rusqliteBlock = cargoSource.match(/rusqlite\s*=\s*\{[\s\S]{0,200}?\}/);
if (rusqliteBlock) {
  const block = rusqliteBlock[0];
  if (!block.includes("default-features = false") || !block.includes('"bundled"')) {
    violations.push({
      file: "src-tauri/Cargo.toml",
      line: 0,
      text: block.replaceAll("\n", " "),
      reason:
        'rusqlite must use default-features = false with the "bundled" feature; its defaults pull the WASM FFI backend.',
    });
  }
}

// T-37: the TypeScript contract is generated. Deleting it or letting an editor
// rewrite it silently removes the drift guard that `npm run check:bindings`
// (byte-identical regeneration) and `bindings-contract.test.ts` rely on.
const bindingsFile = "src/lib/tauri/bindings.ts";
const bindingsPath = join(root, bindingsFile);
if (!existsSync(bindingsPath)) {
  violations.push({
    file: bindingsFile,
    line: 0,
    text: "",
    reason:
      "The generated IPC contract is missing. Run `npm run generate:bindings` and commit the result.",
  });
} else if (
  !readFileSync(bindingsPath, "utf8").startsWith("// This file has been generated by Tauri Specta.")
) {
  violations.push({
    file: bindingsFile,
    line: 1,
    text: "",
    reason: "The IPC contract must stay generated; hand edits are overwritten by the next export.",
  });
}

// The browser-preview catalog is generated from the real rule file. If the two
// diverge, the preview's About page shows a catalog the engine does not apply —
// which is how it used to report "3 rules" for a 56-rule catalog.
{
  const tomlFile = "src-tauri/assets/targets.toml";
  const mockFile = "src/lib/tauri/mock-catalog.ts";
  const tomlPath = join(root, tomlFile);
  const mockPath = join(root, mockFile);
  if (!existsSync(mockPath)) {
    violations.push({
      file: mockFile,
      line: 0,
      text: "",
      reason: "The preview catalog is missing. Run `npm run generate:mock-catalog`.",
    });
  } else {
    const tomlIds = [...readFileSync(tomlPath, "utf8").matchAll(/^id\s*=\s*"([^"]+)"/gm)].map(
      (match) => match[1],
    );
    const mockIds = [...readFileSync(mockPath, "utf8").matchAll(/^\s{4}id: "([^"]+)"/gm)].map(
      (match) => match[1],
    );
    if (tomlIds.join(",") !== mockIds.join(",")) {
      violations.push({
        file: mockFile,
        line: 0,
        text: `${mockIds.length} rule(s) vs ${tomlIds.length} in ${tomlFile}`,
        reason:
          "The preview catalog drifted from the rule file. Run `npm run generate:mock-catalog`.",
      });
    }
  }
}

const dist = join(root, "dist");
if (existsSync(dist)) {
  if (!existsSync(join(dist, "theme-boot.js"))) {
    violations.push({
      file: "dist/theme-boot.js",
      line: 0,
      text: "",
      reason: "K-2: the pre-render theme bootstrap script is missing from dist.",
    });
  }

  const assets = join(dist, "assets");
  if (existsSync(assets)) {
    const files = readdirSync(assets);
    for (const name of files.filter((file) => file.startsWith("locales-bundle"))) {
      violations.push({
        file: `dist/assets/${name}`,
        line: 0,
        text: "",
        reason: "Y-1: locales must stay per-language chunks, never one bundle.",
      });
    }

    const entry = files.find((file) => /^index-.*\.js$/.test(file));
    if (!entry) {
      violations.push({
        file: "dist/assets",
        line: 0,
        text: "",
        reason: "The entry chunk (index-*.js) was not emitted.",
      });
    } else {
      const { size } = statSync(join(assets, entry));
      if (size >= INDEX_BUDGET_BYTES) {
        violations.push({
          file: `dist/assets/${entry}`,
          line: 0,
          text: `${size} bytes`,
          reason: `Y-1: the entry chunk must stay below ${INDEX_BUDGET_BYTES} bytes.`,
        });
      }
    }
  }
} else {
  console.log("check-gates: dist/ not built, bundle gates skipped.");
}

if (violations.length === 0) {
  console.log(
    "Regression gates passed: docs ?raw, console.*, mutex unwrap, IPC command parity, generated contract, mock catalog freshness and optional dependency contracts.",
  );
  process.exit(0);
}

console.error(`Regression gates failed: ${violations.length} violation(s).`);
for (const violation of violations) {
  console.error(`  ${violation.file}:${violation.line} ${violation.text}`);
  console.error(`    -> ${violation.reason}`);
}
process.exit(1);
