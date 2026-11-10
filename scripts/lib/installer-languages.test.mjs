import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  INSTALLER_LANGUAGES,
  NO_NSIS_TRANSLATION,
  buildInstallerLanguageOrder,
} from "./installer-languages.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const localeDir = path.join(root, "src/locales/langs");

const appLocales = fs
  .readdirSync(localeDir)
  .filter((file) => file.endsWith(".ts"))
  .map((file) => path.basename(file, ".ts"))
  .sort();

describe("installer language mapping", () => {
  it("accounts for every app locale exactly once", () => {
    const mapped = Object.keys(INSTALLER_LANGUAGES);
    const gaps = Object.keys(NO_NSIS_TRANSLATION);

    expect([...mapped, ...gaps].sort()).toEqual(appLocales);
    expect(mapped.filter((locale) => gaps.includes(locale))).toEqual([]);
  });

  it("maps each NSIS language to a single locale", () => {
    const names = Object.values(INSTALLER_LANGUAGES);
    expect(new Set(names).size).toBe(names.length);
  });

  it("puts English first so unknown OS languages fall back to English", () => {
    const order = buildInstallerLanguageOrder();
    expect(order[0]).toBe("English");
    expect(order[1]).toBe("Turkish");
    expect(order).toHaveLength(Object.keys(INSTALLER_LANGUAGES).length);
  });

  it("orders the remaining languages alphabetically", () => {
    const rest = buildInstallerLanguageOrder().slice(2);
    expect(rest).toEqual([...rest].sort());
  });
});
