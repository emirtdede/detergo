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
  | "notifications"
  | "shortcuts"
  | "automation"
  | "protections"
  | "agents"
  | "privacy"
  | "about";

/** About hosts the legal documents as a subview rather than a settings page. */
export type AboutPane = "overview" | "legal";

export type HistoryTab = "cleanups" | "actions" | "scans";

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
  aboutPane: AboutPane;
  historyTab: HistoryTab;
  legalDoc: LegalDoc;

  openModal: (modal: ModalType) => void;
  closeModal: () => void;
  setSearchQuery: (query: string) => void;
  setSettingsSection: (section: SettingsSection) => void;
  setAboutPane: (pane: AboutPane) => void;
  setHistoryTab: (tab: HistoryTab) => void;
  /** Opens the legal subview inside About and selects a document. */
  openLegalDoc: (doc: LegalDoc) => void;
  closeLegalDoc: () => void;
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
  aboutPane: "overview",
  historyTab: "cleanups",
  legalDoc: "eula",

  openModal: (modal) => set({ activeModal: modal }),

  closeModal: () =>
    set({ activeModal: null, pendingDeletionIds: [], plan: null }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  setSettingsSection: (section) =>
    set({
      settingsSection: section,
      ...(section === "about" ? {} : { aboutPane: "overview" as AboutPane }),
    }),

  setAboutPane: (aboutPane) => set({ aboutPane }),

  setHistoryTab: (tab) => set({ historyTab: tab }),

  openLegalDoc: (doc) =>
    set({ legalDoc: doc, settingsSection: "about", aboutPane: "legal" }),

  closeLegalDoc: () => set({ aboutPane: "overview" }),

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
