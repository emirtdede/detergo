import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isBrowserShortcutToBlock, installDesktopGuard } from "../lib/desktop-guard";

describe("Desktop Guard & Edge WebView2 Hardening", () => {
  const createKeyEvent = (
    key: string,
    modifiers: {
      ctrl?: boolean;
      alt?: boolean;
      shift?: boolean;
      meta?: boolean;
      code?: string;
    } = {},
    target?: HTMLElement,
  ): KeyboardEvent => {
    return {
      key,
      code: modifiers.code || "",
      ctrlKey: Boolean(modifiers.ctrl),
      altKey: Boolean(modifiers.alt),
      shiftKey: Boolean(modifiers.shift),
      metaKey: Boolean(modifiers.meta),
      target: target || document.body,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;
  };

  describe("isBrowserShortcutToBlock", () => {
    it("blocks Edge Downloads flyout (Ctrl+J)", () => {
      expect(isBrowserShortcutToBlock(createKeyEvent("j", { ctrl: true }))).toBe(true);
      expect(isBrowserShortcutToBlock(createKeyEvent("J", { ctrl: true }))).toBe(true);
      expect(isBrowserShortcutToBlock(createKeyEvent("j", { meta: true }))).toBe(true);
    });

    it("blocks browser print, view source, save, history, bookmarks, and open", () => {
      expect(isBrowserShortcutToBlock(createKeyEvent("p", { ctrl: true }))).toBe(true); // Print
      expect(isBrowserShortcutToBlock(createKeyEvent("u", { ctrl: true }))).toBe(true); // View Source
      expect(isBrowserShortcutToBlock(createKeyEvent("s", { ctrl: true }))).toBe(true); // Save Page
      expect(isBrowserShortcutToBlock(createKeyEvent("h", { ctrl: true }))).toBe(true); // History
      expect(isBrowserShortcutToBlock(createKeyEvent("d", { ctrl: true }))).toBe(true); // Bookmark
      expect(isBrowserShortcutToBlock(createKeyEvent("o", { ctrl: true }))).toBe(true); // Open File
      expect(isBrowserShortcutToBlock(createKeyEvent("f", { ctrl: true }))).toBe(true); // Find in page
      expect(isBrowserShortcutToBlock(createKeyEvent("g", { ctrl: true }))).toBe(true); // Find next
      expect(isBrowserShortcutToBlock(createKeyEvent("f3"))).toBe(true); // F3 Find
    });

    it("blocks browser window and tab management (Ctrl+N, Ctrl+T, Ctrl+W)", () => {
      expect(isBrowserShortcutToBlock(createKeyEvent("n", { ctrl: true }))).toBe(true);
      expect(isBrowserShortcutToBlock(createKeyEvent("t", { ctrl: true }))).toBe(true);
      expect(isBrowserShortcutToBlock(createKeyEvent("w", { ctrl: true }))).toBe(true);
    });

    it("blocks browser help and caret browsing (F1, F7)", () => {
      expect(isBrowserShortcutToBlock(createKeyEvent("f1"))).toBe(true);
      expect(isBrowserShortcutToBlock(createKeyEvent("f7"))).toBe(true);
    });

    it("preserves WCAG 1.4.4 viewport zoom hotkeys (Ctrl++, Ctrl+-, Ctrl+0, Ctrl+=)", () => {
      expect(isBrowserShortcutToBlock(createKeyEvent("+", { ctrl: true }))).toBe(false);
      expect(isBrowserShortcutToBlock(createKeyEvent("-", { ctrl: true }))).toBe(false);
      expect(isBrowserShortcutToBlock(createKeyEvent("0", { ctrl: true }))).toBe(false);
      expect(isBrowserShortcutToBlock(createKeyEvent("=", { ctrl: true }))).toBe(false);
      expect(isBrowserShortcutToBlock(createKeyEvent("_", { ctrl: true }))).toBe(false);
      expect(isBrowserShortcutToBlock(createKeyEvent("+", { ctrl: true, code: "NumpadAdd" }))).toBe(
        false,
      );
      expect(
        isBrowserShortcutToBlock(createKeyEvent("-", { ctrl: true, code: "NumpadSubtract" })),
      ).toBe(false);
    });

    it("blocks history back/forward navigation keys (Alt+ArrowLeft, Alt+ArrowRight)", () => {
      expect(isBrowserShortcutToBlock(createKeyEvent("arrowleft", { alt: true }))).toBe(true);
      expect(isBrowserShortcutToBlock(createKeyEvent("arrowright", { alt: true }))).toBe(true);
    });

    it("blocks Edge feature flyouts (Ctrl+Shift+Delete, Ctrl+Shift+O, B, U, Y, M, S)", () => {
      expect(isBrowserShortcutToBlock(createKeyEvent("delete", { ctrl: true, shift: true }))).toBe(
        true,
      );
      expect(isBrowserShortcutToBlock(createKeyEvent("o", { ctrl: true, shift: true }))).toBe(true);
      expect(isBrowserShortcutToBlock(createKeyEvent("b", { ctrl: true, shift: true }))).toBe(true);
      expect(isBrowserShortcutToBlock(createKeyEvent("u", { ctrl: true, shift: true }))).toBe(true);
      expect(isBrowserShortcutToBlock(createKeyEvent("y", { ctrl: true, shift: true }))).toBe(true);
      expect(isBrowserShortcutToBlock(createKeyEvent("m", { ctrl: true, shift: true }))).toBe(true);
      expect(isBrowserShortcutToBlock(createKeyEvent("s", { ctrl: true, shift: true }))).toBe(true);
    });

    it("handles reload and devtools differently between prod and dev modes", () => {
      // In production mode (isDev = false), reload and DevTools are blocked
      expect(isBrowserShortcutToBlock(createKeyEvent("f5"), false)).toBe(true);
      expect(isBrowserShortcutToBlock(createKeyEvent("r", { ctrl: true }), false)).toBe(true);
      expect(isBrowserShortcutToBlock(createKeyEvent("f12"), false)).toBe(true);
      expect(
        isBrowserShortcutToBlock(createKeyEvent("i", { ctrl: true, shift: true }), false),
      ).toBe(true);

      // In dev mode (isDev = true), reload and DevTools remain accessible to developer
      expect(isBrowserShortcutToBlock(createKeyEvent("f5"), true)).toBe(false);
      expect(isBrowserShortcutToBlock(createKeyEvent("r", { ctrl: true }), true)).toBe(false);
      expect(isBrowserShortcutToBlock(createKeyEvent("f12"), true)).toBe(false);
      expect(isBrowserShortcutToBlock(createKeyEvent("i", { ctrl: true, shift: true }), true)).toBe(
        false,
      );
    });

    it("preserves standard user text editing actions (Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+A, Ctrl+Z)", () => {
      expect(isBrowserShortcutToBlock(createKeyEvent("c", { ctrl: true }))).toBe(false);
      expect(isBrowserShortcutToBlock(createKeyEvent("v", { ctrl: true }))).toBe(false);
      expect(isBrowserShortcutToBlock(createKeyEvent("x", { ctrl: true }))).toBe(false);
      expect(isBrowserShortcutToBlock(createKeyEvent("a", { ctrl: true }))).toBe(false);
      expect(isBrowserShortcutToBlock(createKeyEvent("z", { ctrl: true }))).toBe(false);
      expect(isBrowserShortcutToBlock(createKeyEvent("y", { ctrl: true }))).toBe(false);
    });

    it("preserves app-specific shortcuts (Ctrl+B, Ctrl+K, Ctrl+Enter, Alt+1..7)", () => {
      expect(isBrowserShortcutToBlock(createKeyEvent("b", { ctrl: true }))).toBe(false);
      expect(isBrowserShortcutToBlock(createKeyEvent("k", { ctrl: true }))).toBe(false);
      expect(isBrowserShortcutToBlock(createKeyEvent("enter", { ctrl: true }))).toBe(false);
      expect(isBrowserShortcutToBlock(createKeyEvent("1", { alt: true }))).toBe(false);
      expect(isBrowserShortcutToBlock(createKeyEvent("2", { alt: true }))).toBe(false);
    });

    it("blocks backspace on general page but preserves it on text inputs", () => {
      const regularDiv = document.createElement("div");
      expect(isBrowserShortcutToBlock(createKeyEvent("backspace", {}, regularDiv))).toBe(true);

      const textInput = document.createElement("input");
      textInput.type = "text";
      expect(isBrowserShortcutToBlock(createKeyEvent("backspace", {}, textInput))).toBe(false);

      const textarea = document.createElement("textarea");
      expect(isBrowserShortcutToBlock(createKeyEvent("backspace", {}, textarea))).toBe(false);
    });
  });

  describe("installDesktopGuard event listeners", () => {
    let uninstall: () => void;

    beforeEach(() => {
      uninstall = installDesktopGuard({ isDev: false });
    });

    afterEach(() => {
      uninstall();
    });

    it("prevents default on Ctrl+J keydown", () => {
      const event = new KeyboardEvent("keydown", {
        key: "j",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      const spy = vi.spyOn(event, "preventDefault");
      window.dispatchEvent(event);
      expect(spy).toHaveBeenCalled();
    });

    it("allows Ctrl+Wheel zooming for WCAG 1.4.4 accessibility", () => {
      const event = new WheelEvent("wheel", {
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      const spy = vi.spyOn(event, "preventDefault");
      window.dispatchEvent(event);
      expect(spy).not.toHaveBeenCalled();
    });

    it("prevents dragover and drop file navigation", () => {
      const dragEvent = new Event("dragover", { bubbles: true, cancelable: true });
      const dragSpy = vi.spyOn(dragEvent, "preventDefault");
      window.dispatchEvent(dragEvent);
      expect(dragSpy).toHaveBeenCalled();

      const dropEvent = new Event("drop", { bubbles: true, cancelable: true });
      const dropSpy = vi.spyOn(dropEvent, "preventDefault");
      window.dispatchEvent(dropEvent);
      expect(dropSpy).toHaveBeenCalled();
    });

    it("prevents context menu on general elements but allows on input elements", () => {
      const div = document.createElement("div");
      document.body.appendChild(div);

      const menuEvent = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(menuEvent, "target", { value: div });
      const menuSpy = vi.spyOn(menuEvent, "preventDefault");
      div.dispatchEvent(menuEvent);
      expect(menuSpy).toHaveBeenCalled();

      // On input, context menu is permitted
      const input = document.createElement("input");
      document.body.appendChild(input);

      const inputMenuEvent = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(inputMenuEvent, "target", { value: input });
      const inputMenuSpy = vi.spyOn(inputMenuEvent, "preventDefault");
      input.dispatchEvent(inputMenuEvent);
      expect(inputMenuSpy).not.toHaveBeenCalled();

      document.body.removeChild(div);
      document.body.removeChild(input);
    });

    it("prevents mouse side button 3 and 4 history navigation", () => {
      const backBtnEvent = new MouseEvent("pointerdown", {
        button: 3,
        bubbles: true,
        cancelable: true,
      });
      const spy3 = vi.spyOn(backBtnEvent, "preventDefault");
      window.dispatchEvent(backBtnEvent);
      expect(spy3).toHaveBeenCalled();

      const forwardBtnEvent = new MouseEvent("pointerdown", {
        button: 4,
        bubbles: true,
        cancelable: true,
      });
      const spy4 = vi.spyOn(forwardBtnEvent, "preventDefault");
      window.dispatchEvent(forwardBtnEvent);
      expect(spy4).toHaveBeenCalled();
    });
  });
});
