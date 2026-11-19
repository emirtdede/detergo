import { maskPath } from "@/lib/format/path";
import { recordSystemMessage } from "@/lib/diagnostics/system-log";

/**
 * Minimal level-aware logger.
 *
 * Frontend code must not depend on `console` directly for three reasons:
 *  - production builds should not spam the WebView console,
 *  - a support run needs a stable prefix to grep for,
 *  - tests can silence output without monkey-patching globals.
 *
 * In development everything is forwarded to the console. In production only
 * warnings and errors are kept, and they are prefixed so they appear in the
 * WebView2 console log a user can attach to a bug report.
 *
 * Because that log is attached to bug reports, every payload is sanitized
 * first: an `AppErrorDto` may carry an absolute path or a credential-bearing
 * webhook URL, and a raw `Error` may carry both. Only the code, a masked
 * message and a redacted origin are allowed to reach the console.
 */

type Level = "debug" | "info" | "warn" | "error";

const isDev = (() => {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
})();

const PREFIX = "[dev-cleaner]";

/** Keeps the scheme/host of a URL but drops the path, query and fragment. */
function redactUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (!parsed.protocol.startsWith("http")) return value;
    return parsed.port
      ? `${parsed.protocol}//${parsed.hostname}:${parsed.port}`
      : `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    return value;
  }
}

/**
 * Masks account names and redacts any absolute http(s) URL embedded in a free
 * string. Webhook paths are bearer credentials, so the origin is the only part
 * that may be logged.
 */
export function redactSecrets(value: string): string {
  const withoutUrls = value.replace(/https?:\/\/[^\s"'<>]+/gi, (match) => redactUrl(match));
  return maskPath(withoutUrls);
}

function sanitize(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (value instanceof Error) {
    return { name: value.name, message: redactSecrets(value.message) };
  }
  if (value && typeof value === "object") {
    if (depth >= 2) return "[object]";
    const candidate = value as { code?: unknown; message?: unknown };
    // Backend DTOs (the common case) keep their machine-readable code and a
    // masked message; everything else is stringified shallowly.
    if (typeof candidate.code === "string" || typeof candidate.message === "string") {
      return {
        code: typeof candidate.code === "string" ? candidate.code : undefined,
        message:
          typeof candidate.message === "string" ? redactSecrets(candidate.message) : undefined,
      };
    }
    try {
      return JSON.parse(JSON.stringify(value), (_key, child) =>
        typeof child === "string" ? redactSecrets(child) : child,
      );
    } catch {
      return "[unserializable]";
    }
  }
  return value;
}

function emit(level: Level, args: unknown[]): void {
  const sanitized = args.map((arg) => sanitize(arg));
  // Diagnostics mirrors everything except debug noise. Recording happens even
  // when production suppresses the console line: the point is to let the user
  // read it in Settings > Diagnostics.
  if (level !== "debug") {
    recordSystemMessage(level, sanitized);
  }
  if (!isDev && level !== "warn" && level !== "error") return;
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  sink(PREFIX, ...sanitized);
}

export const log = {
  debug: (...args: unknown[]): void => emit("debug", args),
  info: (...args: unknown[]): void => emit("info", args),
  warn: (...args: unknown[]): void => emit("warn", args),
  error: (...args: unknown[]): void => emit("error", args),
};
