import React from "react";
import { useUIText } from "@/lib/ui-text";
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
  onLabel,
  offLabel,
  "aria-label": ariaLabel,
  id,
  className = "",
}) => {
  const ui = useUIText();
  const resolvedOn = onLabel ?? ui.common.on;
  const resolvedOff = offLabel ?? ui.common.off;
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
      <span>{checked ? resolvedOn : resolvedOff}</span>
    </button>
  );
};

export const ToggleSwitch = Switch;
