import { log } from "@/lib/logging";
import { maskPath } from "@/lib/format/path";

export interface ScanHistoryRecord {
  id: string;
  timestamp: string;
  scope: string;
  rootPath: string;
  itemCount: number;
  cleanableBytes: number;
  durationMs: number;
  /** `partial` means the scan finished early (limit/timeout), not a user cancel. */
  status: "completed" | "cancelled" | "partial";
  /** Kept alongside the status so older records and the banner can explain why. */
  stopReason?: string | null;
}

const NEW_STORAGE_KEY = "dev_cleaner_scan_history";
const LEGACY_STORAGE_KEY = "node_cleaner_scan_history";

/**
 * Same-tab change notification.
 *
 * The `storage` event only fires in *other* windows, so an open History view
 * never learned that the scan that just finished had been appended, nor that
 * another view cleared the persisted snapshot. Every writer dispatches this
 * event and readers listen to both channels.
 */
export const SCAN_HISTORY_CHANGED_EVENT = "dev_cleaner:scan-history-changed";

export function isScanHistoryStorageKey(key: string | null): boolean {
  return key === NEW_STORAGE_KEY || key === LEGACY_STORAGE_KEY;
}

function notifyScanHistoryChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SCAN_HISTORY_CHANGED_EVENT));
}

/** Hard cap so the list cannot grow without bound. */
const MAX_RECORDS = 50;
/** Records older than this are dropped on read. */
const MAX_AGE_DAYS = 90;

function isScanHistoryRecord(value: unknown): value is ScanHistoryRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Partial<ScanHistoryRecord>;
  return (
    typeof r.id === "string" &&
    typeof r.timestamp === "string" &&
    typeof r.scope === "string" &&
    typeof r.rootPath === "string" &&
    typeof r.itemCount === "number" &&
    typeof r.cleanableBytes === "number" &&
    typeof r.durationMs === "number" &&
    (r.status === "completed" || r.status === "cancelled" || r.status === "partial") &&
    (r.stopReason === undefined || r.stopReason === null || typeof r.stopReason === "string")
  );
}

function isFresh(record: ScanHistoryRecord): boolean {
  const parsed = Date.parse(record.timestamp);
  if (Number.isNaN(parsed)) return false;
  return Date.now() - parsed <= MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Why a read produced no rows. The three cases used to collapse into the same
 * empty array, so a broken file looked exactly like "nothing recorded yet" and
 * was never repaired.
 */
export type ScanHistoryStatus = "ok" | "empty" | "corrupt" | "unavailable";

export interface ScanHistoryState {
  records: ScanHistoryRecord[];
  status: ScanHistoryStatus;
}

/**
 * Reads the local scan history.
 *
 * A malformed entry must never wipe the list: entries are validated one by one,
 * expired ones are dropped, and only the newest `MAX_RECORDS` are returned. The
 * cleaned list is written back when rows were dropped, so a single bad line
 * cannot keep a stale file around forever; a file that cannot be parsed at all
 * is left untouched and reported as `corrupt` (deleting user data on a parse
 * error is worse than showing an empty list).
 */
export function readScanHistory(): ScanHistoryState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(NEW_STORAGE_KEY);
    if (!raw) {
      // Migrate from legacy key if exists
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        localStorage.setItem(NEW_STORAGE_KEY, legacy);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        raw = legacy;
      }
    }
  } catch (err) {
    // Storage unavailable (policy/privacy mode) is different from an empty
    // history: say so in the log so the view can explain the missing list.
    log.warn("Scan history storage is unavailable", err);
    return { records: [], status: "unavailable" };
  }
  if (!raw) return { records: [], status: "empty" };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("Stored scan history is not an array");
    const kept = parsed.filter(isScanHistoryRecord).filter(isFresh);
    const records = kept
      .slice(0, MAX_RECORDS)
      // Heal records written by older builds before the write-side mask.
      .map((record) => ({ ...record, rootPath: maskPath(record.rootPath) }));

    // Rewrite when reading dropped rows *or* changed a value: the old check only
    // compared lengths, so a file whose only problem was an unmasked account
    // name was never repaired and the raw path stayed on disk.
    const healed = records.some((record, index) => record.rootPath !== kept[index]?.rootPath);
    if (records.length !== parsed.length || healed) {
      try {
        localStorage.setItem(NEW_STORAGE_KEY, JSON.stringify(records));
      } catch {
        // The healed list is still returned; persistence is best-effort.
      }
    }
    return { records, status: records.length > 0 ? "ok" : "empty" };
  } catch (err) {
    // Corrupt JSON is a real data problem, not "no history yet".
    log.warn("Stored scan history is corrupt and was ignored", err);
    return { records: [], status: "corrupt" };
  }
}

/** Records-only compatibility wrapper for callers that do not need the status. */
export function getScanHistory(): ScanHistoryRecord[] {
  return readScanHistory().records;
}

export function appendScanHistory(record: ScanHistoryRecord): void {
  try {
    const list = getScanHistory();
    // The history file is long-lived local data that ends up in support
    // bundles and backups. Storage must not depend on the current UI privacy
    // setting: mask the account segment before it is ever written.
    const stored: ScanHistoryRecord = { ...record, rootPath: maskPath(record.rootPath) };
    const updated = [stored, ...list.filter((x) => x.id !== record.id)].slice(0, MAX_RECORDS);
    localStorage.setItem(NEW_STORAGE_KEY, JSON.stringify(updated));
    notifyScanHistoryChanged();
  } catch (err) {
    // Quota or privacy mode: the history is a convenience, never a hard failure.
    log.warn("Could not save scan history", err);
  }
}

/** Returns `false` when storage refused the deletion, so the caller cannot
 * report a success that a reload will contradict. */
export function clearScanHistory(): boolean {
  try {
    localStorage.removeItem(NEW_STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    notifyScanHistoryChanged();
    return true;
  } catch (err) {
    log.warn("Could not clear scan history", err);
    return false;
  }
}
