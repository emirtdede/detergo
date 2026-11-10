import React from "react";

export interface LogoProps {
  size?: number;
  className?: string;
  showWordmark?: boolean;
}

/**
 * Canonical glyph-only mark. The path data is hand-maintained and mirrored
 * exactly in `assets/brand/dev-cleaner-icon.svg`; `npm run check:brand` fails
 * when the two drift apart.
 */
export const Logo: React.FC<LogoProps> = ({ size = 22, className = "", showWordmark = false }) => {
  return (
    <div
      className={`logo-container ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        userSelect: "none",
      }}
    >
      <svg
        width={size * 1.697}
        height={size}
        viewBox="32 118 448 264"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Dev Cleaner"
      >
        <g stroke="currentColor" fill="none">
          <path
            d="M166 172L86 256L166 340"
            strokeWidth="34"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M346 172L426 256L346 340"
            strokeWidth="34"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M225.5 336.1L259.6 246.5" strokeWidth="34" strokeLinecap="round" />
          <path
            d="M283.4 146C283.4 173.8 293.6 184 321.4 184C293.6 184 283.4 194.2 283.4 222C283.4 194.2 273.2 184 245.4 184C273.2 184 283.4 173.8 283.4 146Z"
            fill="currentColor"
            stroke="none"
          />
        </g>
      </svg>

      {showWordmark && (
        <span
          style={{
            fontSize: 14,
            fontWeight: 650,
            letterSpacing: "-0.01em",
            color: "var(--text-primary)",
          }}
        >
          Dev Cleaner
        </span>
      )}
    </div>
  );
};
