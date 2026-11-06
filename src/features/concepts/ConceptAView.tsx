import React from "react";
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

interface Props {
  screen: ConceptScreen;
  theme?: "dark" | "light";
  onNavigate?: (screen: ConceptScreen) => void;
}

export const ConceptAView: React.FC<Props> = ({
  screen,
  theme = "dark",
  onNavigate,
}) => {
  return (
    <div className={`concept-a-root ${theme === "light" ? "ca-light" : ""}`}>
      {/* 56px Precision Nav Rail */}
      <nav className="ca-nav-rail">
        <div className="ca-nav-brand">NC</div>
        <button
          className={`ca-nav-item ${screen === "overview" ? "active" : ""}`}
          onClick={() => onNavigate?.("overview")}
          title="Genel Bakış"
        >
          <Layers size={18} />
        </button>
        <button
          className={`ca-nav-item ${screen === "projects" ? "active" : ""}`}
          onClick={() => onNavigate?.("projects")}
          title="Projeler"
        >
          <Folder size={18} />
        </button>
        <button
          className={`ca-nav-item ${screen === "agents" ? "active" : ""}`}
          onClick={() => onNavigate?.("agents")}
          title="AI Ajanları"
        >
          <Bot size={18} />
        </button>
        <button
          className={`ca-nav-item ${screen === "caches" ? "active" : ""}`}
          onClick={() => onNavigate?.("caches")}
          title="Önbellekler"
        >
          <Database size={18} />
        </button>
        <button
          className={`ca-nav-item ${screen === "history" ? "active" : ""}`}
          onClick={() => onNavigate?.("history")}
          title="Geçmiş"
        >
          <History size={18} />
        </button>
        <div style={{ flex: 1 }} />
        <button
          className={`ca-nav-item ${screen === "settings" ? "active" : ""}`}
          onClick={() => onNavigate?.("settings")}
          title="Ayarlar"
        >
          <Settings size={18} />
        </button>
      </nav>

      {/* Main Container */}
      <div className="ca-main-area">
        {/* Top Command Bar */}
        <header className="ca-command-bar">
          <div className="ca-path-selector">
            <span className="ca-path-badge">WORKSPACE</span>
            <span>D:\dev\projects</span>
          </div>

          <div className="ca-telemetry-strip">
            <div className="ca-stat-chip">
              <span className="ca-stat-label">HEDEFLER:</span>
              <span className="ca-stat-val">18</span>
            </div>
            <div className="ca-stat-chip">
              <span className="ca-stat-label">KAZANIM:</span>
              <span className="ca-stat-val" style={{ color: "var(--ca-accent)" }}>
                12.4 GB
              </span>
            </div>
            <div className="ca-stat-chip">
              <span className="ca-stat-label">GÜVENLİK:</span>
              <span className="ca-pill ca-pill-safe">GÜVENLİ</span>
            </div>
            <button className="ca-btn-primary">
              <RefreshCw size={13} />
              <span>Yeniden Tara</span>
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
                  <span className="ca-kpi-label">Toplam Geri Kazanılabilir Alan</span>
                </div>
                <div className="ca-kpi-pills">
                  <span className="ca-pill ca-pill-safe">8.2 GB Güvenli</span>
                  <span className="ca-pill ca-pill-regen">3.5 GB Yeniden Üretilebilir</span>
                  <span className="ca-pill ca-pill-review">0.7 GB İnceleme Gerekli</span>
                </div>
              </div>

              {/* Split Workspace */}
              <div className="ca-split-pane">
                {/* Left: Ecosystem Breakdown */}
                <div className="ca-card">
                  <div className="ca-card-header">
                    <span>Ekosistem Dağılımı</span>
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
                    <span className="ca-dist-name">Diğerleri</span>
                    <div className="ca-dist-bar-wrapper">
                      <div className="ca-dist-bar-fill" style={{ width: "8%" }} />
                    </div>
                    <span className="ca-dist-size">0.7 GB</span>
                  </div>
                </div>

                {/* Right: Quick Table */}
                <div className="ca-card">
                  <div className="ca-card-header">
                    <span>Kritik Temizlik Hedefleri</span>
                    <span style={{ fontSize: "11px", color: "var(--ca-text-muted)" }}>
                      En Büyük 5 Dizin
                    </span>
                  </div>
                  <table className="ca-table">
                    <thead>
                      <tr>
                        <th>Hedef</th>
                        <th>Ekosistem</th>
                        <th>Boyut</th>
                        <th>Durum</th>
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
                                item.safety === "safe"
                                  ? "ca-pill-safe"
                                  : "ca-pill-regen"
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
                <span>Taranan Proje Dizinleri</span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="text"
                    placeholder="Filtrele..."
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
                    <th>Hedef Adı</th>
                    <th>Ekosistem</th>
                    <th>Yol</th>
                    <th>Boyut</th>
                    <th>Güvenlik</th>
                    <th>Son Değişiklik</th>
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
                            item.safety === "safe"
                              ? "ca-pill-safe"
                              : "ca-pill-regen"
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
                    {agent.sessions} aktif oturum • {agent.cache} önbellek
                  </div>
                  <button
                    className="ca-btn-primary"
                    style={{ width: "100%", justifyContent: "center" }}
                  >
                    Önbelleği Temizle
                  </button>
                </div>
              ))}
            </div>
          )}

          {screen === "caches" && (
            <div className="ca-card">
              <div className="ca-card-header">
                <span>Geliştirici Araç Önbellekleri</span>
                <span style={{ fontSize: "11px", color: "var(--ca-text-muted)" }}>
                  Toplam: 10.47 GB
                </span>
              </div>
              <table className="ca-table">
                <thead>
                  <tr>
                    <th>Sağlayıcı</th>
                    <th>Ekosistem</th>
                    <th>Konum</th>
                    <th>Önbellek Boyutu</th>
                    <th>Resmi Eylem</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      name: "npm Cache",
                      eco: "JavaScript",
                      path: "~/.npm/_cacache",
                      size: "3.45 GB",
                      cmd: "npm cache clean --force",
                    },
                    {
                      name: "pip Cache",
                      eco: "Python",
                      path: "~/.cache/pip",
                      size: "1.82 GB",
                      cmd: "pip cache purge",
                    },
                    {
                      name: "Cargo Registry",
                      eco: "Rust",
                      path: "~/.cargo/registry",
                      size: "5.20 GB",
                      cmd: "cargo-cache --autoclean",
                    },
                  ].map((c, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{c.name}</td>
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
                <span>İşlem ve Denetim Günlüğü</span>
                <span style={{ fontSize: "11px", color: "var(--ca-text-muted)" }}>
                  Son 30 Gün
                </span>
              </div>
              <table className="ca-table">
                <thead>
                  <tr>
                    <th>Zaman Damgası</th>
                    <th>Mod</th>
                    <th>Temizlenen Öğe</th>
                    <th>Kazanılan Alan</th>
                    <th>Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      time: "2026-11-04 20:15:22",
                      mode: "Çöp Kutusu",
                      items: 18,
                      size: "4.25 GB",
                      status: "BAŞARILI",
                    },
                    {
                      time: "2026-11-02 14:40:10",
                      mode: "Çöp Kutusu",
                      items: 8,
                      size: "1.85 GB",
                      status: "BAŞARILI",
                    },
                    {
                      time: "2026-10-29 09:12:05",
                      mode: "Kalıcı Silme",
                      items: 32,
                      size: "14.10 GB",
                      status: "BAŞARILI",
                    },
                  ].map((h, i) => (
                    <tr key={i}>
                      <td className="ca-col-mono">{h.time}</td>
                      <td>{h.mode}</td>
                      <td className="ca-col-mono">{h.items} hedef</td>
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
                  Genel Yapılandırma
                </div>
                <div style={{ padding: "8px 12px", color: "var(--ca-text-secondary)" }}>
                  Tarama ve Derinlik
                </div>
                <div style={{ padding: "8px 12px", color: "var(--ca-text-secondary)" }}>
                  Güvenlik & İstisnalar
                </div>
                <div style={{ padding: "8px 12px", color: "var(--ca-text-secondary)" }}>
                  AI Ajan Politikası
                </div>
              </div>

              <div className="ca-card" style={{ padding: "16px" }}>
                <h3 style={{ fontSize: "14px", fontWeight: 700, marginBottom: "16px" }}>
                  Genel Tercihler
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
                    Arayüz Teması
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
                    <option>Dark Black (Varsayılan)</option>
                    <option>Dark Gray</option>
                    <option>Light White</option>
                    <option>Light Gray</option>
                  </select>
                </div>
                <div style={{ marginBottom: "16px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input type="checkbox" defaultChecked />
                    <span>Azaltılmış Hareket (Reduced Motion)</span>
                  </label>
                </div>
                <div>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input type="checkbox" defaultChecked />
                    <span>Taramadan sonra otomatik özet göster</span>
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
                  <span>Temizlik Planı Doğrulaması</span>
                  <span className="ca-pill ca-pill-safe">GÜVENLİ İŞLEM</span>
                </div>
                <div className="ca-modal-body">
                  <div style={{ marginBottom: "12px" }}>
                    Seçilen <strong>5 hedef dizin</strong> Windows Çöp Kutusuna
                    taşınacaktır. Veriler istenirse geri yüklenebilir.
                  </div>
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
                    <div>Toplam Kurtarılacak: <strong>9.08 GB</strong></div>
                    <div>Hedef Konum: <strong>Windows Recycle Bin</strong></div>
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
                    Vazgeç
                  </button>
                  <button className="ca-btn-primary">
                    <Trash2 size={13} />
                    <span>Temizliği Başlat</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modal Overlay for Permanent Delete Guard */}
          {screen === "permanent-modal" && (
            <div className="ca-modal-overlay">
              <div
                className="ca-modal"
                style={{ borderColor: "var(--ca-danger)" }}
              >
                <div
                  className="ca-modal-header"
                  style={{
                    background: "var(--ca-danger-subtle)",
                    color: "var(--ca-danger)",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <AlertTriangle size={16} />
                    Kalıcı Silme Onayı
                  </span>
                  <span className="ca-pill ca-pill-review">GERİ ALINAMAZ</span>
                </div>
                <div className="ca-modal-body">
                  <p style={{ color: "var(--ca-danger)", fontWeight: 600, marginBottom: "8px" }}>
                    DİKKAT: Bu işlem dosyaları doğrudan diskten kalıcı olarak silecektir.
                  </p>
                  <p style={{ fontSize: "12px", color: "var(--ca-text-secondary)", marginBottom: "16px" }}>
                    Dosyalar Windows Çöp Kutusuna gönderilmeyecek, kurtarma araçları
                    olmadan geri getirilemeyecektir.
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
                    <span>Kalıcı silme işleminin geri alınamayacağını anlıyorum.</span>
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
                    İptal
                  </button>
                  <button
                    className="ca-btn-primary"
                    style={{ background: "var(--ca-danger)" }}
                  >
                    <Trash2 size={13} />
                    <span>Kalıcı Olarak Sil</span>
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
