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
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendScanHistory(record: ScanHistoryRecord): void {
  try {
    const list = getScanHistory();
    const updated = [record, ...list.filter((x) => x.id !== record.id)].slice(0, 50);
    localStorage.setItem(NEW_STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn("Could not save scan history:", err);
  }
}

export function clearScanHistory(): void {
  try {
    localStorage.removeItem(NEW_STORAGE_KEY);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {}
}

