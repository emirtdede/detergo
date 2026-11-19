import { describe, expect, it, beforeEach, beforeAll } from "vitest";
import {
  ERROR_LOG_LIMIT,
  ERROR_LOG_STORAGE_KEY,
  clearErrorLog,
  formatErrorLog,
  installErrorLogCapture,
  readErrorLog,
  recordError,
} from "../lib/diagnostics/error-log";

const storageMap = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storageMap.set(key, value);
  },
  removeItem: (key: string) => {
    storageMap.delete(key);
  },
  clear: () => {
    storageMap.clear();
  },
};

beforeAll(() => {
  Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });
});

beforeEach(() => {
  localStorageMock.clear();
});

describe("error log", () => {
  it("stores the newest entry first", () => {
    recordError("command", new Error("first"));
    recordError("command", new Error("second"));
    expect(readErrorLog().map((entry) => entry.message)).toEqual(["second", "first"]);
  });

  it("deduplicates an error that is already the newest entry", () => {
    expect(recordError("command", new Error("boom"))).not.toBeNull();
    expect(recordError("command", new Error("boom"))).toBeNull();
  });

  it("keeps a different source or message as a separate entry", () => {
    recordError("window", new Error("boom"));
    recordError("promise", new Error("boom"));
    recordError("window", new Error("other"));
    expect(readErrorLog()).toHaveLength(3);
  });

  it("keeps a backend error code", () => {
    const entry = recordError("command", { code: "AccessDenied", message: "Denied" });
    expect(entry?.code).toBe("AccessDenied");
    expect(readErrorLog()[0].code).toBe("AccessDenied");
  });

  it("masks absolute user paths before storing them", () => {
    recordError("render", new Error("Failed to open C:\\Users\\alice\\secret\\file.txt"));
    const [entry] = readErrorLog();
    expect(entry.message).not.toContain("alice");
  });

  it("redacts webhook credentials down to the origin", () => {
    recordError("command", new Error("POST https://hooks.example.com/services/T00/B00/XXX failed"));
    const [entry] = readErrorLog();
    expect(entry.message).toContain("https://hooks.example.com");
    expect(entry.message).not.toContain("XXX");
  });

  it("bounds the log so a crash loop cannot grow it forever", () => {
    for (let i = 0; i < ERROR_LOG_LIMIT + 5; i += 1) {
      recordError("window", new Error(`failure ${i}`));
    }
    expect(readErrorLog()).toHaveLength(ERROR_LOG_LIMIT);
    // The newest entry survives and the oldest is dropped.
    expect(readErrorLog()[0].message).toBe(`failure ${ERROR_LOG_LIMIT + 4}`);
  });

  it("falls back to the error name when the message is empty", () => {
    expect(recordError("window", new Error(""))?.message).toBe("Error");
    expect(recordError("window", null)).toBeNull();
  });

  it("survives a corrupt stored value", () => {
    localStorage.setItem(ERROR_LOG_STORAGE_KEY, "{ not json");
    expect(readErrorLog()).toEqual([]);
  });

  it("drops entries that do not match the stored shape", () => {
    localStorage.setItem(
      ERROR_LOG_STORAGE_KEY,
      JSON.stringify([{ id: "1", at: "nope", source: "window", message: "x" }, "junk"]),
    );
    expect(readErrorLog()).toEqual([]);
  });

  it("clears every entry", () => {
    recordError("window", new Error("boom"));
    clearErrorLog();
    expect(readErrorLog()).toEqual([]);
  });

  it("formats entries as one line each for the clipboard", () => {
    const text = formatErrorLog([
      {
        id: "1",
        at: "2026-11-18T10:00:00.000Z",
        source: "command",
        code: "Network",
        message: "Timeout",
      },
    ]);
    expect(text).toBe("[2026-11-18T10:00:00.000Z] (command) Network: Timeout");
  });
});

describe("window error capture", () => {
  /** A detached target keeps jsdom's own rejection handler out of the test. */
  const fakeWindow = () => new EventTarget() as unknown as Window;

  it("records uncaught errors and promise rejections, and detaches cleanly", () => {
    const target = fakeWindow();
    const dispose = installErrorLogCapture(target);
    try {
      target.dispatchEvent(Object.assign(new Event("error"), { error: new Error("render crash") }));
      target.dispatchEvent(
        Object.assign(new Event("unhandledrejection"), { reason: new Error("rejected") }),
      );
      const entries = readErrorLog();
      expect(entries.map((entry) => entry.source)).toEqual(["promise", "window"]);
    } finally {
      dispose();
    }

    target.dispatchEvent(Object.assign(new Event("error"), { error: new Error("late") }));
    expect(readErrorLog().some((entry) => entry.message === "late")).toBe(false);
  });

  it("ignores a resource-load error, which carries no Error object", () => {
    const target = fakeWindow();
    const dispose = installErrorLogCapture(target);
    try {
      target.dispatchEvent(new Event("error"));
      expect(readErrorLog()).toEqual([]);
    } finally {
      dispose();
    }
  });
});
