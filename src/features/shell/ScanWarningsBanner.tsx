import React, { useMemo } from "react";

import { AlertCircle, AlertTriangle, ClipboardCopy, Info, X } from "lucide-react";

import { IconButton } from "@/components/primitives/IconButton";
import { useScanStore } from "@/stores/scan-store";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore } from "@/stores/ui-store";
import { localizeWarningCode, useUIText } from "@/lib/ui-text";
import { maskPath, truncatePath } from "@/lib/format/path";

import { formatNoticeDetails, groupNotices } from "./scan-notice";

import "./stale-scan.css";

/**
 * Surfaces the notices a finished scan produced, split by severity.
 *
 * A full-disk scan always skips Windows-owned folders. Presenting those as
 * "warnings" made a healthy scan look like it had failed and pushed the user to
 * "check permissions" for folders they must not own. The backend therefore
 * classifies every notice; this component renders the two groups separately:
 *
 * - Issues (warning/error): a real gap that can hide cleanup targets.
 * - Information: an expected skip, collapsed and explicitly harmless.
 */
export const ScanWarningsBanner: React.FC = () => {
  const ui = useUIText();
  const status = useScanStore((s) => s.status);
  const warnings = useScanStore((s) => s.warnings);
  const warningsTotal = useScanStore((s) => s.warningsTotal);
  const summary = useScanStore((s) => s.summary);
  const allDismissed = useScanStore((s) => s.noticesBannerDismissed);
  const infoDismissed = useScanStore((s) => s.noticesInfoDismissed);
  const issuesDismissed = useScanStore((s) => s.noticesIssuesDismissed);
  const dismissInfo = useScanStore((s) => s.dismissInfoNotices);
  const dismissIssues = useScanStore((s) => s.dismissIssueNotices);
  const showToast = useUiStore((s) => s.showToast);
  const maskPaths = usePreferencesStore((s) => s.maskPaths);
  const maxDepth = usePreferencesStore((s) => s.maxDepth);

  const groups = useMemo(() => groupNotices(warnings), [warnings]);

  // A running scan has no final notice set yet; a cancelled scan is already
  // explained by its own state. Only finished results get this notice.
  const finished = status === "completed" || status === "partial";
  const depthLimited = finished && summary?.stopReason === "depth-limit";

  if (!finished) return null;

  const showIssues = groups.issues.length > 0 && !allDismissed && !issuesDismissed;
  // The depth limit is a configured stop, so it belongs with the expected
  // skips rather than with unreadable paths.
  const showInfo = (groups.info.length > 0 || depthLimited) && !allDismissed && !infoDismissed;
  if (!showIssues && !showInfo) return null;

  const renderPath = (path?: string | null) =>
    path ? truncatePath(maskPaths ? maskPath(path) : path, 72) : ui.common.none;

  // The store caps the list at `MAX_SCAN_WARNINGS`; say so instead of claiming
  // the capped length is the number of problems found.
  const visibleTotal = warnings.length;
  const capped = visibleTotal < warningsTotal;

  const copyDetails = async () => {
    const text = formatNoticeDetails([...groups.issues, ...groups.info], true);
    try {
      await navigator.clipboard.writeText(text);
      showToast(ui.overview.detailsCopied, "success");
    } catch {
      // A denied clipboard is not worth an error dialog; the list stays visible.
      showToast(ui.errors.title, "error");
    }
  };

  const issueHeading =
    groups.errorCount > 0 && groups.warningCount > 0
      ? `${ui.overview.errors}: ${groups.errorCount} · ${ui.overview.warnings}: ${groups.warningCount}`
      : groups.errorCount > 0
        ? `${ui.overview.errors} (${groups.errorCount})`
        : `${ui.overview.warnings} (${groups.warningCount})`;

  return (
    <>
      {showIssues && (
        <div
          className={`stale-scan-banner stale-scan-banner--${
            groups.errorCount > 0 ? "error" : "warning"
          }`}
          role="status"
        >
          <span
            className={`stale-scan-icon stale-scan-icon--${
              groups.errorCount > 0 ? "error" : "warning"
            }`}
            aria-hidden="true"
          >
            {groups.errorCount > 0 ? <AlertCircle size={16} /> : <AlertTriangle size={16} />}
          </span>

          <div className="stale-scan-text">
            <strong>{issueHeading}</strong>
            <span>{ui.overview.noticeIssueHint}</span>
            {capped && (
              <span>
                {warnings.length}/{warningsTotal}
              </span>
            )}

            <details className="scan-notices-details">
              <summary>
                {ui.table.details} ({groups.issues.length})
              </summary>
              <ul>
                {groups.issues.map((notice, index) => (
                  <li key={`${notice.code}-${notice.path ?? "nopath"}-${index}`}>
                    <span
                      className={`scan-notice-tag scan-notice-tag--${notice.severity}`}
                      aria-hidden="true"
                    >
                      {notice.severity === "error" ? ui.overview.errors : ui.overview.warnings}
                    </span>
                    <span>{localizeWarningCode(notice.code, ui)}</span>
                    <span className="scan-notices-path">{renderPath(notice.path)}</span>
                  </li>
                ))}
              </ul>
            </details>
          </div>

          <div className="stale-scan-actions">
            <IconButton
              size="sm"
              aria-label={ui.overview.copyDetails}
              tooltip={ui.overview.copyDetails}
              onClick={() => void copyDetails()}
            >
              <ClipboardCopy size={13} />
            </IconButton>
            <IconButton
              size="sm"
              aria-label={ui.stale.dismiss}
              tooltip={ui.stale.dismiss}
              onClick={dismissIssues}
            >
              <X size={13} />
            </IconButton>
          </div>
        </div>
      )}

      {showInfo && (
        <div className="stale-scan-banner stale-scan-banner--info" role="status">
          <span className="stale-scan-icon stale-scan-icon--info" aria-hidden="true">
            <Info size={16} />
          </span>

          <div className="stale-scan-text">
            <strong>{ui.overview.noticeInfoTitle}</strong>
            <span>{ui.overview.noticeInfoHint}</span>

            {depthLimited && (
              <span>
                {ui.settings.maxDepth}: {maxDepth} · {ui.overview.partial}
              </span>
            )}

            {groups.info.length > 0 && (
              <details className="scan-notices-details">
                <summary>
                  {ui.table.details} ({groups.info.length})
                </summary>
                <ul>
                  {groups.info.map((notice, index) => (
                    <li key={`${notice.code}-${notice.path ?? "nopath"}-${index}`}>
                      <span>{localizeWarningCode(notice.code, ui)}</span>
                      <span className="scan-notices-path">{renderPath(notice.path)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <div className="stale-scan-actions">
            <IconButton
              size="sm"
              aria-label={ui.overview.copyDetails}
              tooltip={ui.overview.copyDetails}
              onClick={() => void copyDetails()}
            >
              <ClipboardCopy size={13} />
            </IconButton>
            <IconButton
              size="sm"
              aria-label={ui.stale.dismiss}
              tooltip={ui.stale.dismiss}
              onClick={dismissInfo}
            >
              <X size={13} />
            </IconButton>
          </div>
        </div>
      )}
    </>
  );
};
