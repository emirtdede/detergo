import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Boxes,
  ChevronRight,
  Copyright,
  ExternalLink,
  Globe,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Layers,
  Code2,
  Mail,
  CreditCard,
  Lock,
  Headphones,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/primitives/Button";
import { PageHeader } from "@/components/primitives/PageHeader";
import { VelliumLogo } from "@/components/brand/VelliumLogo";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore } from "@/stores/ui-store";
import { useUIText, resolveUiLocale } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import { log } from "@/lib/logging";
import { countCatalogStats, type CatalogStats } from "@/lib/catalog-stats";
import type { BuildInfo, CatalogDto } from "@/types";
import { getLegalDocMeta, LEGAL_REVISION } from "@/features/legal/legal-content";
import { useLegalLocale } from "@/features/legal/use-legal-locale";
import { LegalView } from "@/features/legal/LegalView";
import { SystemHealthPanel } from "./SystemHealthPanel";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { UpdatePanel } from "./UpdatePanel";
import { CatalogExplorer, ecosystemMeta, groupRules } from "./CatalogExplorer";
import "./about.css";

const VELLIUM_URL = "https://vellium.dev";

export interface AboutViewProps {
  buildInfo?: BuildInfo | null;
  catalog?: CatalogDto | null;
  catalogStats?: CatalogStats;
  isStandalone?: boolean;
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

export const AboutView: React.FC<AboutViewProps> = ({
  buildInfo: propBuildInfo,
  catalog: propCatalog,
  catalogStats: propCatalogStats,
  isStandalone = true,
}) => {
  const ui = useUIText();
  const language = usePreferencesStore((s) => s.language);
  const aboutPane = useUiStore((s) => s.aboutPane);
  const openLegalDoc = useUiStore((s) => s.openLegalDoc);
  const closeLegalDoc = useUiStore((s) => s.closeLegalDoc);
  const locale = resolveUiLocale(language);
  // Legal metadata comes from the lazily loaded convenience dictionary.
  useLegalLocale(language);
  const legalDocs = getLegalDocMeta(locale);

  const [internalBuild, setInternalBuild] = useState<BuildInfo | null>(null);
  const [internalCatalog, setInternalCatalog] = useState<CatalogDto | null>(null);
  useEffect(() => {
    // Both reads can settle after the pane switched to Legal or the view
    // unmounted; writing state then is at best wasted work and at worst a
    // warning under StrictMode's double mount.
    let cancelled = false;
    if (!propBuildInfo) {
      scannerApi
        .getBuildInfo()
        .then((info) => {
          if (!cancelled) setInternalBuild(info);
        })
        .catch((err) => log.warn("Could not read the build info", err));
    }
    if (!propCatalog) {
      scannerApi
        .getCatalog()
        .then((next) => {
          if (!cancelled) setInternalCatalog(next);
        })
        .catch((err) => log.warn("Could not read the rules catalog", err));
    }
    return () => {
      cancelled = true;
    };
  }, [propBuildInfo, propCatalog]);

  const buildInfo = propBuildInfo ?? internalBuild;
  const catalog = propCatalog ?? internalCatalog;
  const catalogStats = useMemo(() => {
    if (propCatalogStats && propCatalogStats.rules > 0) return propCatalogStats;
    return countCatalogStats(catalog?.rules ?? []);
  }, [propCatalogStats, catalog]);

  const builtAt = formatBuiltAt(buildInfo?.builtAt, locale);
  const backButtonRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusDocRef = useRef<string | null>(null);
  const wasLegalRef = useRef(false);
  const [selectedEcosystem, setSelectedEcosystem] = useState<string | null>(null);
  const explorerRef = useRef<HTMLElement | null>(null);
  const catalogRules = catalog?.rules ?? [];

  /** Shows the explorer for one ecosystem and brings it into view. */
  const showEcosystem = (ecosystem: string | null) => {
    setSelectedEcosystem(ecosystem);
    if (ecosystem) {
      // The panel sits below the cards, so a click that changes nothing on
      // screen would look broken on a short window.
      requestAnimationFrame(() => {
        explorerRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    }
  };

  const ecosystemGroups = useMemo(
    () =>
      [...groupRules(catalogRules).entries()].sort((a, b) =>
        ecosystemMeta(a[0]).label.localeCompare(ecosystemMeta(b[0]).label),
      ),
    [catalogRules],
  );

  useEffect(() => {
    if (aboutPane === "legal") {
      wasLegalRef.current = true;
      backButtonRef.current?.focus();
      return;
    }
    if (wasLegalRef.current) {
      wasLegalRef.current = false;
      const docId = returnFocusDocRef.current;
      returnFocusDocRef.current = null;
      if (docId) {
        document.querySelector<HTMLButtonElement>(`[data-legal-doc="${docId}"]`)?.focus();
      }
    }
  }, [aboutPane]);

  const openUrl = (url: string) => {
    // The external-link command can fail (no browser association, blocked
    // handler). Reported instead of leaving an unhandled rejection.
    scannerApi.openUrl(url).catch((err) => {
      log.warn("Could not open the external link", err);
      useUiStore.getState().showToast(ui.errors.title, "error");
    });
  };

  const profileLabel = buildInfo
    ? buildInfo.profile === "release"
      ? ui.settings.buildProfileRelease
      : ui.settings.buildProfileDev
    : ui.settings.buildProfileUnknown;

  if (aboutPane === "legal") {
    return (
      <div className="about-page">
        <div className="about-subview-header">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={closeLegalDoc}
            ref={backButtonRef}
          >
            <ArrowLeft size={13} style={{ marginRight: 6 }} />
            {ui.common.back}
          </button>
          <span>{ui.settings.aboutLegalTitle}</span>
        </div>
        <LegalView />
      </div>
    );
  }

  return (
    <div className="about-page">
      {isStandalone && (
        <PageHeader
          title={ui.nav.about}
          description={ui.settings.aboutHint}
          actions={
            <Button
              variant="secondary"
              size="sm"
              icon={<Globe size={13} />}
              onClick={() => openUrl(VELLIUM_URL)}
            >
              {ui.settings.aboutVisit} <ExternalLink size={12} />
            </Button>
          }
        />
      )}

      {/* Shared Bento KPI Strip for About View — 100% Width */}
      <div className="nc-bento-strip nc-bento-strip--4">
        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{ui.about.kpiVersion}</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--accent">
              <Sparkles size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">v{buildInfo?.version ?? "—"}</span>
            <span className="nc-kpi-card-sub">
              {profileLabel} {ui.settings.buildProfile}
            </span>
          </div>
        </div>

        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{ui.about.kpiCatalog}</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--success">
              <Boxes size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {catalogStats.rules} {ui.settings.rules}
            </span>
            <span className="nc-kpi-card-sub">{ui.about.kpiRulesSub}</span>
          </div>
        </div>

        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{ui.about.kpiEco}</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--purple">
              <Layers size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">
              {catalogStats.ecosystems} {ui.settings.ecosystems}
            </span>
            <span className="nc-kpi-card-sub">{ui.about.kpiEcoSub}</span>
          </div>
        </div>

        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">{ui.about.kpiLicense}</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--warning">
              <ScrollText size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">{ui.about.kpiLicenseValue}</span>
            <span className="nc-kpi-card-sub">{ui.about.kpiLicenseSub}</span>
          </div>
        </div>
      </div>

      {/* Main 2-Column Full-Width Bento Grid */}
      <section className="about-workspace-grid">
        {/* Left: Application & Provenance */}
        <div className="about-bento-panel">
          <div className="about-panel-header">
            <div className="about-panel-logo-clean">
              <VelliumLogo size={46} color="var(--accent)" />
            </div>
            <div className="about-panel-title-group">
              <h2 className="about-panel-title">{ui.settings.aboutTitleBy}</h2>
              <span className="about-panel-desc">{ui.settings.aboutTagline}</span>
            </div>
          </div>

          <div className="about-meta-list">
            <div className="about-meta-row">
              <span className="about-meta-label">{ui.about.appVersion}</span>
              <span className="about-meta-value">v{buildInfo?.version ?? "—"}</span>
            </div>
            <div className="about-meta-row">
              <span className="about-meta-label">{ui.about.gitCommitHash}</span>
              <span className="about-meta-value">{buildInfo ? buildInfo.commitShort : "—"}</span>
            </div>
            <div className="about-meta-row">
              <span className="about-meta-label">{ui.settings.buildProfile}</span>
              <span className="about-meta-value">{profileLabel}</span>
            </div>
            {builtAt && (
              <div className="about-meta-row">
                <span className="about-meta-label">{ui.about.builtAt}</span>
                <span className="about-meta-value">{builtAt}</span>
              </div>
            )}
          </div>

          <div className="about-trust-strip">
            <ShieldCheck size={18} className="about-trust-icon" />
            <span>{ui.about.localSafeNote}</span>
          </div>
        </div>

        {/* Right: Rules Catalog Breakdown */}
        <div className="about-bento-panel">
          <div className="about-panel-header">
            <div className="about-panel-icon about-panel-icon--purple">
              <Code2 size={20} />
            </div>
            <div className="about-panel-title-group">
              <h2 className="about-panel-title">{ui.about.catalogTitle}</h2>
              <span className="about-panel-desc">
                {catalogStats.rules} {ui.settings.rules} · {catalogStats.categories}{" "}
                {ui.settings.categories} · {catalogStats.ecosystems} {ui.settings.ecosystems}
              </span>
            </div>
          </div>

          <div className="about-rules-catalog-grid">
            {ecosystemGroups.map(([ecosystem, rules]) => {
              const meta = ecosystemMeta(ecosystem);
              return (
                <button
                  key={ecosystem}
                  type="button"
                  className={`about-rule-card about-rule-card--button${
                    selectedEcosystem === ecosystem ? " is-active" : ""
                  }`}
                  aria-expanded={selectedEcosystem === ecosystem}
                  onClick={() => showEcosystem(selectedEcosystem === ecosystem ? null : ecosystem)}
                >
                  <div className="about-rule-head">
                    <span className="about-rule-dot" style={{ backgroundColor: meta.color }} />
                    <span className="about-rule-name">{meta.label}</span>
                    {/* The badge carries the number only: "1 rules" reads wrong
                        and a plural form per locale is not worth inventing. */}
                    <span className="about-rule-badge" title={ui.settings.rules}>
                      {rules.length}
                    </span>
                  </div>
                  <span className="about-rule-scope">
                    {rules.map((rule) => rule.names[0]).join(", ")}
                  </span>
                </button>
              );
            })}
          </div>

          {catalogRules.length === 0 && <p className="about-catalog-empty">{ui.catalog.empty}</p>}

          <div className="about-meta-list">
            <div className="about-meta-row">
              <span className="about-meta-label">{ui.about.catalogTitle}</span>
              <span className="about-meta-value">{ui.about.schemaVerified}</span>
            </div>
            <div className="about-meta-row">
              <span className="about-meta-label">{ui.about.safetyEngine}</span>
              <span className="about-meta-value" style={{ color: "var(--success)" }}>
                {ui.about.safetyActive}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* The explorer follows the summary cards: a count alone does not tell a
          user what will actually be deleted, so every rule is listed here. */}
      <section className="about-workspace-grid about-workspace-grid--full" ref={explorerRef}>
        <CatalogExplorer
          rules={catalogRules}
          selected={selectedEcosystem}
          onSelect={setSelectedEcosystem}
        />
      </section>

      {/* Update check, local health and the local error log share one row so no
          half of the grid is left empty. */}
      <section className="about-workspace-grid about-workspace-grid--three">
        <UpdatePanel version={buildInfo?.version ?? "—"} />
        <SystemHealthPanel />
        <DiagnosticsPanel version={buildInfo?.version ?? "—"} />
      </section>

      {/* Middle: Vellium Official Communication Channels — 100% Full Width */}
      <section className="about-contacts-section">
        <div className="about-panel-header">
          <div className="about-panel-icon about-panel-icon--blue">
            <Mail size={18} />
          </div>
          <div className="about-panel-title-group">
            <h2 className="about-panel-title">{ui.about.contactsTitle}</h2>
            <span className="about-panel-desc">{ui.about.contactsSubtitle}</span>
          </div>
        </div>

        <div className="about-contacts-grid">
          <a
            href="mailto:contact@vellium.dev"
            className="about-contact-card"
            title="contact@vellium.dev"
          >
            <div className="about-contact-icon about-contact-icon--blue">
              <Mail size={16} />
            </div>
            <div className="about-contact-info">
              <span className="about-contact-label">{ui.about.contactGeneral}</span>
              <strong className="about-contact-email">contact@vellium.dev</strong>
              <span className="about-contact-desc">{ui.about.contactGeneralDesc}</span>
            </div>
          </a>

          <a
            href="mailto:billing@vellium.dev"
            className="about-contact-card"
            title="billing@vellium.dev"
          >
            <div className="about-contact-icon about-contact-icon--purple">
              <CreditCard size={16} />
            </div>
            <div className="about-contact-info">
              <span className="about-contact-label">{ui.about.contactBilling}</span>
              <strong className="about-contact-email">billing@vellium.dev</strong>
              <span className="about-contact-desc">{ui.about.contactBillingDesc}</span>
            </div>
          </a>

          <a
            href="mailto:legal@vellium.dev"
            className="about-contact-card"
            title="legal@vellium.dev"
          >
            <div className="about-contact-icon about-contact-icon--warning">
              <ScrollText size={16} />
            </div>
            <div className="about-contact-info">
              <span className="about-contact-label">{ui.about.contactLegal}</span>
              <strong className="about-contact-email">legal@vellium.dev</strong>
              <span className="about-contact-desc">{ui.about.contactLegalDesc}</span>
            </div>
          </a>

          <a
            href="mailto:privacy@vellium.dev"
            className="about-contact-card"
            title="privacy@vellium.dev"
          >
            <div className="about-contact-icon about-contact-icon--green">
              <Lock size={16} />
            </div>
            <div className="about-contact-info">
              <span className="about-contact-label">{ui.about.contactPrivacy}</span>
              <strong className="about-contact-email">privacy@vellium.dev</strong>
              <span className="about-contact-desc">{ui.about.contactPrivacyDesc}</span>
            </div>
          </a>

          <a
            href="mailto:security@vellium.dev"
            className="about-contact-card"
            title="security@vellium.dev"
          >
            <div className="about-contact-icon about-contact-icon--red">
              <ShieldAlert size={16} />
            </div>
            <div className="about-contact-info">
              <span className="about-contact-label">{ui.about.contactSecurity}</span>
              <strong className="about-contact-email">security@vellium.dev</strong>
              <span className="about-contact-desc">{ui.about.contactSecurityDesc}</span>
            </div>
          </a>

          <a
            href="mailto:support@vellium.dev"
            className="about-contact-card"
            title="support@vellium.dev"
          >
            <div className="about-contact-icon about-contact-icon--accent">
              <Headphones size={16} />
            </div>
            <div className="about-contact-info">
              <span className="about-contact-label">{ui.about.contactSupport}</span>
              <strong className="about-contact-email">support@vellium.dev</strong>
              <span className="about-contact-desc">{ui.about.contactSupportDesc}</span>
            </div>
          </a>
        </div>
      </section>

      {/* Bottom: Legal Documents & Open Source Licenses — 100% Full Width */}
      <section className="about-legal-section">
        <div className="about-panel-header">
          <div className="about-panel-icon about-panel-icon--success">
            <ScrollText size={18} />
          </div>
          <div className="about-panel-title-group">
            <h2 className="about-panel-title">{ui.settings.aboutLegalTitle}</h2>
            <span className="about-panel-desc">{ui.settings.aboutLegalHint}</span>
          </div>
        </div>

        <div className="about-legal-cards-grid">
          {legalDocs.map((doc) => (
            <button
              key={doc.id}
              type="button"
              className="about-legal-btn"
              data-legal-doc={doc.id}
              onClick={() => {
                returnFocusDocRef.current = doc.id;
                openLegalDoc(doc.id);
              }}
            >
              <div className="about-legal-btn-header">
                <span className="about-legal-btn-title">{doc.label}</span>
                <ChevronRight size={15} className="about-legal-btn-arrow" />
              </div>
              <p className="about-legal-btn-desc">{doc.hint}</p>
              <span className="about-legal-btn-rev">
                {ui.settings.aboutLegalRevision}: {LEGAL_REVISION[locale === "tr" ? "tr" : "en"]}
              </span>
            </button>
          ))}
        </div>

        <footer className="about-footer-bar">
          <span>
            <Copyright
              size={12}
              style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }}
            />
            {new Date().getFullYear()} Vellium. {ui.settings.aboutCopyright}
          </span>
          <span>{ui.settings.aboutLocalFirst}</span>
        </footer>
      </section>
    </div>
  );
};
