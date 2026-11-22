import React from "react";
import ReactDOM from "react-dom/client";
import { SetupApp } from "./SetupApp";

const rootElement = document.getElementById("setup-root");
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <SetupApp />
    </React.StrictMode>,
  );
}
