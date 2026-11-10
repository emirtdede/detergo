/**
 * Installer language catalogue.
 *
 * The app ships 73 locales. NSIS itself only has language files for 52 of them.
 * For the remaining 21 we generate our own `.nlf` (NSIS core strings), MUI
 * `.nsh` (Modern UI strings) and Tauri custom-message `.nsh` files from the
 * English originals, so the setup wizard never falls back to English.
 *
 * `source: "nsis"`   — shipped by NSIS in Contrib\Language files.
 * `source: "project"` — generated into src-tauri/nsis/languages and synced into
 *                       the NSIS language directory before bundling.
 */
export const INSTALLER_LANGUAGES = [
  { locale: "en", name: "English", source: "nsis", lcid: 1033, tauri: "builtin" },
  { locale: "tr", name: "Turkish", source: "nsis", lcid: 1055, tauri: "builtin" },
  { locale: "af", name: "Afrikaans", source: "nsis", lcid: 1078, tauri: "project" },
  { locale: "sq", name: "Albanian", source: "nsis", lcid: 1052, tauri: "project" },
  { locale: "am", name: "Amharic", source: "project", lcid: 1118, tauri: "project" },
  { locale: "ar", name: "Arabic", source: "nsis", lcid: 1025, tauri: "builtin", rtl: true },
  { locale: "hy", name: "Armenian", source: "nsis", lcid: 1067, tauri: "project" },
  { locale: "az", name: "Azerbaijani", source: "project", lcid: 1068, tauri: "project" },
  { locale: "eu", name: "Basque", source: "nsis", lcid: 1069, tauri: "project" },
  { locale: "bn", name: "Bengali", source: "project", lcid: 1093, tauri: "project" },
  { locale: "bs", name: "Bosnian", source: "nsis", lcid: 5146, tauri: "project" },
  { locale: "bg", name: "Bulgarian", source: "nsis", lcid: 1026, tauri: "builtin" },
  { locale: "ca", name: "Catalan", source: "nsis", lcid: 1027, tauri: "project" },
  { locale: "hr", name: "Croatian", source: "nsis", lcid: 1050, tauri: "project" },
  { locale: "cs", name: "Czech", source: "nsis", lcid: 1029, tauri: "project" },
  { locale: "da", name: "Danish", source: "nsis", lcid: 1030, tauri: "project" },
  { locale: "nl", name: "Dutch", source: "nsis", lcid: 1043, tauri: "builtin" },
  { locale: "et", name: "Estonian", source: "nsis", lcid: 1061, tauri: "project" },
  { locale: "fa", name: "Farsi", source: "nsis", lcid: 1065, tauri: "project", rtl: true },
  { locale: "fil", name: "Filipino", source: "project", lcid: 1124, tauri: "project" },
  { locale: "fi", name: "Finnish", source: "nsis", lcid: 1035, tauri: "project" },
  { locale: "fr", name: "French", source: "nsis", lcid: 1036, tauri: "builtin" },
  { locale: "gl", name: "Galician", source: "nsis", lcid: 1110, tauri: "project" },
  { locale: "ka", name: "Georgian", source: "nsis", lcid: 1079, tauri: "project" },
  { locale: "de", name: "German", source: "nsis", lcid: 1031, tauri: "builtin" },
  { locale: "el", name: "Greek", source: "nsis", lcid: 1032, tauri: "project" },
  { locale: "gu", name: "Gujarati", source: "project", lcid: 1095, tauri: "project" },
  { locale: "ha", name: "Hausa", source: "project", lcid: 1128, tauri: "project" },
  { locale: "he", name: "Hebrew", source: "nsis", lcid: 1037, tauri: "project", rtl: true },
  { locale: "hi", name: "Hindi", source: "nsis", lcid: 1081, tauri: "project" },
  { locale: "hu", name: "Hungarian", source: "nsis", lcid: 1038, tauri: "project" },
  { locale: "is", name: "Icelandic", source: "nsis", lcid: 1039, tauri: "project" },
  { locale: "id", name: "Indonesian", source: "nsis", lcid: 1057, tauri: "project" },
  { locale: "ga", name: "Irish", source: "nsis", lcid: 2108, tauri: "project" },
  { locale: "it", name: "Italian", source: "nsis", lcid: 1040, tauri: "builtin" },
  { locale: "ja", name: "Japanese", source: "nsis", lcid: 1041, tauri: "builtin" },
  { locale: "kn", name: "Kannada", source: "project", lcid: 1099, tauri: "project" },
  { locale: "kk", name: "Kazakh", source: "project", lcid: 1087, tauri: "project" },
  { locale: "km", name: "Khmer", source: "project", lcid: 1107, tauri: "project" },
  { locale: "ko", name: "Korean", source: "nsis", lcid: 1042, tauri: "builtin" },
  { locale: "ky", name: "Kyrgyz", source: "project", lcid: 1088, tauri: "project" },
  { locale: "lv", name: "Latvian", source: "nsis", lcid: 1062, tauri: "project" },
  { locale: "lt", name: "Lithuanian", source: "nsis", lcid: 1063, tauri: "project" },
  { locale: "mk", name: "Macedonian", source: "nsis", lcid: 1071, tauri: "project" },
  { locale: "ms", name: "Malay", source: "nsis", lcid: 1086, tauri: "project" },
  { locale: "ml", name: "Malayalam", source: "project", lcid: 1100, tauri: "project" },
  { locale: "mr", name: "Marathi", source: "project", lcid: 1102, tauri: "project" },
  { locale: "mn", name: "Mongolian", source: "nsis", lcid: 1104, tauri: "project" },
  { locale: "my", name: "Burmese", source: "project", lcid: 1109, tauri: "project" },
  { locale: "no", name: "Norwegian", source: "nsis", lcid: 1044, tauri: "builtin" },
  { locale: "pa", name: "Punjabi", source: "project", lcid: 1094, tauri: "project" },
  { locale: "pl", name: "Polish", source: "nsis", lcid: 1045, tauri: "project" },
  { locale: "pt", name: "PortugueseBR", source: "nsis", lcid: 1046, tauri: "builtin" },
  { locale: "ro", name: "Romanian", source: "nsis", lcid: 1048, tauri: "project" },
  { locale: "ru", name: "Russian", source: "nsis", lcid: 1049, tauri: "builtin" },
  { locale: "sr", name: "Serbian", source: "nsis", lcid: 10290, tauri: "project" },
  { locale: "si", name: "Sinhala", source: "project", lcid: 1115, tauri: "project" },
  { locale: "sk", name: "Slovak", source: "nsis", lcid: 1051, tauri: "project" },
  { locale: "sl", name: "Slovenian", source: "nsis", lcid: 1060, tauri: "project" },
  { locale: "es", name: "Spanish", source: "nsis", lcid: 3082, tauri: "builtin" },
  { locale: "sw", name: "Swahili", source: "project", lcid: 1089, tauri: "project" },
  { locale: "sv", name: "Swedish", source: "nsis", lcid: 1053, tauri: "builtin" },
  { locale: "ta", name: "Tamil", source: "project", lcid: 1097, tauri: "project" },
  { locale: "te", name: "Telugu", source: "project", lcid: 1098, tauri: "project" },
  { locale: "th", name: "Thai", source: "nsis", lcid: 1054, tauri: "project" },
  { locale: "tk", name: "Turkmen", source: "project", lcid: 1090, tauri: "project" },
  { locale: "uk", name: "Ukrainian", source: "nsis", lcid: 1058, tauri: "builtin" },
  { locale: "ur", name: "Urdu", source: "project", lcid: 1056, tauri: "project", rtl: true },
  { locale: "uz", name: "Uzbek", source: "nsis", lcid: 1091, tauri: "project" },
  { locale: "vi", name: "Vietnamese", source: "nsis", lcid: 1066, tauri: "builtin" },
  { locale: "yo", name: "Yoruba", source: "project", lcid: 1130, tauri: "project" },
  { locale: "zh", name: "SimpChinese", source: "nsis", lcid: 2052, tauri: "builtin" },
  { locale: "zh-tw", name: "TradChinese", source: "nsis", lcid: 1028, tauri: "builtin" },
];

export const PROJECT_LANGUAGE_DIR = "src-tauri/nsis/languages";

/**
 * Native display names for the project-supplied language files. NSIS shows
 * these in the language picker, so they must be the real autonyms.
 */
export const NATIVE_NAMES = {
  am: { native: "አማርኛ", ascii: "Amharic" },
  az: { native: "Azərbaycanca", ascii: "Azerbaycanca" },
  bn: { native: "বাংলা", ascii: "Bangla" },
  fil: { native: "Filipino", ascii: "Filipino" },
  gu: { native: "ગુજરાતી", ascii: "Gujarati" },
  ha: { native: "Hausa", ascii: "Hausa" },
  kn: { native: "ಕನ್ನಡ", ascii: "Kannada" },
  kk: { native: "Қазақша", ascii: "Kazaksha" },
  km: { native: "ខ្មែរ", ascii: "Khmer" },
  ky: { native: "Кыргызча", ascii: "Kyrgyzcha" },
  ml: { native: "മലയാളം", ascii: "Malayalam" },
  mr: { native: "मराठी", ascii: "Marathi" },
  my: { native: "မြန်မာ", ascii: "Myanmar" },
  pa: { native: "ਪੰਜਾਬੀ", ascii: "Punjabi" },
  si: { native: "සිංහල", ascii: "Sinhala" },
  sw: { native: "Kiswahili", ascii: "Kiswahili" },
  ta: { native: "தமிழ்", ascii: "Tamil" },
  te: { native: "తెలుగు", ascii: "Telugu" },
  tk: { native: "Türkmençe", ascii: "Turkmence" },
  ur: { native: "اردو", ascii: "Urdu" },
  yo: { native: "Yorùbá", ascii: "Yoruba" },
};

/** Installer order: English first (fallback), Turkish second, rest alphabetical. */
export function buildInstallerLanguageOrder() {
  const names = INSTALLER_LANGUAGES.map((entry) => entry.name);
  const rest = names.filter((name) => name !== "English" && name !== "Turkish").sort();
  return ["English", "Turkish", ...rest];
}

export function installerLanguageForLocale(locale) {
  return INSTALLER_LANGUAGES.find((entry) => entry.locale === locale);
}

export function projectLanguages() {
  return INSTALLER_LANGUAGES.filter((entry) => entry.source === "project");
}

/**
 * Languages whose Tauri custom installer messages we have to supply ourselves.
 * Tauri only embeds 22 languages; the rest would silently show English strings
 * such as "the app is running" or "already installed".
 */
export function projectTauriLanguages() {
  return INSTALLER_LANGUAGES.filter((entry) => entry.tauri === "project");
}

export function nativeLanguageNames() {
  return INSTALLER_LANGUAGES;
}

/* ------------------------------------------------------------------ */
/* Button labels inside sentences                                      */
/* ------------------------------------------------------------------ */

/**
 * Sentence strings name the buttons: "Click Next to continue.", "Click Install
 * to start the installation.", "click I Agree", "Click Finish to close Setup."
 * Machine translation keeps those words in Latin script, which then contradicts
 * the fully translated button right below them. The generator replaces every
 * literal occurrence of an English button label with its localized label; the
 * gate re-runs the same comparison to make sure no leak ships.
 */

export function cleanButtonLabel(label) {
  return label
    .replace(/&/g, "")
    .replace(/\.{3,}/g, "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Button labels live in `*Btn` keys plus MUI's dedicated Finish label. */
export function isButtonKey(key) {
  return /Btn$/.test(key) || key === "MUI_BUTTONTEXT_FINISH";
}

export function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Pairs of (English label, localized label) for every button whose label really
 * changed. Longest English label first so "I Do Not Accept" is replaced before
 * the shorter "I Accept" could match a prefix of it.
 */
export function buttonLabelPairs(englishByKey, localizedByKey) {
  const pairs = [];
  for (const [key, english] of englishByKey) {
    if (!isButtonKey(key)) continue;
    const localized = localizedByKey.get(key);
    if (!localized) continue;
    const from = cleanButtonLabel(english);
    const to = cleanButtonLabel(localized);
    if (from.length < 3 || !to || from === to) continue;
    if (!/[A-Za-z]/.test(from)) continue;
    pairs.push({ from, to });
  }
  pairs.sort((a, b) => b.from.length - a.from.length);
  return pairs;
}

export function substituteButtonLabels(text, pairs) {
  let out = text;
  for (const { from, to } of pairs) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(from)}\\b`, "g"), to);
  }
  return out;
}
