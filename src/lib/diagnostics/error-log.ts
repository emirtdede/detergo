import { redactSecrets } from "@/lib/logging";

/**
 * Local, opt-out-free error log.
 *
 * The product promise is that no crash report leaves the machine, so this log
 * is deliberately storage-only: it lives in `localStorage`, survives a reload,
 * and is shown to the user in Settings > About. Nothing here talks to a server.
 *
 * Two rules keep it safe to show and to attach to a public issue:
 *  - every message goes through the same sanitiser the console logger uses, so
 *    absolute paths, account names and webhook URLs are masked;
 *  - stacks are never stored. A stack names internal modules and can embed
 *    absolute paths; a masked message plus the version is enough to triage.
 */

export type ErrorLogSource = "render" | "window" | "promise" | "command";

export interface ErrorLogEntry {
  id: string;
  /** ISO-8601 timestamp. */
  at: string;
  source: ErrorLogSource;
  /** Backend error code (`AppErrorDto.code`) when the failure carried one. */
  code: string | null;
  /** Masked, truncated message. */
  message: string;
}

/** Newest-first ring buffer; the panel renders at most this many rows. */
export const ERROR_LOG_LIMIT = 20;
export const ERROR_LOG_STORAGE_KEY = "detergo.error-log.v1";

const MAX_MESSAGE_CHARS = 400;

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // A locked-down WebView can throw on access itself.
    return null;
  }
}

function isSource(value: unknown): value is ErrorLogSource {
  return value === "render" || value === "window" || value === "promise" || value === "command";
}

function isEntry(value: unknown): value is ErrorLogEntry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ErrorLogEntry>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.at === "string" &&
    !Number.isNaN(Date.parse(candidate.at)) &&
    isSource(candidate.source) &&
    (candidate.code === null || typeof candidate.code === "string") &&
    typeof candidate.message === "string"
  );
}

/** Reads the log, dropping anything that does not match the stored shape. */
export function readErrorLog(storage: Storage | null = safeStorage()): ErrorLogEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(ERROR_LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).slice(0, ERROR_LOG_LIMIT);
  } catch {
    // Corrupt JSON must not break the page that reports errors.
    return [];
  }
}

function writeErrorLog(entries: ErrorLogEntry[], storage: Storage | null = safeStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(ERROR_LOG_STORAGE_KEY, JSON.stringify(entries.slice(0, ERROR_LOG_LIMIT)));
  } catch {
    // Quota or private mode: the log is best-effort, never fatal.
  }
}

interface ExtractedError {
  code: string | null;
  message: string;
}

/** Normalises the several shapes an error can arrive in. */
function extractError(error: unknown): ExtractedError {
  if (typeof error === "string") {
    return { code: null, message: error };
  }
  if (error instanceof Error) {
    return { code: null, message: error.message || error.name };
  }
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown; reason?: unknown };
    if (candidate.reason !== undefined) return extractError(candidate.reason);
    const message =
      typeof candidate.message === "string"
        ? candidate.message
        : typeof candidate.code === "string"
          ? candidate.code
          : "";
    if (message) {
      return {
        code: typeof candidate.code === "string" ? candidate.code : null,
        message,
      };
    }
  }
  if (error === undefined || error === null) return { code: null, message: "" };
  try {
    return { code: null, message: JSON.stringify(error) };
  } catch {
    return { code: null, message: "Unserializable error" };
  }
}

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Older WebView2 builds lack randomUUID.
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Appends one masked entry. Returns the stored entry, or `null` when the same
 * failure is already at the top of the log (a render loop would otherwise fill
 * the entire buffer with one error).
 */
export function recordError(
  source: ErrorLogSource,
  error: unknown,
  now: Date = new Date(),
): ErrorLogEntry | null {
  const extracted = extractError(error);
  const message = redactSecrets(extracted.message).slice(0, MAX_MESSAGE_CHARS);
  if (!message) return null;

  const entries = readErrorLog();
  const newest = entries[0];
  if (newest && newest.source === source && newest.message === message) {
    return null;
  }

  const entry: ErrorLogEntry = {
    id: newId(),
    at: now.toISOString(),
    source,
    code: extracted.code,
    message,
  };
  writeErrorLog([entry, ...entries]);
  return entry;
}

export function clearErrorLog(storage: Storage | null = safeStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(ERROR_LOG_STORAGE_KEY);
  } catch {
    // Nothing else to do; the panel re-reads the store anyway.
  }
}

/** Plain-text rendering for the clipboard and a pre-filled issue body. */
export function formatErrorLog(entries: readonly ErrorLogEntry[]): string {
  return entries
    .map((entry) => {
      const code = entry.code ? ` ${entry.code}:` : "";
      return `[${entry.at}] (${entry.source})${code} ${entry.message}`;
    })
    .join("\n");
}

let installed = false;

/**
 * Captures uncaught errors and unhandled promise rejections for the whole
 * window. Returns a disposer so tests (and a hot reload) can detach it.
 *
 * `error` events also fire for failed resource loads; those carry no `error`
 * object and describe a missing file rather than a crash, so they are skipped.
 */
export function installErrorLogCapture(target: Window = window): () => void {
  if (installed) return () => undefined;
  installed = true;

  const onError = (event: ErrorEvent) => {
    if (!event.error) return;
    recordError("window", event.error);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    recordError("promise", event.reason);
  };

  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);

  return () => {
    installed = false;
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
