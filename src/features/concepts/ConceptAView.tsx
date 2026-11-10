import React from "react";
import { useUIText } from "@/lib/ui-text";
import {
  Folder,
  Trash2,
  Settings,
  History,
  Bot,
  Database,
  Layers,
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { ConceptScreen, MOCK_PROJECT_ITEMS } from "./concept-types";
import "./concept-a.css";
import { translateBackendText } from "@/lib/ui-text/backend-i18n";

interface Props {
  screen: ConceptScreen;
  theme?: "dark" | "light";
  onNavigate?: (screen: ConceptScreen) => void;
}

export const ConceptAView: React.FC<Props> = ({ screen, theme = "dark", onNavigate }) => {
  const ui = useUIText();
  return (
    <div className={`concept-a-root ${theme === "light" ? "ca-light" : ""}`}>
      {/* 56px Precision Nav Rail */}
      <nav className="ca-nav-rail">
        <div className="ca-nav-brand">NC</div>
        <button
          className={`ca-nav-item ${screen === "overview" ? "active" : ""}`}
          onClick={() => onNavigate?.("overview")}
          title={ui.nav.overview}
        >
          <Layers size={18} />
        </button>
        <button
          className={`ca-nav-item ${screen === "projects" ? "active" : ""}`}
          onClick={() => onNavigate?.("projects")}
          title={ui.nav.projects}
        >
          <Folder size={18} />
        </button>
        <button
          className={`ca-nav-item ${screen === "agents" ? "active" : ""}`}
          onClick={() => onNavigate?.("agents")}
          title={ui.nav.agents}
        >
          <Bot size={18} />
        </button>
        <button
          className={`ca-nav-item ${screen === "caches" ? "active" : ""}`}
          onClick={() => onNavigate?.("caches")}
          title={ui.nav.caches}
        >
          <Database size={18} />
        </button>
        <button
          className={`ca-nav-item ${screen === "history" ? "active" : ""}`}
          onClick={() => onNavigate?.("history")}
          title={ui.nav.history}
        >
          <History size={18} />
        </button>
        <div style={{ flex: 1 }} />
        <button
          className={`ca-nav-item ${screen === "settings" ? "active" : ""}`}
          onClick={() => onNavigate?.("settings")}
          title={ui.nav.settings}
        >
          <Settings size={18} />
        </button>
      </nav>

      {/* Main Container */}
      <div className="ca-main-area">
        {/* Top Command Bar */}
        <header className="ca-command-bar">
          <div className="ca-path-selector">
            <span className="ca-path-badge">{translateBackendText("Workspace").toUpperCase()}</span>
            <span>D:\dev\projects</span>
          </div>

          <div className="ca-telemetry-strip">
            <div className="ca-stat-chip">
              <span className="ca-stat-label">{ui.overview.candidates.toUpperCase()}:</span>
              <span className="ca-stat-val">18</span>
            </div>
            <div className="ca-stat-chip">
              <span className="ca-stat-label">{ui.table.reclaim.toUpperCase()}:</span>
              <span className="ca-stat-val" style={{ color: "var(--ca-accent)" }}>
                12.4 GB
              </span>
            </div>
            <div className="ca-stat-chip">
              <span className="ca-stat-label">{ui.table.safety.toUpperCase()}:</span>
              <span className="ca-pill ca-pill-safe">{ui.safety.safe.toUpperCase()}</span>
            </div>
            <button className="ca-btn-primary">
              <RefreshCw size={13} />
              <span>{ui.common.rescan}</span>
            </button>
          </div>
        </header>

        {/* Content Body */}
        <main className="ca-content-body">
          {screen === "overview" && (
            <div>
              {/* Dominant KPI strip */}
              <div className="ca-kpi-banner">
                <div className="ca-kpi-main">
                  <span className="ca-kpi-val">12.4 GB</span>
                  <span className="ca-kpi-label">{ui.overview.kpiCleanable}</span>
                </div>
                <div className="ca-kpi-pills">
                  <span className="ca-pill ca-pill-safe">8.2 GB {ui.safety.safe}</span>
                  <span className="ca-pill ca-pill-regen">3.5 GB {ui.safety.regenerate}</span>
                  <span className="ca-pill ca-pill-review">0.7 GB {ui.safety.review}</span>
                </div>
              </div>

              {/* Split Workspace */}
              <div className="ca-split-pane">
                {/* Left: Ecosystem Breakdown */}
                <div className="ca-card">
                  <div className="ca-card-header">
                    <span>{ui.overview.breakdown}</span>
                    <ShieldCheck size={14} color="var(--ca-success)" />
                  </div>
                  <div className="ca-dist-row">
                    <span className="ca-dist-name">Node.js</span>
                    <div className="ca-dist-bar-wrapper">
                      <div className="ca-dist-bar-fill" style={{ width: "45%" }} />
                    </div>
                    <span className="ca-dist-size">4.2 GB</span>
                  </div>
                  <div className="ca-dist-row">
                    <span className="ca-dist-name">Rust</span>
                    <div className="ca-dist-bar-wrapper">
                      <div className="ca-dist-bar-fill" style={{ width: "35%" }} />
                    </div>
                    <span className="ca-dist-size">3.8 GB</span>
                  </div>
                  <div className="ca-dist-row">
                    <span className="ca-dist-name">Python</span>
                    <div className="ca-dist-bar-wrapper">
                      <div className="ca-dist-bar-fill" style={{ width: "22%" }} />
                    </div>
                    <span className="ca-dist-size">2.1 GB</span>
                  </div>
                  <div className="ca-dist-row">
                    <span className="ca-dist-name">Java/Kotlin</span>
                    <div className="ca-dist-bar-wrapper">
                      <div className="ca-dist-bar-fill" style={{ width: "16%" }} />
                    </div>
                    <span className="ca-dist-size">1.6 GB</span>
                  </div>
                  <div className="ca-dist-row">
                    <span className="ca-dist-name">{ui.overview.ecoOther}</span>
                    <div className="ca-dist-bar-wrapper">
                      <div className="ca-dist-bar-fill" style={{ width: "8%" }} />
                    </div>
                    <span className="ca-dist-size">0.7 GB</span>
                  </div>
                </div>

                {/* Right: Quick Table */}
                <div className="ca-card">
                  <div className="ca-card-header">
                    <span>{ui.overview.topItemsTitle}</span>
                    <span style={{ fontSize: "11px", color: "var(--ca-text-muted)" }}>
                      {ui.overview.topItemsSubtitle}
                    </span>
                  </div>
                  <table className="ca-table">
                    <thead>
                      <tr>
                        <th>{ui.table.name}</th>
                        <th>{ui.table.category}</th>
                        <th>{ui.table.size}</th>
                        <th>{ui.table.safety}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {MOCK_PROJECT_ITEMS.slice(0, 5).map((item) => (
                        <tr key={item.id}>
                          <td className="ca-col-mono" style={{ fontWeight: 600 }}>
                            {item.name}
                          </td>
                          <td>{item.ecosystem}</td>
                          <td className="ca-col-mono">
                            {(item.sizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB
                          </td>
                          <td>
                            <span
                              className={`ca-pill ${
                                item.safety === "safe" ? "ca-pill-safe" : "ca-pill-regen"
                              }`}
                            >
                              {item.safety.toUpperCase()}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {screen === "projects" && (
            <div className="ca-card">
              <div className="ca-card-header">
                <span>{ui.projects.title}</span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="text"
                    placeholder={ui.table.searchPlaceholder}
                    style={{
                      background: "var(--ca-bg)",
                      border: "1px solid var(--ca-border)",
                      color: "var(--ca-text-primary)",
                      padding: "3px 8px",
                      borderRadius: "4px",
                      fontSize: "11px",
                    }}
                  />
                </div>
              </div>
              <table className="ca-table">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}>
                      <input type="checkbox" defaultChecked />
                    </th>
                    <th>{ui.table.name}</th>
                    <th>{ui.table.category}</th>
                    <th>{ui.table.project}</th>
                    <th>{ui.table.size}</th>
                    <th>{ui.table.safety}</th>
                    <th>{ui.table.modified}</th>
                  </tr>
                </thead>
                <tbody>
                  {MOCK_PROJECT_ITEMS.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <input type="checkbox" defaultChecked={item.selected} />
                      </td>
                      <td className="ca-col-mono" style={{ fontWeight: 600 }}>
                        {item.name}
                      </td>
                      <td>{item.ecosystem}</td>
                      <td
                        className="ca-col-mono"
                        style={{
                          fontSize: "11px",
                          maxWidth: 240,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {item.path}
                      </td>
                      <td className="ca-col-mono">
                        {(item.sizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB
                      </td>
                      <td>
                        <span
                          className={`ca-pill ${
                            item.safety === "safe" ? "ca-pill-safe" : "ca-pill-regen"
                          }`}
                        >
                          {item.safety.toUpperCase()}
                        </span>
                      </td>
                      <td>{item.lastModified}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {screen === "agents" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "16px",
              }}
            >
              {[
                {
                  name: "OpenAI Codex / CLI",
                  size: "1.42 GB",
                  sessions: 42,
                  cache: "980 MB",
                },
                {
                  name: "Claude Code",
                  size: "2.84 GB",
                  sessions: 89,
                  cache: "1.92 GB",
                },
                {
                  name: "Google Antigravity",
                  size: "4.12 GB",
                  sessions: 156,
                  cache: "3.10 GB",
                },
              ].map((agent, i) => (
                <div key={i} className="ca-card" style={{ padding: "16px" }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: "12px",
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>{agent.name}</span>
                    <Bot size={16} color="var(--ca-accent)" />
                  </div>
                  <div
                    style={{
                      fontSize: "24px",
                      fontWeight: 700,
                      fontFamily: "var(--ca-font-mono)",
                      marginBottom: "8px",
                    }}
                  >
                    {agent.size}
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--ca-text-secondary)",
                      marginBottom: "16px",
                    }}
                  >
                    {agent.sessions} {ui.agents.active} • {agent.cache} {ui.overview.ecoCache}
                  </div>
                  <button
                    className="ca-btn-primary"
                    style={{ width: "100%", justifyContent: "center" }}
                  >
                    {ui.caches.runAction}
                  </button>
                </div>
              ))}
            </div>
          )}

          {screen === "caches" && (
            <div className="ca-card">
              <div className="ca-card-header">
                <span>{ui.caches.title}</span>
                <span style={{ fontSize: "11px", color: "var(--ca-text-muted)" }}>
                  {ui.caches.kpiTotal}: 10.47 GB
                </span>
              </div>
              <table className="ca-table">
                <thead>
                  <tr>
                    <th>{ui.table.project}</th>
                    <th>{ui.table.category}</th>
                    <th>{ui.table.project}</th>
                    <th>{ui.table.size}</th>
                    <th>{ui.caches.kpiActions}</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      name: "npm",
                      eco: "JavaScript",
                      path: "~/.npm/_cacache",
                      size: "3.45 GB",
                      cmd: "npm cache clean --force",
                    },
                    {
                      name: "pip",
                      eco: "Python",
                      path: "~/.cache/pip",
                      size: "1.82 GB",
                      cmd: "pip cache purge",
                    },
                    {
                      name: "Cargo",
                      eco: "Rust",
                      path: "~/.cargo/registry",
                      size: "5.20 GB",
                      cmd: "cargo-cache --autoclean",
                    },
                  ].map((c, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{translateBackendText(c.name)}</td>
                      <td>{c.eco}</td>
                      <td className="ca-col-mono" style={{ fontSize: "11px" }}>
                        {c.path}
                      </td>
                      <td className="ca-col-mono">{c.size}</td>
                      <td>
                        <button
                          className="ca-btn-primary"
                          style={{
                            padding: "2px 8px",
                            fontSize: "11px",
                            background: "var(--ca-surface-elevated)",
                            color: "var(--ca-text-primary)",
                            border: "1px solid var(--ca-border)",
                          }}
                        >
                          {c.cmd}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {screen === "history" && (
            <div className="ca-card">
              <div className="ca-card-header">
                <span>{ui.history.title}</span>
                <span style={{ fontSize: "11px", color: "var(--ca-text-muted)" }}>
                  {ui.history.subtitle}
                </span>
              </div>
              <table className="ca-table">
                <thead>
                  <tr>
                    <th>{ui.history.timestamp}</th>
                    <th>{ui.history.mode}</th>
                    <th>{ui.history.actions}</th>
                    <th>{ui.history.reclaim}</th>
                    <th>{ui.table.safety}</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      time: "2026-11-04 20:15:22",
                      mode: ui.plan.trash,
                      items: 18,
                      size: "4.25 GB",
                      status: ui.result.success.toUpperCase(),
                    },
                    {
                      time: "2026-11-02 14:40:10",
                      mode: ui.plan.trash,
                      items: 8,
                      size: "1.85 GB",
                      status: ui.result.success.toUpperCase(),
                    },
                    {
                      time: "2026-10-29 09:12:05",
                      mode: ui.plan.permanent,
                      items: 32,
                      size: "14.10 GB",
                      status: ui.result.success.toUpperCase(),
                    },
                  ].map((h, i) => (
                    <tr key={i}>
                      <td className="ca-col-mono">{h.time}</td>
                      <td>{h.mode}</td>
                      <td className="ca-col-mono">
                        {h.items} {ui.overview.candidates}
                      </td>
                      <td className="ca-col-mono" style={{ fontWeight: 600 }}>
                        {h.size}
                      </td>
                      <td>
                        <span className="ca-pill ca-pill-safe">{h.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {screen === "settings" && (
            <div className="ca-split-pane">
              <div className="ca-card" style={{ padding: "8px" }}>
                <div
                  style={{
                    padding: "8px 12px",
                    fontWeight: 700,
                    borderRadius: "4px",
                    background: "var(--ca-accent-subtle)",
                    color: "var(--ca-accent)",
                    marginBottom: "4px",
                  }}
                >
                  {ui.settings.general}
                </div>
                <div style={{ padding: "8px 12px", color: "var(--ca-text-secondary)" }}>
                  {ui.settings.scan}
                </div>
                <div style={{ padding: "8px 12px", color: "var(--ca-text-secondary)" }}>
                  {ui.settings.protections}
                </div>
                <div style={{ padding: "8px 12px", color: "var(--ca-text-secondary)" }}>
                  {ui.settings.agents}
                </div>
              </div>

              <div className="ca-card" style={{ padding: "16px" }}>
                <h3 style={{ fontSize: "14px", fontWeight: 700, marginBottom: "16px" }}>
                  {ui.settings.general}
                </h3>
                <div style={{ marginBottom: "16px" }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: "12px",
                      fontWeight: 600,
                      marginBottom: "6px",
                    }}
                  >
                    {ui.settings.theme}
                  </label>
                  <select
                    style={{
                      background: "var(--ca-bg)",
                      border: "1px solid var(--ca-border)",
                      color: "var(--ca-text-primary)",
                      padding: "6px 12px",
                      borderRadius: "4px",
                      width: "240px",
                    }}
                  >
                    <option>
                      {ui.settings.themeDark} ({translateBackendText("Default")})
                    </option>
                    <option>{translateBackendText("Dark Gray")}</option>
                    <option>{translateBackendText("Light White")}</option>
                    <option>{translateBackendText("Light Gray")}</option>
                  </select>
                </div>
                <div style={{ marginBottom: "16px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input type="checkbox" defaultChecked />
                    <span>{ui.settings.reduceMotion}</span>
                  </label>
                </div>
                <div>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input type="checkbox" defaultChecked />
                    <span>{ui.settings.scanHint}</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Modal Overlay for Cleanup Plan Confirmation */}
          {screen === "cleanup-modal" && (
            <div className="ca-modal-overlay">
              <div className="ca-modal">
                <div className="ca-modal-header">
                  <span>{ui.plan.title}</span>
                  <span className="ca-pill ca-pill-safe">{ui.safety.safe.toUpperCase()}</span>
                </div>
                <div className="ca-modal-body">
                  <div style={{ marginBottom: "12px" }}>{ui.plan.confirmTrash}</div>
                  <div
                    style={{
                      background: "var(--ca-bg)",
                      border: "1px solid var(--ca-border)",
                      padding: "10px 12px",
                      borderRadius: "4px",
                      fontFamily: "var(--ca-font-mono)",
                      fontSize: "12px",
                      marginBottom: "16px",
                    }}
                  >
                    <div>
                      {ui.table.reclaim}: <strong>9.08 GB</strong>
                    </div>
                    <div>
                      {ui.table.project}:{" "}
                      <strong>{translateBackendText("Windows Recycle Bin")}</strong>
                    </div>
                  </div>
                </div>
                <div className="ca-modal-footer">
                  <button
                    className="ca-btn-primary"
                    style={{
                      background: "transparent",
                      color: "var(--ca-text-secondary)",
                      border: "1px solid var(--ca-border)",
                    }}
                  >
                    {ui.common.cancel}
                  </button>
                  <button className="ca-btn-primary">
                    <Trash2 size={13} />
                    <span>{ui.plan.confirmTrash}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modal Overlay for Permanent Delete Guard */}
          {screen === "permanent-modal" && (
            <div className="ca-modal-overlay">
              <div className="ca-modal" style={{ borderColor: "var(--ca-danger)" }}>
                <div
                  className="ca-modal-header"
                  style={{
                    background: "var(--ca-danger-subtle)",
                    color: "var(--ca-danger)",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <AlertTriangle size={16} />
                    {ui.plan.confirmPermanent}
                  </span>
                  <span className="ca-pill ca-pill-review">
                    {ui.plan.permanentAck.toUpperCase()}
                  </span>
                </div>
                <div className="ca-modal-body">
                  <p style={{ color: "var(--ca-danger)", fontWeight: 600, marginBottom: "8px" }}>
                    {ui.plan.permanentNote}
                  </p>
                  <p
                    style={{
                      fontSize: "12px",
                      color: "var(--ca-text-secondary)",
                      marginBottom: "16px",
                    }}
                  >
                    {ui.plan.confirmPermanent}
                  </p>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      background: "var(--ca-bg)",
                      padding: "10px 12px",
                      borderRadius: "4px",
                      border: "1px solid var(--ca-border)",
                      fontSize: "12px",
                    }}
                  >
                    <input type="checkbox" defaultChecked />
                    <span>{ui.plan.permanentAck}</span>
                  </label>
                </div>
                <div className="ca-modal-footer">
                  <button
                    className="ca-btn-primary"
                    style={{
                      background: "transparent",
                      color: "var(--ca-text-secondary)",
                      border: "1px solid var(--ca-border)",
                    }}
                  >
                    {ui.common.cancel}
                  </button>
                  <button className="ca-btn-primary" style={{ background: "var(--ca-danger)" }}>
                    <Trash2 size={13} />
                    <span>{ui.plan.confirmPermanent}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
