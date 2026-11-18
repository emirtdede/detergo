/**
 * Desktop Guard & Shell Hardening
 *
 * Prevents Microsoft Edge WebView2 from leaking browser behaviors into the
 * native desktop application:
 * 1. Blocks native browser shortcuts (Ctrl+J Downloads flyout, Ctrl+P Print,
 *    Ctrl+U View Source, Ctrl+S Save Page, Ctrl+H History, Ctrl+D Bookmarks, etc.).
 * 2. Neutralizes accidental viewport zooming via Ctrl + MouseWheel or Ctrl + +/-/0.
 * 3. Prevents accidental file drag-and-drop from navigating away from the React SPA.
 * 4. Eliminates the browser right-click context menu ("Back", "Reload", "Print",
 *    "Inspect") on application chrome, keeping it strictly on editable inputs.
 * 5. Disables mouse side-buttons (Back/Forward) and Alt+Arrow navigation from
 *    unloading the current view.
 */

export interface DesktopGuardOptions {
  /** If true, developer tools and refresh shortcuts remain accessible (default: false in prod). */
  isDev?: boolean;
}

/**
 * Checks whether a given keyboard event corresponds to an Edge/Chromium browser
 * accelerator that should be suppressed in a desktop application.
 */
export function isBrowserShortcutToBlock(e: KeyboardEvent, isDev: boolean = false): boolean {
  const ctrlOrMeta = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  const code = e.code;

  // 1. Edge Downloads flyout (the exact bug: Ctrl + J)
  if (ctrlOrMeta && key === "j" && !e.shiftKey && !e.altKey) {
    return true;
  }

  // 2. Browser Print (Ctrl + P)
  if (ctrlOrMeta && key === "p" && !e.shiftKey && !e.altKey) {
    return true;
  }

  // 3. View Source (Ctrl + U)
  if (ctrlOrMeta && key === "u" && !e.shiftKey && !e.altKey) {
    return true;
  }

  // 4. Save Page As (Ctrl + S)
  if (ctrlOrMeta && key === "s" && !e.shiftKey && !e.altKey) {
    return true;
  }

  // 5. Browser History panel (Ctrl + H)
  if (ctrlOrMeta && key === "h" && !e.shiftKey && !e.altKey) {
    return true;
  }

  // 6. Browser Favorites/Bookmark dialog (Ctrl + D)
  if (ctrlOrMeta && key === "d" && !e.shiftKey && !e.altKey) {
    return true;
  }

  // 7. Browser Find in Page (Ctrl + F, Ctrl + G, F3, Shift + F3).
  //    Ctrl+F is the actual WebView2 accelerator; leaving it unblocked let the
  //    native find overlay open on top of the SPA.
  if (ctrlOrMeta && key === "f" && !e.shiftKey && !e.altKey) {
    return true;
  }
  if (ctrlOrMeta && key === "g") {
    return true;
  }
  if (key === "f3") {
    return true;
  }

  // 8. Open File (Ctrl + O)
  if (ctrlOrMeta && key === "o" && !e.shiftKey && !e.altKey) {
    return true;
  }

  // 9. New Window (Ctrl + N), New Tab (Ctrl + T), Close Tab (Ctrl + W)
  if (ctrlOrMeta && (key === "n" || key === "t" || key === "w") && !e.shiftKey && !e.altKey) {
    return true;
  }

  // 10. Help (F1)
  if (key === "f1") {
    return true;
  }

  // 11. Caret Browsing (F7)
  if (key === "f7") {
    return true;
  }

  // 12. Page Reload (F5, Ctrl + R, Ctrl + F5)
  // In production desktop apps, accidental reloads wipe in-memory scan progress.
  if (!isDev) {
    if (key === "f5") return true;
    if (ctrlOrMeta && (key === "r" || code === "KeyR")) return true;
  }

  // 13. DevTools (F12, Ctrl + Shift + I, Ctrl + Shift + J, Ctrl + Shift + C)
  if (!isDev) {
    if (key === "f12") return true;
    if (ctrlOrMeta && e.shiftKey && (key === "i" || key === "j" || key === "c")) return true;
  }

  // 14. Edge feature flyouts
  // Ctrl + Shift + Delete (Clear browsing data)
  if (ctrlOrMeta && e.shiftKey && (key === "delete" || code === "Delete")) {
    return true;
  }
  // Edge flyouts: Favorites (O), Favorites bar (B), Read aloud (U), Collections (Y), Profile (M), Web capture (S), Search (E)
  if (ctrlOrMeta && e.shiftKey && ["o", "b", "u", "y", "m", "s", "e"].includes(key)) {
    return true;
  }

  // 15. Viewport Zoom Shortcuts: Ctrl + '+', Ctrl + '-', Ctrl + '=', Ctrl + '_', Ctrl + '0'
  if (
    ctrlOrMeta &&
    (key === "=" ||
      key === "+" ||
      key === "-" ||
      key === "_" ||
      key === "0" ||
      code === "NumpadAdd" ||
      code === "NumpadSubtract")
  ) {
    return true;
  }

  // 16. Browser History Back/Forward shortcuts: Alt + ArrowLeft, Alt + ArrowRight
  if (e.altKey && (key === "arrowleft" || key === "arrowright")) {
    return true;
  }

  // 17. Backspace outside text inputs (prevents accidental page back navigation)
  if (key === "backspace") {
    const target = e.target as HTMLElement | null;
    const isInput =
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        target.getAttribute("role") === "textbox");
    if (!isInput) {
      return true;
    }
  }

  return false;
}

/**
 * Installs window-level event listeners with capturing phase to intercept and
 * neutralize Edge WebView2 native browser artifacts.
 */
export function installDesktopGuard(options?: DesktopGuardOptions): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const isDev = options?.isDev ?? Boolean(import.meta.env?.DEV);

  // 1. Keyboard Accelerator Shield (Capturing phase ensures it runs before WebView2 acts)
  const onKeyDown = (e: KeyboardEvent) => {
    if (isBrowserShortcutToBlock(e, isDev)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // 2. Prevent Ctrl + MouseWheel Zooming
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
    }
  };

  // 3. Prevent external file drop from navigating the window away
  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
  };

  // 4. Eliminate native browser context menu on general app chrome
  // Allows native menu only on text inputs / textareas for cut, copy, paste
  const onContextMenu = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const isEditable =
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        target.getAttribute("role") === "textbox");

    if (!isEditable) {
      e.preventDefault();
    }
  };

  // 5. Prevent mouse side buttons (Back / Forward) from navigating WebView history
  const onPointerDown = (e: MouseEvent) => {
    if (e.button === 3 || e.button === 4) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  window.addEventListener("keydown", onKeyDown, { capture: true });
  window.addEventListener("wheel", onWheel, { passive: false, capture: true });
  window.addEventListener("dragover", onDragOver, { capture: true });
  window.addEventListener("drop", onDrop, { capture: true });
  window.addEventListener("contextmenu", onContextMenu, { capture: true });
  window.addEventListener("pointerdown", onPointerDown, { capture: true });

  return () => {
    window.removeEventListener("keydown", onKeyDown, { capture: true });
    window.removeEventListener("wheel", onWheel, { capture: true });
    window.removeEventListener("dragover", onDragOver, { capture: true });
    window.removeEventListener("drop", onDrop, { capture: true });
    window.removeEventListener("contextmenu", onContextMenu, { capture: true });
    window.removeEventListener("pointerdown", onPointerDown, { capture: true });
  };
}
