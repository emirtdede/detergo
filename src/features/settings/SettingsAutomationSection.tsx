import React from "react";
import { Check, Send, X } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { Switch } from "@/components/primitives/Switch";
import { UIText } from "@/lib/ui-text";
import { AppSettings } from "@/types";

interface SettingsAutomationSectionProps {
  ui: UIText;
  webhookUrl?: string | null;
  webhookDraft: string | null;
  webhookOnScan?: boolean;
  webhookOnClean?: boolean;
  allowPrivateWebhooks?: boolean;
  mcpAllowDestructive?: boolean;
  testingWebhook: boolean;
  webhookTestStatus: { success: boolean; text: string } | null;
  onDraftChange: (value: string) => void;
  onCommitWebhook: () => void;
  onTestWebhook: () => void;
  onSave: (patch: Partial<AppSettings>) => void;
}

export const SettingsAutomationSection: React.FC<SettingsAutomationSectionProps> = ({
  ui,
  webhookUrl,
  webhookDraft,
  webhookOnScan,
  webhookOnClean,
  allowPrivateWebhooks,
  mcpAllowDestructive,
  testingWebhook,
  webhookTestStatus,
  onDraftChange,
  onCommitWebhook,
  onTestWebhook,
  onSave,
}) => (
  <section className="settings-card">
    <div className="form-row form-row--stretch">
      <input
        type="url"
        placeholder={ui.settings.webhookPlaceholder}
        value={webhookDraft ?? webhookUrl ?? ""}
        onChange={(e) => onDraftChange(e.target.value)}
        onBlur={onCommitWebhook}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommitWebhook();
          }
        }}
        aria-label={ui.settings.webhookUrl}
      />
      <Button
        variant="primary"
        size="sm"
        icon={<Send size={13} />}
        onClick={onTestWebhook}
        disabled={testingWebhook || (!webhookUrl && !webhookDraft?.trim())}
      >
        {testingWebhook ? ui.settings.webhookSending : ui.settings.webhookTestBtn}
      </Button>
    </div>

    {webhookTestStatus && (
      <p
        className="plan-note"
        style={{
          marginTop: 8,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: webhookTestStatus.success ? "var(--success-text)" : "var(--danger-foreground)",
        }}
      >
        {webhookTestStatus.success ? <Check size={14} /> : <X size={14} />}
        <span>{webhookTestStatus.text}</span>
      </p>
    )}

    <div className="form-row" style={{ marginTop: 16 }}>
      <div>
        <span>{ui.settings.webhookAllowPrivateTitle}</span>
        <p className="settings-hint">{ui.settings.webhookAllowPrivateHint}</p>
      </div>
      <Switch
        checked={allowPrivateWebhooks ?? false}
        onChange={(checked) => onSave({ allowPrivateWebhooks: checked })}
        aria-label={ui.settings.webhookAllowPrivateTitle}
      />
    </div>

    <div className="form-row">
      <div>
        <span>{ui.settings.webhookScanDone}</span>
        <p className="settings-hint">{ui.settings.webhookScanDoneHint}</p>
      </div>
      <Switch
        checked={webhookOnScan ?? true}
        onChange={(checked) => onSave({ webhookOnScan: checked })}
        aria-label={ui.settings.webhookScanDone}
      />
    </div>

    <div className="form-row">
      <div>
        <span>{ui.settings.webhookCleanDone}</span>
        <p className="settings-hint">{ui.settings.webhookCleanDoneHint}</p>
      </div>
      <Switch
        checked={webhookOnClean ?? true}
        onChange={(checked) => onSave({ webhookOnClean: checked })}
        aria-label={ui.settings.webhookCleanDone}
      />
    </div>

    <div className="form-row">
      <div>
        <span>{ui.settings.mcpDestructiveTitle}</span>
        <p className="settings-hint">{ui.settings.mcpDestructiveHint}</p>
      </div>
      <Switch
        checked={mcpAllowDestructive ?? false}
        onChange={(checked) => onSave({ mcpAllowDestructive: checked })}
        aria-label={ui.settings.mcpDestructiveTitle}
      />
    </div>
  </section>
);
