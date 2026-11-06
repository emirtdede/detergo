import React from "react";
import {
  Bell,
  Keyboard,
  Cpu,
  ListChecks,
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
      label: "Bildirimler & Uyarılar",
      hint: "Uygulama içi ve Windows masaüstü bildirim tercihleri",
      icon: <Bell size={15} />,
    },
    {
      id: "shortcuts",
      label: "Klavye Kısayolları",
      hint: "Uygulama içi özel tuş kombinasyonlarını yapılandırın",
      icon: <Keyboard size={15} />,
    },
    {
      id: "automation",
      label: "Otomasyon & Webhook",
      hint: "Webhook endpoint'leri ve otonom tetikleyiciler",
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
  ];
}
