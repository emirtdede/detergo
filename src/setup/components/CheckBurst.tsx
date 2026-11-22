import React from "react";

/**
 * 88x88 monochrome completion emblem with animated ring, radial burst ticks,
 * and crisp drawn checkmark.
 */
export const CheckBurst: React.FC = () => {
  return (
    <div className="setup-check-burst" aria-hidden="true">
      <svg
        width="88"
        height="88"
        viewBox="0 0 88 88"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle
          className="setup-check-halo"
          cx="44"
          cy="44"
          r="38"
          stroke="rgba(255, 255, 255, 0.14)"
          strokeWidth="1.5"
        />
        <circle className="setup-check-circle" cx="44" cy="44" r="30" fill="#FAFAFA" />
        <g
          className="setup-check-rays"
          stroke="rgba(255, 255, 255, 0.48)"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <line x1="44" y1="3" x2="44" y2="9" />
          <line x1="44" y1="79" x2="44" y2="85" />
          <line x1="3" y1="44" x2="9" y2="44" />
          <line x1="79" y1="44" x2="85" y2="44" />
          <line x1="15" y1="15" x2="19.5" y2="19.5" />
          <line x1="68.5" y1="68.5" x2="73" y2="73" />
          <line x1="73" y1="15" x2="68.5" y2="19.5" />
          <line x1="19.5" y1="68.5" x2="15" y2="73" />
        </g>
        <path
          className="setup-check-mark"
          d="M32.5 44.5L40.5 52.5L56.5 36.5"
          stroke="#09090B"
          strokeWidth="4.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};
