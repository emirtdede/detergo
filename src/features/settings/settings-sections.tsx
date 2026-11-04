import React from "react";
import {
  Cpu,
  Info,
  ListChecks,
  ShieldCheck,
  SlidersHorizontal,
  UserRoundCog,
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
 * Single source of truth for the settings subpages. The settings view owns the
 * only section navigation; the side rail no longer duplicates this list.
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
      id: "about",
      label: ui.settings.about,
      hint: ui.settings.aboutHint,
      icon: <Info size={15} />,
    },
  ];
}
