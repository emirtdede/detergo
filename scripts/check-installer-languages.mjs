#!/usr/bin/env node
/**
 * Installer language gate.
 *
 * Fails when the NSIS language list, the app locales and the documented
 * mapping drift apart, so the setup wizard cannot silently lose a language
 * the app actually speaks.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  INSTALLER_LANGUAGES,
  NO_NSIS_TRANSLATION,
  buildInstallerLanguageOrder,
} from "./lib/installer-languages.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

function fail(message) {
  errors.push(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

// 1. App locales on disk.
const localeDir = path.join(root, "src/locales/langs");
const appLocales = fs
  .readdirSync(localeDir)
  .filter((file) => file.endsWith(".ts"))
  .map((file) => path.basename(file, ".ts"))
  .sort();

const mapped = Object.keys(INSTALLER_LANGUAGES);
const unmapped = Object.keys(NO_NSIS_TRANSLATION);

for (const locale of appLocales) {
  const inMap = mapped.includes(locale);
  const inGap = unmapped.includes(locale);
  if (!inMap && !inGap)
    fail(`locale ${locale} is neither mapped to NSIS nor documented as missing`);
  if (inMap && inGap) fail(`locale ${locale} is both mapped and documented as missing`);
}

for (const locale of [...mapped, ...unmapped]) {
  if (!appLocales.includes(locale)) fail(`installer-language entry ${locale} has no app locale`);
}

// 2. Mapping must be one-to-one with NSIS names.
const seen = new Map();
for (const [locale, name] of Object.entries(INSTALLER_LANGUAGES)) {
  if (seen.has(name))
    fail(`NSIS language ${name} is mapped twice (${seen.get(name)} and ${locale})`);
  seen.set(name, locale);
}

// 3. Config must match the derived order exactly.
const config = readJson("src-tauri/tauri.conf.json");
const nsis = config.bundle?.windows?.nsis ?? {};
const expected = buildInstallerLanguageOrder();
const actual = nsis.languages ?? [];

if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  const missing = expected.filter((name) => !actual.includes(name));
  const extra = actual.filter((name) => !expected.includes(name));
  if (missing.length) fail(`tauri.conf.json is missing NSIS languages: ${missing.join(", ")}`);
  if (extra.length) fail(`tauri.conf.json has unknown NSIS languages: ${extra.join(", ")}`);
  if (!missing.length && !extra.length) {
    fail("tauri.conf.json NSIS language order differs from the documented order");
  }
}

if (nsis.displayLanguageSelector !== true) {
  fail("displayLanguageSelector must be true so the wizard can show the language list");
}

// 4. WiX is a separate artifact set; keep it intentional and documented.
const wixLanguages = config.bundle?.windows?.wix?.language ?? [];
if (!Array.isArray(wixLanguages) || wixLanguages.length !== 2) {
  fail(
    "WiX is expected to build exactly two cultures (en-US, tr-TR); see docs/release/TEST_MATRIX.md",
  );
}

// 5. If the NSIS toolchain is present, every name must be a real NSIS language.
const nlfDir = path.join(
  process.env.LOCALAPPDATA ?? "",
  "tauri",
  "NSIS",
  "Contrib",
  "Language files",
);
if (fs.existsSync(nlfDir)) {
  const available = new Set(
    fs
      .readdirSync(nlfDir)
      .filter((file) => file.endsWith(".nlf"))
      .map((file) => path.basename(file, ".nlf")),
  );
  for (const name of expected) {
    if (!available.has(name)) fail(`NSIS has no language file for ${name}`);
  }
}

if (errors.length) {
  console.error("[check-installer-languages] FAIL");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `[check-installer-languages] PASS — ${appLocales.length} app locales; ` +
    `${expected.length} installer languages; ${unmapped.length} documented gaps; ` +
    `WiX cultures: ${wixLanguages.join(", ")}.`,
);
