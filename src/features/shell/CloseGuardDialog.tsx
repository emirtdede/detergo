import React, { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Dialog } from "@/components/primitives/Dialog";
import { Button } from "@/components/primitives/Button";
import { Checkbox } from "@/components/primitives/Checkbox";
import { useUIText } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { usePreferencesStore } from "@/stores/preferences-store";
import type { CloseAction } from "@/types";
import "./shell.css";

/**
 * The close button is intercepted by Rust (`CloseRequested` -> emit). This
 * guard turns an accidental click into an explicit choice instead of killing a
 * running scan: keep running in the tray (default), quit, or stay.
 *
 * The user can opt out of the dialog: ticking "remember my choice" stores
 * `closeAction` in settings, and Settings -> General exposes the same value so
 * the behaviour stays reversible.
 */
export const CloseGuardDialog: React.FC = () => {
  const ui = useUIText();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    try {
      const appWindow = getCurrentWindow();
      appWindow
        .listen("close-requested", () => {
          // Apply a remembered choice without asking again; only "ask" opens
          // the guard. The setting is read at click time, not at mount time,
          // so a change made in Settings takes effect immediately.
          const action = usePreferencesStore.getState().closeAction;
          if (action === "tray") {
            void scannerApi.hideToTray();
            return;
          }
          if (action === "quit") {
            void scannerApi.quitApp();
            return;
          }
          setRemember(false);
          setOpen(true);
        })
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

  const applyChoice = async (action: Exclude<CloseAction, "ask">) => {
    setBusy(true);
    try {
      if (remember) {
        usePreferencesStore.getState().setCloseAction(action);
        // Await the write: for "quit" the process is gone right after, and a
        // fire-and-forget save would lose the remembered choice.
        try {
          await usePreferencesStore.getState().persistSettings();
        } catch {
          // A failed save must not block hiding or quitting.
        }
      }
      if (action === "tray") {
        await scannerApi.hideToTray();
        setOpen(false);
      } else {
        await scannerApi.quitApp();
      }
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
        <div className="dialog-footer-equal">
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={busy}>
            {ui.closeGuard.stay}
          </Button>
          <Button
            variant="danger-outline"
            size="sm"
            onClick={() => applyChoice("quit")}
            disabled={busy}
          >
            {ui.closeGuard.quit}
          </Button>
          <Button variant="primary" size="sm" onClick={() => applyChoice("tray")} disabled={busy}>
            {ui.closeGuard.minimize}
          </Button>
        </div>
      }
    >
      <p className="plan-note">{ui.closeGuard.body}</p>
      <p className="plan-note" style={{ marginTop: 8, fontWeight: 600 }}>
        {ui.closeGuard.trayHint}
      </p>
      <div className="close-guard-remember">
        <Checkbox
          id="close-guard-remember"
          checked={remember}
          aria-label={ui.closeGuard.remember}
          onChange={setRemember}
        />
        <label htmlFor="close-guard-remember">
          {ui.closeGuard.remember}
          <small>{ui.closeGuard.rememberHint}</small>
        </label>
      </div>
    </Dialog>
  );
};
