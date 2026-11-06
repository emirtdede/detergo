import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { installDesktopGuard } from "./lib/desktop-guard";
import "./styles/index.css";

// Install native desktop shell hardening immediately upon bootstrap
installDesktopGuard();

const rootElement = document.getElementById("root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}
