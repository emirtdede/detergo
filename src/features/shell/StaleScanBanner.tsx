import React from "react";
import { History, X } from "lucide-react";
import { IconButton } from "@/components/primitives/IconButton";
import { useScanStore } from "@/stores/scan-store";
import { useAppStore } from "@/stores/app-store";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUIText } from "@/lib/ui-text";
import { formatSavedAt } from "@/lib/format/date";
import "./stale-scan.css";

/**
 * Predicate to decide if the stale scan banner should be visible.
 * Rule: Only visible on views backed by the restored scan snapshot
 * (projects, agents), explicitly excluding unrelated views.
 */
export function isStaleScanBannerVisible(
  view: string,
  restored: boolean,
  dismissed: boolean,
): boolean {
  if (!restored || dismissed) return false;
  return view === "projects" || view === "agents";
}

/**
 * A persistent, non-blocking reminder that the visible rows are a restored
 * snapshot. It disappears as soon as a fresh scan replaces the data.
 */
export const StaleScanBanner: React.FC = () => {
  const ui = useUIText();
  const restored = useScanStore((s) => s.restored);
  const lastSavedAt = useScanStore((s) => s.lastSavedAt);
  const dismissed = useScanStore((s) => s.staleBannerDismissed);
  const dismiss = useScanStore((s) => s.dismissStaleBanner);
  const view = useAppStore((s) => s.view);
  const language = usePreferencesStore((s) => s.language);

  if (!isStaleScanBannerVisible(view, restored, dismissed)) return null;

  return (
    <div className="stale-scan-banner" role="status">
      <span className="stale-scan-icon" aria-hidden="true">
        <History size={16} />
      </span>

      <div className="stale-scan-text">
        <strong>{ui.stale.bannerTitle}</strong>
        <span>{ui.stale.bannerBody(formatSavedAt(lastSavedAt, language))}</span>
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
