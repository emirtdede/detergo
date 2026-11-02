import React from "react";
import { History, Play, X } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { IconButton } from "@/components/primitives/IconButton";
import { useScanStore } from "@/stores/scan-store";
import { useAppStore } from "@/stores/app-store";
import { useScanController } from "@/features/scan/useScanController";
import { useUIText } from "@/lib/ui-text";
import "./stale-scan.css";

function formatSavedAt(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

/**
 * A persistent, non-blocking reminder that the visible rows are a restored
 * snapshot. It disappears as soon as a fresh scan replaces the data.
 */
export const StaleScanBanner: React.FC = () => {
  const ui = useUIText();
  const restored = useScanStore((s) => s.restored);
  const lastSavedAt = useScanStore((s) => s.lastSavedAt);
  const scope = useScanStore((s) => s.scope);
  const dismissed = useScanStore((s) => s.staleBannerDismissed);
  const dismiss = useScanStore((s) => s.dismissStaleBanner);
  const view = useAppStore((s) => s.view);
  const { startScan, isScanning } = useScanController();

  if (!restored || dismissed) return null;
  if (view === "settings" || view === "history" || view === "caches") return null;

  return (
    <div className="stale-scan-banner" role="status">
      <span className="stale-scan-icon" aria-hidden="true">
        <History size={16} />
      </span>
      <div className="stale-scan-text">
        <strong>{ui.stale.bannerTitle}</strong>
        <span>{ui.stale.bannerBody(formatSavedAt(lastSavedAt))}</span>
      </div>
      <div className="stale-scan-actions">
        <Button
          variant="primary"
          size="sm"
          icon={<Play size={11} fill="currentColor" />}
          onClick={() => startScan(undefined, scope)}
          disabled={isScanning}
        >
          {ui.stale.rescan}
        </Button>
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
