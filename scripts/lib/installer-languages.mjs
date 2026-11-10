/**
 * Installer language coverage.
 *
 * The application UI ships 73 locales (`src/locales/langs`). The NSIS setup
 * wizard is a separate layer: it can only speak a language when NSIS itself
 * ships a `.nlf` translation for it, and its own chrome is translated
 * independently of the app.
 *
 * This module is the single source of truth for the overlap. Every app locale
 * is either mapped to an NSIS language name or listed in `NO_NSIS_TRANSLATION`
 * with a reason. `scripts/check-installer-languages.mjs` keeps the mapping, the
 * app locales and `tauri.conf.json` in sync.
 */

/** App locale -> NSIS language name (the `.nlf` file name). */
export const INSTALLER_LANGUAGES = {
  af: "Afrikaans",
  ar: "Arabic",
  bg: "Bulgarian",
  bs: "Bosnian",
  ca: "Catalan",
  cs: "Czech",
  da: "Danish",
  de: "German",
  el: "Greek",
  en: "English",
  es: "Spanish",
  et: "Estonian",
  eu: "Basque",
  fa: "Farsi",
  fi: "Finnish",
  fr: "French",
  ga: "Irish",
  gl: "Galician",
  he: "Hebrew",
  hi: "Hindi",
  hr: "Croatian",
  hu: "Hungarian",
  hy: "Armenian",
  id: "Indonesian",
  is: "Icelandic",
  it: "Italian",
  ja: "Japanese",
  ka: "Georgian",
  ko: "Korean",
  lt: "Lithuanian",
  lv: "Latvian",
  mk: "Macedonian",
  mn: "Mongolian",
  ms: "Malay",
  nl: "Dutch",
  no: "Norwegian",
  pl: "Polish",
  pt: "PortugueseBR",
  ro: "Romanian",
  ru: "Russian",
  sk: "Slovak",
  sl: "Slovenian",
  sq: "Albanian",
  sr: "Serbian",
  sv: "Swedish",
  th: "Thai",
  tr: "Turkish",
  uk: "Ukrainian",
  uz: "Uzbek",
  vi: "Vietnamese",
  zh: "SimpChinese",
  "zh-tw": "TradChinese",
};

/**
 * App locales that have no NSIS `.nlf` file. Windows shows the English setup
 * wizard for these users; the app itself still starts in their language, so the
 * only gap is the installer chrome.
 */
export const NO_NSIS_TRANSLATION = {
  am: "Amharic has no NSIS language file",
  az: "Azerbaijani has no NSIS language file",
  bn: "Bengali has no NSIS language file",
  fil: "Filipino has no NSIS language file",
  gu: "Gujarati has no NSIS language file",
  ha: "Hausa has no NSIS language file",
  kk: "Kazakh has no NSIS language file",
  km: "Khmer has no NSIS language file",
  kn: "Kannada has no NSIS language file",
  ky: "Kyrgyz has no NSIS language file",
  ml: "Malayalam has no NSIS language file",
  mr: "Marathi has no NSIS language file",
  my: "Burmese has no NSIS language file",
  pa: "Punjabi has no NSIS language file",
  si: "Sinhala has no NSIS language file",
  sw: "Swahili has no NSIS language file",
  ta: "Tamil has no NSIS language file",
  te: "Telugu has no NSIS language file",
  tk: "Turkmen has no NSIS language file",
  ur: "Urdu has no NSIS language file",
  yo: "Yoruba has no NSIS language file",
};

/**
 * Installer order. English leads because Windows and NSIS fall back to the
 * first declared language when the OS language is not in the list; Turkish is
 * second as the primary audience. The rest is alphabetical by NSIS name.
 */
export function buildInstallerLanguageOrder() {
  const names = Object.values(INSTALLER_LANGUAGES);
  const rest = names.filter((name) => name !== "English" && name !== "Turkish").sort();
  return ["English", "Turkish", ...rest];
}
