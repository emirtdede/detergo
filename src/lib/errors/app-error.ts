import { AppErrorDto } from "@/types";

/**
 * Normalises anything thrown across the Tauri boundary into the DTO the UI
 * renders.
 *
 * `invoke` rejects with the serialised `AppError` object, but a JS bug or a
 * mocked command can reject with a string or a plain `Error`. Storing the DTO
 * instead of a pre-formatted string keeps the user-facing language switchable
 * and lets every screen localize the same code identically.
 */
export function toAppError(err: unknown): AppErrorDto {
  if (err && typeof err === "object") {
    const candidate = err as { code?: unknown; message?: unknown };
    if (typeof candidate.code === "string") {
      return {
        code: candidate.code as AppErrorDto["code"],
        message: typeof candidate.message === "string" ? candidate.message : String(err),
      };
    }
    if (err instanceof Error) {
      return { code: "Unknown", message: err.message };
    }
  }
  return { code: "Unknown", message: typeof err === "string" ? err : String(err) };
}
