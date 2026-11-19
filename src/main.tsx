import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { installDesktopGuard } from "./lib/desktop-guard";
import { installErrorLogCapture } from "./lib/diagnostics/error-log";
import { disposeNotifications } from "./lib/notifications/notification-service";
import { disposeScanBuffers } from "./stores/scan-store";
import "./styles/index.css";

// Install native desktop shell hardening immediately upon bootstrap
installDesktopGuard();

// Uncaught errors and unhandled rejections are written to a local, masked log
// that Settings > About shows. Nothing is uploaded: the user decides whether to
// attach it to a bug report.
installErrorLogCapture();

// Close the notification AudioContext when the webview goes away instead of
// leaving a hardware handle to the process teardown.
window.addEventListener("pagehide", disposeNotifications, { once: true });

// A hot update swaps modules without tearing down the document, so the buffered
// scan writes and their timers would outlive the store instance they write to.
// Releasing them here keeps an edit-refresh cycle from leaving an orphan timer
// that keeps persisting a scan nobody renders.
if (import.meta.hot) {
  import.meta.hot.dispose(() => disposeScanBuffers());
}

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  );
}
