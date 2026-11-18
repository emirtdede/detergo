// One-off codemod: specta-typescript 0.0.15 refuses to export 64-bit integers
// (it cannot prove precision), so every 64-bit field in a type that crosses the
// IPC boundary is remapped to `specta_typescript::Number`, which exports as the
// TypeScript `number` the frontend already uses.
//
// The override is applied per field, not per struct, so `Option<u64>` becomes
// `Option<Number<u64>>` and keeps its `| null` in the generated contract.
//
// Only declarations that already carry the opt-in specta derive are touched, so
// internal structs keep their real `u64` fields.
//
// Idempotent: re-running adds nothing.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("src-tauri/src");
const DERIVE = '#[cfg_attr(feature = "bindings", derive(specta::Type))]';
const WIDE_INT = /\b(u64|i64|usize|isize)\b/;
const FIELD = /^(\s+)(pub )?([a-z_][a-z0-9_]*): (.+),$/;

function braceDelta(line) {
  let delta = 0;
  for (const character of line) {
    if (character === "{") delta += 1;
    else if (character === "}") delta -= 1;
  }
  return delta;
}

function attributeFor(type) {
  const inner = type.trim();
  const optional = /^Option\s*<(.+)>$/.exec(inner);
  const wrapped = optional
    ? `Option<specta_typescript::Number<${optional[1].trim()}>>`
    : `specta_typescript::Number<${inner}>`;
  return `#[cfg_attr(feature = "bindings", specta(type = ${wrapped}))]`;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "target" ? [] : walk(full);
    return entry.name.endsWith(".rs") ? [full] : [];
  });
}

let added = 0;
for (const file of walk(root)) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const output = [];
  let pending = false;
  let bodyDepth = 0;
  let previous = "";

  for (const line of lines) {
    if (bodyDepth > 0) {
      const field = FIELD.exec(line);
      if (field && WIDE_INT.test(field[4])) {
        const attribute = attributeFor(field[4]);
        if (previous.trim() !== attribute) {
          output.push(attribute);
          added += 1;
        }
      }
      output.push(line);
      previous = line;
      bodyDepth += braceDelta(line);
      continue;
    }

    output.push(line);
    previous = line;

    if (line.trim() === DERIVE) {
      pending = true;
      continue;
    }
    if (!pending) continue;

    if (/^pub (struct|enum) \w+/.test(line)) {
      pending = false;
      bodyDepth = braceDelta(line);
      continue;
    }
    if (/^pub /.test(line)) pending = false;
  }

  fs.writeFileSync(file, output.join("\n"));
}

console.log(`added ${added} 64-bit field remaps`);
