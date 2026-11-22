import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FolderOpen,
  Play,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Store,
} from "lucide-react";

import { Button } from "@/components/primitives/Button";
import { useUiStore } from "@/stores/ui-store";
import { useUIText, localizeAppError } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { log } from "@/lib/logging";
import { RELEASES_URL } from "@/lib/links";
import { APP_VERSION } from "@/lib/app-version";
import { formatBytes } from "@/lib/formatters";
import type { DownloadedUpdate, InstallChannel, UpdateInfo } from "@/types";

type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "ok"; info: UpdateInfo }
  | { kind: "error" };

type DownloadState =
  | { kind: "idle" }
  | { kind: "downloading" }
  | { kind: "verified"; result: DownloadedUpdate }
  | { kind: "error"; message: string };

interface UpdatePanelProps {
  version: string;
  /** Hides the inner card header when the parent section already renders one. */
  hideHeader?: boolean;
}

const MS_STORE_PRODUCT_URL = "ms-windows-store://pdp/?productid=9MWNT98V0905";

/**
 * Zero-cost verified update panel.
 *
 * - Detects `InstallChannel` (`msixStore`, `installer`, `portable`) locally.
 * - For Microsoft Store (MSIX) installs, delegates updates strictly to Store
 *   so external `.exe` installers are never offered.
 * - For Installer and Portable builds, reads the rate-limit-free GitHub
 *   Releases CDN `latest-release.json` manifest (with GitHub API fallback),
 *   matches only the compatible package, verifies streaming SHA-256 before
 *   exposing "Run installer" / "Show in Explorer", and never auto-executes.
 */
export const UpdatePanel: React.FC<UpdatePanelProps> = ({ version, hideHeader = false }) => {
  const ui = useUIText();
  const showToast = useUiStore((s) => s.showToast);
  const [channel, setChannel] = useState<InstallChannel | null>(null);
  const [state, setState] = useState<CheckState>({ kind: "idle" });
  const [downloadState, setDownloadState] = useState<DownloadState>({ kind: "idle" });
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    scannerApi
      .getInstallChannel()
      .then((detected) => {
        if (!unmountedRef.current) setChannel(detected);
      })
      .catch(() => {
        if (!unmountedRef.current) setChannel("installer");
      });
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const displayVersion = version && version !== "-" ? version : APP_VERSION;

  const channelLabel = (ch: InstallChannel | null): string => {
    if (ch === "msixStore") return ui.updates.channelMsixStore;
    if (ch === "portable") return ui.updates.channelPortable;
    return ui.updates.channelInstaller;
  };

  const check = async () => {
    setState({ kind: "checking" });
    setDownloadState({ kind: "idle" });
    try {
      const info = await scannerApi.checkForUpdates();
      if (!unmountedRef.current) {
        setChannel(info.installChannel);
        setState({ kind: "ok", info });
      }
    } catch (err) {
      log.warn("Update check failed", err);
      if (!unmountedRef.current) setState({ kind: "error" });
    }
  };

  const openRelease = (url: string) => {
    scannerApi.openUrl(url).catch((err) => {
      log.warn("Could not open external update URL", err);
      showToast(`${ui.errors.title}: ${localizeAppError(err, ui)}`, "error");
    });
  };

  const downloadAndVerify = async () => {
    if (state.kind !== "ok") return;
    const asset = state.info.recommendedAsset;
    if (!asset?.sha256) return;
    setDownloadState({ kind: "downloading" });
    try {
      const result = await scannerApi.downloadAndVerifyUpdate(
        asset.downloadUrl,
        asset.sha256,
        asset.name,
      );
      if (!unmountedRef.current) {
        setDownloadState({ kind: "verified", result });
        showToast(ui.updates.verifiedTitle, "success");
      }
    } catch (err) {
      log.warn("Update download or SHA-256 verification failed", err);
      if (!unmountedRef.current) {
        const message = localizeAppError(err, ui) || ui.updates.downloadFailed;
        setDownloadState({ kind: "error", message });
        showToast(message, "error", 6000);
      }
    }
  };

  const launchVerified = async (path: string) => {
    try {
      await scannerApi.launchDownloadedUpdate(path);
    } catch (err) {
      log.warn("Could not launch verified update", err);
      showToast(`${ui.errors.title}: ${localizeAppError(err, ui)}`, "error");
    }
  };

  const revealVerified = async (path: string) => {
    try {
      await scannerApi.openPathInExplorer(path);
    } catch (err) {
      log.warn("Could not reveal verified update", err);
      showToast(`${ui.errors.title}: ${localizeAppError(err, ui)}`, "error");
    }
  };

  const info = state.kind === "ok" ? state.info : null;
  const effectiveChannel = info?.installChannel ?? channel;
  const isStoreManaged = effectiveChannel === "msixStore" || Boolean(info?.managedByStore);
  const recommended = info?.recommendedAsset ?? null;
  const notes = info?.notes?.trim() ?? "";

  const signatureLabel = (status: DownloadedUpdate["signatureStatus"]) => {
    if (status === "valid") return ui.updates.signatureValid;
    if (status === "untrusted") return ui.updates.signatureUntrusted;
    return ui.updates.signatureUnsigned;
  };

  return (
    <section
      className={
        hideHeader
          ? "settings-card about-update-panel about-update-panel--embedded"
          : "about-bento-panel about-update-panel"
      }
    >
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

      <div className="about-update-bar">
        <div className="about-update-versions">
          <div className="about-update-metric">
            <span className="about-update-metric-label">{ui.about.appVersion}</span>
            <span className="about-update-metric-value">v{displayVersion}</span>
          </div>
          {effectiveChannel && (
            <>
              <span className="about-update-divider" aria-hidden="true" />
              <div className="about-update-metric">
                <span className="about-update-metric-label">{ui.updates.channelLabel}</span>
                <span className="about-update-metric-value about-update-channel-pill">
                  {channelLabel(effectiveChannel)}
                </span>
              </div>
            </>
          )}
          {info && (
            <>
              <span className="about-update-divider" aria-hidden="true" />
              <div className="about-update-metric">
                <span className="about-update-metric-label">{ui.updates.latestVersion}</span>
                <span className="about-update-metric-value">v{info.latestVersion}</span>
              </div>
            </>
          )}
        </div>

        <div className="about-update-actions">
          {isStoreManaged ? (
            <Button
              size="sm"
              variant="primary"
              icon={<Store size={13} />}
              onClick={() => openRelease(MS_STORE_PRODUCT_URL)}
            >
              {ui.updates.openStore}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              icon={<RefreshCw size={13} />}
              onClick={check}
              disabled={state.kind === "checking" || downloadState.kind === "downloading"}
            >
              {state.kind === "checking" ? ui.updates.checking : ui.updates.check}
            </Button>
          )}
          {!isStoreManaged && info?.available && (
            <Button
              size="sm"
              variant="secondary"
              icon={<ExternalLink size={13} />}
              onClick={() => openRelease(info.releaseUrl || RELEASES_URL)}
            >
              {ui.updates.download}
            </Button>
          )}
        </div>
      </div>

      {isStoreManaged && (
        <div className="about-trust-strip" role="status">
          <Store size={16} className="about-trust-icon" aria-hidden="true" />
          <span>{ui.updates.storeManaged}</span>
        </div>
      )}

      {!isStoreManaged && state.kind === "ok" && !info?.available && (
        <div className="about-trust-strip" role="status">
          <ShieldCheck size={16} className="about-trust-icon" aria-hidden="true" />
          <span>{ui.updates.upToDate}</span>
        </div>
      )}

      {state.kind === "error" && (
        <p className="items-warning" role="status">
          {ui.updates.failed}
        </p>
      )}

      {!isStoreManaged && info?.available && (
        <div className="about-update-available">
          <p className="about-update-banner" role="status">
            {ui.updates.available(info.latestVersion)}
          </p>

          {!isStoreManaged && recommended && (
            <div className="update-package-card">
              <div className="update-package-meta">
                <span className="update-package-name">{recommended.name}</span>
                <span className="update-package-details">
                  {formatBytes(recommended.size)}
                  {recommended.sha256 ? ` · SHA-256: ${recommended.sha256.slice(0, 16)}...` : ""}
                </span>
              </div>

              <div className="update-package-actions">
                {recommended.sha256 && downloadState.kind !== "verified" && (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Download size={13} />}
                    onClick={() => void downloadAndVerify()}
                    disabled={downloadState.kind === "downloading"}
                  >
                    {downloadState.kind === "downloading"
                      ? ui.updates.downloading
                      : ui.updates.downloadVerify}
                  </Button>
                )}
              </div>
            </div>
          )}

          {downloadState.kind === "error" && (
            <p className="items-warning" role="alert">
              {downloadState.message}
            </p>
          )}

          {downloadState.kind === "verified" && (
            <div className="update-verified-card" role="status">
              <div className="update-verified-head">
                <CheckCircle2 size={16} className="about-trust-icon" aria-hidden="true" />
                <div className="update-verified-copy">
                  <strong>{ui.updates.verifiedTitle}</strong>
                  <span className="update-verified-hash">
                    {downloadState.result.fileName} ({formatBytes(downloadState.result.bytes)}) ·{" "}
                    {downloadState.result.sha256.slice(0, 20)}...
                  </span>
                </div>
              </div>

              <div
                className={`update-sig-badge ${
                  downloadState.result.signatureStatus === "untrusted"
                    ? "update-sig-badge--warn"
                    : ""
                }`}
              >
                {downloadState.result.signatureStatus === "untrusted" ? (
                  <AlertTriangle size={13} aria-hidden="true" />
                ) : (
                  <ShieldCheck size={13} aria-hidden="true" />
                )}
                <span>{signatureLabel(downloadState.result.signatureStatus)}</span>
              </div>

              <div className="update-verified-actions">
                {effectiveChannel === "installer" && (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Play size={13} />}
                    onClick={() => void launchVerified(downloadState.result.path)}
                  >
                    {ui.updates.launchInstaller}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<FolderOpen size={13} />}
                  onClick={() => void revealVerified(downloadState.result.path)}
                >
                  {ui.diagnostics.reveal}
                </Button>
              </div>
            </div>
          )}

          {notes && (
            <details className="about-update-notes">
              <summary>{ui.updates.notes}</summary>
              <pre className="about-update-notes-body">{notes}</pre>
            </details>
          )}
        </div>
      )}

      <p className="about-update-privacy">
        <ShieldCheck size={14} className="about-update-privacy-icon" aria-hidden="true" />
        <span>{ui.updates.privacy}</span>
      </p>
    </section>
  );
};
