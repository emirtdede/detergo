import { localizeAppError } from "@/lib/ui-text";

/**
 * Routes backend errors through the shared localizer. Returning `err.message`
 * verbatim would surface untranslated English diagnostics in the UI.
 */
export function describeError(err: unknown): string {
  return localizeAppError(err);
}
