import { Component, ErrorInfo, ReactNode } from "react";
import { usePreferencesStore } from "@/stores/preferences-store";
import { log } from "@/lib/logging";
import { recordError } from "@/lib/diagnostics/error-log";
import { getErrorBoundaryText } from "./error-boundary-text";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Last-resort screen for an uncaught render error.
 *
 * It must not depend on the async locale loader, the theme store or the legacy
 * dictionary map: any of those may be what failed. Copy comes from a small
 * static table and colours from CSS variables so the screen follows the
 * persisted light/dark theme instead of forcing a hard-coded dark palette.
 */
export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // The stack belongs in a log, never on screen: it can contain local paths
    // and internal module names.
    log.error("Uncaught React error", error, errorInfo.componentStack);
    // Keep a masked copy for Settings > About so the user can report the crash
    // even after the screen was reloaded.
    recordError("render", error);
    this.setState({ error, errorInfo });
  }

  private getTranslation() {
    let language: string | null = null;
    try {
      language = usePreferencesStore.getState()?.language ?? null;
    } catch {
      // The store itself can be the crashed module; the table has a fallback.
    }
    return getErrorBoundaryText(language);
  }

  public render() {
    if (this.state.hasError) {
      const t = this.getTranslation();
      return (
        <div
          role="alert"
          style={{
            padding: "32px",
            color: "var(--text-primary, #fff)",
            background: "var(--bg-app, #16161a)",
            minHeight: "100vh",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              maxWidth: "600px",
              background: "var(--surface-raised, #1F1F26)",
              border: "1px solid var(--border-subtle, #2A2A31)",
              borderRadius: "16px",
              padding: "28px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            }}
          >
            <h2
              style={{
                color: "var(--danger, #E5484D)",
                marginBottom: "12px",
                fontSize: "20px",
              }}
            >
              {t.title}
            </h2>
            <p
              style={{
                color: "var(--text-muted, #A4A4AA)",
                fontSize: "14px",
                marginBottom: "16px",
              }}
            >
              {t.unknownError}
            </p>
            {import.meta.env.DEV && this.state.error?.message && (
              <pre
                style={{
                  background: "var(--bg-sunken, rgba(0,0,0,0.5))",
                  padding: "12px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  overflowX: "auto",
                  color: "var(--warning, #f5a623)",
                  maxHeight: "200px",
                }}
              >
                {this.state.error.message}
              </pre>
            )}
            {import.meta.env.DEV && this.state.error?.stack && (
              <details
                style={{
                  marginTop: "8px",
                  color: "var(--text-muted, #A4A4AA)",
                  fontSize: "12px",
                }}
              >
                <summary>Stack trace (dev only)</summary>
                <pre style={{ overflowX: "auto", maxHeight: "200px", marginTop: "6px" }}>
                  {this.state.error.stack}
                </pre>
              </details>
            )}
            <button
              onClick={() => window.location.reload()}
              style={{
                marginTop: "20px",
                padding: "10px 20px",
                background: "var(--accent, #0A84FF)",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              {t.reload}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
