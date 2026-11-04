import React from "react";
import "./primitives.css";

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  /** Extra content rendered under the description, e.g. a scope indicator. */
  children?: React.ReactNode;
}

/**
 * One h1 per page. Every top-level view used to hand-roll the same header with
 * a different wrapper, which is how the title level and action alignment drifted
 * between pages.
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  eyebrow,
  actions,
  meta,
  children,
}) => (
  <header className="page-header">
    <div className="page-header-copy">
      {eyebrow && <span className="page-header-eyebrow">{eyebrow}</span>}
      <h1 className="page-header-title">{title}</h1>
      {description && <p className="page-header-description">{description}</p>}
      {meta && <div className="page-header-meta">{meta}</div>}
      {children}
    </div>
    {actions && <div className="page-header-actions">{actions}</div>}
  </header>
);
