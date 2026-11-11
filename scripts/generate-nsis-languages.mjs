#!/usr/bin/env node
/**
 * Generates NSIS language packs for app locales that NSIS does not ship.
 *
 * NSIS has language files for 52 of our 73 locales. For the other 21 the setup
 * wizard would fall back to English, which is visible leakage. This tool
 * derives `.nlf`, Modern UI `.nsh` and Tauri custom-message `.nsh` files from
 * the English originals and machine-translates only the human strings, keeping
 * every macro, placeholder and mnemonic intact.
 *
 * Output is committed under src-tauri/nsis/languages, so a release build never
 * needs network access. Run manually when the English source changes:
 *
 *   node scripts/generate-nsis-languages.mjs
 *
 * Translation quality is machine-grade; each generated file carries a header
 * that says so. Native review can replace any file without touching the build.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import {
  INSTALLER_LANGUAGES,
  NATIVE_NAMES,
  PROJECT_LANGUAGE_DIR,
  buttonLabelPairs,
  substituteButtonLabels,
} from "./lib/installer-languages.mjs";

const NSIS_DIR = join(
  process.env.LOCALAPPDATA ?? join(homedir(), "AppData/Local"),
  "tauri",
  "NSIS",
);
const LANG_DIR = join(NSIS_DIR, "Contrib", "Language files");
const CACHE_PATH = join(process.env.TEMP ?? "/tmp", "dev-cleaner-mt-cache.json");

const BOM = "\uFEFF";

/** Placeholders that must survive translation untouched. */
const PROTECT = [
  ["Dev Cleaner", "ZXQ0QXZ"],
  ["{{product_name}}", "ZXQ1QXZ"],
  ["${PRODUCTNAME}", "ZXQ2QXZ"],
  ["${VERSION}", "ZXQ3QXZ"],
  ["$(^NameDA)", "ZXQ4QXZ"],
  ["$(^Name)", "ZXQ5QXZ"],
  ["$(^ClickNext)", "ZXQ6QXZ"],
  ["$_CLICK", "ZXQ7QXZ"],
  ["$\\r\\n", "ZXQ8QXZ"],
  ["\\r\\n", "ZXQ9QXZ"],
  ["$\\n", "ZXQAQXZ"],
  ["$R4", "ZXQBQXZ"],
  ["$0", "ZXQCQXZ"],
  ["$1", "ZXQDQXZ"],
  ["%s", "ZXQEQXZ"],
];

function protect(text) {
  // A newline placeholder glued straight to the next word ("$\nClick") becomes
  // one unknown token for the translator, which mangles it into nonsense such
  // as "ClCl". A space after the newline is visually identical and keeps the
  // token a separate word.
  let out = text.replace(/(\$(?:\\r\\n|\\n))(?=[A-Za-z])/g, "$1 ");
  for (const [from, to] of PROTECT) out = out.split(from).join(to);
  return out;
}

function restore(text) {
  let out = text;
  for (const [from, to] of [...PROTECT].reverse()) out = out.split(to).join(from);
  return out;
}

/**
 * Ampersands are NSIS button mnemonics (`&Next >`), not text. Sending one to a
 * translator turns the whole label into an unknown token and the translator
 * returns it unchanged, which is how `&Next >` and `B&rowse...` stayed English
 * in every generated language. Strip the marker before translating and put it
 * back before the first letter of the result; the exact letter does not matter
 * because Windows derives the mnemonic per locale anyway.
 */
function stripMnemonic(text) {
  let marked = false;
  const stripped = text.replace(/&&|&(?=[^&\s])/g, (match) => {
    if (match === "&&") return match;
    marked = true;
    return "";
  });
  return { text: stripped, marked };
}

function applyMnemonic(text, marked) {
  if (!marked) return text;
  return text.replace(/[^\W\d_]/u, (letter) => `&${letter}`);
}

/**
 * Sentence strings name the buttons: "Click Next to continue.", "Click
 * Install to start the installation.", "click I Agree", "Click Finish to close
 * Setup." Machine translation happily keeps those words in Latin script, which
 * then contradicts the fully translated button right below them — that is how
 * `Next`, `Install`, `Uninstall` and `I Agree` survived in otherwise translated
 * wizards. `buttonLabelPairs`/`substituteButtonLabels` (shared with the gate)
 * replace every literal occurrence of the English label with the localized one.
 */

const cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, "utf8")) : {};
let cacheDirty = false;

async function translateBatch(texts, target) {
  const key = `${target}|${texts.join("\u0001")}`;
  if (cache[key]) return cache[key];

  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&dt=t&tl=" +
    encodeURIComponent(target) +
    "&q=" +
    encodeURIComponent(texts.join("\n"));

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!response.ok) {
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
      continue;
    }
    const payload = await response.json();
    const joined = (payload[0] ?? []).map((segment) => segment[0]).join("");
    const lines = joined.split("\n");
    if (lines.length === texts.length) {
      cache[key] = lines;
      cacheDirty = true;
      return lines;
    }
    // Line counts can drift on very short strings; retry one by one below.
    break;
  }

  const single = [];
  for (const text of texts) {
    const url1 =
      "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&dt=t&tl=" +
      encodeURIComponent(target) +
      "&q=" +
      encodeURIComponent(text);
    const response = await fetch(url1, { headers: { "User-Agent": "Mozilla/5.0" } });
    const payload = await response.json();
    single.push((payload[0] ?? []).map((segment) => segment[0]).join("") || text);
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  cache[key] = single;
  cacheDirty = true;
  return single;
}

async function translateAll(entries, target) {
  // entries: [{ key, text }] -> Map(key -> translated)
  const result = new Map();
  const batchSize = 24;
  for (let i = 0; i < entries.length; i += batchSize) {
    const slice = entries.slice(i, i + batchSize);
    const prepared = slice.map((entry) => {
      const { text, marked } = stripMnemonic(entry.text);
      return { marked, text: protect(text).replace(/\n/g, " ") };
    });
    const translated = await translateBatch(
      prepared.map((item) => item.text),
      target,
    );
    slice.forEach((entry, index) => {
      const restored = restore(translated[index] ?? entry.text);
      result.set(entry.key, applyMnemonic(restored, prepared[index].marked));
    });
    process.stdout.write(".");
  }
  return result;
}

function writeBom(file, text) {
  writeFileSync(file, BOM + text.replace(/\r?\n/g, "\r\n"), "utf8");
}

/**
 * Tauri's own bundler re-writes every `custom_language_files` entry with a UTF-8
 * BOM before compiling. If the source file already has one, makensis sees a
 * double BOM and fails with `Invalid command: "﻿LangString"`, so these packs
 * are written without a BOM on purpose.
 */
function writePlain(file, text) {
  writeFileSync(file, text.replace(/\r?\n/g, "\r\n"), "utf8");
}

/**
 * NSIS has no backslash escapes. A literal double quote inside a string must be
 * written `$\"`; a plain `\"` closes the string and makensis then reports
 * "LangString expects 3 parameters, got 6".
 */
function escapeNsis(text) {
  return text.replace(/"/g, '$\\"');
}

/* ------------------------------------------------------------------ */
/* NSIS core language file (.nlf)                                      */
/* ------------------------------------------------------------------ */

function parseNlf(text) {
  const lines = text.split(/\r?\n/);
  const values = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    const line = lines[i];
    if (!line.startsWith("# ^")) continue;
    const key = line.slice(3).trim();
    const value = lines[i + 1] ?? "";
    values.push({ index: i + 1, key, value });
  }
  return { lines, values };
}

function shouldTranslate(key, value) {
  if (["Branding"].includes(key)) return false;
  if (!value) return false;
  if (/^["']?[\s.,:;\-–—]*["']?$/.test(value)) return false;
  return /[A-Za-z]/.test(value.replace(/\$\([^)]*\)|\$[A-Za-z0-9_]+|%s/g, ""));
}

const SOURCE_NLF = [
  join(process.cwd(), "src-tauri", "nsis", "languages", "_template", "English.nlf"),
  join(LANG_DIR, "English.nlf"),
].find((candidate) => existsSync(candidate));
const SOURCE_MUI = [
  join(process.cwd(), "src-tauri", "nsis", "languages", "_template", "English.nsh"),
  join(LANG_DIR, "English.nsh"),
].find((candidate) => existsSync(candidate));
const TAURI_NSH_DIR = join(NSIS_DIR, "..", "tauri-bundler-nsh");

if (!SOURCE_NLF || !SOURCE_MUI) {
  console.error(
    "[generate-nsis-languages] English NSIS templates not found in " +
      LANG_DIR +
      ".\n" +
      "Run `npx tauri build` once so Tauri downloads its NSIS toolchain.",
  );
  process.exit(1);
}

const englishNlf = readFileSync(SOURCE_NLF, "utf8").replace(/^\uFEFF/, "");
const englishMui = readFileSync(SOURCE_MUI, "utf8").replace(/^\uFEFF/, "");

// Canonical English button labels, shared by every generated file. NSIS's own
// tables (source: "nsis") already translate their buttons; their Tauri message
// packs still quote "Next", so the pairs are needed for those 33 languages too.
const englishButtonLabels = new Map();
for (const item of parseNlf(englishNlf).values) englishButtonLabels.set(item.key, item.value);
for (const match of englishMui.matchAll(/\$\{LangFileString\}\s+(\S+)\s+"((?:[^"\\]|\\.)*)"/g)) {
  englishButtonLabels.set(match[1], match[2]);
}

// Tauri's own custom-message strings come from a Tauri build. Reuse the copy the
// bundler emitted for English when present, otherwise fall back to the file we
// keep in the repo.
const tauriEnglishCandidates = [
  join(process.cwd(), "src-tauri", "target", "release", "nsis", "x64", "English.nsh"),
  join(process.cwd(), "src-tauri", "nsis", "languages", "_template", "tauri-English.nsh"),
];
const tauriEnglishPath = tauriEnglishCandidates.find((candidate) => existsSync(candidate));
if (!tauriEnglishPath) {
  console.error("[generate-nsis-languages] Tauri English string template not found");
  process.exit(1);
}
const tauriEnglish = readFileSync(tauriEnglishPath, "utf8").replace(/^\uFEFF/, "");

mkdirSync(join(PROJECT_LANGUAGE_DIR, "tauri"), { recursive: true });

const summary = [];

const tauriStrings = [
  ...tauriEnglish.matchAll(/LangString\s+(\S+)\s+\$\{LANG_ENGLISH\}\s+"((?:[^"\\]|\\.)*)"/g),
];

for (const entry of INSTALLER_LANGUAGES) {
  const native = NATIVE_NAMES[entry.locale];
  const generated = [];

  // Button (English -> localized) pairs are shared by all three files of a
  // language: `.nlf` holds the button labels, `.nsh` the Finish label, and the
  // Tauri pack quotes "click Next to continue". A sentence may reference a
  // button defined in another file, so collect both maps before substituting.
  const localizedByKey = new Map();
  let sharedButtonPairs = [];

  if (entry.source === "project") {
    if (!native) throw new Error(`missing native name for ${entry.locale}`);

    /* --- .nlf ---------------------------------------------------------- */
    const { lines, values } = parseNlf(englishNlf);
    const translatable = values.filter((item) => shouldTranslate(item.key, item.value));
    const nlfMap = await translateAll(
      translatable.map((item, index) => ({ key: `nlf-${index}`, text: item.value })),
      entry.locale,
    );
    translatable.forEach((item, index) => {
      localizedByKey.set(item.key, nlfMap.get(`nlf-${index}`) ?? item.value);
    });

    /* --- MUI .nsh ------------------------------------------------------ */
    const muiText = englishMui
      .replace(
        /!insertmacro LANGFILE "[^"]*" "[^"]*" "[^"]*" "[^"]*"/,
        `!insertmacro LANGFILE "${entry.name}" "${entry.name}" "${native.native}" "${native.ascii}"`,
      )
      .replace(/;Language: English \(1033\)/, `;Language: ${entry.name} (${entry.lcid})`);

    const muiStrings = [...muiText.matchAll(/\$\{LangFileString\}\s+(\S+)\s+"((?:[^"\\]|\\.)*)"/g)];
    const muiMap = await translateAll(
      muiStrings.map((match, index) => ({
        key: `mui-${index}`,
        text: match[2],
      })),
      entry.locale,
    );

    muiStrings.forEach((match, index) => {
      localizedByKey.set(match[1], muiMap.get(`mui-${index}`) ?? match[2]);
    });

    const buttonPairs = buttonLabelPairs(englishButtonLabels, localizedByKey);

    const outLines = [...lines];
    translatable.forEach((item, index) => {
      const value = nlfMap.get(`nlf-${index}`) ?? item.value;
      outLines[item.index] = substituteButtonLabels(value, buttonPairs);
    });

    // Header block: language id, font, codepage, RTL.
    const idIndex = outLines.findIndex((line) => line.trim() === "# Language ID");
    if (idIndex >= 0) outLines[idIndex + 1] = String(entry.lcid);
    const cpIndex = outLines.findIndex((line) => line.startsWith("# Codepage"));
    // NSIS refuses any codepage except 1200 for a Unicode installer. The files
    // stay UTF-8 with a BOM (that is exactly how NSIS ships Armenian/Georgian/
    // Hindi), so 1200 here means "the text is Unicode", not UTF-16.
    if (cpIndex >= 0) outLines[cpIndex + 1] = "1200";
    const rtlIndex = outLines.findIndex((line) => line.startsWith("# RTL"));
    if (rtlIndex >= 0) outLines[rtlIndex + 1] = entry.rtl ? "RTL" : "-";
    const creditIndex = outLines.findIndex((line) => line.startsWith("# Translation by"));
    if (creditIndex >= 0) {
      outLines[creditIndex] =
        "# Project-supplied machine translation (Google Translate); pending native review";
    }

    writeBom(join(PROJECT_LANGUAGE_DIR, `${entry.name}.nlf`), outLines.join("\n"));

    const muiOut = muiText.replace(
      /\$\{LangFileString\}\s+(\S+)\s+"((?:[^"\\]|\\.)*)"/g,
      (full, name, value) => {
        const index = muiStrings.findIndex((match) => match[1] === name && match[2] === value);
        const translated = muiMap.get(`mui-${index}`) ?? value;
        return `\${LangFileString} ${name} "${escapeNsis(substituteButtonLabels(translated, buttonPairs))}"`;
      },
    );

    writeBom(join(PROJECT_LANGUAGE_DIR, `${entry.name}.nsh`), muiOut);
    generated.push(`${translatable.length} nlf`, `${muiStrings.length} mui`);

    sharedButtonPairs = buttonPairs;
  } else if (entry.tauri === "project") {
    // NSIS already ships a translated table for this language, so read it back
    // from the toolset to learn how it names the buttons. Its Tauri message pack
    // is ours and may still quote "Next" in Latin script.
    for (const extension of [".nlf", ".nsh"]) {
      const file = join(LANG_DIR, `${entry.name}${extension}`);
      if (!existsSync(file)) continue;
      const text = readFileSync(file, "utf8").replace(/^\uFEFF/, "");
      const labels =
        extension === ".nlf"
          ? parseNlf(text).values.map((item) => [item.key, item.value])
          : [...text.matchAll(/\$\{LangFileString\}\s+(\S+)\s+"((?:[^"\\]|\\.)*)"/g)].map(
              (match) => [match[1], match[2]],
            );
      for (const [key, value] of labels) localizedByKey.set(key, value);
    }
    sharedButtonPairs = buttonLabelPairs(englishButtonLabels, localizedByKey);
  }

  if (entry.tauri === "project") {
    /* --- Tauri custom messages ---------------------------------------- */
    const langConst = `LANG_${entry.name.toUpperCase()}`;
    const tauriMap = await translateAll(
      tauriStrings.map((match, index) => ({ key: `tauri-${index}`, text: match[2] })),
      entry.locale,
    );

    // The maintenance page says "click Next to continue." (and "Uninstall
    // before installing" is an option, not the button). Reuse the button pairs
    // from the NSIS tables so the quoted label matches the wizard button. Tauri
    // covers 19 languages with hand-written strings, so for those no pairs
    // exist and the pack is not generated at all.
    const buttonPairs = sharedButtonPairs;

    const tauriOut = tauriEnglish
      .replace(
        /LangString\s+(\S+)\s+\$\{LANG_ENGLISH\}\s+"((?:[^"\\]|\\.)*)"/g,
        (full, name, value) => {
          const index = tauriStrings.findIndex((match) => match[1] === name && match[2] === value);
          const translated = tauriMap.get(`tauri-${index}`) ?? value;
          return `LangString ${name} \${${langConst}} "${escapeNsis(substituteButtonLabels(translated, buttonPairs))}"`;
        },
      )
      .replace(/\$\{LANG_ENGLISH\}/g, `\${${langConst}}`);

    writePlain(join(PROJECT_LANGUAGE_DIR, "tauri", `${entry.locale}.nsh`), tauriOut);
    generated.push(`${tauriStrings.length} tauri`);
  }

  summary.push(`${entry.name} (${entry.locale}): ${generated.join(", ")}`);
  console.log(`\n[generate-nsis-languages] ${entry.name}: ${generated.join(", ")}`);
}

writeFileSync(CACHE_PATH, JSON.stringify(cache), "utf8");
console.log(`\n[generate-nsis-languages] wrote ${summary.length} language packs`);

/* ------------------------------------------------------------------ */
/* Language picker strings                                             */
/* ------------------------------------------------------------------ */

// LangDLL's dialog takes its window title and info text from two MUI defines,
// which default to English. We point them at LangStrings so the dialog is
// localized in every language rather than only English. MUI resolves these
// defines in .onInit before it reads the saved language, so the title follows
// the Windows UI language while the list preselects the saved one.
// The OK/Cancel labels are compiled into LangDLL.dll itself and cannot be
// overridden by any define; see docs/release/INSTALLER_LANGUAGES.md.
const PICKER_TITLE = "Installer Language";
const PICKER_INFO = "Please select a language.";

const pickerTitle = new Map();
const pickerInfo = new Map();
for (const entry of INSTALLER_LANGUAGES) {
  if (entry.locale === "en") {
    pickerTitle.set(entry.locale, PICKER_TITLE);
    pickerInfo.set(entry.locale, PICKER_INFO);
    continue;
  }
  const map = await translateAll(
    [
      { key: "title", text: PICKER_TITLE },
      { key: "info", text: PICKER_INFO },
    ],
    entry.locale,
  );
  pickerTitle.set(entry.locale, map.get("title") ?? PICKER_TITLE);
  pickerInfo.set(entry.locale, map.get("info") ?? PICKER_INFO);
}

const pickerLines = [
  "; Generated by scripts/generate-nsis-languages.mjs. Do not edit by hand.",
  "; Localized strings for MUI's language picker (LangDLL::LangDialog).",
  "; Language ids are numeric so this file does not depend on LANG_* constants.",
  "",
];

for (const entry of INSTALLER_LANGUAGES) {
  pickerLines.push(
    `LangString DcPickerTitle ${entry.lcid} "${escapeNsis(pickerTitle.get(entry.locale))}"`,
  );
  pickerLines.push(
    `LangString DcPickerInfo ${entry.lcid} "${escapeNsis(pickerInfo.get(entry.locale))}"`,
  );
}

writeBom(join(PROJECT_LANGUAGE_DIR, "picker.nsh"), pickerLines.join("\n"));
console.log(
  `[generate-nsis-languages] wrote picker.nsh (${INSTALLER_LANGUAGES.length} languages x title/info)`,
);
