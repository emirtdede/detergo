import React from "react";

import { AlertTriangle, X } from "lucide-react";

import { IconButton } from "@/components/primitives/IconButton";
import { useScanStore } from "@/stores/scan-store";
import { localizeStopReason, useUIText } from "@/lib/ui-text";

import "./stale-scan.css";

/**
 * Explains that the visible results are incomplete.
 *
 * A partial scan happens when a limit or the timeout stops the walk; it is not
 * the same as a user cancel, and cleaning from a partial result without saying
 * so silently hides targets that were never visited.
 */
export const PartialScanBanner: React.FC = () => {
  const ui = useUIText();
  const status = useScanStore((s) => s.status);
  const summary = useScanStore((s) => s.summary);
  const dismissed = useScanStore((s) => s.partialBannerDismissed);
  const dismiss = useScanStore((s) => s.dismissPartialBanner);

  if (status !== "partial" || !summary?.partial || dismissed) return null;

  return (
    <div className="stale-scan-banner stale-scan-banner--warning" role="alert">
      <span className="stale-scan-icon stale-scan-icon--warning" aria-hidden="true">
        <AlertTriangle size={16} />
      </span>

      <div className="stale-scan-text">
        <strong>{ui.overview.partial}</strong>
        {summary.stopReason && (
          <span>
            {ui.overview.stopReason}: {localizeStopReason(summary.stopReason, ui)}
          </span>
        )}
      </div>

      <div className="stale-scan-actions">
        <IconButton
          size="sm"
          aria-label={ui.stale.dismiss}
          tooltip={ui.stale.dismiss}
          onClick={dismiss}
        >
          <X size={13} />
        </IconButton>
      </div>
    </div>
  );
};
