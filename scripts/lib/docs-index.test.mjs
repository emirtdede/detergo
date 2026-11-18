import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildDocsIndex, extractTopicStrings, serializeDocsIndex } from "./docs-index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const docsDir = path.join(root, "src/features/docs");

function readSources() {
  return {
    en: fs.readFileSync(path.join(docsDir, "DocsContentEn.tsx"), "utf8"),
    tr: fs.readFileSync(path.join(docsDir, "DocsContentTr.tsx"), "utf8"),
  };
}

describe("docs-index generator", () => {
  it("extracts t() literals from a topic branch", () => {
    const strings = extractTopicStrings(`{activeTopicId === "x" && <p>{t("Recycle Bin")}</p>}`);
    expect(strings).toContain("Recycle Bin");
  });

  it("produces a non-empty index for every authored locale", () => {
    const index = buildDocsIndex(readSources());
    expect(Object.keys(index.en).length).toBeGreaterThan(0);
    expect(Object.keys(index.tr).length).toBeGreaterThan(0);
    const englishCorpus = Object.values(index.en).flat().join(" ");
    expect(englishCorpus).toContain("TOCTOU");
    expect(englishCorpus).toContain("Recycle Bin");
  });

  it("never lets JSX source leak into the searchable text", () => {
    const index = buildDocsIndex(readSources());
    for (const locale of ["en", "tr"]) {
      const corpus = Object.values(index[locale]).flat().join(" ");
      // Regression: the split starts on the `activeTopicId ===` marker, and a
      // naive tag/expression regex left handlers and operators in the index.
      expect(corpus).not.toContain("activeTopicId");
      expect(corpus).not.toContain("setCliPath");
      expect(corpus).not.toContain("e.target.value");
      expect(corpus).not.toContain("&& (");
      expect(corpus).not.toContain("=>");
      expect(corpus).not.toContain("className");
    }
  });

  it("keeps Turkish body sentences searchable", () => {
    const index = buildDocsIndex(readSources());
    const turkish = Object.values(index.tr).flat().join(" ");
    // A sentence that only exists as a plain JSX text node.
    expect(turkish).toContain("İnteraktif CLI Komut Oluşturucu");
  });

  it("keeps docs-index.generated.json in sync with the JSX source", () => {
    const expected = serializeDocsIndex(buildDocsIndex(readSources()));
    const actual = fs.readFileSync(path.join(docsDir, "docs-index.generated.json"), "utf8");
    expect(actual).toBe(expected);
  });
});
