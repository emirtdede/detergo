/**
 * Contract test for the generated Rust -> TypeScript IPC bindings (T-37).
 *
 * `src/lib/tauri/bindings.ts` is produced from the Rust types by
 * `cargo run --features bindings --bin export_bindings`. The frontend keeps its
 * own ergonomic names in `src/types/index.ts`, so the two files can drift: a
 * Rust field can be renamed and the generated file updated without anyone
 * touching the code the UI actually imports.
 *
 * This test parses both files and asserts, for every type that crosses the IPC
 * boundary:
 *
 * - the field sets are identical (no missing, no extra fields);
 * - every field's normalized type matches (unions are sorted, `null` and
 *   `undefined` are dropped, `Array<T>` is written `T[]`);
 * - enum unions and tagged unions (`ScanEvent`, `CleanupEvent`, ...) carry the
 *   same variants, and each variant the same fields.
 *
 * Optionality (`field?:`) is deliberately not compared: serde derives produce a
 * `_Serialize` and a `_Deserialize` shape that differ only in that dimension,
 * while the handwritten types pick whichever reads best.
 *
 * Intentional narrowings (the UI knows `string` is really a closed union) are
 * listed in `NARROWED` with a reason, so a new one cannot slip in unnoticed.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const GENERATED = join(here, "..", "lib", "tauri", "bindings.ts");
const HANDWRITTEN = join(here, "..", "types", "index.ts");

/** Frontend names that differ from the Rust/generated type name. */
const RENAMED: Record<string, string> = {
  Rule: "CatalogRule",
  FavoriteItem: "FavoriteLocation",
  SortConfig: "SortOption",
};

/** Extra type references whose frontend name differs. */
const TYPE_ALIASES: Record<string, string> = {
  ...RENAMED,
  AppError: "AppErrorDto",
};

/** Types compared by a dedicated test instead of the generic shape walk. */
const SPECIAL_CASED = new Set(["AppError"]);

/** Fields where the frontend intentionally narrows a generated `string`. */
const NARROWED: Record<string, string> = {
  "AppSettings.language": "Rust stores a string; the UI only offers SupportedLanguage.",
  "AppSettings.sidebarMode": "Rust stores a string; the UI only offers SidebarMode.",
  "AppSettings.cacheMeasureMode": "Rust stores a string; the UI only offers CacheMeasureMode.",
  "AppSettings.closeAction": "Rust stores a string; the UI only offers CloseAction.",
  "CustomThemeConfig.base": "Rust stores a validated string; the UI only offers dark/light.",
  "BuildInfo.profile": "Rust stores a string; only debug/release exist.",
  "SortOption.field": "Rust stores a validated string; the UI knows the closed set.",
  "SortOption.direction": "Rust stores a validated string; the UI knows asc/desc.",
  "GrowthEntry.level": "Rust stores a validated string; the UI knows the three levels.",
};

/** Types compared through a differently shaped frontend declaration. */
const SKIPPED = new Set<string>();

type Field = { type: string; optional: boolean };
type Shape = Map<string, Field>;
type TaggedUnion = Map<string, Shape>;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/[^\n]*/g, "$1");
}

function matchingBrace(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`unbalanced braces at ${open}`);
}

function splitTopLevel(body: string, separators: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of body) {
    if ("{<([".includes(character)) depth += 1;
    if ("}>)]".includes(character)) depth -= 1;
    if (depth === 0 && separators.includes(character)) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function parseFields(body: string): Shape {
  const shape: Shape = new Map();
  for (const entry of splitTopLevel(body, ";,")) {
    const field = /^([A-Za-z_$][\w$]*)(\?)?\s*:\s*([\s\S]+)$/.exec(entry);
    if (!field) continue;
    shape.set(field[1], { optional: field[2] === "?", type: field[3].trim() });
  }
  return shape;
}

function objectShapes(source: string): Map<string, Shape> {
  const shapes = new Map<string, Shape>();
  const declaration = /export (interface|type) (\w+)\s*(?:=\s*)?\{/g;
  for (const match of source.matchAll(declaration)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const close = matchingBrace(source, open);
    // A union alias (`{ a } | { b }`) is parsed by `taggedUnions` instead.
    if (match[1] === "type" && source.slice(close + 1).trimStart()[0] !== ";") continue;
    const name = canonicalName(match[2]);
    // `_Serialize` is the shape the frontend receives; `_Deserialize` only
    // differs for `Option` handling and is the one that appears first in the
    // generated file, so prefer the serialized variant when both exist.
    const preferred = match[2].endsWith("_Serialize");
    if (shapes.has(name) && !preferred) continue;
    shapes.set(name, parseFields(source.slice(open + 1, close)));
  }
  return shapes;
}

function canonicalName(name: string): string {
  const base = name.replace(/_(Serialize|Deserialize)$/, "");
  return RENAMED[base] ?? base;
}

function taggedUnions(source: string, objects: ReadonlySet<string>): Map<string, TaggedUnion> {
  const unions = new Map<string, TaggedUnion>();
  const declaration = /export type (\w+) =/g;
  for (const match of source.matchAll(declaration)) {
    const name = canonicalName(match[1]);
    // A plain object can carry a `code` field; `objectShapes` owns those.
    if (objects.has(name)) continue;
    const bodyStart = (match.index ?? 0) + match[0].length;
    const body = splitTopLevel(source.slice(bodyStart), ";")[0];
    const variants = splitTopLevel(body, "|");
    if (variants.length === 0 || !variants.every((part) => part.startsWith("{"))) continue;

    const union: TaggedUnion = unions.get(name) ?? new Map();
    for (const variant of variants) {
      const fields = parseFields(variant.slice(1, -1));
      const tag = fields.get("type") ?? fields.get("code");
      if (!tag) {
        union.clear();
        break;
      }
      const key = tag.type.replace(/"/g, "");
      // `_Serialize` and `_Deserialize` describe the same variant; the fields
      // are identical once optionality is ignored, so keep the first shape.
      if (!union.has(key)) union.set(key, fields);
    }
    if (union.size > 0) unions.set(name, union);
  }
  return unions;
}

function unionMembers(source: string): Map<string, string[]> {
  const members = new Map<string, string[]>();
  const declaration = /export type (\w+) =([^;{}]*);/g;
  for (const match of source.matchAll(declaration)) {
    const values = splitTopLevel(match[2], "|");
    if (values.length === 0) continue;
    if (!values.every((value) => value.startsWith('"'))) continue;
    members.set(
      match[1],
      values.map((value) => value.replace(/"/g, "")),
    );
  }
  return members;
}

function renameType(type: string, direction: "generated" | "handwritten"): string {
  if (direction === "handwritten") return type;
  const stripped = type.replace(/\b(\w+)_(?:Serialize|Deserialize)\b/g, "$1");
  let renamed = stripped;
  for (const [from, to] of Object.entries(TYPE_ALIASES)) {
    renamed = renamed.replace(new RegExp(`\\b${from}\\b`, "g"), to);
  }
  return renamed;
}

function normalizeType(type: string, direction: "generated" | "handwritten"): string {
  let text = type.replace(/\s+/g, "");
  if (text.startsWith("(") && text.endsWith(")")) text = text.slice(1, -1);
  const parts = splitTopLevel(text, "|")
    .filter((part) => part !== "null" && part !== "undefined")
    .map((part) => {
      // `{[keyinstring]:string}` (specta) and `Record<string,string>` (frontend).
      const indexSignature = /^\{\[keyinstring\]:([^{}]+)\}$/.exec(part);
      return indexSignature ? `Record<string,${indexSignature[1]}>` : part;
    })
    .map((part) => renameType(part, direction));
  const normalized = [...new Set(parts)].sort().join("|");
  // The frontend declares `Array<X>` in a few places; specta emits `X[]`.
  const array = /^Array<(.+)>$/.exec(normalized);
  return (array ? `${array[1]}[]` : normalized) || "unknown";
}

const generatedSource = stripComments(readFileSync(GENERATED, "utf8"));
const handwrittenSource = stripComments(readFileSync(HANDWRITTEN, "utf8"));

const generatedObjects = objectShapes(generatedSource);
const handwrittenObjects = objectShapes(handwrittenSource);
const generatedUnions = taggedUnions(generatedSource, new Set(generatedObjects.keys()));
const handwrittenUnions = taggedUnions(handwrittenSource, new Set(handwrittenObjects.keys()));
const generatedMembers = unionMembers(generatedSource);
const handwrittenMembers = unionMembers(handwrittenSource);

function compareShapes(name: string, generated: Shape, handwritten: Shape): string[] {
  const problems: string[] = [];
  for (const [field, expected] of generated) {
    const actual = handwritten.get(field);
    if (!actual) {
      problems.push(`${name}.${field}: missing in src/types/index.ts`);
      continue;
    }
    if (NARROWED[`${name}.${field}`]) continue;
    const want = normalizeType(expected.type, "generated");
    const have = normalizeType(actual.type, "handwritten");
    if (want !== have) {
      problems.push(`${name}.${field}: generated ${want} != handwritten ${have}`);
    }
  }
  for (const field of handwritten.keys()) {
    if (!generated.has(field)) {
      problems.push(`${name}.${field}: not produced by the backend`);
    }
  }
  return problems;
}

describe("IPC bindings contract", () => {
  it("compares every generated object type with the handwritten one", () => {
    const problems: string[] = [];
    let compared = 0;
    for (const [generatedName, shape] of generatedObjects) {
      if (SKIPPED.has(generatedName)) continue;
      const name = RENAMED[generatedName] ?? generatedName;
      const handwritten = handwrittenObjects.get(name);
      if (!handwritten) {
        problems.push(`${name}: no matching interface in src/types/index.ts`);
        continue;
      }
      problems.push(...compareShapes(name, shape, handwritten));
      compared += 1;
    }
    expect(compared).toBeGreaterThan(30);
    expect(problems).toEqual([]);
  });

  it("compares every tagged union variant", () => {
    const problems: string[] = [];
    for (const [name, union] of generatedUnions) {
      if (SPECIAL_CASED.has(name)) continue;
      const handwritten = handwrittenUnions.get(name);
      if (!handwritten) {
        problems.push(`${name}: no matching tagged union in src/types/index.ts`);
        continue;
      }
      for (const [tag, shape] of union) {
        const other = handwritten.get(tag);
        if (!other) {
          problems.push(`${name}: variant "${tag}" missing from the frontend`);
          continue;
        }
        problems.push(...compareShapes(`${name}<${tag}>`, shape, other));
      }
      for (const tag of handwritten.keys()) {
        if (!union.has(tag)) problems.push(`${name}: variant "${tag}" is not produced`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("compares every enum union", () => {
    const problems: string[] = [];
    for (const [name, values] of generatedMembers) {
      const handwritten = handwrittenMembers.get(name);
      if (!handwritten) {
        problems.push(`${name}: no matching string union in src/types/index.ts`);
        continue;
      }
      if (values.join("|") !== handwritten.join("|")) {
        problems.push(
          `${name}: generated [${values.join(", ")}] != handwritten [${handwritten.join(", ")}]`,
        );
      }
    }
    expect(problems).toEqual([]);
  });

  it("keeps the error code union in sync with AppError", () => {
    const error = generatedUnions.get("AppError");
    expect(error).toBeDefined();
    const generatedCodes = [...(error ?? new Map()).keys()].sort();
    const handwrittenCodes = [...(handwrittenMembers.get("AppErrorCode") ?? [])].sort();
    expect(handwrittenCodes).toEqual(generatedCodes);
  });
});
