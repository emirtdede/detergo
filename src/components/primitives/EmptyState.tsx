import React from "react";
import "./primitives.css";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Compact fits inside a table canvas; the default is a page-level block. */
  variant?: "default" | "compact";
  /** Announce this state when it appears after an async action. */
  live?: boolean;
  className?: string;
}

/**
 * Shared empty state. The point is that an empty table is not a table with a
 * message inside its grid: it is explained once, with the next action nearby.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actions,
  variant = "default",
  live = false,
  className = "",
}) => (
  <section
    className={`empty-state empty-state--${variant} ${className}`.trim()}
    role={live ? "status" : undefined}
    aria-live={live ? "polite" : undefined}
  >
    {icon && (
      <span className="empty-state-icon" aria-hidden="true">
        {icon}
      </span>
    )}
    <div className="empty-state-copy">
      <h2 className="empty-state-title">{title}</h2>
      {description && <p className="empty-state-description">{description}</p>}
    </div>
    {actions && <div className="empty-state-actions">{actions}</div>}
  </section>
);
