import React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { UIText } from "@/lib/ui-text";
import { DEFAULT_SHORTCUTS } from "@/types";

export interface ShortcutDefinition {
  id: string;
  label: string;
  hint: string;
}

interface SettingsShortcutsSectionProps {
  ui: UIText;
  shortcuts?: Record<string, string>;
  shortcutDefs: ShortcutDefinition[];
  recordingId: string | null;
  conflictWarning: string | null;
  onStartStopRecord: (id: string | null) => void;
  onResetShortcuts: () => void;
}

export const SettingsShortcutsSection: React.FC<SettingsShortcutsSectionProps> = ({
  ui,
  shortcuts,
  shortcutDefs,
  recordingId,
  conflictWarning,
  onStartStopRecord,
  onResetShortcuts,
}) => (
  <section className="settings-card">
    <div className="settings-card-toolbar">
      <Button variant="secondary" size="sm" onClick={onResetShortcuts}>
        <RotateCcw size={13} style={{ marginRight: 6 }} />
        {ui.settings.resetShortcuts}
      </Button>
    </div>

    {conflictWarning && (
      <div className="shortcut-conflict-alert" role="alert">
        <AlertTriangle size={15} />
        <span>{conflictWarning}</span>
      </div>
    )}

    <div className="shortcuts-table-wrap">
      <table className="shortcuts-table">
        <thead>
          <tr>
            <th style={{ width: "35%" }}>{ui.settings.thAction}</th>
            <th style={{ width: "40%" }}>{ui.settings.thDesc}</th>
            <th style={{ width: "25%", textAlign: "right" }}>{ui.settings.thShortcut}</th>
          </tr>
        </thead>
        <tbody>
          {shortcutDefs.map((def) => {
            const currentShortcut =
              (shortcuts ?? DEFAULT_SHORTCUTS)[def.id] ?? DEFAULT_SHORTCUTS[def.id];
            const isRecording = recordingId === def.id;

            return (
              <tr key={def.id}>
                <td>
                  <span className="shortcut-action-name">{def.label}</span>
                </td>
                <td>
                  <span className="shortcut-action-hint">{def.hint}</span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    {isRecording ? (
                      <span className="shortcut-recording-badge">{ui.settings.pressKey}</span>
                    ) : (
                      <span className="shortcut-key-badge">{currentShortcut}</span>
                    )}
                    <Button
                      variant={isRecording ? "primary" : "secondary"}
                      size="sm"
                      onClick={() => onStartStopRecord(isRecording ? null : def.id)}
                    >
                      {isRecording ? ui.common.cancel : ui.settings.changeKey}
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </section>
);
