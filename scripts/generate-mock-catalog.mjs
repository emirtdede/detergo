#!/usr/bin/env node
/**
 * Regenerates `src/lib/tauri/mock-catalog.ts` from the real rule catalog.
 *
 * The browser preview (`npm run dev` without a Rust backend) used to ship three
 * hand-written rules, so the About page reported "3 rules / 3 ecosystems" while
 * the shipped app reports 56 / 14. That is exactly the kind of drift a preview
 * must not have: the About page is where a reviewer checks the catalog's size,
 * and the catalog explorer is where they check what a rule matches.
 *
 * The mock is not part of the release binary; it only exists so the UI can be
 * exercised, and Playwright screenshots, in a plain browser. Keeping it
 * generated from `assets/targets.toml` means it cannot disagree with the engine.
 *
 * Usage: node scripts/generate-mock-catalog.mjs
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const TOML = path.join(root, "src-tauri/assets/targets.toml");
const OUT = path.join(root, "src/lib/tauri/mock-catalog.ts");

/** Minimal TOML reader for the flat `[[rules]]` table this file contains. */
function parseRules(source) {
  return source
    .split("[[rules]]")
    .slice(1)
    .map((block) => {
      const out = {};
      for (const line of block.split(/\r?\n/)) {
        const match = /^([a-z_]+)\s*=\s*(.+?)\s*$/.exec(line);
        if (!match) continue;
        const [, key, raw] = match;
        out[key] = parseValue(raw);
      }
      return out;
    })
    .filter((rule) => typeof rule.id === "string");
}

function parseValue(raw) {
  if (raw.startsWith("[")) {
    const inner = raw.slice(1, raw.lastIndexOf("]")).trim();
    if (!inner) return [];
    return [...inner.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) =>
      m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"),
    );
  }
  if (raw.startsWith('"')) {
    return raw.slice(1, raw.lastIndexOf('"')).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  const number = Number(raw);
  return Number.isNaN(number) ? raw : number;
}

const rules = parseRules(fs.readFileSync(TOML, "utf8"));

const lines = [];
lines.push(`// GENERATED FILE - do not edit by hand.`);
lines.push(`//`);
lines.push(`// Source: src-tauri/assets/targets.toml`);
lines.push(`// Regenerate: node scripts/generate-mock-catalog.mjs`);
lines.push(`//`);
lines.push(`// The browser preview has no Rust engine, so this mirrors the shipped`);
lines.push(`// catalog. Every field the UI reads is copied verbatim: the About page can`);
lines.push(`// therefore report the real rule, ecosystem and category counts, and the`);
lines.push(`// catalog explorer lists the same folder names the scanner actually matches.`);
lines.push(`import type { CatalogRule } from "@/types";`);
lines.push(``);
lines.push(`export const MOCK_CATALOG_RULES: CatalogRule[] = [`);

const ORDER = ["id", "ecosystem", "category", "kind"];
for (const rule of rules) {
  lines.push("  {");
  for (const key of ORDER) {
    lines.push(`    ${key}: ${JSON.stringify(rule[key] ?? "")},`);
  }
  lines.push(`    names: ${JSON.stringify(rule.names ?? [])},`);
  lines.push(`    markers: ${JSON.stringify(rule.markers ?? [])},`);
  lines.push(`    markerMode: ${JSON.stringify(rule.marker_mode ?? "any")},`);
  lines.push(`    content: ${JSON.stringify(rule.content ?? [])},`);
  lines.push(`    minEvidence: ${rule.min_evidence ?? 1},`);
  lines.push(`    safety: ${JSON.stringify(rule.safety ?? "review")},`);
  lines.push(`    confidence: ${JSON.stringify(rule.confidence ?? "high")},`);
  lines.push(`    cleanup: ${JSON.stringify(rule.cleanup ?? "trash")},`);
  lines.push(`    regenerate: ${rule.regenerate ? JSON.stringify(rule.regenerate) : "null"},`);
  lines.push(`    genericName: ${rule.generic_name === true},`);
  lines.push(`    protected: ${rule.protected === true},`);
  lines.push(`    nestedIn: ${JSON.stringify(rule.nested_in ?? [])},`);
  lines.push(`    childRules: ${JSON.stringify(rule.child_rules ?? [])},`);
  lines.push(`    gitPolicy: ${JSON.stringify(rule.git_policy ?? "ignore")},`);
  lines.push(`    requiresIdle: ${rule.requires_idle === true},`);
  lines.push(`    maxDepth: ${typeof rule.max_depth === "number" ? rule.max_depth : "null"},`);
  lines.push(`    note: ${rule.note ? JSON.stringify(rule.note) : "null"},`);
  lines.push("  },");
}

lines.push("];");
lines.push("");

fs.writeFileSync(OUT, lines.join("\n"));
console.log(`wrote ${path.relative(root, OUT)} with ${rules.length} rule(s)`);
