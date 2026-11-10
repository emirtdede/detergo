import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  INSTALLER_LANGUAGES,
  NATIVE_NAMES,
  buildInstallerLanguageOrder,
  projectLanguages,
  projectTauriLanguages,
} from "./installer-languages.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const localeDir = path.join(root, "src/locales/langs");

const appLocales = fs
  .readdirSync(localeDir)
  .filter((file) => file.endsWith(".ts"))
  .map((file) => path.basename(file, ".ts"))
  .sort();

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
