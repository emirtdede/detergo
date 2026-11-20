import { BUG_REPORT_TEMPLATE, NEW_ISSUE_URL } from "@/lib/links";
import { formatErrorLog, type ErrorLogEntry } from "./error-log";

/** The issue body is a URL parameter, so it must stay well under 8 KB. */
export const MAX_ISSUE_BODY = 6000;

export function buildIssueUrl(entries: readonly ErrorLogEntry[], version: string): string {
  const logText = formatErrorLog(entries);
  const body = [
    "### What happened",
    "<!-- Describe what you were doing when the problem appeared. -->",
    "",
    "### Environment",
    `- Dev Cleaner: ${version}`,
    `- Platform: ${navigator.platform || "unknown"}`,
    "",
    "### In-app error log",
    "<!-- Written locally by the app. Paths and URLs are already masked. -->",
    "```",
    logText.slice(0, MAX_ISSUE_BODY),
    "```",
  ].join("\n");

  const params = new URLSearchParams({
    template: BUG_REPORT_TEMPLATE,
    title: "[Bug] ",
    body,
  });
  return `${NEW_ISSUE_URL}?${params.toString()}`;
}

export function formatDiagnosticTime(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return date.toLocaleString(locale, { dateStyle: "short", timeStyle: "medium" });
  } catch {
    return iso;
  }
}
