import { log } from "@/lib/logging";

export interface ScanHistoryRecord {
  id: string;
  timestamp: string;
  scope: string;
  rootPath: string;
  itemCount: number;
  cleanableBytes: number;
  durationMs: number;
  status: "completed" | "cancelled";
}

const NEW_STORAGE_KEY = "dev_cleaner_scan_history";
const LEGACY_STORAGE_KEY = "node_cleaner_scan_history";

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
    (r.status === "completed" || r.status === "cancelled")
  );
}

function isFresh(record: ScanHistoryRecord): boolean {
  const parsed = Date.parse(record.timestamp);
  if (Number.isNaN(parsed)) return false;
  return Date.now() - parsed <= MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Reads the local scan history.
 *
 * A malformed entry must never wipe the list: entries are validated one by one,
 * expired ones are dropped, and only the newest `MAX_RECORDS` are returned.
 */
export function getScanHistory(): ScanHistoryRecord[] {
  try {
    let raw = localStorage.getItem(NEW_STORAGE_KEY);
    if (!raw) {
      // Migrate from legacy key if exists
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        localStorage.setItem(NEW_STORAGE_KEY, legacy);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        raw = legacy;
      }
    }
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isScanHistoryRecord).filter(isFresh).slice(0, MAX_RECORDS);
  } catch {
    return [];
  }
}

export function appendScanHistory(record: ScanHistoryRecord): void {
  try {
    const list = getScanHistory();
    const updated = [record, ...list.filter((x) => x.id !== record.id)].slice(0, MAX_RECORDS);
    localStorage.setItem(NEW_STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    // Quota or privacy mode: the history is a convenience, never a hard failure.
    log.warn("Could not save scan history", err);
  }
}

export function clearScanHistory(): void {
  try {
    localStorage.removeItem(NEW_STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Nothing to do: the key is already gone or storage is unavailable.
  }
}
