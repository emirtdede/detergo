import React, { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useUIText } from "@/lib/ui-text";
import { log } from "@/lib/logging";
import "./window-controls.css";

export const WindowControls: React.FC = () => {
  const ui = useUIText();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    try {
      const appWindow = getCurrentWindow();
      appWindow
        .isMaximized()
        .then(setIsMaximized)
        .catch(() => {});

      const unlisten = appWindow.onResized(async () => {
        try {
          const max = await appWindow.isMaximized();
          setIsMaximized(max);
        } catch {}
      });

      return () => {
        unlisten.then((fn) => fn()).catch(() => {});
      };
    } catch {}
  }, []);

  const handleMinimize = async () => {
    try {
      await getCurrentWindow().minimize();
    } catch (err) {
      log.error("Window control action failed", err);
    }
  };

  const handleToggleMaximize = async () => {
    try {
      await getCurrentWindow().toggleMaximize();
      const max = await getCurrentWindow().isMaximized();
      setIsMaximized(max);
    } catch (err) {
      log.error("Window control action failed", err);
    }
  };

  const handleClose = async () => {
    try {
      await getCurrentWindow().close();
    } catch (err) {
      log.error("Window control action failed", err);
    }
  };

  const maximizeTitle = isMaximized ? ui.window.restore : ui.window.maximize;

  return (
    <div
      className="window-controls pp-window-controls"
      role="group"
      aria-label={ui.window.minimize}
      data-tauri-drag-region="false"
    >
      <button
        type="button"
        className="win-btn pp-win-btn win-minimize"
        onClick={handleMinimize}
        title={ui.window.minimize}
        aria-label={ui.window.minimize}
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 6.5H10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        className="win-btn pp-win-btn win-maximize"
        onClick={handleToggleMaximize}
        title={maximizeTitle}
        aria-label={maximizeTitle}
        data-maximized={isMaximized ? "true" : "false"}
      >
        {isMaximized ? (
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M3.75 3.75V2.5C3.75 2.08579 4.08579 1.75 4.5 1.75H9.5C9.91421 1.75 10.25 2.08579 10.25 2.5V7.5C10.25 7.91421 9.91421 8.25 9.5 8.25H8.25"
              stroke="currentColor"
              strokeWidth="1.15"
              strokeLinecap="round"
            />
            <rect
              x="1.75"
              y="3.75"
              width="6.5"
              height="6.5"
              rx="1"
              stroke="currentColor"
              strokeWidth="1.15"
            />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <rect
              x="2"
              y="2"
              width="8"
              height="8"
              rx="1"
              stroke="currentColor"
              strokeWidth="1.15"
            />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="win-btn pp-win-btn win-close pp-win-close"
        onClick={handleClose}
        title={ui.window.close}
        aria-label={ui.window.close}
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path
            d="M2.5 2.5L9.5 9.5M9.5 2.5L2.5 9.5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
};
