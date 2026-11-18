import React, { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { useUIText } from "@/lib/ui-text";
import { useUiStore } from "@/stores/ui-store";
import { IconButton } from "./IconButton";
import "./primitives.css";

export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Open dialogs, in mount order. `keydown` reaches every listener on the same
 * target, so without this stack one Escape ran *every* open dialog's
 * `onClose`: dismissing the close guard also cleared the pending cleanup plan
 * (or the finished cleanup report) underneath it.
 */
const dialogStack: HTMLElement[] = [];

export const Dialog: React.FC<DialogProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  maxWidth = "520px",
}) => {
  const ui = useUIText();
  const titleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  // Whether the current press started on the overlay itself. A drag that ends
  // over the overlay (text selection starting inside the dialog) also fires a
  // `click` whose target is the overlay; without tracking the press origin that
  // dismissed a dialog the user was actively interacting with.
  const overlayPressRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Every dialog counts, not only the ones tracked by `activeModal`. The
  // counter is incremented on mount and decremented on unmount, so nested
  // dialogs keep the background shortcuts disabled until the last one closes.
  useEffect(() => {
    if (!isOpen) return;
    useUiStore.getState().pushDialog();
    return () => useUiStore.getState().popDialog();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const modal = modalRef.current;
    if (modal) dialogStack.push(modal);
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const getFocusable = () =>
      modal
        ? Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
            (element) => element.getClientRects().length > 0,
          )
        : [];

    // Focus the dialog itself so its accessible name is announced before the
    // first control; the trap below keeps Tab inside from there.
    const frame = requestAnimationFrame(() => {
      modal?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      // Only the top-most dialog owns the keyboard. Every open Dialog
      // registered its own window listener, and `preventDefault()` does not
      // stop the other listeners.
      if (dialogStack[dialogStack.length - 1] !== modal) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        modal?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === modal)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || active === modal)) {
        event.preventDefault();
        first.focus();
      } else if (!modal?.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      const index = modal ? dialogStack.lastIndexOf(modal) : -1;
      if (index !== -1) dialogStack.splice(index, 1);
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="dialog-overlay"
      onPointerDown={(event) => {
        // Only a press that starts outside the modal counts as a dismissal
        // gesture; a drag that merely ends there must not close the dialog.
        overlayPressRef.current = event.target === event.currentTarget;
      }}
      onPointerCancel={() => {
        overlayPressRef.current = false;
      }}
      onClick={(event) => {
        const pressedOnOverlay = overlayPressRef.current;
        overlayPressRef.current = false;
        if (pressedOnOverlay && event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className="dialog-modal"
        style={{ maxWidth }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={modalRef}
        tabIndex={-1}
      >
        <div className="dialog-header">
          <h2 id={titleId} className="dialog-title">
            {title}
          </h2>
          <IconButton size="sm" aria-label={ui.common.close} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>

        <div className="dialog-body">{children}</div>

        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>
  );
};
