import React from "react";
import "./primitives.css";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  onLabel?: string;
  offLabel?: string;
  "aria-label"?: string;
  id?: string;
  className?: string;
}

export const Switch: React.FC<SwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  onLabel = "Açık",
  offLabel = "Kapalı",
  "aria-label": ariaLabel,
  id,
  className = "",
}) => {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={`btn ${checked ? "btn-primary" : "btn-secondary"} btn-sm nc-switch-toggle-btn ${className}`.trim()}
      onClick={() => {
        if (!disabled) {
          onChange(!checked);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          if (!disabled) {
            onChange(!checked);
          }
        }
      }}
    >
      <span>{checked ? onLabel : offLabel}</span>
    </button>
  );
};

export const ToggleSwitch = Switch;
