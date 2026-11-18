import { ScanNoticeSeverity, ScanWarning } from "@/types";

/**
 * One scan notice with the severity the UI will show.
 *
 * New scans carry `severity` and `root` from the backend: only the walk knows
 * the real root of each pass, and a full-disk scan therefore cannot be judged
 * from the joined `"C:\\, D:\\"` label the UI sees. For snapshots written by
 * older builds the field is missing; `classifyNotice` then reproduces the
 * backend rule conservatively, so an unreadable path is still reported as a
 * warning rather than being hidden as "info".
 */
export interface ClassifiedNotice extends ScanWarning {
  severity: ScanNoticeSeverity;
}

/** Windows-owned folders that never hold a cleanup target. */
const SYSTEM_SEGMENTS = new Set([
  "system volume information",
  "config.msi",
  "$recycle.bin",
  "recovery",
  "perflogs",
  "msocache",
  "$windows.~bt",
  "$windows.~ws",
  "boot",
]);

/** First component after the drive letter that is always Windows-owned. */
const SYSTEM_FIRST_COMPONENTS = new Set([
  "windows",
  "program files",
  "program files (x86)",
  "programdata",
]);

function isSystemProtected(path: string): boolean {
  const lower = path.replace(/\//g, "\\").toLowerCase();
  if (lower.includes("\\appdata\\local\\temp\\") || lower.includes("\\windows\\temp\\")) {
    return true;
  }
  const parts = lower.split("\\").filter(Boolean);
  if (parts.some((part) => SYSTEM_SEGMENTS.has(part))) return true;
  return parts.length > 1 && SYSTEM_FIRST_COMPONENTS.has(parts[1]);
}

/**
 * Fallback classifier for notices without a backend severity.
 *
 * Kept deliberately small: it only needs to avoid presenting expected Windows
 * skips as missing results. Anything that could be a real hole in the walk
 * stays a warning.
 */
export function classifyNotice(notice: ScanWarning): ScanNoticeSeverity {
  if (notice.severity === "info" || notice.severity === "warning" || notice.severity === "error") {
    return notice.severity;
  }
  if (notice.code === "DRIVE_SCAN_FAILED" || notice.code === "AGENT_SCAN_FAILED") {
    return "error";
  }
  if (!notice.path) {
    // HISTORY_WRITE_FAILED/ACCESS_DENIED without a path still affect trust.
    return notice.code === "HISTORY_WRITE_FAILED" || notice.code === "ACCESS_DENIED"
      ? "warning"
      : "info";
  }
  return isSystemProtected(notice.path) ? "info" : "warning";
}

export interface NoticeGroups {
  /** Expected skips; never presented as a problem. */
  info: ClassifiedNotice[];
  /** Real gaps: unreadable in-scope paths and blocked steps. */
  issues: ClassifiedNotice[];
  infoCount: number;
  warningCount: number;
  errorCount: number;
}

/** Groups notices by severity. Display order is errors, warnings, info. */
export function groupNotices(warnings: ScanWarning[]): NoticeGroups {
  const info: ClassifiedNotice[] = [];
  const issues: ClassifiedNotice[] = [];
  let warningCount = 0;
  let errorCount = 0;
  for (const warning of warnings) {
    const severity = classifyNotice(warning);
    const classified: ClassifiedNotice = { ...warning, severity };
    if (severity === "info") {
      info.push(classified);
    } else {
      issues.push(classified);
      if (severity === "error") errorCount += 1;
      else warningCount += 1;
    }
  }
  // Errors describe a blocked step, so they lead the list.
  issues.sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error"));
  return { info, issues, infoCount: info.length, warningCount, errorCount };
}

/**
 * Plain-text record of every notice, for the "copy details" action.
 *
 * Support needs the root and the code, not just the rendered sentence, so the
 * clipboard gets the machine-readable fields as well.
 */
export function formatNoticeDetails(notices: ClassifiedNotice[], includeSeverity = false): string {
  return notices
    .map((notice) => {
      const parts = [includeSeverity ? `[${notice.severity}]` : "", notice.code];
      if (notice.path) parts.push(notice.path);
      if (notice.root && notice.root !== notice.path) parts.push(`(root: ${notice.root})`);
      return parts.filter(Boolean).join(" ");
    })
    .join("\n");
}
