/**
 * Webhook URL validation shared by the settings UI and the preferences store.
 *
 * A webhook is delivered by the backend, so a URL that the browser would never
 * accept must not reach the settings file. Keep the rules deliberately narrow:
 * only absolute `http`/`https` URLs with a real host are meaningful, and a
 * half-typed value (for example `https://`) must never be persisted.
 */
export type WebhookUrlValidation =
  | { ok: true; value: string | null }
  | { ok: false; reason: "invalid" };

// The backend refuses loopback/private webhook targets and pins DNS answers
// before connecting. The settings form mirrors the literal-host part of that
// policy so a user gets immediate feedback instead of saving a URL that every
// delivery will reject. DNS-dependent checks stay on the backend, which is the
// only place they can be enforced safely.
const LOCAL_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

function parseIPv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

function isForbiddenIPv4(octets: number[]): boolean {
  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/** Expands an IPv6 literal into eight hextets, or returns null. */
function parseIPv6(host: string): number[] | null {
  let text = host.toLowerCase();
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);
  if (!text.includes(":")) return null;

  // Rewrite an embedded dotted-quad tail as two hextets so the rest of the
  // parser only has to understand the hex form.
  const lastColon = text.lastIndexOf(":");
  const lastGroup = text.slice(lastColon + 1);
  if (lastGroup.includes(".")) {
    const v4 = parseIPv4(lastGroup);
    if (!v4) return null;
    const high = ((v4[0] << 8) | v4[1]).toString(16);
    const low = ((v4[2] << 8) | v4[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const parseGroups = (segment: string): number[] | null => {
    if (segment === "") return [];
    const groups: number[] = [];
    for (const group of segment.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      groups.push(parseInt(group, 16));
    }
    return groups;
  };

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const left = parseGroups(halves[0]);
  const right = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (!left || !right) return null;

  const known = left.length + right.length;
  if (halves.length === 1) {
    return known === 8 ? left : null;
  }
  // A `::` must stand for at least one zero hextet.
  if (known > 7) return null;
  return [...left, ...new Array(8 - known).fill(0), ...right];
}

function isForbiddenIPv6(groups: number[]): boolean {
  const [a, b, c, d, e, f, g, h] = groups;
  if (groups.every((group) => group === 0)) return true; // ::
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0 && g === 0 && h === 1) {
    return true; // ::1
  }
  if ((a & 0xfe00) === 0xfc00) return true; // unique local (fc00::/7)
  if ((a & 0xffc0) === 0xfe80) return true; // link-local (fe80::/10)
  if ((a & 0xff00) === 0xff00) return true; // multicast (ff00::/8)

  const embedded = (high: number, low: number) =>
    isForbiddenIPv4([(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff]);

  // IPv4-mapped/compatible literals inherit the IPv4 policy.
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && (f === 0 || f === 0xffff)) {
    return embedded(g, h);
  }
  // 6to4 embeds the destination IPv4 address in the second and third hextets.
  if (a === 0x2002) return embedded(b, c);
  // Teredo embeds the client IPv4 address XORed with 0xffffffff.
  if (a === 0x2001 && b === 0) {
    return isForbiddenIPv4([(~g >> 8) & 0xff, ~g & 0xff, (~h >> 8) & 0xff, ~h & 0xff]);
  }
  return false;
}

function isForbiddenHostname(hostname: string): boolean {
  const host = hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.$/, "");
  if (host === "localhost" || LOCAL_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return true;
  }
  const v4 = parseIPv4(host);
  if (v4) return isForbiddenIPv4(v4);
  const v6 = parseIPv6(host);
  if (v6) return isForbiddenIPv6(v6);
  return false;
}

export function normalizeWebhookUrl(raw: unknown): WebhookUrlValidation {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, reason: "invalid" };

  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };

  // `new URL` is the same WHATWG parser the rest of the app uses; it rejects
  // whitespace, relative paths and unknown schemes without custom regexes.
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "invalid" };
  }
  if (!parsed.hostname) return { ok: false, reason: "invalid" };
  // A webhook is delivered by the backend, so a loopback destination would let
  // a remote config turn the app into a local network proxy (SSRF).
  if (isForbiddenHostname(parsed.hostname)) {
    return { ok: false, reason: "invalid" };
  }

  return { ok: true, value: parsed.toString() };
}

/** Convenience predicate for callers that only need a yes/no answer. */
export function isValidWebhookUrl(raw: unknown): boolean {
  return normalizeWebhookUrl(raw).ok;
}
