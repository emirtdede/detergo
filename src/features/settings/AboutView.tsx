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
import { countCatalogStats, type CatalogStats } from "@/lib/catalog-stats";
import type { BuildInfo, CatalogDto } from "@/types";
import { getLegalDocMeta, LEGAL_REVISION } from "@/features/legal/legal-content";
import { LegalView } from "@/features/legal/LegalView";
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
  const tr = locale === "tr";
  const legalDocs = getLegalDocMeta(locale);

  const [internalBuild, setInternalBuild] = useState<BuildInfo | null>(null);
  const [internalCatalog, setInternalCatalog] = useState<CatalogDto | null>(null);
  useEffect(() => {
    if (!propBuildInfo) {
      scannerApi.getBuildInfo().then(setInternalBuild).catch(() => {});
    }
    if (!propCatalog) {
      scannerApi.getCatalog().then(setInternalCatalog).catch(() => {});
    }
  }, [propBuildInfo, propCatalog]);

  const buildInfo = propBuildInfo ?? internalBuild;
  const catalog = propCatalog ?? internalCatalog;
  const catalogStats = useMemo(() => {
    if (propCatalogStats && propCatalogStats.rules > 0) return propCatalogStats;
    return countCatalogStats(catalog?.rules ?? []);
  }, [propCatalogStats, catalog]);

  const builtAt = formatBuiltAt(buildInfo?.builtAt, tr ? "tr-TR" : "en-US");
  const backButtonRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusDocRef = useRef<string | null>(null);
  const wasLegalRef = useRef(false);

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
          description="Sistem sürüm bilgisi, kural kataloğu telemetrisi ve açık kaynak lisans uyumluluğu."
          actions={
            <Button
              variant="secondary"
              size="sm"
              icon={<Globe size={13} />}
              onClick={() => openUrl(VELLIUM_URL)}
            >
              Resmi Web Sitesi <ExternalLink size={12} />
            </Button>
          }
        />
      )}

      {/* Shared Bento KPI Strip for About View — 100% Width */}
      <div className="nc-bento-strip nc-bento-strip--4">
        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">Sürüm</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--accent">
              <Sparkles size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">v{buildInfo?.version ?? "2.0.0"}</span>
            <span className="nc-kpi-card-sub">{profileLabel} Dağıtım Profili</span>
          </div>
        </div>

        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">Kural Kataloğu</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--success">
              <Boxes size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">{catalogStats.rules} Kural</span>
            <span className="nc-kpi-card-sub">Aktif temizleme kuralları</span>
          </div>
        </div>

        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">Ekosistemler</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--purple">
              <Layers size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">{catalogStats.ecosystems} Ekosistem</span>
            <span className="nc-kpi-card-sub">Web, Rust, Python, Ajanlar...</span>
          </div>
        </div>

        <div className="nc-kpi-card">
          <div className="nc-kpi-card-header">
            <span className="nc-kpi-card-label">Lisans Durumu</span>
            <span className="nc-kpi-card-icon nc-kpi-card-icon--warning">
              <ScrollText size={14} />
            </span>
          </div>
          <div className="nc-kpi-card-body">
            <span className="nc-kpi-card-value">MIT / Açık</span>
            <span className="nc-kpi-card-sub">149 Rust + 48 NPM paketi</span>
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
              <h2 className="about-panel-title">Dev Cleaner by Vellium</h2>
              <span className="about-panel-desc">{ui.settings.aboutTagline}</span>
            </div>
          </div>

          <div className="about-meta-list">
            <div className="about-meta-row">
              <span className="about-meta-label">Uygulama Sürümü</span>
              <span className="about-meta-value">v{buildInfo?.version ?? "2.0.0"}</span>
            </div>
            <div className="about-meta-row">
              <span className="about-meta-label">Git Commit Hash</span>
              <span className="about-meta-value">
                {buildInfo ? buildInfo.commitShort : "release-v2"}
              </span>
            </div>
            <div className="about-meta-row">
              <span className="about-meta-label">Derleme Profili</span>
              <span className="about-meta-value">{profileLabel}</span>
            </div>
            {builtAt && (
              <div className="about-meta-row">
                <span className="about-meta-label">Derleme Zamanı</span>
                <span className="about-meta-value">{builtAt}</span>
              </div>
            )}
          </div>

          <div className="about-trust-strip">
            <ShieldCheck size={18} className="about-trust-icon" />
            <span>
              <strong>Yerel ve Güvenli Çalışma:</strong> Dev Cleaner disk analizlerini ve temizliklerini tamamen yerel makinenizde gerçekleştirir. Kaynak kodlarınız veya dosya yollarınız asla harici bir sunucuya iletilmez.
            </span>
          </div>
        </div>

        {/* Right: Rules Catalog Breakdown */}
        <div className="about-bento-panel">
          <div className="about-panel-header">
            <div className="about-panel-icon about-panel-icon--purple">
              <Code2 size={20} />
            </div>
            <div className="about-panel-title-group">
              <h2 className="about-panel-title">Sistem Kural Kataloğu</h2>
              <span className="about-panel-desc">
                {catalogStats.rules} Kural · {catalogStats.categories} Kategori · {catalogStats.ecosystems} Ekosistem
              </span>
            </div>
          </div>

          <div className="about-rules-catalog-grid">
            <div className="about-rule-card">
              <div className="about-rule-head">
                <span className="about-rule-dot" style={{ backgroundColor: "var(--accent)" }} />
                <span className="about-rule-name">Node.js Ekosistemi</span>
                <span className="about-rule-badge">Aktif</span>
              </div>
              <span className="about-rule-scope">node_modules, .next, dist, build, .turbo</span>
            </div>

            <div className="about-rule-card">
              <div className="about-rule-head">
                <span className="about-rule-dot" style={{ backgroundColor: "#F97316" }} />
                <span className="about-rule-name">Rust Ekosistemi</span>
                <span className="about-rule-badge">Aktif</span>
              </div>
              <span className="about-rule-scope">target, Cargo.lock debug derlemeleri</span>
            </div>

            <div className="about-rule-card">
              <div className="about-rule-head">
                <span className="about-rule-dot" style={{ backgroundColor: "var(--success)" }} />
                <span className="about-rule-name">Python Ekosistemi</span>
                <span className="about-rule-badge">Aktif</span>
              </div>
              <span className="about-rule-scope">venv, .venv, __pycache__, .pytest_cache</span>
            </div>

            <div className="about-rule-card">
              <div className="about-rule-head">
                <span className="about-rule-dot" style={{ backgroundColor: "#8B5CF6" }} />
                <span className="about-rule-name">AI Kodlama Ajanları</span>
                <span className="about-rule-badge">Aktif</span>
              </div>
              <span className="about-rule-scope">Claude Code, Cursor, Codex, Antigravity</span>
            </div>

            <div className="about-rule-card">
              <div className="about-rule-head">
                <span className="about-rule-dot" style={{ backgroundColor: "#EC4899" }} />
                <span className="about-rule-name">Global Paket Önbellekleri</span>
                <span className="about-rule-badge">Aktif</span>
              </div>
              <span className="about-rule-scope">npm cache, Cargo registry, pip cache, yarn</span>
            </div>

            <div className="about-rule-card">
              <div className="about-rule-head">
                <span className="about-rule-dot" style={{ backgroundColor: "#06B6D4" }} />
                <span className="about-rule-name">Genel Derleme Çıktıları</span>
                <span className="about-rule-badge">Aktif</span>
              </div>
              <span className="about-rule-scope">out, coverage, .cache, log ve tmp çıktıları</span>
            </div>
          </div>

          <div className="about-meta-list">
            <div className="about-meta-row">
              <span className="about-meta-label">Kural Şeması</span>
              <span className="about-meta-value">v1.0 Doğrulanmış</span>
            </div>
            <div className="about-meta-row">
              <span className="about-meta-label">Güvenlik Motoru</span>
              <span className="about-meta-value" style={{ color: "var(--success)" }}>
                Aktif ve Korumalı
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Middle: Vellium Official Communication Channels — 100% Full Width */}
      <section className="about-contacts-section">
        <div className="about-panel-header">
          <div className="about-panel-icon about-panel-icon--blue">
            <Mail size={18} />
          </div>
          <div className="about-panel-title-group">
            <h2 className="about-panel-title">Vellium İletişim Kanalları</h2>
            <span className="about-panel-desc">Resmî kurumsal e-posta adresleri ve destek noktaları</span>
          </div>
        </div>

        <div className="about-contacts-grid">
          <a href="mailto:contact@vellium.dev" className="about-contact-card" title="contact@vellium.dev">
            <div className="about-contact-icon about-contact-icon--blue"><Mail size={16} /></div>
            <div className="about-contact-info">
              <span className="about-contact-label">Genel İletişim</span>
              <strong className="about-contact-email">contact@vellium.dev</strong>
              <span className="about-contact-desc">Resmî iş birlikleri ve genel yazışmalar</span>
            </div>
          </a>

          <a href="mailto:billing@vellium.dev" className="about-contact-card" title="billing@vellium.dev">
            <div className="about-contact-icon about-contact-icon--purple"><CreditCard size={16} /></div>
            <div className="about-contact-info">
              <span className="about-contact-label">Fatura & Ticari</span>
              <strong className="about-contact-email">billing@vellium.dev</strong>
              <span className="about-contact-desc">Ödeme, abonelik ve kurumsal faturalandırma</span>
            </div>
          </a>

          <a href="mailto:legal@vellium.dev" className="about-contact-card" title="legal@vellium.dev">
            <div className="about-contact-icon about-contact-icon--warning"><ScrollText size={16} /></div>
            <div className="about-contact-info">
              <span className="about-contact-label">Hukuk & Sözleşmeler</span>
              <strong className="about-contact-email">legal@vellium.dev</strong>
              <span className="about-contact-desc">EULA, lisanslama ve telif hakları</span>
            </div>
          </a>

          <a href="mailto:privacy@vellium.dev" className="about-contact-card" title="privacy@vellium.dev">
            <div className="about-contact-icon about-contact-icon--green"><Lock size={16} /></div>
            <div className="about-contact-info">
              <span className="about-contact-label">Gizlilik & KVKK</span>
              <strong className="about-contact-email">privacy@vellium.dev</strong>
              <span className="about-contact-desc">Veri güvenliği ve gizlilik politikası</span>
            </div>
          </a>

          <a href="mailto:security@vellium.dev" className="about-contact-card" title="security@vellium.dev">
            <div className="about-contact-icon about-contact-icon--red"><ShieldAlert size={16} /></div>
            <div className="about-contact-info">
              <span className="about-contact-label">Güvenlik Bildirimi</span>
              <strong className="about-contact-email">security@vellium.dev</strong>
              <span className="about-contact-desc">Güvenlik açığı bildirimleri (sorumlu açıklama)</span>
            </div>
          </a>

          <a href="mailto:support@vellium.dev" className="about-contact-card" title="support@vellium.dev">
            <div className="about-contact-icon about-contact-icon--accent"><Headphones size={16} /></div>
            <div className="about-contact-info">
              <span className="about-contact-label">Müşteri Desteği</span>
              <strong className="about-contact-email">support@vellium.dev</strong>
              <span className="about-contact-desc">Teknik destek, geri bildirim ve sorun giderme</span>
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
                Revizyon: {LEGAL_REVISION[locale === "tr" ? "tr" : "en"]}
              </span>
            </button>
          ))}
        </div>

        <footer className="about-footer-bar">
          <span>
            <Copyright size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
            {new Date().getFullYear()} Vellium. {ui.settings.aboutCopyright}
          </span>
          <span>{ui.settings.aboutLocalFirst}</span>
        </footer>
      </section>
    </div>
  );
};
