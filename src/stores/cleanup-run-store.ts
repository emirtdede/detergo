import { create } from "zustand";

import { CleanupEvent, CleanupReport } from "@/types";

export interface CleanupProgress {
  status: "running" | "cancelling";
  planId: string;
  total: number;
  processed: number;
  currentPath: string | null;
  /** True when the run continues while its dialog is hidden. */
  background: boolean;
}

interface CleanupRunState {
  progress: CleanupProgress | null;
  lastReport: CleanupReport | null;
  start: (planId: string, total: number, background: boolean) => void;
  applyEvent: (event: CleanupEvent) => void;
  markCancelling: () => void;
  finish: (report: CleanupReport) => void;
  dismiss: () => void;
}

/**
 * Live state for a running cleanup. Kept outside the UI store because the run
 * must survive the plan dialog closing when the user sends it to the
 * background.
 */
export const useCleanupRunStore = create<CleanupRunState>((set) => ({
  progress: null,
  lastReport: null,

  start: (planId, total, background) =>
    set({
      progress: {
        status: "running",
        planId,
        total,
        processed: 0,
        currentPath: null,
        background,
      },
    }),

  applyEvent: (event) =>
    set((state) => {
      if (!state.progress) return state;
      switch (event.type) {
        case "started":
          return {
            progress: {
              ...state.progress,
              total: event.total,
              processed: 0,
              currentPath: null,
            },
          };
        case "itemStarted":
          return {
            progress: {
              ...state.progress,
              total: event.total,
              currentPath: event.displayPath,
            },
          };
        case "itemFinished":
          return {
            progress: {
              ...state.progress,
              total: event.total,
              processed: event.index,
              currentPath: null,
            },
          };
        case "cancelled":
          return {
            progress: {
              ...state.progress,
              status: "cancelling",
              processed: event.processed,
            },
          };
        default:
          return state;
      }
    }),

  markCancelling: () =>
    set((state) =>
      state.progress ? { progress: { ...state.progress, status: "cancelling" } } : state,
    ),

  finish: (report) => set({ progress: null, lastReport: report }),

  dismiss: () => set({ progress: null, lastReport: null }),
}));
