#!/usr/bin/env node
/**
 * Installer language gate.
 *
 * Fails when the NSIS language list, the app locales and the language catalogue
 * drift apart, so the setup wizard cannot silently lose a language the app
 * speaks or offer one it cannot render.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  INSTALLER_LANGUAGES,
  NATIVE_NAMES,
  PROJECT_LANGUAGE_DIR,
  buildInstallerLanguageOrder,
  projectLanguages,
  projectTauriLanguages,
} from "./lib/installer-languages.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

function fail(message) {
  errors.push(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

// 1. App locales on disk must match the catalogue one-to-one.
const localeDir = path.join(root, "src/locales/langs");
const appLocales = fs
  .readdirSync(localeDir)
  .filter((file) => file.endsWith(".ts"))
  .map((file) => path.basename(file, ".ts"))
  .sort();

const catalogue = INSTALLER_LANGUAGES.map((entry) => entry.locale).sort();
if (JSON.stringify(appLocales) !== JSON.stringify(catalogue)) {
  const missing = appLocales.filter((locale) => !catalogue.includes(locale));
  const extra = catalogue.filter((locale) => !appLocales.includes(locale));
  if (missing.length) fail(`catalogue is missing app locales: ${missing.join(", ")}`);
  if (extra.length) fail(`catalogue has locales without a translation file: ${extra.join(", ")}`);
}

// 2. One installer language name per locale, no duplicates.
const names = INSTALLER_LANGUAGES.map((entry) => entry.name);
if (new Set(names).size !== names.length) fail("duplicate NSIS language name in the catalogue");

// 3. Project-supplied packs must exist, carry a language id and be translated.
for (const entry of projectLanguages()) {
  const native = NATIVE_NAMES[entry.locale];
  if (!native) fail(`${entry.locale}: missing native name, the picker would show a placeholder`);

  for (const extension of [".nlf", ".nsh"]) {
    const file = path.join(root, PROJECT_LANGUAGE_DIR, `${entry.name}${extension}`);
    if (!fs.existsSync(file)) {
      fail(`missing generated language file ${PROJECT_LANGUAGE_DIR}/${entry.name}${extension}`);
      continue;
    }
    const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    if (!text.includes(String(entry.lcid))) {
      fail(`${entry.name}${extension}: language id ${entry.lcid} is not set`);
    }
    if (extension === ".nlf" && !text.includes("\n1200")) {
      fail(`${entry.name}.nlf: Unicode installers require codepage 1200`);
    }
    // English sentinels must not survive as a complete line; that means the
    // translation step failed and the wizard would show English chrome. A
    // sentinel inside an otherwise translated sentence is fine (loan words).
    const englishLines = new Set(
      text.split(/\r?\n/).map((line) => line.trim().replace(/^["']|["']$/g, "")),
    );
    for (const sentinel of [
      "License Agreement",
      "Choose Install Location",
      "Installation Complete",
      "Please wait",
      ": License Agreement",
    ]) {
      if (englishLines.has(sentinel)) {
        fail(`${entry.name}${extension}: still contains the English line "${sentinel}"`);
      }
    }

    if (extension === ".nlf") {
      // Sentence strings name the buttons ("Click Next to continue."). If the
      // button itself is translated but the sentence still says "Next", the user
      // reads a half-English wizard — exactly the leak this gate exists for.
      const pick = (key) => {
        const match = text.match(new RegExp(`# \\^${key}\\r?\\n([^\\r\\n]*)`));
        return match ? match[1] : "";
      };
      for (const [word, key] of [
        ["Next", "NextBtn"],
        ["Install", "InstallBtn"],
        ["Browse", "BrowseBtn"],
      ]) {
        const label = pick(key);
        if (!label || !/[A-Za-z]/.test(label)) continue; // label left in English
        for (const sentence of ["ClickNext", "ClickInstall"]) {
          const value = pick(sentence);
          if (new RegExp(`\\b${word}\\b`).test(value)) {
            fail(`${entry.name}.nlf: ${sentence} still says "${word}" while ${key} is translated`);
          }
        }
      }
    }
  }
}

// 3b. Tauri custom installer messages ("app is running", "already installed",
// maintenance choices) exist for 22 languages only; every other language needs
// a project pack or the wizard shows English text mid-sentence.
for (const entry of projectTauriLanguages()) {
  const tauriFile = path.join(root, PROJECT_LANGUAGE_DIR, "tauri", `${entry.locale}.nsh`);
  if (!fs.existsSync(tauriFile)) {
    fail(`missing Tauri custom-message pack ${PROJECT_LANGUAGE_DIR}/tauri/${entry.locale}.nsh`);
    continue;
  }
  const text = fs.readFileSync(tauriFile, "utf8");
  const constant = `LANG_${entry.name.toUpperCase()}`;
  if (!text.includes(constant)) {
    fail(`${entry.locale}.nsh does not target ${constant}`);
  }
  if (text.includes("${LANG_ENGLISH}")) {
    fail(`${entry.locale}.nsh still references LANG_ENGLISH`);
  }
  // Tauri re-writes these files with a UTF-8 BOM, so a BOM here would produce a
  // double BOM and makensis rejects the file with `Invalid command: "LangString"`.
  if (text.charCodeAt(0) === 0xfeff) {
    fail(`${entry.locale}.nsh starts with a BOM; Tauri adds its own`);
  }
  // NSIS has no backslash escapes: `\"` closes the string instead of quoting it.
  // `$\"` is the correct escape and must not trip this check.
  if (/(?<!\$)\\"/.test(text)) {
    fail(`${entry.locale}.nsh uses \\" instead of the NSIS escape $\\"`);
  }
}
// 4. Config must declare every language in the documented order, and map the
//    project packs through custom_language_files.
const config = readJson("src-tauri/tauri.conf.json");
const nsis = config.bundle?.windows?.nsis ?? {};
const expected = buildInstallerLanguageOrder();
const actual = nsis.languages ?? [];

if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  const missing = expected.filter((name) => !actual.includes(name));
  const extra = actual.filter((name) => !expected.includes(name));
  if (missing.length) fail(`tauri.conf.json is missing NSIS languages: ${missing.join(", ")}`);
  if (extra.length) fail(`tauri.conf.json has unknown NSIS languages: ${extra.join(", ")}`);
  if (!missing.length && !extra.length) fail("NSIS language order differs from the catalogue");
}

if (nsis.displayLanguageSelector !== true) {
  fail("displayLanguageSelector must be true so the wizard can show the language list");
}

const custom = nsis.customLanguageFiles ?? {};
// Tauri resolves these paths relative to `src-tauri`, exactly like
// `installerHooks` and the artwork settings.
const installDirPrefix = PROJECT_LANGUAGE_DIR.replace(/^src-tauri\//, "");
for (const entry of projectTauriLanguages()) {
  const configured = custom[entry.name];
  const wanted = `${installDirPrefix}/tauri/${entry.locale}.nsh`;
  if (!configured) fail(`customLanguageFiles has no entry for ${entry.name}`);
  else if (configured.replace(/\\/g, "/") !== wanted) {
    fail(`customLanguageFiles.${entry.name} should point at ${wanted}`);
  }
  if (!fs.existsSync(path.join(root, "src-tauri", wanted))) {
    fail(`customLanguageFiles.${entry.name} points at a missing file: ${wanted}`);
  }
}
for (const name of Object.keys(custom)) {
  if (!projectTauriLanguages().some((entry) => entry.name === name)) {
    fail(`customLanguageFiles.${name} is not a language that needs project messages`);
  }
}

// 5. WiX stays at two cultures on purpose (Tauri ships English locale strings).
const wixLanguages = config.bundle?.windows?.wix?.language ?? [];
if (!Array.isArray(wixLanguages) || wixLanguages.length !== 2) {
  fail(
    "WiX is expected to build exactly two cultures (en-US, tr-TR); see docs/release/TEST_MATRIX.md",
  );
}

// 5b. NSIS renders `bundle.copyright` verbatim in the wizard footer
// (`BrandingText`), so it must not contain a translatable English sentence:
// there is exactly one define for all 73 languages. Symbols, a year and the
// brand name are language-neutral; "All rights reserved." is not.
const copyright = config.bundle?.copyright ?? "";
if (!/^©\s*\d{4}\s+\S+$/.test(copyright.trim())) {
  fail(
    `bundle.copyright must be language-neutral (got ${JSON.stringify(copyright)}); ` +
      "it is shown untranslated in every language's wizard footer",
  );
}

// 6. When the NSIS toolchain is present, verify every language is resolvable.
const nlfDir = path.join(
  process.env.LOCALAPPDATA ?? "",
  "tauri",
  "NSIS",
  "Contrib",
  "Language files",
);
let toolchainChecked = false;
if (nsisDirExists(nlfDir)) {
  toolchainChecked = true;
  for (const name of expected) {
    if (!fs.existsSync(path.join(nlfDir, `${name}.nlf`))) {
      fail(`NSIS cannot resolve ${name}: run \`npm run sync:nsis-languages\``);
    }
  }
  // makensis reads language files only from inside its own installation, so the
  // copies in `Contrib` are what actually ships. A stale copy silently reverts
  // translated chrome to English (that is how `Next >` and `Brows...` shipped
  // after a generator fix), so the installed copy must match the repository.
  for (const entry of projectLanguages()) {
    for (const extension of [".nlf", ".nsh"]) {
      const source = path.join(root, PROJECT_LANGUAGE_DIR, `${entry.name}${extension}`);
      const installed = path.join(nlfDir, `${entry.name}${extension}`);
      if (!fs.existsSync(source) || !fs.existsSync(installed)) {
        fail(`${entry.name}${extension} is missing from either the repo or the NSIS toolset`);
        continue;
      }
      if (!fs.readFileSync(source).equals(fs.readFileSync(installed))) {
        fail(
          `NSIS toolset copy of ${entry.name}${extension} is stale: ` +
            "run `npm run sync:nsis-languages`",
        );
      }
    }
  }
}

function nsisDirExists(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

if (errors.length) {
  console.error("[check-installer-languages] FAIL");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `[check-installer-languages] PASS — ${appLocales.length} app locales; ` +
    `${expected.length} installer languages ` +
    `(${projectLanguages().length} project-supplied NSIS packs, ` +
    `${projectTauriLanguages().length} project-supplied message packs); ` +
    `WiX cultures: ${wixLanguages.join(", ")}` +
    (toolchainChecked
      ? "; NSIS toolchain resolves every language."
      : "; NSIS toolchain not installed, skipped."),
);
