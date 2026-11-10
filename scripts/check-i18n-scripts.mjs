#!/usr/bin/env node
/**
 * Locale script-integrity gate.
 *
 * Every translation surface is audited for two classes of defect that fallback
 * cannot hide because the string is present but wrong:
 *
 *   1. Cross-script contamination — a string written in the locale's own
 *      script that contains letters from another writing system (for example
 *      Arabic "جاري" inside a Kannada string). Shared punctuation such as the
 *      danda (U+0964) is ignored so Bengali/Gurmukhi are not false-flagged.
 *   2. Mojibake — Windows-1251 bytes decoded as Latin-1, which turns Russian
 *      text into strings like "Àëåêñàíäð".
 *   3. Han variant mixing — Simplified characters inside zh-tw (Traditional)
 *      strings and Traditional characters inside zh (Simplified) strings.
 *      Only unambiguous variant characters are checked so that shared forms
 *      (台, 后, 里, 面, 云, 干, 么, 游, …) are never flagged.
 *
 * Latin is always allowed because brand names and technical terms (Dev Cleaner,
 * Windows, AI) legitimately stay in Latin across every locale.
 *
 * Run with: npm run check:i18n
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, basename } from "node:path";
import { SIMPLIFIED_ONLY, TRADITIONAL_ONLY } from "./i18n-han-variants.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SCRIPTS = {
  latin: [
    [0x0000, 0x024f],
    [0x1e00, 0x1eff],
    [0x2c60, 0x2c7f],
    [0xa720, 0xa7ff],
  ],
  cyrillic: [
    [0x0400, 0x052f],
    [0x2de0, 0x2dff],
    [0xa640, 0xa69f],
  ],
  arabic: [
    [0x0600, 0x06ff],
    [0x0750, 0x077f],
    [0x08a0, 0x08ff],
    [0xfb50, 0xfdff],
    [0xfe70, 0xfeff],
  ],
  devanagari: [
    [0x0900, 0x097f],
    [0xa8e0, 0xa8ff],
  ],
  bengali: [[0x0980, 0x09ff]],
  gurmukhi: [[0x0a00, 0x0a7f]],
  gujarati: [[0x0a80, 0x0aff]],
  tamil: [[0x0b80, 0x0bff]],
  telugu: [[0x0c00, 0x0c7f]],
  kannada: [[0x0c80, 0x0cff]],
  malayalam: [[0x0d00, 0x0d7f]],
  sinhala: [[0x0d80, 0x0dff]],
  thai: [[0x0e00, 0x0e7f]],
  myanmar: [
    [0x1000, 0x109f],
    [0xaa60, 0xaa7f],
  ],
  khmer: [
    [0x1780, 0x17ff],
    [0x19e0, 0x19ff],
  ],
  georgian: [
    [0x10a0, 0x10ff],
    [0x1c90, 0x1cbf],
  ],
  armenian: [
    [0x0530, 0x058f],
    [0xfb00, 0xfb06],
  ],
  greek: [
    [0x0370, 0x03ff],
    [0x1f00, 0x1fff],
  ],
  hebrew: [
    [0x0590, 0x05ff],
    [0xfb1d, 0xfb4f],
  ],
  ethiopic: [
    [0x1200, 0x137f],
    [0x1380, 0x139f],
    [0x2d80, 0x2ddf],
  ],
  hangul: [
    [0x1100, 0x11ff],
    [0x3130, 0x318f],
    [0xa960, 0xa97f],
    [0xac00, 0xd7af],
  ],
  kana: [
    [0x3040, 0x309f],
    [0x30a0, 0x30ff],
    [0x31f0, 0x31ff],
    [0xff66, 0xff9d],
  ],
  han: [
    [0x3400, 0x4dbf],
    [0x4e00, 0x9fff],
    [0xf900, 0xfaff],
    [0x20000, 0x2fa1f],
  ],
};

// Locale → scripts that may appear besides Latin.
const LOCALE_SCRIPTS = {
  bg: ["cyrillic"],
  kk: ["cyrillic"],
  ky: ["cyrillic"],
  mk: ["cyrillic"],
  mn: ["cyrillic"],
  ru: ["cyrillic"],
  sr: ["cyrillic", "latin"],
  uk: ["cyrillic"],
  ar: ["arabic"],
  fa: ["arabic"],
  ur: ["arabic"],
  hi: ["devanagari"],
  mr: ["devanagari"],
  bn: ["bengali"],
  pa: ["gurmukhi"],
  gu: ["gujarati"],
  ta: ["tamil"],
  te: ["telugu"],
  kn: ["kannada"],
  ml: ["malayalam"],
  si: ["sinhala"],
  th: ["thai"],
  my: ["myanmar"],
  km: ["khmer"],
  ka: ["georgian"],
  hy: ["armenian"],
  el: ["greek"],
  he: ["hebrew"],
  am: ["ethiopic"],
  ko: ["hangul", "han"],
  ja: ["kana", "han"],
  zh: ["han"],
  "zh-tw": ["han"],
};

function scriptOf(cp) {
  for (const [name, ranges] of Object.entries(SCRIPTS)) {
    for (const [lo, hi] of ranges) {
      if (cp >= lo && cp <= hi) return name;
    }
  }
  return null;
}

const decoder = new TextDecoder("windows-1251");

function looksLikeCp1251Mojibake(value) {
  const chars = [...value];
  const nonAscii = chars.filter((c) => c.codePointAt(0) > 0x7f);
  if (nonAscii.length < 4) return false;
  if (!nonAscii.every((c) => c.codePointAt(0) <= 0xff)) return false;
  const bytes = Uint8Array.from(chars.map((c) => c.codePointAt(0) & 0xff));
  const decoded = decoder.decode(bytes);
  const letters = [...decoded].filter((c) => /\p{L}/u.test(c));
  if (letters.length === 0) return false;
  const cyrillic = letters.filter((c) => /\p{Script=Cyrillic}/u.test(c)).length;
  const asciiLatin = letters.filter((c) => /[A-Za-z]/.test(c)).length;
  return cyrillic / letters.length > 0.8 && asciiLatin === 0;
}

function findHanVariantViolations(locale, value) {
  const forbidden =
    locale === "zh-tw" ? SIMPLIFIED_ONLY : locale === "zh" ? TRADITIONAL_ONLY : null;
  if (!forbidden) return [];
  const hits = new Set();
  for (const char of value) {
    if (forbidden.has(char)) hits.add(char);
  }
  if (hits.size === 0) return [];
  const variant = locale === "zh-tw" ? "simplified" : "traditional";
  return [`${variant} Han variant: ${[...hits].join(" ")}`];
}

function findViolations(locale, value) {
  const allowed = new Set(["latin", ...(LOCALE_SCRIPTS[locale] ?? [])]);
  const foreign = new Set();
  for (const char of value) {
    // Punctuation, separators, symbols and numbers are shared across scripts.
    if (/\p{P}|\p{Z}|\p{S}|\p{N}/u.test(char)) continue;
    const script = scriptOf(char.codePointAt(0));
    if (script === null || allowed.has(script)) continue;
    foreign.add(script);
  }
  const problems = [];
  if (foreign.size > 0) problems.push(`foreign script: ${[...foreign].join(", ")}`);
  if (looksLikeCp1251Mojibake(value)) problems.push("cp1251-as-latin1 mojibake");
  problems.push(...findHanVariantViolations(locale, value));
  return problems;
}

function* walkJson(node, path) {
  if (typeof node === "string") {
    yield [path, node];
  } else if (node && typeof node === "object") {
    for (const [key, child] of Object.entries(node)) {
      yield* walkJson(child, path ? `${path}.${key}` : key);
    }
  }
}

const findings = [];
let scannedFiles = 0;
let scannedStrings = 0;

function auditFile(file, locale, dict) {
  scannedFiles++;
  for (const [key, value] of walkJson(dict, "")) {
    scannedStrings++;
    const problems = findViolations(locale, value);
    if (problems.length > 0) {
      findings.push({ file, locale, key, value, problems });
    }
  }
}

function auditDirectory(relativeDir) {
  const dir = resolve(root, relativeDir);
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const locale = basename(name, ".json");
    if (locale === "en") continue;
    const dict = JSON.parse(readFileSync(resolve(dir, name), "utf8"));
    auditFile(`${relativeDir}/${name}`, locale, dict);
  }
}

// The legacy `src/locales/langs/*.ts` dictionaries are still consumed by
// ErrorBoundary and the test suite, so they are gated too. String literals are
// extracted with a quote-aware matcher that tolerates escapes and apostrophes
// inside double-quoted values.
const STRING_LITERAL = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;

function auditTypeScriptDirectory(relativeDir) {
  const dir = resolve(root, relativeDir);
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".ts")) continue;
    const locale = basename(name, ".ts");
    if (locale === "en") continue;
    const source = readFileSync(resolve(dir, name), "utf8");
    scannedFiles++;
    for (const match of source.matchAll(STRING_LITERAL)) {
      const value = match[1] ?? match[2] ?? match[3];
      if (value == null) continue;
      scannedStrings++;
      const problems = findViolations(locale, value);
      if (problems.length > 0) {
        findings.push({
          file: `${relativeDir}/${name}`,
          locale,
          key: "(string literal)",
          value,
          problems,
        });
      }
    }
  }
}

auditDirectory("src/lib/ui-text/locales");
auditDirectory("src/lib/ui-text/backend-locales");
auditDirectory("src/features/docs/docs-locales");
auditDirectory("src/features/legal/legal-locales");
auditTypeScriptDirectory("src/locales/langs");

// The Rust asset bundles are keyed by locale instead of by directory.
for (const asset of ["src-tauri/assets/cli-locales.json", "src-tauri/assets/tray-locales.json"]) {
  const file = resolve(root, asset);
  if (!existsSync(file)) continue;
  const bundle = JSON.parse(readFileSync(file, "utf8"));
  for (const [locale, dict] of Object.entries(bundle)) {
    if (locale === "en") continue;
    auditFile(asset, locale, dict);
  }
}

if (findings.length > 0) {
  console.error(`i18n script audit failed: ${findings.length} defect(s).\n`);
  for (const { file, locale, key, value, problems } of findings) {
    console.error(`  ${file} [${locale}] ${key}`);
    console.error(`    ${problems.join("; ")}`);
    console.error(`    ${JSON.stringify(value)}`);
  }
  process.exit(1);
}

console.log(
  `i18n script audit passed: ${scannedStrings} strings across ${scannedFiles} files, no foreign scripts or mojibake.`,
);
