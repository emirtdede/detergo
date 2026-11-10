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

function emit(level: Level, args: unknown[]): void {
  if (!isDev && level !== "warn" && level !== "error") return;
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  sink(PREFIX, ...args);
}

export const log = {
  debug: (...args: unknown[]): void => emit("debug", args),
  info: (...args: unknown[]): void => emit("info", args),
  warn: (...args: unknown[]): void => emit("warn", args),
  error: (...args: unknown[]): void => emit("error", args),
};
