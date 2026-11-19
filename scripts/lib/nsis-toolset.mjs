/**
 * Locates the NSIS toolset that the Tauri bundler installs.
 *
 * The bundler downloads it on demand into `%LOCALAPPDATA%\tauri\NSIS`, and both
 * the language sync and the "is it installed?" check have to agree on that
 * path. `LOCALAPPDATA` is overridable so a CI runner with a relocated profile
 * still works.
 */
import { homedir } from "node:os";
import { join } from "node:path";

export function tauriToolsDir() {
  return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "tauri");
}

export function nsisToolsetDir() {
  return join(tauriToolsDir(), "NSIS");
}

export function nsisLanguageDir() {
  return join(nsisToolsetDir(), "Contrib", "Language files");
}
