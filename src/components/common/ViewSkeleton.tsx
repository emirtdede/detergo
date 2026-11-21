import React, { useEffect, useState } from "react";
import type { AppView } from "@/stores/app-store";

export interface ViewSkeletonProps {
  view?: AppView;
}

/**
 * 1:1 per-view layout-matched placeholder shown inside `<main>` only if a
 * lazily imported view chunk takes longer than 120 ms to resolve.
 *
 * Every lazy route (`docs`, `settings`, `about`, `agents`, `caches`, `system`,
 * `history`) mirrors its exact real container geometry (240px split sidebar,
 * Bento KPI count, tab bar, provider grid, or centered docs article) so there
 * is zero layout jump or corner-sticking on any viewport width.
 */
export const ViewSkeleton: React.FC<ViewSkeletonProps> = ({ view = "overview" }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 120);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  if (view === "docs") {
    return (
      <div className="docs-container view-skeleton-split" role="status" aria-live="polite">
        <aside className="docs-sidebar" aria-hidden="true">
          <div className="docs-sidebar-header">
            <div className="view-skeleton-block view-skeleton-title-sm" />
          </div>
          <div className="docs-search-wrap">
            <div className="view-skeleton-block view-skeleton-search" />
          </div>
          <div className="docs-sidebar-scroll">
            <div className="view-skeleton-nav-group">
              <div className="view-skeleton-block view-skeleton-nav-row" />
              <div className="view-skeleton-block view-skeleton-nav-row" />
              <div className="view-skeleton-block view-skeleton-nav-row" />
              <div className="view-skeleton-block view-skeleton-nav-row" />
              <div className="view-skeleton-block view-skeleton-nav-row" />
            </div>
          </div>
        </aside>
        <div className="docs-content-pane" aria-hidden="true">
          <div className="docs-article">
            <div className="view-skeleton-header">
              <div className="view-skeleton-block view-skeleton-pill" />
              <div className="view-skeleton-block view-skeleton-title" />
              <div className="view-skeleton-block view-skeleton-sub" />
            </div>
            <div className="view-skeleton-block view-skeleton-callout" />
            <div className="view-skeleton-block view-skeleton-panel" />
          </div>
        </div>
      </div>
    );
  }

  if (view === "settings" || view === "about") {
    const kpiCount = view === "about" ? 4 : 3;
    return (
      <div className="split-layout view-skeleton-split" role="status" aria-live="polite">
        <aside className="split-sidebar" aria-hidden="true">
          <div className="split-sidebar-header">
            <div className="view-skeleton-block view-skeleton-title-sm" />
          </div>
          <div className="split-sidebar-scroll">
            <div className="view-skeleton-nav-group">
              <div className="view-skeleton-block view-skeleton-nav-row" />
              <div className="view-skeleton-block view-skeleton-nav-row" />
              <div className="view-skeleton-block view-skeleton-nav-row" />
              <div className="view-skeleton-block view-skeleton-nav-row" />
              <div className="view-skeleton-block view-skeleton-nav-row" />
            </div>
          </div>
        </aside>
        <div className="split-content-pane" aria-hidden="true">
          <div className="split-content-inner">
            <div className="view-skeleton-header">
              <div className="view-skeleton-block view-skeleton-title" />
              <div className="view-skeleton-block view-skeleton-sub" />
            </div>
            <div className={`nc-bento-strip nc-bento-strip--${kpiCount}`}>
              {Array.from({ length: kpiCount }).map((_, idx) => (
                <div key={idx} className="view-skeleton-block view-skeleton-kpi" />
              ))}
            </div>
            <div className="view-skeleton-block view-skeleton-panel" />
          </div>
        </div>
      </div>
    );
  }

  if (view === "caches") {
    return (
      <div className="view-skeleton-page" role="status" aria-live="polite" aria-hidden="true">
        <div className="view-skeleton-header">
          <div className="view-skeleton-block view-skeleton-title" />
          <div className="view-skeleton-block view-skeleton-sub" />
        </div>
        <div className="nc-bento-strip nc-bento-strip--4">
          <div className="view-skeleton-block view-skeleton-kpi" />
          <div className="view-skeleton-block view-skeleton-kpi" />
          <div className="view-skeleton-block view-skeleton-kpi" />
          <div className="view-skeleton-block view-skeleton-kpi" />
        </div>
        <div className="provider-grid">
          <div className="view-skeleton-block view-skeleton-card" />
          <div className="view-skeleton-block view-skeleton-card" />
          <div className="view-skeleton-block view-skeleton-card" />
        </div>
      </div>
    );
  }

  if (view === "agents" || view === "history") {
    return (
      <div className="view-skeleton-page" role="status" aria-live="polite" aria-hidden="true">
        <div className="view-skeleton-header">
          <div className="view-skeleton-block view-skeleton-title" />
          <div className="view-skeleton-block view-skeleton-sub" />
        </div>
        <div className="view-skeleton-tabs">
          <div className="view-skeleton-block view-skeleton-tab" />
          <div className="view-skeleton-block view-skeleton-tab" />
        </div>
        <div className="view-skeleton-block view-skeleton-panel" />
      </div>
    );
  }

  return (
    <div className="view-skeleton-page" role="status" aria-live="polite" aria-hidden="true">
      <div className="view-skeleton-header">
        <div className="view-skeleton-block view-skeleton-title" />
        <div className="view-skeleton-block view-skeleton-sub" />
      </div>
      <div className="nc-bento-strip nc-bento-strip--4">
        <div className="view-skeleton-block view-skeleton-kpi" />
        <div className="view-skeleton-block view-skeleton-kpi" />
        <div className="view-skeleton-block view-skeleton-kpi" />
        <div className="view-skeleton-block view-skeleton-kpi" />
      </div>
      <div className="view-skeleton-block view-skeleton-panel" />
    </div>
  );
};
