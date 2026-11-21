/**
 * Local system message ring buffer.
 *
 * `log.warn`/`log.error` only reached the WebView console, which a user cannot
 * read and a release build largely discards. Settings > Diagnostics needs those
 * messages on screen and inside the support bundle, so the logger mirrors them
 * here.
 *
 * Same rules as the error log: storage only, newest first, bounded, and every
 * payload has already passed through the logger's sanitizer (paths masked,
 * webhook URLs reduced to their origin).
 */

export type SystemLogLevel = "info" | "warn" | "error";

export interface SystemLogEntry {
  id: string;
  at: string;
  level: SystemLogLevel;
  message: string;
}

export const SYSTEM_LOG_LIMIT = 100;
export const SYSTEM_LOG_STORAGE_KEY = "detergo.system-log.v1";

const MAX_MESSAGE_CHARS = 500;

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isLevel(value: unknown): value is SystemLogLevel {
  return value === "info" || value === "warn" || value === "error";
}

function isEntry(value: unknown): value is SystemLogEntry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SystemLogEntry>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.at === "string" &&
    !Number.isNaN(Date.parse(candidate.at)) &&
    isLevel(candidate.level) &&
    typeof candidate.message === "string"
  );
}

export function readSystemLog(storage: Storage | null = safeStorage()): SystemLogEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(SYSTEM_LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).slice(0, SYSTEM_LOG_LIMIT);
  } catch {
    return [];
  }
}

function writeSystemLog(entries: SystemLogEntry[], storage: Storage | null = safeStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(SYSTEM_LOG_STORAGE_KEY, JSON.stringify(entries.slice(0, SYSTEM_LOG_LIMIT)));
  } catch {
    // Quota or private mode: best effort only.
  }
}

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Older WebView2 builds.
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Serializes already-sanitized logger arguments into one readable line. */
function serialize(args: readonly unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      if (arg instanceof Error) return arg.message;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE_CHARS);
}

export function recordSystemMessage(
  level: SystemLogLevel,
  args: readonly unknown[],
  now: Date = new Date(),
): SystemLogEntry | null {
  const message = serialize(args);
  if (!message) return null;

  const entries = readSystemLog();
  const newest = entries[0];
  if (newest && newest.level === level && newest.message === message) {
    return null;
  }

  const entry: SystemLogEntry = {
    id: newId(),
    at: now.toISOString(),
    level,
    message,
  };
  writeSystemLog([entry, ...entries]);
  return entry;
}

export function clearSystemLog(storage: Storage | null = safeStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(SYSTEM_LOG_STORAGE_KEY);
  } catch {
    // Nothing else to do.
  }
}

/** Plain-text rendering for the clipboard, the bundle and the mail body. */
export function formatSystemLog(entries: readonly SystemLogEntry[]): string {
  return entries.map((entry) => `[${entry.at}] (${entry.level}) ${entry.message}`).join("\n");
}
