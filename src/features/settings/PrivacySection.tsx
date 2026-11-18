import React, { useState } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

import { Button } from "@/components/primitives/Button";
import { Dialog } from "@/components/primitives/Dialog";
import { Switch } from "@/components/primitives/Switch";
import { usePreferencesStore, quiescePreferencesWrites } from "@/stores/preferences-store";
import { useScanStore, flushLastScanPersist, cancelScheduledPersist } from "@/stores/scan-store";
import { useUiStore } from "@/stores/ui-store";
import { useUIText, localizeAppError } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { log } from "@/lib/logging";
import {
  beginAppDataReset,
  cancelAppDataReset,
  markAppDataResetCompleted,
} from "@/lib/app-data-reset";
import { clearScanHistory } from "@/features/history/scan-history";

export type SettingsPatch = Parameters<
  ReturnType<typeof usePreferencesStore.getState>["updateSettings"]
>[0];

interface PrivacySectionProps {
  maskPaths: boolean;
  historyEnabled: boolean;
  /** A reset during a scan would race the writer and recreate the files. */
  scanBusy: boolean;
  onSave: (patch: SettingsPatch) => void;
}

/**
 * Privacy switches and the factory-reset danger zone.
 *
 * Kept out of `SettingsView` because the reset is an ordered, multi-step
 * destructive flow (quiesce writes → delete → suppress unload flush → reload).
 * Living next to the other tabs made that state machine hard to review, and it
 * can now be tested without mounting the whole settings page.
 */
export const PrivacySection: React.FC<PrivacySectionProps> = ({
  maskPaths,
  historyEnabled,
  scanBusy,
  onSave,
}) => {
  const ui = useUIText();
  const showToast = useUiStore((s) => s.showToast);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  /**
   * Factory reset. The order matters:
   *  1. stop already-queued writes and let in-flight ones settle,
   *  2. delete the backend files,
   *  3. suppress the `pagehide` flush, clear the local caches, and reload.
   * Anything else lets the old settings or last-scan snapshot reappear after
   * the reset because the unload handler writes them back.
   */
  const handleResetAppData = async () => {
    if (useScanStore.getState().status === "scanning") return;
    if (scanBusy) {
      setResetDialogOpen(false);
      showToast(ui.settings.resetAppDataBlocked, "warning", 7000);
      return;
    }

    setResetting(true);
    try {
      cancelScheduledPersist();
      await quiescePreferencesWrites();
      await flushLastScanPersist();
      beginAppDataReset();
      try {
        await scannerApi.resetAppData();
      } catch (err) {
        cancelAppDataReset();
        throw err;
      }

      try {
        clearScanHistory();
        // `theme-boot.js` reads these before React mounts; leaving them would
        // paint the old theme and language for a frame after the reset.
        localStorage.removeItem("dev_cleaner_theme");
        localStorage.removeItem("dev_cleaner_lang");
        localStorage.removeItem("dev_cleaner_language");
        localStorage.removeItem("node_cleaner_language");
      } catch (err) {
        log.warn("Could not clear local caches during the application reset", err);
      }

      markAppDataResetCompleted();
      window.location.reload();
    } catch (err) {
      setResetting(false);
      const blocked =
        typeof err === "object" && err !== null && (err as { code?: unknown }).code === "Blocked";
      showToast(
        blocked
          ? ui.settings.resetAppDataBlocked
          : `${ui.settings.resetAppDataTitle}: ${localizeAppError(err, ui)}`,
        "error",
        7000,
      );
    }
  };

  return (
    <>
      <section className="settings-card">
        <div className="form-row">
          <span>{ui.settings.maskPaths}</span>
          <Switch
            checked={maskPaths}
            onLabel={ui.common.on}
            offLabel={ui.common.off}
            aria-label={ui.settings.maskPaths}
            onChange={(v) => onSave({ maskPaths: v })}
          />
        </div>
        <div className="form-row">
          <span>{ui.settings.historyEnabled}</span>
          <Switch
            checked={historyEnabled}
            onLabel={ui.common.on}
            offLabel={ui.common.off}
            aria-label={ui.settings.historyEnabled}
            onChange={(v) => onSave({ historyEnabled: v })}
          />
        </div>
        <p className="plan-note">{ui.history.clearHint}</p>
      </section>

      <section className="settings-card settings-danger-zone">
        <div className="settings-danger-heading">
          <span className="settings-danger-icon" aria-hidden="true">
            <AlertTriangle size={16} />
          </span>
          <div>
            <h3 className="settings-group-title settings-danger-title">
              {ui.settings.resetAppDataTitle}
            </h3>
            <p className="plan-note">{ui.settings.resetAppDataHint}</p>
          </div>
        </div>
        <div className="settings-danger-actions">
          <Button
            variant="danger-outline"
            icon={<RotateCcw size={14} />}
            disabled={scanBusy}
            title={scanBusy ? ui.settings.resetAppDataBlocked : undefined}
            onClick={() => setResetDialogOpen(true)}
          >
            {ui.settings.resetAppDataTitle}
          </Button>
        </div>
      </section>

      <Dialog
        isOpen={resetDialogOpen}
        onClose={() => {
          if (!resetting) setResetDialogOpen(false);
        }}
        title={
          <span className="settings-danger-title">
            <AlertTriangle size={16} aria-hidden="true" /> {ui.settings.resetAppDataTitle}
          </span>
        }
        footer={
          <>
            <Button
              variant="secondary"
              disabled={resetting}
              onClick={() => setResetDialogOpen(false)}
            >
              {ui.common.cancel}
            </Button>
            <Button
              variant="danger"
              disabled={resetting}
              aria-busy={resetting}
              onClick={() => void handleResetAppData()}
            >
              {resetting ? ui.settings.resetAppDataBusy : ui.settings.resetAppDataConfirmBtn}
            </Button>
          </>
        }
      >
        <p className="settings-danger-confirm">{ui.settings.resetAppDataHint}</p>
      </Dialog>
    </>
  );
};
