import { vi } from "vitest";

import { createMockScannerApi } from "@/lib/tauri/scanner-api.mock";
import type { ScannerApi } from "@/lib/tauri/scanner-api";

export type InvokeHandler = (args: Record<string, unknown> | undefined) => unknown;

export interface InvokeMock {
  invoke: ReturnType<typeof vi.fn>;
  calls: Array<{ command: string; args?: Record<string, unknown> }>;
  reset: () => void;
}

/**
 * Builds a `vi.fn` that behaves like Tauri's `invoke`. Register one handler per
 * command; an unregistered command fails loudly so a test cannot accidentally
 * pass because the bridge returned `undefined`.
 */
export function createInvokeMock(handlers: Record<string, InvokeHandler> = {}): InvokeMock {
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args });
    const handler = handlers[command];
    if (!handler) throw new Error(`Unexpected Tauri command in test: ${command}`);
    return handler(args);
  });
  return {
    invoke,
    calls,
    reset: () => {
      calls.length = 0;
      invoke.mockClear();
    },
  };
}

/** Fully in-memory ScannerApi with per-test overrides. */
export function createFakeScannerApi(overrides: Partial<ScannerApi> = {}): ScannerApi {
  return { ...createMockScannerApi(), ...overrides };
}
