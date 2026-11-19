import React, { useState } from "react";
import { Download, RefreshCw, Rocket, ShieldCheck } from "lucide-react";

import { Button } from "@/components/primitives/Button";
import { useUiStore } from "@/stores/ui-store";
import { useUIText } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { log } from "@/lib/logging";
import { RELEASES_URL } from "@/lib/links";
import { APP_VERSION } from "@/lib/app-version";
import type { UpdateInfo } from "@/types";

type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "ok"; info: UpdateInfo }
  | { kind: "error" };

interface UpdatePanelProps {
  version: string;
  /** Hides the inner card header when the parent section already renders one. */
  hideHeader?: boolean;
}

/**
 * User-initiated update check.
 *
 * The backend asks the public GitHub Releases API for the newest tag and does a
 * semver comparison; this panel only renders the answer and offers the release
 * page. Nothing is downloaded or installed automatically, so the "no silent
 * network request" promise stays true: the request happens only after a click.
 */
export const UpdatePanel: React.FC<UpdatePanelProps> = ({ version, hideHeader = false }) => {
  const ui = useUIText();
  const showToast = useUiStore((s) => s.showToast);
  const [state, setState] = useState<CheckState>({ kind: "idle" });

  const displayVersion = version && version !== "—" ? version : APP_VERSION;

  const check = async () => {
    setState({ kind: "checking" });
    try {
      const info = await scannerApi.checkForUpdates();
      setState({ kind: "ok", info });
    } catch (err) {
      log.warn("Update check failed", err);
      setState({ kind: "error" });
    }
  };

  const openRelease = (url: string) => {
    scannerApi.openUrl(url).catch((err) => {
      log.warn("Could not open the release page", err);
      showToast(ui.errors.title, "error");
    });
  };

  const info = state.kind === "ok" ? state.info : null;
  const notes = info?.notes?.trim() ?? "";

  return (
    <section className="about-bento-panel about-update-panel">
      {!hideHeader && (
        <div className="about-panel-header">
          <div className="about-panel-icon about-panel-icon--accent">
            <Rocket size={18} />
          </div>
          <div className="about-panel-title-group">
            <h2 className="about-panel-title">{ui.updates.title}</h2>
            <span className="about-panel-desc">{ui.updates.hint}</span>
          </div>
        </div>
      )}

      <div className="about-meta-list">
        <div className="about-meta-row">
          <span className="about-meta-label">{ui.about.appVersion}</span>
          <span className="about-meta-value">v{displayVersion}</span>
        </div>
        {info && (
          <div className="about-meta-row">
            <span className="about-meta-label">{ui.updates.latestVersion}</span>
            <span className="about-meta-value">v{info.latestVersion}</span>
          </div>
        )}
      </div>

      {state.kind === "ok" && !info?.available && (
        <div className="about-trust-strip">
          <ShieldCheck size={18} className="about-trust-icon" />
          <span>{ui.updates.upToDate}</span>
        </div>
      )}

      {state.kind === "error" && (
        <p className="items-warning" role="status">
          {ui.updates.failed}
        </p>
      )}

      {info?.available && (
        <div className="about-update-available">
          <p className="about-update-banner" role="status">
            {ui.updates.available(info.latestVersion)}
          </p>
          {notes && (
            <details className="about-update-notes">
              <summary>{ui.updates.notes}</summary>
              <pre className="about-update-notes-body">{notes}</pre>
            </details>
          )}
        </div>
      )}

      <div className="about-update-actions">
        <Button
          size="sm"
          variant="secondary"
          icon={<RefreshCw size={13} />}
          onClick={check}
          disabled={state.kind === "checking"}
        >
          {state.kind === "checking" ? ui.updates.checking : ui.updates.check}
        </Button>
        {info?.available && (
          <Button
            size="sm"
            variant="primary"
            icon={<Download size={13} />}
            onClick={() => openRelease(info.releaseUrl || RELEASES_URL)}
          >
            {ui.updates.download}
          </Button>
        )}
      </div>

      <p className="about-update-privacy">{ui.updates.privacy}</p>
    </section>
  );
};
