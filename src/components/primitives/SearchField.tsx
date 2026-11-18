import React, { useRef, useEffect } from "react";
import { Search, X } from "lucide-react";
import { useUIText } from "@/lib/ui-text";
import "./primitives.css";

/**
 * Whether Ctrl/Cmd+F should focus this search field.
 *
 * A modal owns the keyboard while open (WAI-ARIA APG dialog pattern), so the
 * shortcut must not pull focus to a field behind the overlay. Fields rendered
 * inside the modal itself remain reachable.
 */
export function shouldHandleSearchShortcut(
  event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "key" | "defaultPrevented">,
  input: HTMLElement | null,
): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f") return false;
  if (event.defaultPrevented) return false;
  const openModal = document.querySelector('[aria-modal="true"]');
  if (!openModal) return true;
  return input !== null && openModal.contains(input);
}

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export const SearchField: React.FC<SearchFieldProps> = ({
  value,
  onChange,
  placeholder,
  className = "",
}) => {
  const ui = useUIText();
  const resolvedPlaceholder = placeholder || ui.table.searchPlaceholder;
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: Ctrl + F focuses the search field (UX-009)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!shouldHandleSearchShortcut(e, inputRef.current)) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className={`search-field-container ${className}`}>
      <Search size={16} className="search-field-icon" strokeWidth={2} />
      <input
        ref={inputRef}
        type="search"
        className="search-field-input"
        placeholder={resolvedPlaceholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={resolvedPlaceholder}
      />
      {value.length > 0 && (
        <button
          type="button"
          className="search-field-clear icon-btn icon-btn-sm"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          aria-label={ui.common.clear}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};
