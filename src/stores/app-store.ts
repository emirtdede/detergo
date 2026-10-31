import { create } from "zustand";

export type AppView = "overview" | "projects" | "agents" | "caches" | "history" | "settings";

interface AppState {
  view: AppView;
  setView: (view: AppView) => void;
}

export const useAppStore = create<AppState>((set) => ({
  view: "overview",
  setView: (view) => set({ view }),
}));
