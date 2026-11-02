import React from "react";
import {
  Boxes,
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
import { useUIText } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import type { CatalogStats } from "@/lib/catalog-stats";
import type { BuildInfo, CatalogDto } from "@/types";
import { getLegalDocMeta, LEGAL_REVISION } from "@/features/legal/legal-content";
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

/**
 * About is the one place that speaks for the product rather than for a
 * setting: brand, build provenance, catalog size, and the entry points to the
 * legal documents. Everything shown here is read from the running binary, not
 * hard-coded, so a support report and the audited revision can be compared.
 */
export const AboutView: React.FC<AboutViewProps> = ({ buildInfo, catalog, catalogStats }) => {
  const ui = useUIText();
  const language = usePreferencesStore((s) => s.language);
  const openLegalDoc = useUiStore((s) => s.openLegalDoc);
  const tr = language === "tr";
  const legalDocs = getLegalDocMeta(language);
  const builtAt = formatBuiltAt(buildInfo?.builtAt, tr ? "tr-TR" : "en-US");

  const openUrl = (url: string) => {
    void scannerApi.openUrl(url);
  };

  return (
    <div className="about-view">
      <section className="about-hero">
        <div className="about-hero-glow" aria-hidden="true" />
        <div className="about-mark">
          <VelliumLogo size={46} />
        </div>
        <div className="about-hero-copy">
          <span className="about-eyebrow">{ui.settings.aboutMadeBy}</span>
          <h2 className="about-name">Node Cleaner</h2>
          <p className="about-tagline">{ui.settings.aboutTagline}</p>
          <div className="about-hero-meta">
            <span className="about-pill about-pill--accent">v{buildInfo?.version ?? "2.0.0"}</span>
            {buildInfo && <span className="about-pill">{buildInfo.profile}</span>}
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
      </section>

      <div className="about-grid">
        <section className="about-card">
          <header className="about-card-header">
            <HardDriveDownload size={14} />
            <h3>{ui.settings.aboutBuildTitle}</h3>
          </header>
          <dl className="about-rows">
            <div className="about-row">
              <dt>{ui.settings.version}</dt>
              <dd>{buildInfo?.version ?? "2.0.0"}</dd>
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
              <dd>{buildInfo?.profile ?? "—"}</dd>
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
                onClick={() => openLegalDoc(doc.id)}
              >
                <span className="about-legal-copy">
                  <span className="about-legal-label">{doc.label}</span>
                  <span className="about-legal-hint">{doc.hint}</span>
                </span>
                <span className="about-legal-revision">
                  {ui.settings.aboutLegalRevision} · {LEGAL_REVISION[tr ? "tr" : "en"]}
                </span>
                <ExternalLink size={12} className="about-legal-arrow" />
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
