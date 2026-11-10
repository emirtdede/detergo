/**
 * Tiny SVG helpers shared by the generator and the structural checks.
 * Deliberately dependency-free: these run on Linux CI too.
 */

function findOpeningTag(svg, attribute) {
  const match = new RegExp(`<g\\b[^>]*${attribute}[^>]*>`).exec(svg);
  if (!match) return null;
  return { start: match.index, end: match.index + match[0].length };
}

/**
 * Remove a top-level <g data-layer="..."> block, including nested groups.
 *
 * @param {string} svg
 * @param {string} layer
 * @returns {string}
 */
export function stripDataLayer(svg, layer) {
  const opening = findOpeningTag(svg, `data-layer="${layer}"`);
  if (!opening) return svg;

  const tagPattern = /<g\b[^>]*>|<\/g>/g;
  tagPattern.lastIndex = opening.start;
  let depth = 0;
  let match;
  while ((match = tagPattern.exec(svg)) !== null) {
    if (match[0] === "</g>") {
      depth -= 1;
      if (depth === 0) {
        const end = match.index + match[0].length;
        return `${svg.slice(0, opening.start)}${svg.slice(end)}`;
      }
    } else {
      depth += 1;
    }
  }
  throw new Error(`Unclosed <g data-layer="${layer}"> block`);
}

/**
 * Read the path data of the canonical mark group.
 *
 * @param {string} svg
 * @returns {{ paths: string[], markup: string }}
 */
export function extractGlyph(svg) {
  const opening = findOpeningTag(svg, 'data-glyph="mark"');
  if (!opening) throw new Error('Master SVG has no <g data-glyph="mark"> group');

  const tagPattern = /<g\b[^>]*>|<\/g>/g;
  tagPattern.lastIndex = opening.start;
  let depth = 0;
  let end = -1;
  let match;
  while ((match = tagPattern.exec(svg)) !== null) {
    if (match[0] === "</g>") {
      depth -= 1;
      if (depth === 0) {
        end = match.index + match[0].length;
        break;
      }
    } else {
      depth += 1;
    }
  }
  if (end < 0) throw new Error('Unclosed <g data-glyph="mark"> group');

  const markup = svg.slice(opening.start, end);
  const paths = [...markup.matchAll(/\bd="([^"]+)"/g)].map((pathMatch) => pathMatch[1]);
  if (paths.length === 0) throw new Error("Canonical mark has no path data");
  return { paths, markup };
}

/**
 * Return the inner markup of an SVG document (without the root element).
 *
 * @param {string} svg
 */
export function innerSvg(svg) {
  const start = svg.indexOf(">");
  const end = svg.lastIndexOf("</svg>");
  if (start < 0 || end < 0) throw new Error("SVG root element is not closed");
  return svg.slice(start + 1, end);
}
