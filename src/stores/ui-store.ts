import { create } from "zustand";
import { CleanupPlan, CleanupReport, DeleteMode } from "@/types";

export type ModalType =
  | null
  | "settings"
  | "cleanup-plan"
  | "cleanup-result"
  | "official-action";

export type SettingsSection =
  | "general"
  | "scan"
  | "protections"
  | "agents"
  | "privacy"
  | "legal"
  | "about";

export type HistoryTab = "cleanups" | "actions";

/** Documents hosted on the Legal page; the value survives tab switches. */
export type LegalDoc = "eula" | "privacy" | "thirdParty";

export interface ToastMessage {
  id: string;
  message: string;
  type: "info" | "success" | "warning" | "error";
  durationMs?: number;
}

interface UiState {
  activeModal: ModalType;
  searchQuery: string;
  toast: ToastMessage | null;
  pendingDeletionIds: string[];
  pendingMode: DeleteMode;
  plan: CleanupPlan | null;
  report: CleanupReport | null;
  settingsSection: SettingsSection;
  historyTab: HistoryTab;
  legalDoc: LegalDoc;

  openModal: (modal: ModalType) => void;
  closeModal: () => void;
  setSearchQuery: (query: string) => void;
  setSettingsSection: (section: SettingsSection) => void;
  setHistoryTab: (tab: HistoryTab) => void;
  /** Switches the Legal page to a document and opens that section. */
  openLegalDoc: (doc: LegalDoc) => void;
  setLegalDoc: (doc: LegalDoc) => void;
  showToast: (
    message: string,
    type?: "info" | "success" | "warning" | "error",
    durationMs?: number
  ) => void;
  clearToast: () => void;
  setPendingDeletion: (ids: string[], mode?: DeleteMode) => void;
  setPlan: (plan: CleanupPlan | null) => void;
  setReport: (report: CleanupReport | null) => void;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useUiStore = create<UiState>((set) => ({
  activeModal: null,
  searchQuery: "",
  toast: null,
  pendingDeletionIds: [],
  pendingMode: "recycleBin",
  plan: null,
  report: null,
  settingsSection: "general",
  historyTab: "cleanups",
  legalDoc: "eula",

  openModal: (modal) => set({ activeModal: modal }),

  closeModal: () =>
    set({ activeModal: null, pendingDeletionIds: [], plan: null }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  setSettingsSection: (section) => set({ settingsSection: section }),

  setHistoryTab: (tab) => set({ historyTab: tab }),

  openLegalDoc: (doc) => set({ legalDoc: doc, settingsSection: "legal" }),

  setLegalDoc: (doc) => set({ legalDoc: doc }),

  showToast: (message, type = "info", durationMs = 3500) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: { id: "toast-" + Date.now(), message, type, durationMs } });
    toastTimer = setTimeout(() => {
      set({ toast: null });
      toastTimer = null;
    }, durationMs);
  },

  clearToast: () => {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = null;
    set({ toast: null });
  },

  setPendingDeletion: (ids, mode = "recycleBin") =>
    set({ pendingDeletionIds: ids, pendingMode: mode }),

  setPlan: (plan) => set({ plan }),

  setReport: (report) => set({ report }),
}));
