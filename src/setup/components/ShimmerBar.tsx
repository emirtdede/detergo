import React from "react";

export interface ShimmerBarProps {
  percent: number;
}

/**
 * 7px bright monochrome progress bar with animated platinum shimmer sweep.
 */
export const ShimmerBar: React.FC<ShimmerBarProps> = ({ percent }) => {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div
      className="setup-shimmer-track"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
    >
      <div className="setup-shimmer-fill" style={{ width: `${clamped}%` }} />
    </div>
  );
};
