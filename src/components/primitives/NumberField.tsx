import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export interface NumberFieldProps {
  /** Committed value. The field keeps a local draft while the user types. */
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel?: string;
  increaseLabel: string;
  decreaseLabel: string;
  id?: string;
}

/**
 * Numeric input with a custom stepper. The native spinner is a white square in
 * dark themes and its size differs per platform, which made settings rows look
 * ragged; this keeps a single 32px control with theme-aware chevrons.
 *
 * The value is committed on blur or Enter so a half-typed number (e.g. the "5"
 * in "50000") is never persisted and clamped up to the minimum.
 */
export const NumberField: React.FC<NumberFieldProps> = ({
  value,
  onCommit,
  min,
  max,
  step = 1,
  ariaLabel,
  increaseLabel,
  decreaseLabel,
  id,
}) => {
  const [draft, setDraft] = useState(() => String(value));
  const [editing, setEditing] = useState(false);

  // Follow external updates (profile switch, reset) unless the user is typing.
  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  const clamp = (next: number) => {
    const lower = min ?? Number.NEGATIVE_INFINITY;
    const upper = max ?? Number.POSITIVE_INFINITY;
    const bounded = Math.min(upper, Math.max(lower, next));
    // Every numeric setting is a whole number; avoid 31.999999999999996.
    return step >= 1 ? Math.round(bounded) : bounded;
  };

  const commit = (raw: string) => {
    const parsed = Number(raw.replace(",", "."));
    const next = raw.trim() === "" || !Number.isFinite(parsed) ? value : clamp(parsed);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  const bump = (direction: 1 | -1) => {
    const current = Number(draft.replace(",", "."));
    const base = Number.isFinite(current) ? current : value;
    commit(String(clamp(base + direction * step)));
  };

  return (
    <div className="number-field">
      <input
        id={id}
        type="number"
        className="number-field-input"
        inputMode="numeric"
        value={draft}
        min={min}
        max={max}
        step={step}
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setEditing(true)}
        onBlur={(e) => {
          setEditing(false);
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit((e.target as HTMLInputElement).value);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <div className="number-field-stepper">
        <button
          type="button"
          className="number-field-step"
          aria-label={increaseLabel}
          tabIndex={-1}
          onClick={() => bump(1)}
        >
          <ChevronUp size={12} strokeWidth={2.6} />
        </button>
        <button
          type="button"
          className="number-field-step"
          aria-label={decreaseLabel}
          tabIndex={-1}
          onClick={() => bump(-1)}
        >
          <ChevronDown size={12} strokeWidth={2.6} />
        </button>
      </div>
    </div>
  );
};
