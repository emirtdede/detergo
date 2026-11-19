import { describe, expect, it } from "vitest";
import { ecosystemMeta, groupRules } from "../features/settings/CatalogExplorer";
import type { CatalogRule } from "../types";

/** Only the fields the explorer reads are populated. */
function rule(id: string, ecosystem: string, names: string[]): CatalogRule {
  return {
    id,
    ecosystem,
    category: "build",
    kind: "directory",
    names,
    markers: [],
    markerMode: "any",
    content: [],
    minEvidence: 1,
    safety: "regenerate",
    confidence: "high",
    cleanup: "deleteTree",
    regenerate: null,
    genericName: false,
    protected: false,
    nestedIn: [],
    childRules: [],
    gitPolicy: "none",
    requiresIdle: false,
    maxDepth: null,
    note: null,
  } as unknown as CatalogRule;
}

describe("catalog explorer grouping", () => {
  it("groups by ecosystem and keeps rule ids ordered", () => {
    const groups = groupRules([
      rule("js.b", "javascript", ["dist"]),
      rule("py.a", "python", ["__pycache__"]),
      rule("js.a", "javascript", ["node_modules"]),
    ]);

    expect([...groups.keys()]).toEqual(["javascript", "python"]);
    expect(groups.get("javascript")?.map((entry) => entry.id)).toEqual(["js.a", "js.b"]);
  });

  it("does not mutate the caller's array", () => {
    const rules = [rule("js.b", "javascript", ["dist"]), rule("js.a", "javascript", ["build"])];
    groupRules(rules);
    expect(rules.map((entry) => entry.id)).toEqual(["js.b", "js.a"]);
  });

  it("returns an empty map for an empty catalog", () => {
    expect(groupRules([]).size).toBe(0);
  });
});

describe("ecosystem metadata", () => {
  it("labels the ecosystems the catalog ships", () => {
    expect(ecosystemMeta("javascript").label).toBe("JavaScript / TypeScript");
    expect(ecosystemMeta("rust").label).toBe("Rust");
  });

  it("falls back to the raw id instead of hiding an unknown ecosystem", () => {
    const meta = ecosystemMeta("zig");
    expect(meta.label).toBe("zig");
    expect(meta.color).toBeTruthy();
  });
});
