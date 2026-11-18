import React from "react";

/**
 * Placeholder shown inside `<main>` while a lazily imported view chunk loads.
 *
 * It intentionally mirrors the padding of `.view-container` so the header and
 * navigation rail never jump when the chunk resolves.
 */
export const ViewSkeleton: React.FC = () => (
  <div
    role="status"
    aria-live="polite"
    style={{
      display: "flex",
      flexDirection: "column",
      gap: "12px",
      padding: "8px 0",
    }}
  >
    <div
      style={{
        height: "28px",
        width: "38%",
        borderRadius: "6px",
        background: "var(--surface-raised, #1F1F26)",
      }}
    />
    <div
      style={{
        height: "120px",
        borderRadius: "10px",
        background: "var(--surface-raised, #1F1F26)",
      }}
    />
    <div
      style={{
        height: "120px",
        borderRadius: "10px",
        background: "var(--surface-raised, #1F1F26)",
      }}
    />
  </div>
);
