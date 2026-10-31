import type { CatalogRule } from "@/types";

export interface CatalogStats {
  /** Number of cleanup rules in the catalog. */
  rules: number;
  /** Distinct ecosystems those rules cover. */
  ecosystems: number;
  /** Distinct categories those rules cover. */
  categories: number;
}

/**
 * Summarises a catalog. Rules, ecosystems and categories are different
 * quantities: a single ecosystem such as `javascript` contributes many rules
 * spanning several categories, so the rule count must never be used as the
 * number of categories (or vice versa).
 */
export function countCatalogStats(
  rules: readonly Pick<CatalogRule, "ecosystem" | "category">[]
): CatalogStats {
  return {
    rules: rules.length,
    ecosystems: new Set(rules.map((rule) => rule.ecosystem)).size,
    categories: new Set(rules.map((rule) => rule.category)).size,
  };
}
