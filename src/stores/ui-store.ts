import { create } from "zustand";
import { CleanupPlan, CleanupReport, DeleteMode } from "@/types";

export type ModalType = null | "settings" | "cleanup-plan" | "cleanup-result" | "official-action";

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
  /**
   * Number of mounted `Dialog` primitives. `activeModal` only covers the
   * plan/result/settings modals, so the global keyboard listener used to leak
   * through Settings, reset confirmations and other plain dialogs.
   */
  dialogDepth: number;
  searchQuery: string;
  toast: ToastMessage | null;
  /**
   * Pending auto-dismiss timer for the visible toast. Kept in state instead of
   * a module variable so an HMR reload cannot leave an orphan timer that keeps
   * writing into a replaced store.
   */
  toastTimerId: ReturnType<typeof setTimeout> | null;
  /** Toasts waiting for the visible slot; part of the state so a test or HMR
   * reload cannot inherit a stale module-level queue. */
  toastQueue: ToastMessage[];
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
  /** Registers a mounted dialog so global shortcuts stay disabled. */
  pushDialog: () => void;
  popDialog: () => void;
  /** Hides the active modal without discarding the plan or pending selection. */
  hideModal: () => void;
  /** Clears plan/report state without touching the active modal. */
  clearPlanState: () => void;
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
    durationMs?: number,
  ) => void;
  clearToast: () => void;
  setPendingDeletion: (ids: string[], mode?: DeleteMode) => void;
  setPlan: (plan: CleanupPlan | null) => void;
  setReport: (report: CleanupReport | null) => void;
}

const MAX_QUEUED_TOASTS = 4;
/**
 * Monotonic toast id. `Date.now()` collided when two messages were raised in
 * the same millisecond, which made queued entries indistinguishable; a counter
 * is unique by construction and monotonic across clock changes.
 */
let toastSequence = 0;

/**
 * Shows one toast and, when it expires, moves on to the next queued one. The
 * store used to expose a single slot, so a transient error overwrote the
 * message the user was reading (and vice versa) with no way to recover it.
 */
function presentToast(
  set: (partial: Partial<UiState>) => void,
  get: () => UiState,
  toast: ToastMessage,
): void {
  const previous = get().toastTimerId;
  if (previous !== null) clearTimeout(previous);

  set({ toast });
  const timer = setTimeout(() => {
    set({ toastTimerId: null });
    const [next, ...rest] = get().toastQueue;
    if (next) {
      set({ toastQueue: rest });
      presentToast(set, get, next);
    } else {
      set({ toast: null });
    }
  }, toast.durationMs ?? 3500);
  set({ toastTimerId: timer });
}

export const useUiStore = create<UiState>((set, get) => ({
  activeModal: null,
  dialogDepth: 0,
  searchQuery: "",
  toast: null,
  toastTimerId: null,
  toastQueue: [],
  pendingDeletionIds: [],
  pendingMode: "recycleBin",
  plan: null,
  report: null,
  settingsSection: "general",
  aboutPane: "overview",
  historyTab: "cleanups",
  legalDoc: "eula",

  openModal: (modal) => set({ activeModal: modal }),

  // Same contract as `clearPlanState`: a closed dialog must not leave a report
  // or a delete mode behind. `CleanupPlanDialog` seeds its local mode from
  // `pendingMode`, so a stale value showed the previous mode for a frame.
  closeModal: () => set({ activeModal: null, pendingDeletionIds: [], plan: null, report: null }),

  pushDialog: () => set((state) => ({ dialogDepth: state.dialogDepth + 1 })),

  popDialog: () => set((state) => ({ dialogDepth: Math.max(0, state.dialogDepth - 1) })),

  hideModal: () => set({ activeModal: null }),

  clearPlanState: () => set({ plan: null, report: null, pendingDeletionIds: [] }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  setSettingsSection: (section) =>
    set({
      settingsSection: section,
      ...(section === "about" ? {} : { aboutPane: "overview" as AboutPane }),
    }),

  setAboutPane: (aboutPane) => set({ aboutPane }),

  setHistoryTab: (tab) => set({ historyTab: tab }),

  openLegalDoc: (doc) => set({ legalDoc: doc, settingsSection: "about", aboutPane: "legal" }),

  closeLegalDoc: () => set({ aboutPane: "overview" }),

  setLegalDoc: (doc) => set({ legalDoc: doc }),

  showToast: (message, type = "info", durationMs = 3500) => {
    const toast: ToastMessage = {
      id: `toast-${++toastSequence}`,
      message,
      type,
      durationMs,
    };
    const timer = get().toastTimerId;
    if (timer !== null) {
      const current = get().toast;
      // The slot was cleared externally (`setState({ toast: null })`, e.g. a
      // reset): show the new message immediately instead of queuing it behind
      // a toast that is no longer on screen.
      if (!current) {
        clearTimeout(timer);
        presentToast(set, get, toast);
        return;
      }
      // An error should not wait behind a routine "refreshed" notice, but the
      // notice must not disappear either: requeue it ahead of the new error.
      if (type === "error" && current.type !== "error") {
        clearTimeout(timer);
        set({ toastQueue: [current, ...get().toastQueue] });
        presentToast(set, get, toast);
        return;
      }
      const queue = [...get().toastQueue, toast];
      if (queue.length > MAX_QUEUED_TOASTS) queue.splice(0, queue.length - MAX_QUEUED_TOASTS);
      set({ toastQueue: queue });
      return;
    }
    presentToast(set, get, toast);
  },

  clearToast: () => {
    const timer = get().toastTimerId;
    if (timer !== null) clearTimeout(timer);
    set({ toast: null, toastQueue: [], toastTimerId: null });
  },

  setPendingDeletion: (ids, mode = "recycleBin") =>
    set({ pendingDeletionIds: ids, pendingMode: mode }),

  setPlan: (plan) => set({ plan }),

  setReport: (report) => set({ report }),
}));

/**
 * Whether a global shortcut must be ignored because a dialog is on screen.
 *
 * `activeModal` alone was not enough: Settings, the close guard and the reset
 * confirmation render `Dialog` without opening a modal, so pressing a shortcut
 * navigated the view behind the dialog.
 */
export function isGlobalShortcutBlocked(
  state: Pick<UiState, "dialogDepth" | "activeModal">,
): boolean {
  return state.dialogDepth > 0 || state.activeModal !== null;
}
