import React, { useCallback, useEffect, useState } from "react";

import { warmUpApi } from "@/lib/tauri/scanner-api";

export type BridgeStatus = "checking" | "ready" | "unavailable";

/**
 * Reports whether the Tauri IPC bridge resolved.
 *
 * The locale dictionaries may be unavailable when the bridge is missing, so the
 * screen below intentionally carries hard-coded bilingual copy instead of
 * `useUIText()`. The hook itself retries only on an explicit user action.
 */
export function useBridgeStatus(): { status: BridgeStatus; retry: () => void } {
  const [status, setStatus] = useState<BridgeStatus>("checking");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void warmUpApi().then((ok) => {
      if (!cancelled) setStatus(ok ? "ready" : "unavailable");
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  return { status, retry };
}

interface Props {
  onRetry: () => void;
}

/**
 * Shown when the desktop bridge could not be created.
 *
 * It has to work before preferences and locales load, so the copy is a fixed
 * TR/EN pair and the error code is stable for support tickets.
 */
export const BridgeUnavailableScreen: React.FC<Props> = ({ onRetry }) => (
  <div
    role="alert"
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      padding: "32px",
      gap: "16px",
      background: "var(--app-bg, #16161a)",
      color: "var(--text-primary, #fff)",
      textAlign: "center",
      fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
    }}
  >
    <h1 style={{ margin: 0, fontSize: "20px" }}>Backend bağlantısı kurulamadı</h1>
    <p style={{ margin: 0, maxWidth: "48ch", color: "var(--text-muted, #A4A4AA)" }}>
      Detergo masaüstü çalışma zamanına bağlanamadı. Uygulamayı masaüstü penceresinde yeniden açın.
      <br />
      <span lang="en">Detergo could not connect to the desktop runtime. Reopen the app.</span>
    </p>
    <code style={{ color: "var(--text-muted, #A4A4AA)", fontSize: "12px" }}>
      BRIDGE_UNAVAILABLE
    </code>
    <button
      type="button"
      onClick={onRetry}
      style={{
        padding: "8px 20px",
        borderRadius: "8px",
        border: "1px solid var(--border, #2A2A31)",
        background: "var(--surface-strong, #1F1F26)",
        color: "inherit",
        cursor: "pointer",
        fontSize: "14px",
      }}
    >
      Tekrar dene / Retry
    </button>
  </div>
);
