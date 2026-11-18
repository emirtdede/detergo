/** Regenerates `src/features/docs/docs-index.generated.json` from the docs JSX. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildDocsIndex, serializeDocsIndex } from "./lib/docs-index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = path.join(root, "src/features/docs");
const target = path.join(docsDir, "docs-index.generated.json");

const sources = {
  en: fs.readFileSync(path.join(docsDir, "DocsContentEn.tsx"), "utf8"),
  tr: fs.readFileSync(path.join(docsDir, "DocsContentTr.tsx"), "utf8"),
};

const serialized = serializeDocsIndex(buildDocsIndex(sources));
const topicCount = Object.keys(JSON.parse(serialized).en).length;

if (topicCount === 0) {
  // An empty index silently disables body search, so fail the build instead.
  console.error("build-docs-index: no topics matched in DocsContentEn.tsx");
  process.exit(1);
}

fs.writeFileSync(target, serialized, "utf8");
console.log(
  `build-docs-index: wrote ${path.relative(root, target)} (${topicCount} topics, ${serialized.length} bytes)`,
);
