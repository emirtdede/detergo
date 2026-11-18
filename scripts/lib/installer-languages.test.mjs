import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  INSTALLER_LANGUAGES,
  NATIVE_NAMES,
  PROJECT_LANGUAGE_DIR,
  buildInstallerLanguageOrder,
  buttonLabelPairs,
  cleanButtonLabel,
  projectLanguages,
  projectTauriLanguages,
  substituteButtonLabels,
} from "./installer-languages.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// English and Turkish ship as TypeScript modules; the rest are JSON dictionaries.
const localeDir = path.join(root, "src/lib/ui-text/locales");
const templateDir = path.join(root, PROJECT_LANGUAGE_DIR, "_template");
const appLocales = [
  ...fs
    .readdirSync(localeDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.basename(file, ".json")),
  "en",
  "tr",
].sort();

function parseNlfLabels(text) {
  const map = new Map();
  for (const match of text.matchAll(/^# \^(\w+)\r?\n(.*)$/gm)) map.set(match[1], match[2]);
  return map;
}

function parseMuiLabels(text) {
  const map = new Map();
  for (const match of text.matchAll(/\$\{LangFileString\}\s+(\S+)\s+"((?:[^"\\]|\\.)*)"/g)) {
    map.set(match[1], match[2]);
  }
  return map;
}

const englishButtonLabels = new Map();
for (const [file, parser] of [
  ["English.nlf", parseNlfLabels],
  ["English.nsh", parseMuiLabels],
]) {
  for (const [key, value] of parser(fs.readFileSync(path.join(templateDir, file), "utf8"))) {
    englishButtonLabels.set(key, value);
  }
}

describe("installer language catalogue", () => {
  it("accounts for every app locale exactly once", () => {
    const catalogue = INSTALLER_LANGUAGES.map((entry) => entry.locale).sort();
    expect(catalogue).toEqual(appLocales);
  });

  it("maps each NSIS language to a single locale", () => {
    const names = INSTALLER_LANGUAGES.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("marks every language as either NSIS-supplied or project-supplied", () => {
    for (const entry of INSTALLER_LANGUAGES) {
      expect(["nsis", "project"]).toContain(entry.source);
      expect(["builtin", "project"]).toContain(entry.tauri);
    }
    // English must be NSIS-supplied: it is the fallback table for every other
    // language and the model the generated packs are built from.
    expect(INSTALLER_LANGUAGES.find((entry) => entry.locale === "en").source).toBe("nsis");
  });

  it("gives every project-supplied language a unique language id and native name", () => {
    const project = projectLanguages();
    expect(project.length).toBeGreaterThan(0);
    const ids = project.map((entry) => entry.lcid);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of project) {
      expect(Number.isInteger(entry.lcid)).toBe(true);
      expect(NATIVE_NAMES[entry.locale]?.native).toBeTruthy();
    }
  });

  it("supplies Tauri messages for every language Tauri does not ship", () => {
    // 73 languages minus the 19 Tauri ships hand-written messages for.
    expect(projectTauriLanguages()).toHaveLength(54);
    const builtin = INSTALLER_LANGUAGES.filter((entry) => entry.tauri === "builtin");
    expect(builtin).toHaveLength(19);
    // Tauri ships .nlf files for Farsi and Hebrew but no message file, so they
    // must be project-supplied or the wizard warns and falls back to English.
    expect(builtin.map((entry) => entry.locale)).not.toContain("fa");
    expect(builtin.map((entry) => entry.locale)).not.toContain("he");
  });

  it("declares RTL for exactly the right-to-left languages", () => {
    const rtl = INSTALLER_LANGUAGES.filter((entry) => entry.rtl).map((entry) => entry.locale);
    expect(rtl.sort()).toEqual(["ar", "fa", "he", "ur"]);
  });

  it("puts English first so unknown OS languages fall back to English", () => {
    const order = buildInstallerLanguageOrder();
    expect(order[0]).toBe("English");
    expect(order[1]).toBe("Turkish");
    expect(order).toHaveLength(INSTALLER_LANGUAGES.length);
  });

  it("orders the remaining languages alphabetically", () => {
    const rest = buildInstallerLanguageOrder().slice(2);
    expect(rest).toEqual([...rest].sort());
  });
});

describe("button labels inside sentences", () => {
  const localized = new Map([
    ["NextBtn", "İleri >"],
    ["InstallBtn", "Yükle"],
    ["UninstallBtn", "Kaldır"],
    ["AgreeBtn", "Kabul ediyorum"],
    ["BrowseBtn", "Gözat..."],
    ["MUI_BUTTONTEXT_FINISH", "Bitir"],
  ]);
  const pairs = buttonLabelPairs(englishButtonLabels, localized);
  const labels = pairs.map((pair) => pair.from);

  it("derives a pair for every button whose label changed", () => {
    expect(labels).toEqual(
      expect.arrayContaining(["Next", "Install", "Uninstall", "I Agree", "Finish"]),
    );
  });

  it("strips mnemonics and chrome from labels", () => {
    expect(cleanButtonLabel("&Next >")).toBe("Next");
    expect(cleanButtonLabel("B&rowse...")).toBe("Browse");
    expect(cleanButtonLabel("< &Back")).toBe("Back");
    expect(labels).not.toContain("&Next >");
    expect(labels).not.toContain("B&rowse...");
  });

  it("ignores strings that only contain a button word", () => {
    expect(labels).not.toContain("Nullsoft Install System %s");
    expect(labels.every((label) => /[A-Za-z]/.test(label))).toBe(true);
  });

  it("substitutes whole words only", () => {
    // `>` is button chrome, so the substituted label is the bare word.
    expect(substituteButtonLabels("Click Next to continue.", pairs)).toBe(
      "Click İleri to continue.",
    );
    expect(substituteButtonLabels("Click I Agree to continue.", pairs)).toBe(
      "Click Kabul ediyorum to continue.",
    );
    expect(substituteButtonLabels("Installer settings", pairs)).toBe("Installer settings");
  });

  it("does not double-substitute a localized label", () => {
    const already = "Devam etmek için İleri > öğesine tıklayın.";
    expect(substituteButtonLabels(already, pairs)).toBe(already);
  });

  it("replaces longer labels before their prefixes", () => {
    const longer = buttonLabelPairs(
      englishButtonLabels,
      new Map([
        ["AgreeBtn", "Kabul"],
        ["AcceptBtn", "Kabul et"],
        ["DontAcceptBtn", "Reddet"],
      ]),
    );
    const order = longer.map((pair) => pair.from);
    const acceptIndex = order.indexOf("I accept the terms of the License Agreement");
    const dontIndex = order.indexOf("I do not accept the terms of the License Agreement");
    expect(acceptIndex).toBeGreaterThanOrEqual(0);
    expect(dontIndex).toBeGreaterThanOrEqual(0);
    expect(dontIndex).toBeLessThan(acceptIndex);
  });
});
