import React, { useEffect, useRef } from "react";
import {
  ArrowLeft,
  Boxes,
  ChevronRight,
  Copyright,
  ExternalLink,
  Globe,
  HardDriveDownload,
  ScrollText,
  ShieldCheck,
} from "lucide-react";
import { VelliumLogo } from "@/components/brand/VelliumLogo";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore } from "@/stores/ui-store";
import { useUIText, resolveUiLocale } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import type { CatalogStats } from "@/lib/catalog-stats";
import type { BuildInfo, CatalogDto } from "@/types";
import { getLegalDocMeta, LEGAL_REVISION } from "@/features/legal/legal-content";
import { LegalView } from "@/features/legal/LegalView";
import "./about.css";

const VELLIUM_URL = "https://vellium.dev";

interface AboutViewProps {
  buildInfo: BuildInfo | null;
  catalog: CatalogDto | null;
  catalogStats: CatalogStats;
}

function formatBuiltAt(value: string | undefined, locale: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return date.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return date.toISOString();
  }
}

export const AboutView: React.FC<AboutViewProps> = ({ buildInfo, catalog, catalogStats }) => {
  const ui = useUIText();
  const language = usePreferencesStore((s) => s.language);
  const aboutPane = useUiStore((s) => s.aboutPane);
  const openLegalDoc = useUiStore((s) => s.openLegalDoc);
  const closeLegalDoc = useUiStore((s) => s.closeLegalDoc);
  const locale = resolveUiLocale(language);
  const tr = locale === "tr";
  const legalDocs = getLegalDocMeta(locale);
  const builtAt = formatBuiltAt(buildInfo?.builtAt, tr ? "tr-TR" : "en-US");
  const backButtonRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusDocRef = useRef<string | null>(null);
  const wasLegalRef = useRef(false);

  useEffect(() => {
    if (aboutPane === "legal") {
      wasLegalRef.current = true;
      // The overview that held focus has just been replaced by the document
      // subview; move focus into it instead of letting it fall to <body>.
      backButtonRef.current?.focus();
      return;
    }
    if (wasLegalRef.current) {
      wasLegalRef.current = false;
      // The originating button was unmounted while the document pane was open,
      // so its element cannot be refocused. Re-query the freshly mounted row
      // by document id instead of keeping a stale node reference.
      const docId = returnFocusDocRef.current;
      returnFocusDocRef.current = null;
      if (docId) {
        document
          .querySelector<HTMLButtonElement>(`[data-legal-doc="${docId}"]`)
          ?.focus();
      }
    }
  }, [aboutPane]);

  const openUrl = (url: string) => {
    void scannerApi.openUrl(url);
  };

  const profileLabel = buildInfo
    ? buildInfo.profile === "release"
      ? tr ? "Kararlı" : "Stable"
      : tr ? "Geliştirme" : "Development"
    : tr ? "Bilinmiyor" : "Unknown";

  if (aboutPane === "legal") {
    return (
      <div className="about-view">
        <div className="about-subview-header">
          <button type="button" className="btn btn-ghost btn-sm" onClick={closeLegalDoc} ref={backButtonRef}>
            <ArrowLeft size={14} />
            {ui.common.back}
          </button>
          <span>{ui.settings.aboutLegalTitle}</span>
        </div>
        <LegalView />
      </div>
    );
  }

  return (
    <div className="about-view">
      <header className="about-intro">
        <div className="about-mark" aria-hidden="true">
          <VelliumLogo size={36} />
        </div>
        <div className="about-intro-copy">
          <span className="about-eyebrow">{ui.settings.aboutMadeBy}</span>
          <h2 className="about-name">Node Cleaner</h2>
          <p className="about-tagline">{ui.settings.aboutTagline}</p>
          <div className="about-hero-meta">
            <span className="about-pill about-pill--accent">v{buildInfo?.version ?? "—"}</span>
            <span className="about-pill">{profileLabel}</span>
            <button
              type="button"
              className="about-site-link"
              onClick={() => openUrl(VELLIUM_URL)}
              title={VELLIUM_URL}
            >
              <Globe size={13} />
              <span>{ui.settings.aboutVisit}</span>
              <ExternalLink size={11} />
            </button>
          </div>
        </div>
      </header>

      <div className="about-grid">
        <section className="about-card">
          <header className="about-card-header">
            <HardDriveDownload size={14} />
            <h3>{ui.settings.aboutBuildTitle}</h3>
          </header>
          <dl className="about-rows">
            <div className="about-row">
              <dt>{ui.settings.version}</dt>
              <dd>{buildInfo?.version ?? "—"}</dd>
            </div>
            <div className="about-row">
              <dt>{ui.settings.buildCommit}</dt>
              <dd className="about-mono">
                {buildInfo
                  ? `${buildInfo.commitShort}${buildInfo.dirty ? ` (${ui.settings.buildDirty})` : ""}`
                  : "—"}
              </dd>
            </div>
            <div className="about-row">
              <dt>{ui.settings.buildProfile}</dt>
              <dd>{profileLabel}</dd>
            </div>
            {builtAt && (
              <div className="about-row">
                <dt>{ui.settings.aboutBuiltAt}</dt>
                <dd>{builtAt}</dd>
              </div>
            )}
          </dl>
        </section>

        <section className="about-card">
          <header className="about-card-header">
            <Boxes size={14} />
            <h3>{ui.settings.aboutCatalogTitle}</h3>
          </header>
          {catalog ? (
            <dl className="about-rows">
              <div className="about-row">
                <dt>{ui.settings.rules}</dt>
                <dd className="about-number">{catalogStats.rules}</dd>
              </div>
              <div className="about-row">
                <dt>{ui.settings.ecosystems}</dt>
                <dd className="about-number">{catalogStats.ecosystems}</dd>
              </div>
              <div className="about-row">
                <dt>{ui.settings.categories}</dt>
                <dd className="about-number">{catalogStats.categories}</dd>
              </div>
            </dl>
          ) : (
            <p className="about-empty">{ui.common.loading}</p>
          )}
        </section>

        <section className="about-card about-card--wide">
          <header className="about-card-header">
            <ScrollText size={14} />
            <h3>{ui.settings.aboutLegalTitle}</h3>
            <span className="about-card-hint">{ui.settings.aboutLegalHint}</span>
          </header>
          <div className="about-legal-list">
            {legalDocs.map((doc) => (
              <button
                key={doc.id}
                type="button"
                className="about-legal-item"
                data-legal-doc={doc.id}
                onClick={() => {
                  returnFocusDocRef.current = doc.id;
                  openLegalDoc(doc.id);
                }}
              >
                <span className="about-legal-copy">
                  <span className="about-legal-label">{doc.label}</span>
                  <span className="about-legal-hint">{doc.hint}</span>
                </span>
                <span className="about-legal-revision">
                  {ui.settings.aboutLegalRevision} · {LEGAL_REVISION[locale]}
                </span>
                <ChevronRight size={14} className="about-legal-arrow" aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      </div>

      <footer className="about-footer">
        <span className="about-footer-brand">
          <Copyright size={12} />
          {new Date().getFullYear()} Vellium. {ui.settings.aboutCopyright}
        </span>
        <span className="about-footer-sep" aria-hidden="true">·</span>
        <span className="about-footer-local">
          <ShieldCheck size={12} />
          {ui.settings.aboutLocalFirst}
        </span>
      </footer>
    </div>
  );
};
