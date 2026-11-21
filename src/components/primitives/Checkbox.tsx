import React, { useEffect, useRef } from "react";
import { Check, Minus } from "lucide-react";
import "./primitives.css";

export interface CheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  onClick?: (event: React.MouseEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  /**
   * Visible text rendered inside the same `<label>` as the input, so clicking
   * the sentence toggles the box. Without this the permanent-delete
   * acknowledgement only responded on the 18px square.
   */
  label?: React.ReactNode;
  "aria-label"?: string;
  id?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  indeterminate = false,
  onChange,
  onClick,
  disabled = false,
  label,
  "aria-label": ariaLabel,
  id,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  // `indeterminate` is a DOM property, not an attribute, and screen readers
  // only announce it through `aria-checked="mixed"`. Without this a tri-state
  // "select all" looked partial but was announced as unchecked (L3).
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <label
      className={`checkbox-container ${label ? "checkbox-with-label" : ""} ${
        checked ? "checkbox-checked" : ""
      } ${indeterminate ? "checkbox-indeterminate" : ""} ${disabled ? "disabled" : ""}`}
    >
      <input
        ref={inputRef}
        type="checkbox"
        id={id}
        className="checkbox-input"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-checked={indeterminate ? "mixed" : checked}
        onClick={onClick}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className="checkbox-box">
        {indeterminate ? (
          <Minus size={12} strokeWidth={3} />
        ) : checked ? (
          <Check size={12} strokeWidth={3} />
        ) : null}
      </div>
      {label ? <span className="checkbox-label">{label}</span> : null}
    </label>
  );
};
