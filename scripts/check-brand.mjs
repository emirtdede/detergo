#!/usr/bin/env node
/**
 * Brand integrity scan. Runs on Linux CI. It verifies that the canonical mark
 * is the only source of truth and that the retired identity cannot reappear on
 * a shipping surface.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractGlyph } from "./lib/svg.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

function fail(message) {
  errors.push(message);
}

function readText(relativePath) {
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute)) {
    fail(`missing: ${relativePath}`);
    return "";
  }
  return fs.readFileSync(absolute, "utf8");
}

function exists(relativePath) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    fail(`missing: ${relativePath}`);
    return false;
  }
  return true;
}

const master = readText("assets/brand/dev-cleaner-icon.svg");
if (master) {
  for (const marker of [
    'data-brand="canvas"',
    'data-safe="32"',
    'data-glyph="mark"',
    'data-layer="detail"',
  ]) {
    if (!master.includes(marker)) fail(`master SVG is missing ${marker}`);
  }
  if (/<text\b/i.test(master)) fail("master SVG must not contain text elements");
  if (/font-family/i.test(master)) fail("master SVG must not depend on a font");
  if (/currentColor/i.test(master)) fail("master SVG must carry its own colours");
  if (!master.includes("dc-bg") || !master.includes("dc-rim")) {
    fail("master SVG gradients are not the canonical dc-* gradients");
  }
}

let glyphPaths = [];
try {
  glyphPaths = extractGlyph(master).paths;
  if (glyphPaths.length !== 4)
    fail(`canonical mark should contain 4 paths, found ${glyphPaths.length}`);
} catch (error) {
  fail(`master glyph: ${error.message}`);
}

const logo = readText("src/components/brand/Logo.tsx");
if (!logo) {
  fail("Logo.tsx is missing");
} else {
  for (const pathData of glyphPaths) {
    if (!logo.includes(pathData))
      fail(`Logo.tsx is out of sync with master glyph path: ${pathData.slice(0, 32)}...`);
  }
  for (const legacy of ["0A84FF", "0055D4", "nc-grad-primary", "nc-grad-glass"]) {
    if (logo.includes(legacy)) fail(`Logo.tsx still contains the retired identity token ${legacy}`);
  }
  if (!logo.includes("currentColor")) fail("Logo.tsx glyph must inherit currentColor");
}

// Shipping-surface scan.
const scanRoots = [
  "README.md",
  "index.html",
  "package.json",
  "src",
  "scripts",
  "src-tauri",
  "assets",
  "public",
  ".github",
  "docs/brand/BRAND_GUIDELINES.md",
  "docs/brand/preview.html",
];
const excluded = new Set([
  path.join(root, "scripts", "check-brand.mjs"),
  path.join(root, "scripts", "check-icons.mjs"),
  path.join(root, "scripts", "lib", "brand-writers.test.mjs"),
]);
const excludedDirs = [
  path.join(root, "src-tauri", "target"),
  path.join(root, "src-tauri", "gen"),
  path.join(root, "node_modules"),
  path.join(root, ".git"),
  path.join(root, "dist"),
  path.join(root, "release_output"),
  path.join(root, "docs", "archive"),
];
const textExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".html",
  ".css",
  ".nsh",
  ".nsi",
  ".rs",
  ".toml",
  ".yml",
  ".yaml",
  ".svg",
]);

function walk(absolute, files) {
  if (!fs.existsSync(absolute)) return;
  const stat = fs.statSync(absolute);
  if (stat.isDirectory()) {
    if (excludedDirs.some((dir) => absolute === dir || absolute.startsWith(`${dir}${path.sep}`)))
      return;
    for (const entry of fs.readdirSync(absolute)) walk(path.join(absolute, entry), files);
    return;
  }
  if (excluded.has(absolute)) return;
  if (!textExtensions.has(path.extname(absolute).toLowerCase())) return;
  files.push(absolute);
}

const files = [];
for (const relativePath of scanRoots) walk(path.join(root, relativePath), files);

const forbidden = ["app-icon.svg", "logo-master.svg", "concept-logos", "setup.ico"];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const relative = path.relative(root, file).replaceAll("\\", "/");
  for (const token of forbidden) {
    if (text.includes(token)) fail(`${relative} references the retired asset "${token}"`);
  }
  if (
    (relative.startsWith("src-tauri/") || relative.startsWith("scripts/")) &&
    text.includes("ie4uinit")
  ) {
    fail(`${relative} mentions ie4uinit; shell refresh must use SHChangeNotify only`);
  }
}

// Notification icon and path.
if (exists("public/icons/notification.png")) {
  const service = readText("src/lib/notifications/notification-service.ts");
  if (!service.includes("/icons/notification.png")) {
    fail("notification-service.ts does not point at /icons/notification.png");
  }
  if (service.includes("/icons/icon.png")) {
    fail("notification-service.ts still points at the removed /icons/icon.png");
  }
}

// Tauri configuration.
const configText = readText("src-tauri/tauri.conf.json");
if (configText) {
  let config = null;
  try {
    config = JSON.parse(configText);
  } catch (error) {
    fail(`tauri.conf.json is invalid JSON: ${error.message}`);
  }
  if (config) {
    const icons = config.bundle?.icon ?? [];
    for (const icon of [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.ico",
      "icons/icon.png",
    ]) {
      if (!icons.includes(icon)) fail(`bundle.icon is missing ${icon}`);
    }
    const nsis = config.bundle?.windows?.nsis ?? {};
    if (nsis.installerIcon !== "icons/icon.ico") fail("NSIS installerIcon must be icons/icon.ico");
    if (nsis.uninstallerIcon !== "icons/icon.ico")
      fail("NSIS uninstallerIcon must be icons/icon.ico");
    for (const key of ["headerImage", "uninstallerHeaderImage", "sidebarImage"]) {
      const relativePath = nsis[key];
      if (!relativePath) fail(`NSIS ${key} is not configured`);
      else if (!fs.existsSync(path.join(root, "src-tauri", relativePath))) {
        fail(`NSIS ${key} points at a missing file: ${relativePath}`);
      }
    }
    const wix = config.bundle?.windows?.wix ?? {};
    if (wix.upgradeCode !== "40ef2964-2821-54d7-ac14-2894d8e84709") {
      fail("WiX upgradeCode must remain 40ef2964-2821-54d7-ac14-2894d8e84709");
    }
    for (const key of ["bannerPath", "dialogImagePath"]) {
      const relativePath = wix[key];
      if (!relativePath) fail(`WiX ${key} is not configured`);
      else if (!fs.existsSync(path.join(root, "src-tauri", relativePath))) {
        fail(`WiX ${key} points at a missing file: ${relativePath}`);
      }
    }
  }
}

// Rust tray feature and assets.
const cargo = readText("src-tauri/Cargo.toml");
if (!cargo.includes("image-png")) fail("Cargo.toml must enable the tauri image-png feature");
for (const size of [16, 20, 24, 28, 32, 36, 40, 48]) {
  exists(`src-tauri/icons/tray-${size}.png`);
}

// NSIS refresh policy.
const hooks = readText("src-tauri/nsis/hooks.nsh");
if (hooks) {
  if (!hooks.includes("SHCNF_FLUSH")) fail("hooks.nsh must use SHCNF_FLUSH");
  if (!hooks.includes("0x08000000")) fail("hooks.nsh must raise SHCNE_ASSOCCHANGED");
  if (!hooks.includes("0x1005"))
    fail("hooks.nsh must use SHCNE_UPDATEITEM with SHCNF_PATHW|SHCNF_FLUSH");
  if (hooks.includes("FLUSHNOWAIT")) fail("hooks.nsh must not use SHCNF_FLUSHNOWAIT");
}

// Scope-claim guard. Dev Cleaner is multi-ecosystem (56 rules across 14
// ecosystems in src-tauri/assets/targets.toml), so no shipping surface may
// describe the product as a cleaner for a single ecosystem. The retired claim
// was "NODE_MODULES CLEANER" on the installer art and in the legacy `tagline`
// dictionary key; both are gone, and this rule keeps them gone.
const installerArtDir = path.join(root, "assets", "brand", "installer");
for (const file of fs.readdirSync(installerArtDir)) {
  if (!file.toLowerCase().endsWith(".svg")) continue;
  const absolute = path.join(installerArtDir, file);
  // Comments are not rendered; scan only the markup that the renderer sees.
  const text = fs
    .readFileSync(absolute, "utf8")
    .replace(/<!--[\s\S]*?-->/g, "")
    .toLowerCase();
  if (/node[_\s-]*modules|package\.json/.test(text)) {
    fail(`installer art ${file} scopes the product to a single ecosystem`);
  }
}
const schema = readText("src/locales/types.ts");
if (schema && /\btagline\s*:/.test(schema)) {
  fail("TranslationSchema reintroduces `tagline`; the product scope is not a tagline");
}
for (const file of fs.readdirSync(path.join(root, "src", "locales", "langs"))) {
  if (!file.endsWith(".ts")) continue;
  const text = fs.readFileSync(path.join(root, "src", "locales", "langs", file), "utf8");
  if (/^\s*tagline\s*:/m.test(text)) {
    fail(`src/locales/langs/${file} reintroduces a single-ecosystem tagline`);
  }
}

// Frontend brand wiring.
const indexHtml = readText("index.html");
if (!indexHtml.includes("/favicon.svg")) fail("index.html must link /favicon.svg");
const readme = readText("README.md");
if (readme && !readme.includes("assets/brand/dev-cleaner-icon-256.png")) {
  fail("README must use assets/brand/dev-cleaner-icon-256.png");
}
if (exists("docs/brand/preview.html")) {
  const preview = readText("docs/brand/preview.html");
  if (!preview.includes("../../assets/brand/dev-cleaner-icon.svg")) {
    fail("docs/brand/preview.html must reference the canonical master");
  }
}
exists("docs/brand/BRAND_GUIDELINES.md");
exists("docs/brand/TRADEMARK_CLEARANCE.md");
exists("docs/archive/brand-v1/README.md");
exists("assets/brand/icon-manifest.json");

if (errors.length > 0) {
  console.error(`[check-brand] FAIL (${errors.length})`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(
  "[check-brand] PASS — canonical master, glyph sync, no retired references, installer art and config wired.",
);
