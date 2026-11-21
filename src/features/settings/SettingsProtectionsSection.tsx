import React, { useState } from "react";
import { FolderOpen, Plus, X } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { localizeAppError, UIText } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { AppSettings } from "@/types";

interface SettingsProtectionsSectionProps {
  ui: UIText;
  protectedPaths: string[];
  excludedNames: string[];
  onSave: (patch: Partial<AppSettings>) => void;
  onShowToast: (
    message: string,
    variant?: "info" | "success" | "warning" | "error",
    ms?: number,
  ) => void;
}

export const SettingsProtectionsSection: React.FC<SettingsProtectionsSectionProps> = ({
  ui,
  protectedPaths,
  excludedNames,
  onSave,
  onShowToast,
}) => {
  const [protectedInput, setProtectedInput] = useState("");
  const [excludedInput, setExcludedInput] = useState("");

  const addProtectedPath = () => {
    const value = protectedInput.trim();
    if (!value) return;
    // A relative path never matches a scanned absolute path; reject it upfront.
    const isAbsolute =
      /^[A-Za-z]:\\/.test(value) || value.startsWith("\\\\") || value.startsWith("/");
    if (!isAbsolute) {
      onShowToast(ui.settings.pathMustBeAbsolute, "warning");
      return;
    }
    const normalized = value.replace(/[\\/]+$/, "");
    if (!protectedPaths.some((p) => p.toLowerCase() === normalized.toLowerCase())) {
      onSave({ protectedPaths: [...protectedPaths, normalized] });
    }
    setProtectedInput("");
  };

  const addExcludedName = () => {
    const value = excludedInput.trim();
    if (!value) return;
    if (/[\\/]/.test(value)) {
      onShowToast(ui.settings.excludedNameInvalid, "warning");
      return;
    }
    const normalized = value.toLowerCase();
    if (!excludedNames.some((n) => n.toLowerCase() === normalized)) {
      onSave({ excludedNames: [...excludedNames, value] });
    }
    setExcludedInput("");
  };

  return (
    <>
      <section className="settings-card">
        <h3 className="settings-group-title">{ui.settings.protectedPaths}</h3>
        <div className="form-row form-row--stretch">
          <input
            type="text"
            placeholder={ui.settings.addPath}
            value={protectedInput}
            aria-label={ui.settings.protectedPaths}
            onChange={(e) => setProtectedInput(e.target.value)}
          />
          <Button
            variant="secondary"
            size="sm"
            icon={<FolderOpen size={12} />}
            onClick={async () => {
              try {
                const selected = await scannerApi.selectFolderDialog(ui.settings.protectedPaths);
                if (selected) setProtectedInput(selected);
              } catch (err) {
                onShowToast(`${ui.errors.title}: ${localizeAppError(err, ui)}`, "error", 6000);
              }
            }}
          >
            {ui.common.browse}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus size={12} />}
            onClick={addProtectedPath}
          >
            {ui.common.add}
          </Button>
        </div>
        <div className="list-editor">
          {protectedPaths.length === 0 && <span className="plan-note">{ui.common.none}</span>}
          {protectedPaths.map((path) => (
            <div key={path} className="list-row">
              <span>{path}</span>
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                aria-label={`${ui.settings.remove}: ${path}`}
                onClick={() => onSave({ protectedPaths: protectedPaths.filter((p) => p !== path) })}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="settings-card">
        <h3 className="settings-group-title">{ui.settings.excludedNames}</h3>
        <div className="form-row form-row--stretch">
          <input
            type="text"
            placeholder={ui.settings.excludedNames}
            value={excludedInput}
            aria-label={ui.settings.excludedNames}
            onChange={(e) => setExcludedInput(e.target.value)}
          />
          <Button variant="secondary" size="sm" icon={<Plus size={12} />} onClick={addExcludedName}>
            {ui.common.add}
          </Button>
        </div>
        <div className="list-editor">
          {excludedNames.length === 0 && <span className="plan-note">{ui.common.none}</span>}
          {excludedNames.map((name) => (
            <div key={name} className="list-row">
              <span>{name}</span>
              <button
                type="button"
                className="icon-btn icon-btn-sm"
                aria-label={`${ui.settings.remove}: ${name}`}
                onClick={() => onSave({ excludedNames: excludedNames.filter((n) => n !== name) })}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      </section>
    </>
  );
};
