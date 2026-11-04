import React from "react";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react";
import { useUiStore } from "@/stores/ui-store";
import { useUIText } from "@/lib/ui-text";
import "./primitives.css";

export const Toast: React.FC = () => {
  const ui = useUIText();
  const toast = useUiStore((s) => s.toast);
  const clearToast = useUiStore((s) => s.clearToast);

  if (!toast) return null;

  const renderIcon = () => {
    switch (toast.type) {
      case "success":
        return <CheckCircle2 size={18} color="var(--success)" />;
      case "error":
        return <AlertCircle size={18} color="var(--danger)" />;
      case "warning":
        return <AlertTriangle size={18} color="var(--warning)" />;
      case "info":
      default:
        return <Info size={18} color="var(--accent)" />;
    }
  };

  const isError = toast.type === "error";

  return (
    <div
      className={`toast-container toast-${toast.type}`}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
    >
      {renderIcon()}
      <span>{toast.message}</span>
      <button
        type="button"
        className="icon-btn icon-btn-sm"
        onClick={clearToast}
        aria-label={ui.common.close}
      >
        <X size={14} />
      </button>
    </div>
  );
};
