import { KnownLocation } from "@/types";
import type { UIText } from "@/lib/ui-text";

/**
 * Maps known location IDs (from the Windows/macOS/Linux platform detector) to
 * the labels of the active UI language.
 */
export function getKnownLocationLabel(loc: KnownLocation, ui: UIText): string {
  if (loc.id === "loc-desktop" || loc.id === "desktop") return ui.locations.desktop;
  if (loc.id === "loc-documents" || loc.id === "documents") return ui.locations.documents;
  if (loc.id === "loc-Projects" || loc.id === "projects") return ui.locations.projects;
  if (loc.id === "loc-Code" || loc.id === "code") return ui.locations.code;
  if (loc.id === "loc-Dev" || loc.id === "loc-Development" || loc.id === "dev")
    return ui.locations.dev;
  if (loc.id === "loc-source-repos" || loc.id === "repos") return ui.locations.repos;
  return loc.label;
}
