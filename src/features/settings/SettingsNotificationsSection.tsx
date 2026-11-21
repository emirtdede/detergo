import React from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { Switch } from "@/components/primitives/Switch";
import { notificationService } from "@/lib/notifications/notification-service";
import { UIText } from "@/lib/ui-text";
import { NotificationChannel, NotificationPreferences } from "@/types";

interface SettingsNotificationsSectionProps {
  ui: UIText;
  notifications?: NotificationPreferences;
  onUpdate: (key: keyof NotificationPreferences, value: NotificationChannel | boolean) => void;
}

const CHANNEL_EVENTS: Array<{
  key: Exclude<keyof NotificationPreferences, "soundEnabled">;
  titleKey: keyof UIText["settings"];
  hintKey: keyof UIText["settings"];
  fallback: NotificationChannel;
}> = [
  { key: "scanComplete", titleKey: "evScanDone", hintKey: "evScanDoneHint", fallback: "both" },
  { key: "cleanComplete", titleKey: "evCleanDone", hintKey: "evCleanDoneHint", fallback: "both" },
  { key: "diskPressure", titleKey: "evDiskAlert", hintKey: "evDiskAlertHint", fallback: "both" },
  {
    key: "processLock",
    titleKey: "evLockConflict",
    hintKey: "evLockConflictHint",
    fallback: "in_app",
  },
  {
    key: "automationWebhook",
    titleKey: "evAutomation",
    hintKey: "evAutomationHint",
    fallback: "both",
  },
];

export const SettingsNotificationsSection: React.FC<SettingsNotificationsSectionProps> = ({
  ui,
  notifications,
  onUpdate,
}) => (
  <section className="settings-card">
    <div className="settings-card-toolbar">
      <Button
        variant="secondary"
        size="sm"
        icon={<Bell size={13} />}
        onClick={() => notificationService.testDesktopNotification()}
      >
        {ui.settings.testDesktop}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => notificationService.testInAppNotification()}
      >
        {ui.settings.testInApp}
      </Button>
    </div>

    <div className="form-row">
      <div>
        <span>{ui.settings.notifSounds}</span>
        <p className="settings-hint">{ui.settings.notifSoundsHint}</p>
      </div>
      <Switch
        checked={notifications?.soundEnabled ?? true}
        onChange={(checked) => onUpdate("soundEnabled", checked)}
        aria-label={ui.settings.notifSounds}
      />
    </div>

    <h4 className="settings-group-title" style={{ marginTop: 20, marginBottom: 8 }}>
      {ui.settings.eventMatrixTitle}
    </h4>

    {CHANNEL_EVENTS.map((ev) => (
      <label key={ev.key} className="form-row">
        <div>
          <span>{ui.settings[ev.titleKey] as string}</span>
          <p className="settings-hint">{ui.settings[ev.hintKey] as string}</p>
        </div>
        <select
          value={notifications?.[ev.key] ?? ev.fallback}
          onChange={(e) => onUpdate(ev.key, e.target.value as NotificationChannel)}
        >
          <option value="both">{ui.settings.chBoth}</option>
          <option value="in_app">{ui.settings.chInApp}</option>
          <option value="desktop">{ui.settings.chDesktop}</option>
          <option value="none">{ui.settings.chNone}</option>
        </select>
      </label>
    ))}
  </section>
);
