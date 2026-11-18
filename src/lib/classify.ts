import { CleanupItem } from "@/types";

/** Canonical buckets used by the Overview breakdown cards. */
export type ItemBucket = "node" | "rust" | "python" | "agent" | "cache" | "other";

/**
 * Maps the backend's structured metadata onto the Overview buckets.
 *
 * The backend already classifies every target (`ecosystem`, `category`), so the
 * UI must not re-derive the ecosystem from folder names: a Python directory
 * called `target` is not Rust, and a cache named `*claude*` inside a normal
 * project is not an agent target.
 */
const ECOSYSTEM_BUCKETS: Record<string, ItemBucket> = {
  javascript: "node",
  node: "node",
  rust: "rust",
  python: "python",
};

const CATEGORY_BUCKETS: Record<string, ItemBucket> = {
  agent: "agent",
  cache: "cache",
  "package-cache": "cache",
};

export function itemBucket(item: Pick<CleanupItem, "ecosystem" | "category">): ItemBucket {
  const eco = (item.ecosystem ?? "").trim().toLowerCase();
  const category = (item.category ?? "").trim().toLowerCase();

  // Agent storage is identified by its own ecosystem slug; agent caches often
  // also carry a generic `cache` category, so this check must run first.
  if (eco === "ai" || category === "agent") return "agent";

  const ecoBucket = ECOSYSTEM_BUCKETS[eco];
  if (ecoBucket) return ecoBucket;

  const categoryBucket = CATEGORY_BUCKETS[category];
  if (categoryBucket) return categoryBucket;

  return "other";
}
