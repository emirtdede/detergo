import React, { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Dialog } from "@/components/primitives/Dialog";
import { Button } from "@/components/primitives/Button";
import { useUIText } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";

/**
 * The close button is intercepted by Rust (`CloseRequested` -> emit). This
 * guard turns an accidental click into an explicit choice instead of killing a
 * running scan: keep running in the tray (default), quit, or stay.
 */
export const CloseGuardDialog: React.FC = () => {
  const ui = useUIText();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    try {
      const appWindow = getCurrentWindow();
      appWindow
        .listen("close-requested", () => setOpen(true))
        .then((fn) => {
          if (disposed) fn();
          else unlisten = fn;
        })
        .catch(() => {});
    } catch {
      // Browser preview: there is no native window to guard.
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const hideToTray = async () => {
    setBusy(true);
    try {
      await scannerApi.hideToTray();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const quit = async () => {
    setBusy(true);
    try {
      await scannerApi.quitApp();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      isOpen={open}
      onClose={() => setOpen(false)}
      title={ui.closeGuard.title}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>
            {ui.closeGuard.stay}
          </Button>
          <Button variant="danger-outline" size="sm" onClick={quit} disabled={busy}>
            {ui.closeGuard.quit}
          </Button>
          <Button variant="primary" size="sm" onClick={hideToTray} disabled={busy}>
            {ui.closeGuard.minimize}
          </Button>
        </>
      }
    >
      <p className="plan-note">{ui.closeGuard.body}</p>
      <p className="plan-note" style={{ marginTop: 8, fontWeight: 600 }}>
        {ui.closeGuard.trayHint}
      </p>
    </Dialog>
  );
};
