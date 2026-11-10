import { describe, it, expect, beforeEach } from "vitest";
import {
  LEGAL_DOCUMENTS,
  LEGAL_DOC_META,
  LEGAL_REVISION,
  getLegalDocMeta,
  getLegalDocument,
  type LegalDocId,
} from "@/features/legal/legal-content";
import {
  DIRECT_DEPENDENCIES,
  NPM_COMPONENT_COUNT,
  NPM_LICENSE_GROUPS,
  RUST_COMPONENT_COUNT,
  RUST_LICENSE_GROUPS,
} from "@/features/legal/license-data";
import { useUiStore } from "@/stores/ui-store";

const DOC_IDS: LegalDocId[] = ["eula", "privacy", "thirdParty"];

describe("legal documents", () => {
  beforeEach(() => {
    useUiStore.setState({ settingsSection: "general", legalDoc: "eula" });
  });

  it.each(["en", "tr"] as const)("ships every document in %s", (language) => {
    const meta = LEGAL_DOC_META[language];
    expect(meta.map((doc) => doc.id)).toEqual(DOC_IDS);

    for (const id of DOC_IDS) {
      const document = LEGAL_DOCUMENTS[language][id];
      expect(document.title.length).toBeGreaterThan(0);
      expect(document.summary.length).toBeGreaterThan(20);
      expect(document.updated).toBe(LEGAL_REVISION[language]);
      // A legal page with one clause is not a legal page.
      expect(document.clauses.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("gives the EULA and the privacy policy real substance", () => {
    for (const language of ["en", "tr"] as const) {
      expect(LEGAL_DOCUMENTS[language].eula.clauses.length).toBeGreaterThanOrEqual(10);
      expect(LEGAL_DOCUMENTS[language].privacy.clauses.length).toBeGreaterThanOrEqual(10);
    }
    // The obligations a EULA is expected to cover.
    const headings = LEGAL_DOCUMENTS.en.eula.clauses
      .map((clause) => clause.heading.toLowerCase())
      .join(" ");
    for (const keyword of [
      "license grant",
      "restrictions",
      "warranty",
      "liability",
      "governing law",
    ]) {
      expect(headings).toContain(keyword);
    }
  });

  it("has no empty clause and no duplicate heading", () => {
    for (const language of ["en", "tr"] as const) {
      for (const id of DOC_IDS) {
        const headings = LEGAL_DOCUMENTS[language][id].clauses.map((clause) => clause.heading);
        expect(new Set(headings).size).toBe(headings.length);

        for (const clause of LEGAL_DOCUMENTS[language][id].clauses) {
          expect(clause.heading.trim().length).toBeGreaterThan(0);
          const body = [...(clause.paragraphs ?? []), ...(clause.bullets ?? [])];
          expect(body.length).toBeGreaterThan(0);
          for (const text of body) expect(text.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("localizes every other UI language instead of falling back to English", () => {
    // An unknown or missing language still resolves to the English original.
    expect(getLegalDocument(undefined, "eula")).toBe(LEGAL_DOCUMENTS.en.eula);
    expect(getLegalDocument(null, "thirdParty")).toBe(LEGAL_DOCUMENTS.en.thirdParty);

    for (const language of ["de", "ja", "ar"] as const) {
      const document = getLegalDocument(language, "privacy");
      expect(document, `${language} privacy`).not.toBe(LEGAL_DOCUMENTS.en.privacy);
      expect(document.title, `${language} title`).not.toBe(LEGAL_DOCUMENTS.en.privacy.title);
      expect(document.clauses.length).toBe(LEGAL_DOCUMENTS.en.privacy.clauses.length);
      expect(getLegalDocMeta(language)).not.toBe(LEGAL_DOC_META.en);
      expect(getLegalDocMeta(language)[0].label).not.toBe(LEGAL_DOC_META.en[0].label);
    }
  });

  it("names Vellium and its channel in every document", () => {
    for (const language of ["en", "tr"] as const) {
      for (const id of DOC_IDS) {
        const document = LEGAL_DOCUMENTS[language][id];
        const text = [
          document.summary,
          ...document.clauses.flatMap((clause) => [
            ...(clause.paragraphs ?? []),
            ...(clause.bullets ?? []),
          ]),
        ].join(" ");
        expect(text).toContain("Vellium");
        expect(text).toContain("vellium.dev");
      }
    }
  });

  it("opens a legal document from anywhere through one store action", () => {
    const ui = useUiStore.getState();
    expect(ui.legalDoc).toBe("eula");

    ui.openLegalDoc("thirdParty");
    expect(useUiStore.getState().legalDoc).toBe("thirdParty");
    expect(useUiStore.getState().settingsSection).toBe("about");
    expect(useUiStore.getState().aboutPane).toBe("legal");

    // Merely switching tabs must not yank the user out of another section.
    useUiStore.getState().setSettingsSection("about");
    useUiStore.getState().setLegalDoc("privacy");
    expect(useUiStore.getState().legalDoc).toBe("privacy");
    expect(useUiStore.getState().settingsSection).toBe("about");

    // Back returns to the About overview without losing the chosen document.
    useUiStore.getState().closeLegalDoc();
    expect(useUiStore.getState().aboutPane).toBe("overview");
    expect(useUiStore.getState().legalDoc).toBe("privacy");
  });
});

describe("third-party license data", () => {
  it("lists the direct dependencies of both ecosystems", () => {
    const ecosystems = new Set(DIRECT_DEPENDENCIES.map((dependency) => dependency.ecosystem));
    expect(ecosystems).toEqual(new Set(["rust", "npm"]));
    for (const dependency of DIRECT_DEPENDENCIES) {
      expect(dependency.name.length).toBeGreaterThan(0);
      expect(dependency.version.length).toBeGreaterThan(0);
      expect(dependency.license.length).toBeGreaterThan(0);
    }
  });

  it("groups every component and loses none on the way", () => {
    const countComponents = (groups: { components: unknown[] }[]) =>
      groups.reduce((total, group) => total + group.components.length, 0);

    expect(countComponents(RUST_LICENSE_GROUPS)).toBe(RUST_COMPONENT_COUNT);
    expect(countComponents(NPM_LICENSE_GROUPS)).toBe(NPM_COMPONENT_COUNT);
  });

  it("keeps each direct dependency inside its matching license group", () => {
    for (const dependency of DIRECT_DEPENDENCIES) {
      const groups = dependency.ecosystem === "rust" ? RUST_LICENSE_GROUPS : NPM_LICENSE_GROUPS;
      const group = groups.find((candidate) => candidate.license === dependency.license);
      expect(group, `${dependency.name} -> ${dependency.license}`).toBeDefined();
      expect(group!.components.some((component) => component.name === dependency.name)).toBe(true);
    }
  });

  it("carries the licenses that require attribution", () => {
    // These are the obligations called out in the notices page; if a scan ever
    // drops them the page would silently stop being accurate.
    const rustLicenses = RUST_LICENSE_GROUPS.map((group) => group.license).join(" ");
    expect(rustLicenses).toContain("MPL-2.0");
    expect(rustLicenses).toContain("Unicode-3.0");

    const npmLicenses = NPM_LICENSE_GROUPS.map((group) => group.license).join(" ");
    expect(npmLicenses).toContain("MIT");
    expect(npmLicenses).toContain("ISC");
  });
});
