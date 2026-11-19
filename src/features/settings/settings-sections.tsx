import React from "react";
import {
  Bell,
  Bug,
  Keyboard,
  Cpu,
  ListChecks,
  Rocket,
  ShieldCheck,
  SlidersHorizontal,
  UserRoundCog,
  Webhook,
} from "lucide-react";
import { SettingsSection } from "@/stores/ui-store";
import { useUIText } from "@/lib/ui-text";

export interface SettingsSectionDef {
  id: SettingsSection;
  label: string;
  hint: string;
  icon: React.ReactNode;
}

/**
 * Single source of truth for settings subpages. The settings view owns the
 * configuration sections (General, Scan, Protections, Agents, Privacy).
 * Informational / Legal content has been extracted to the dedicated About view.
 */
export function useSettingsSections(): SettingsSectionDef[] {
  const ui = useUIText();
  return [
    {
      id: "general",
      label: ui.settings.general,
      hint: ui.settings.generalHint,
      icon: <SlidersHorizontal size={15} />,
    },
    {
      id: "scan",
      label: ui.settings.scan,
      hint: ui.settings.scanHint,
      icon: <Cpu size={15} />,
    },
    {
      id: "notifications",
      label: ui.settings.notifTitle,
      hint: ui.settings.notifDesc,
      icon: <Bell size={15} />,
    },
    {
      id: "shortcuts",
      label: ui.settings.shortcutsTitle,
      hint: ui.settings.shortcutsDesc,
      icon: <Keyboard size={15} />,
    },
    {
      id: "automation",
      label: ui.settings.webhookTitle,
      hint: ui.settings.webhookDesc,
      icon: <Webhook size={15} />,
    },
    {
      id: "protections",
      label: ui.settings.protections,
      hint: ui.settings.protectionsHint,
      icon: <ShieldCheck size={15} />,
    },
    {
      id: "agents",
      label: ui.settings.agents,
      hint: ui.settings.agentsHint,
      icon: <UserRoundCog size={15} />,
    },
    {
      id: "privacy",
      label: ui.settings.privacy,
      hint: ui.settings.privacyHint,
      icon: <ListChecks size={15} />,
    },
    {
      id: "updates",
      label: ui.updates.title,
      hint: ui.updates.hint,
      icon: <Rocket size={15} />,
    },
    {
      id: "diagnostics",
      label: ui.diagnostics.title,
      hint: ui.diagnostics.hint,
      icon: <Bug size={15} />,
    },
  ];
}
