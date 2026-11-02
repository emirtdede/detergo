import React from "react";
import { CalendarClock, ExternalLink, Globe, ScrollText } from "lucide-react";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore } from "@/stores/ui-store";
import { useUIText } from "@/lib/ui-text";
import { scannerApi } from "@/lib/tauri/scanner-api";
import {
  DIRECT_DEPENDENCIES,
  NPM_COMPONENT_COUNT,
  NPM_LICENSE_GROUPS,
  RUST_COMPONENT_COUNT,
  RUST_LICENSE_GROUPS,
  type LicenseGroup,
} from "./license-data";
import {
  getLegalDocMeta,
  getLegalDocument,
} from "./legal-content";
import "./legal.css";

const VELLIUM_URL = "https://vellium.dev";
const CONTACT_URL = "https://vellium.dev/contact";

/**
 * One license group rendered as a collapsible block. Collapsed by default: the
 * full crate list runs to hundreds of entries and would bury the summary a
 * user actually needs to read.
 */
const LicenseGroupBlock: React.FC<{ group: LicenseGroup }> = ({ group }) => (
  <details className="legal-license-group">
    <summary className="legal-license-group-summary">
      <span className="legal-license-name">{group.license}</span>
      <span className="legal-license-count">{group.components.length}</span>
    </summary>
    <ul className="legal-license-components">
      {group.components.map((component) => (
        <li key={`${component.name}@${component.version}`}>
          <code>{component.name}</code>
          <span className="legal-license-version">{component.version}</span>
        </li>
      ))}
    </ul>
  </details>
);

const ThirdPartyDetail: React.FC = () => {
  const language = usePreferencesStore((s) => s.language);
  const ui = useUIText();
  const t = ui.legal;
  const tr = language === "tr";

  return (
    <>
      <div className="legal-stats">
        <div className="legal-stat">
          <strong>{RUST_COMPONENT_COUNT}</strong>
          <span>{tr ? "Rust crate" : "Rust crates"}</span>
        </div>
        <div className="legal-stat">
          <strong>{NPM_COMPONENT_COUNT}</strong>
          <span>{tr ? "JavaScript paketi" : "JavaScript packages"}</span>
        </div>
        <div className="legal-stat">
          <strong>{DIRECT_DEPENDENCIES.length}</strong>
          <span>{tr ? "Doğrudan bağımlılık" : "Direct dependencies"}</span>
        </div>
      </div>

      <section className="legal-direct-card">
        <h3 className="legal-subheading">{t.directTitle}</h3>
        <p className="legal-note">{t.directHint}</p>
        <div className="legal-table-wrap">
          <table className="legal-table">
            <thead>
              <tr>
                <th scope="col">{t.colEcosystem}</th>
                <th scope="col">{t.colComponent}</th>
                <th scope="col">{t.colVersion}</th>
                <th scope="col">{t.colLicense}</th>
              </tr>
            </thead>
            <tbody>
              {DIRECT_DEPENDENCIES.map((dependency) => (
                <tr key={`${dependency.ecosystem}-${dependency.name}`}>
                  <td>
                    <span className={`legal-eco legal-eco--${dependency.ecosystem}`}>
                      {dependency.ecosystem === "rust" ? "Rust" : "JS"}
                    </span>
                  </td>
                  <td><code>{dependency.name}</code></td>
                  <td className="legal-mono">{dependency.version}</td>
                  <td>{dependency.license}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="legal-groups-card">
        <h3 className="legal-subheading">{t.groupsTitle}</h3>
        <p className="legal-note">{t.groupsHint}</p>
        <h4 className="legal-groups-label">{t.groupsRust}</h4>
        <div className="legal-license-groups">
          {RUST_LICENSE_GROUPS.map((group) => (
            <LicenseGroupBlock key={`rust-${group.license}`} group={group} />
          ))}
        </div>
        <h4 className="legal-groups-label">{t.groupsNpm}</h4>
        <div className="legal-license-groups">
          {NPM_LICENSE_GROUPS.map((group) => (
            <LicenseGroupBlock key={`npm-${group.license}`} group={group} />
          ))}
        </div>
      </section>
    </>
  );
};

export const LegalView: React.FC = () => {
  const ui = useUIText();
  const language = usePreferencesStore((s) => s.language);
  const legalDoc = useUiStore((s) => s.legalDoc);
  const setLegalDoc = useUiStore((s) => s.setLegalDoc);
  const document = getLegalDocument(language, legalDoc);
  const docs = getLegalDocMeta(language);
  const tr = language === "tr";

  const openUrl = (url: string) => {
    void scannerApi.openUrl(url);
  };

  return (
    <div className="legal-view">
      <nav className="legal-doc-tabs" aria-label={ui.legal.docTabsLabel}>
        {docs.map((doc) => (
          <button
            key={doc.id}
            type="button"
            className={`legal-doc-tab ${doc.id === legalDoc ? "is-active" : ""}`}
            onClick={() => setLegalDoc(doc.id)}
            aria-current={doc.id === legalDoc ? "page" : undefined}
          >
            <span className="legal-doc-tab-label">{doc.label}</span>
            <span className="legal-doc-tab-hint">{doc.hint}</span>
          </button>
        ))}
      </nav>

      <article className="legal-document">
        <header className="legal-doc-header">
          <span className="legal-doc-icon" aria-hidden="true">
            <ScrollText size={20} />
          </span>
          <div className="legal-doc-header-copy">
            <h2 className="legal-doc-title">{document.title}</h2>
            <p className="legal-doc-summary">{document.summary}</p>
          </div>
          <span className="legal-doc-revision">
            <CalendarClock size={12} />
            {tr ? `Son güncelleme: ${document.updated}` : `Last updated: ${document.updated}`}
          </span>
        </header>

        <ol className="legal-clauses">
          {document.clauses.map((clause) => (
            <li key={clause.heading} className="legal-clause">
              <h3 className="legal-clause-heading">{clause.heading}</h3>
              {clause.paragraphs?.map((paragraph) => (
                <p key={paragraph} className="legal-paragraph">{paragraph}</p>
              ))}
              {clause.bullets && (
                <ul className="legal-bullets">
                  {clause.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ol>

        {legalDoc === "thirdParty" && <ThirdPartyDetail />}

        <footer className="legal-doc-footer">
          <div className="legal-doc-footer-links">
            <button type="button" className="legal-link" onClick={() => openUrl(VELLIUM_URL)}>
              <Globe size={13} />
              <span>vellium.dev</span>
              <ExternalLink size={11} />
            </button>
            <button type="button" className="legal-link" onClick={() => openUrl(CONTACT_URL)}>
              <span>{ui.legal.contact}</span>
              <ExternalLink size={11} />
            </button>
          </div>
          <span className="legal-doc-copyright">
            © {new Date().getFullYear()} Vellium. {ui.legal.rights}
          </span>
        </footer>
      </article>
    </div>
  );
};
