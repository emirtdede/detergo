import React from "react";

export interface SetupLogoProps {
  size: 96 | 84 | 72;
}

/**
 * Monochrome vector Detergo emblem framed in a crisp rounded square badge.
 * Uses the exact canonical Detergo glyph paths from `src/components/brand/Logo.tsx`.
 */
export const SetupLogo: React.FC<SetupLogoProps> = ({ size }) => {
  const radius = Math.round(size * 0.25);
  return (
    <div
      className="setup-logo-badge"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
      }}
      aria-hidden="true"
    >
      <svg
        width={Math.round(size * 0.72)}
        height={Math.round(size * 0.44)}
        viewBox="32 118 448 264"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g stroke="#FAFAFA" fill="none">
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
            fill="#FAFAFA"
            stroke="none"
          />
        </g>
      </svg>
    </div>
  );
};
