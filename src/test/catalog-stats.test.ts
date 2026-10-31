import { describe, expect, it } from "vitest";
import { countCatalogStats } from "../lib/catalog-stats";

const rule = (ecosystem: string, category: string) => ({ ecosystem, category });

describe("catalog stats", () => {
  it("counts rules, ecosystems and categories separately", () => {
    const stats = countCatalogStats([
      rule("javascript", "build"),
      rule("javascript", "cache"),
      rule("javascript", "build"),
      rule("python", "cache"),
      rule("rust", "tooling"),
    ]);

    expect(stats.rules).toBe(5);
    expect(stats.ecosystems).toBe(3);
    expect(stats.categories).toBe(3);
  });

  it("does not report the rule count as the category count", () => {
    const stats = countCatalogStats([
      rule("javascript", "build"),
      rule("python", "build"),
      rule("go", "build"),
      rule("php", "build"),
    ]);

    expect(stats.rules).toBe(4);
    expect(stats.categories).toBe(1);
    expect(stats.ecosystems).toBe(4);
  });

  it("returns zeros for an empty catalog", () => {
    expect(countCatalogStats([])).toEqual({ rules: 0, ecosystems: 0, categories: 0 });
  });
});
