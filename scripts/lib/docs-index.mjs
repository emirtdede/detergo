/**
 * Documentation search index builder.
 *
 * The documentation body is authored as JSX components, not as data. Searching
 * only the topic titles and keyword lists therefore missed every phrase that
 * appears in the article body ("TOCTOU", "Recycle Bin", "GitHub Actions").
 *
 * This module derives the searchable strings from the component source at build
 * time so the 107 KB of `?raw` JSX no longer ships to the browser:
 *
 *  - the source is split on each `activeTopicId === "…"` branch;
 *  - every `t("…")` literal is taken as an English source string;
 *  - the remaining visible text nodes are kept for the Turkish component, which
 *    ships plain JSX text instead of a dictionary.
 *
 * Locale-specific enrichment (adding the translated term from
 * `docs-locales/*.json`) still happens at runtime, where the active dictionary
 * is known. Keep these functions dependency-free so the generator and its test
 * can import them directly.
 */

/**
 * Removes JSX expression containers (`{…}`) including nested braces, arrow
 * functions and quoted strings. A naive `\{[^{}]*\}` regex used to leave code
 * fragments such as `setCliPath(e.target.value)}` in the index.
 */
function stripBraceExpressions(text) {
  let out = "";
  let depth = 0;
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (depth === 0) {
      if (ch === "{") depth = 1;
      else out += ch;
      continue;
    }
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
  }
  return out;
}

/** Removes JSX tags, including `>` characters inside attribute strings. */
function stripTags(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "<") {
      out += text[i];
      i += 1;
      continue;
    }
    let quote = null;
    i += 1;
    while (i < text.length) {
      const ch = text[i];
      if (quote) {
        if (ch === "\\") i += 1;
        else if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        i += 1;
        break;
      }
      i += 1;
    }
    out += " ";
  }
  return out;
}

/** Extract visible literals from an `activeTopicId === "id"` branch. */
export function extractTopicStrings(chunk) {
  const values = [];

  // `t("…")` literals hold all English body copy.
  const literalPattern = /\bt\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g;
  let match;
  while ((match = literalPattern.exec(chunk)) !== null) {
    const text = match[1].replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\n/g, " ").trim();
    if (text) values.push(text);
  }

  // Plain text nodes: everything between tags, with expressions removed. This
  // is what the Turkish component relies on. Cut everything before the first
  // tag first: the split above starts at `activeTopicId === "…"`, which is code,
  // not body text.
  const firstTag = chunk.indexOf("<");
  const body = firstTag === -1 ? "" : chunk.slice(firstTag);
  const textNodes = stripTags(stripBraceExpressions(body))
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (textNodes) values.push(textNodes);

  return values;
}

/** Split a content component into `topicId -> source chunk`. */
export function splitTopics(source) {
  const marker = /activeTopicId\s*===\s*"([^"]+)"/g;
  const chunks = [];
  let match;
  while ((match = marker.exec(source)) !== null) {
    chunks.push({ id: match[1], start: match.index });
  }

  const result = {};
  for (let index = 0; index < chunks.length; index += 1) {
    const { id, start } = chunks[index];
    const end = index + 1 < chunks.length ? chunks[index + 1].start : source.length;
    // A topic can appear more than once (e.g. shared fragments); concatenating
    // keeps every body string searchable.
    result[id] = `${result[id] ?? ""} ${source.slice(start, end)}`;
  }
  return result;
}

/**
 * Build the per-locale string index.
 *
 * `sources` maps a component locale (`en`, `tr`) to its raw file contents. The
 * result is `{ en: { topicId: string[] }, tr: { … } }` with sorted keys so the
 * generated file is deterministic and the sync test can compare text.
 */
export function buildDocsIndex(sources) {
  const index = {};
  for (const locale of Object.keys(sources).sort()) {
    const chunks = splitTopics(sources[locale] ?? "");
    const topics = {};
    for (const topicId of Object.keys(chunks).sort()) {
      const strings = extractTopicStrings(chunks[topicId]);
      // De-duplicate while preserving reading order.
      topics[topicId] = Array.from(new Set(strings));
    }
    index[locale] = topics;
  }
  return index;
}

/** Serialize an index the exact way the generator writes it. */
export function serializeDocsIndex(index) {
  return `${JSON.stringify(index, null, 2)}\n`;
}
