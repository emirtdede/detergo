import { KnownLocation } from "@/types";
import type { UIText } from "@/lib/ui-text";

/**
 * Maps known location IDs (from the Windows/macOS/Linux platform detector) to
 * the labels of the active UI language.
 */
export function getKnownLocationLabel(loc: KnownLocation, ui: UIText): string {
  if (loc.id === "loc-all-drives" || loc.source === "all-drives") return ui.common.allDrives;
  if (loc.id === "loc-desktop" || loc.id === "desktop") return ui.locations.desktop;
  if (loc.id === "loc-documents" || loc.id === "documents") return ui.locations.documents;
  if (loc.id === "loc-Projects" || loc.id === "projects") return ui.locations.projects;
  if (loc.id === "loc-Code" || loc.id === "code") return ui.locations.code;
  if (loc.id === "loc-Dev" || loc.id === "loc-Development" || loc.id === "dev")
    return ui.locations.dev;
  if (loc.id === "loc-source-repos" || loc.id === "repos") return ui.locations.repos;
  if (loc.id === "loc-workspace" || loc.id === "workspace") return ui.locations.workspace;
  if (loc.id === "loc-workspaces" || loc.id === "workspaces") return ui.locations.workspaces;

  if (loc.id.startsWith("loc-drive-root-")) {
    const letter = loc.id.replace("loc-drive-root-", "");
    return `${letter}: (${ui.common.allDrives})`;
  }

  if (loc.id.startsWith("loc-drive-")) {
    const parts = loc.id.split("-");
    if (parts.length >= 4) {
      const driveLetter = parts[2];
      const folderKey = parts[3].toLowerCase();
      let folderName = folderKey;
      if (folderKey === "projects") folderName = ui.locations.projects;
      else if (folderKey === "code") folderName = ui.locations.code;
      else if (folderKey === "dev" || folderKey === "development") folderName = ui.locations.dev;
      else if (folderKey === "workspace") folderName = ui.locations.workspace;
      else if (folderKey === "workspaces") folderName = ui.locations.workspaces;
      return `${folderName} (${driveLetter}:)`;
    }
  }

  if (loc.label === "All drives (full scan)") {
    return ui.common.allDrives;
  }
  const driveFullMatch = loc.label.match(/^Drive\s+([A-Za-z]:?)\s*\(full\)$/i);
  if (driveFullMatch) {
    const driveStr = driveFullMatch[1].endsWith(":") ? driveFullMatch[1] : `${driveFullMatch[1]}:`;
    return `${driveStr} (${ui.common.allDrives})`;
  }

  return loc.label;
}
