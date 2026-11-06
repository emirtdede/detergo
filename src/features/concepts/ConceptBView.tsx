import React from "react";
import {
  Folder,
  Trash2,
  Settings,
  History,
  Bot,
  Database,
  Layers,
  Search,
  CheckCircle2,
  ChevronRight,
  ShieldAlert,
  HardDrive,
  Sparkles,
} from "lucide-react";
import { ConceptScreen, MOCK_PROJECT_ITEMS } from "./concept-types";
import "./concept-b.css";

interface Props {
  screen: ConceptScreen;
  theme?: "dark" | "light";
  onNavigate?: (screen: ConceptScreen) => void;
}

export const ConceptBView: React.FC<Props> = ({
  screen,
  theme = "dark",
  onNavigate,
}) => {
  return (
    <div className={`concept-b-root ${theme === "light" ? "cb-light" : ""}`}>
      {/* 220px Fluent Sidebar */}
      <aside className="cb-sidebar">
        <div className="cb-app-header">
          <div className="cb-app-logo">NC</div>
          <div>
            <div className="cb-app-title">Node Cleaner</div>
            <div style={{ fontSize: "11px", color: "var(--cb-text-muted)" }}>
              Windows Masaüstü
            </div>
          </div>
        </div>

        <div className="cb-nav-section-title">TEMİZLİK KAPSAMI</div>
        <button
          className={`cb-nav-link ${screen === "overview" ? "active" : ""}`}
          onClick={() => onNavigate?.("overview")}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Layers size={16} />
            Genel Bakış
          </span>
          <span className="cb-badge">12.4 GB</span>
        </button>
        <button
          className={`cb-nav-link ${screen === "projects" ? "active" : ""}`}
          onClick={() => onNavigate?.("projects")}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Folder size={16} />
            Projeler
          </span>
          <span className="cb-badge">6</span>
        </button>

        <div className="cb-nav-section-title">GELİŞTİRİCİ ARAÇLARI</div>
        <button
          className={`cb-nav-link ${screen === "agents" ? "active" : ""}`}
          onClick={() => onNavigate?.("agents")}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Bot size={16} />
            AI Ajanları
          </span>
          <span className="cb-badge">3</span>
        </button>
        <button
          className={`cb-nav-link ${screen === "caches" ? "active" : ""}`}
          onClick={() => onNavigate?.("caches")}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Database size={16} />
            Araç Önbellekleri
          </span>
        </button>

        <div className="cb-nav-section-title">TERCİHLER & KAYIT</div>
        <button
          className={`cb-nav-link ${screen === "history" ? "active" : ""}`}
          onClick={() => onNavigate?.("history")}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <History size={16} />
            Geçmiş
          </span>
        </button>
        <div style={{ flex: 1 }} />
        <button
          className={`cb-nav-link ${screen === "settings" ? "active" : ""}`}
          onClick={() => onNavigate?.("settings")}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Settings size={16} />
            Ayarlar
          </span>
        </button>
      </aside>

      {/* Main Container */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Top Header */}
        <header className="cb-top-header">
          <div className="cb-search-bar">
            <Search size={14} />
            <span style={{ flex: 1 }}>Proje veya hedef ara...</span>
            <span className="cb-search-kbd">Ctrl K</span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button className="cb-btn cb-btn-secondary">
              <HardDrive size={14} />
              <span>D:\dev\projects</span>
            </button>
            <button className="cb-btn cb-btn-primary">
              <Sparkles size={14} />
              <span>Hızlı Temizle</span>
            </button>
          </div>
        </header>

        {/* Content Body */}
        <main className="cb-content">
          {screen === "overview" && (
            <div className="cb-guide-container">
              {/* Stage 1: Scope */}
              <div className="cb-stage-card">
                <div className="cb-stage-header">
                  <div className="cb-stage-num">1</div>
                  <div className="cb-stage-title">Tarama Kapsamı & Hedef Klasör</div>
                </div>
                <div className="cb-stage-body">
                  Şu an <strong>D:\dev\projects</strong> dizini taranmış durumda. Toplam 18 proje ve bağımlılık dizini tespit edildi.
                </div>
              </div>

              {/* Stage 2: Health Analysis */}
              <div className="cb-stage-card">
                <div className="cb-stage-header">
                  <div className="cb-stage-num">2</div>
                  <div className="cb-stage-title">Depolama Durumu & Risk Analizi</div>
                  <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "6px", color: "var(--cb-success)", fontSize: "13px" }}>
                    <CheckCircle2 size={16} />
                    <span>%100 Güvenli & Geri Alınabilir</span>
                  </div>
                </div>
                <div className="cb-stage-body" style={{ display: "flex", gap: "24px", marginTop: "12px" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "28px", fontWeight: 700, color: "var(--cb-text-primary)", marginBottom: "4px" }}>
                      12.4 GB
                    </div>
                    <div>Geliştirici artıklarından kurtarılabilecek toplam disk alanı.</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "220px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                      <span>Node.js node_modules</span>
                      <strong>4.2 GB</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                      <span>Rust target derlemeleri</span>
                      <strong>3.8 GB</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                      <span>Python .venv paketleri</span>
                      <strong>2.1 GB</strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stage 3: Recommended Action */}
              <div className="cb-stage-card" style={{ borderColor: "var(--cb-accent-subtle)" }}>
                <div className="cb-stage-header">
                  <div className="cb-stage-num">3</div>
                  <div className="cb-stage-title">Önerilen Güvenli Temizlik</div>
                </div>
                <div className="cb-stage-body" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    Seçilen <strong>6 proje dizini</strong> önce Windows Çöp Kutusuna taşınacak şekilde hazırlandı.
                  </div>
                  <button className="cb-btn cb-btn-primary">
                    <Trash2 size={14} />
                    <span>Çöp Kutusuna Taşı (12.4 GB)</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {screen === "projects" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {MOCK_PROJECT_ITEMS.map((item) => (
                <div
                  key={item.id}
                  style={{
                    backgroundColor: "var(--cb-surface)",
                    border: "1px solid var(--cb-border)",
                    borderRadius: "8px",
                    padding: "14px 18px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <input type="checkbox" defaultChecked={item.selected} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "14px", color: "var(--cb-text-primary)" }}>
                        {item.name}
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--cb-text-secondary)" }}>
                        {item.path}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    <span style={{ fontSize: "12px", background: "var(--cb-surface-elevated)", padding: "3px 8px", borderRadius: "12px" }}>
                      {item.ecosystem}
                    </span>
                    <span style={{ fontWeight: 700, fontSize: "14px" }}>
                      {(item.sizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB
                    </span>
                    <ChevronRight size={16} color="var(--cb-text-muted)" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {screen === "agents" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {[
                {
                  name: "OpenAI Codex / CLI",
                  desc: "Kodlama komut istemi geçmişi ve geçici analiz önbellekleri.",
                  size: "1.42 GB",
                  safety: "Tamamen güvenli temizlenebilir.",
                },
                {
                  name: "Claude Code",
                  desc: "Oturum çalışma alanları, token önbellekleri ve hata ayıklama kayıtları.",
                  size: "2.84 GB",
                  safety: "Oturumlar silinir, kaynak kod etkilenmez.",
                },
                {
                  name: "Google Antigravity",
                  desc: "Ajan muhakeme grafları, geçici kod çalışma dosyaları ve transcriptler.",
                  size: "4.12 GB",
                  safety: "Tamamen güvenli; tekrar taranabilir.",
                },
              ].map((agent, i) => (
                <div
                  key={i}
                  style={{
                    backgroundColor: "var(--cb-surface)",
                    border: "1px solid var(--cb-border)",
                    borderRadius: "10px",
                    padding: "18px 20px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "4px" }}>
                      {agent.name}
                    </div>
                    <div style={{ fontSize: "13px", color: "var(--cb-text-secondary)", marginBottom: "6px" }}>
                      {agent.desc}
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--cb-success)", display: "flex", alignItems: "center", gap: "4px" }}>
                      <CheckCircle2 size={13} />
                      {agent.safety}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "20px", fontWeight: 700, marginBottom: "8px" }}>
                      {agent.size}
                    </div>
                    <button className="cb-btn cb-btn-secondary" style={{ padding: "5px 12px", fontSize: "12px" }}>
                      Depolamayı Boşalt
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {screen === "caches" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {[
                { name: "npm Paket İndirme Önbelleği", size: "3.45 GB", desc: "Global npm modül arşivi." },
                { name: "Python pip Wheel Önbelleği", size: "1.82 GB", desc: "İndirilen ve derlenen Python paketleri." },
                { name: "Cargo Registry Önbelleği", size: "5.20 GB", desc: "crates.io kaynak ve paket arşivi." },
              ].map((c, i) => (
                <div
                  key={i}
                  style={{
                    backgroundColor: "var(--cb-surface)",
                    border: "1px solid var(--cb-border)",
                    borderRadius: "8px",
                    padding: "16px 20px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    <div style={{ fontSize: "12px", color: "var(--cb-text-secondary)" }}>{c.desc}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                    <span style={{ fontWeight: 700 }}>{c.size}</span>
                    <button className="cb-btn cb-btn-secondary" style={{ fontSize: "12px", padding: "5px 12px" }}>
                      Önbelleği Temizle
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {screen === "history" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {[
                { date: "4 Kasım 2026, 20:15", title: "18 proje hedefi Çöp Kutusuna taşındı", gain: "4.25 GB" },
                { date: "2 Kasım 2026, 14:40", title: "8 hedef başarıyla temizlendi", gain: "1.85 GB" },
                { date: "29 Ekim 2026, 09:12", title: "Kalıcı silme ile 32 hedef temizlendi", gain: "14.10 GB" },
              ].map((h, i) => (
                <div
                  key={i}
                  style={{
                    backgroundColor: "var(--cb-surface)",
                    border: "1px solid var(--cb-border)",
                    borderRadius: "8px",
                    padding: "16px 20px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div>
                    <div style={{ fontSize: "12px", color: "var(--cb-text-muted)", marginBottom: "2px" }}>
                      {h.date}
                    </div>
                    <div style={{ fontWeight: 600 }}>{h.title}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <span style={{ fontWeight: 700, color: "var(--cb-success)" }}>+{h.gain}</span>
                    <CheckCircle2 size={16} color="var(--cb-success)" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {screen === "settings" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div
                style={{
                  backgroundColor: "var(--cb-surface)",
                  border: "1px solid var(--cb-border)",
                  borderRadius: "8px",
                  padding: "16px 20px",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: "8px" }}>Görünüm ve Tema</div>
                <div style={{ display: "flex", gap: "12px" }}>
                  <button className="cb-btn cb-btn-secondary" style={{ flex: 1, justifyContent: "center" }}>
                    Karanlık Mod (Varsayılan)
                  </button>
                  <button className="cb-btn cb-btn-secondary" style={{ flex: 1, justifyContent: "center" }}>
                    Açık Mod
                  </button>
                </div>
              </div>

              <div
                style={{
                  backgroundColor: "var(--cb-surface)",
                  border: "1px solid var(--cb-border)",
                  borderRadius: "8px",
                  padding: "16px 20px",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: "8px" }}>Varsayılan Silme Yöntemi</div>
                <div style={{ fontSize: "13px", color: "var(--cb-text-secondary)", marginBottom: "12px" }}>
                  Tavsiye edilen yöntem Windows Çöp Kutusu'dur. Dosyalar istenildiğinde geri kurtarılabilir.
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input type="radio" name="delete_mode" defaultChecked />
                  <span>Windows Çöp Kutusuna Gönder (Önerilen)</span>
                </label>
              </div>
            </div>
          )}

          {/* Modal Overlay for Cleanup Plan Confirmation */}
          {screen === "cleanup-modal" && (
            <div className="cb-modal-overlay">
              <div className="cb-modal">
                <div className="cb-modal-title">Temizleme İşlemini Onaylayın</div>
                <div className="cb-modal-desc">
                  Seçilen <strong>6 adet proje dizini</strong> Windows Çöp Kutusuna taşınacaktır.
                  Bu işlem diskte <strong>12.4 GB</strong> alan açacaktır.
                </div>
                <div
                  style={{
                    backgroundColor: "var(--cb-surface-elevated)",
                    borderRadius: "8px",
                    padding: "12px 16px",
                    marginBottom: "20px",
                    fontSize: "13px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--cb-success)", marginBottom: "4px" }}>
                    <CheckCircle2 size={15} />
                    <strong>Güvenli Taşıma Modu</strong>
                  </div>
                  <div style={{ color: "var(--cb-text-secondary)" }}>
                    İhtiyaç duyarsanız dosyaları Çöp Kutusundan geri alabilirsiniz.
                  </div>
                </div>
                <div className="cb-modal-actions">
                  <button className="cb-btn cb-btn-secondary">Vazgeç</button>
                  <button className="cb-btn cb-btn-primary">
                    <Trash2 size={14} />
                    <span>Çöp Kutusuna Gönder</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modal Overlay for Permanent Delete Guard */}
          {screen === "permanent-modal" && (
            <div className="cb-modal-overlay">
              <div className="cb-modal" style={{ borderColor: "var(--cb-danger)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--cb-danger)", marginBottom: "8px" }}>
                  <ShieldAlert size={20} />
                  <div className="cb-modal-title" style={{ margin: 0 }}>Kalıcı Olarak Silinsin mi?</div>
                </div>
                <div className="cb-modal-desc">
                  Bu işlem dosyaları diskinizden <strong>tamamen ve geri alınamaz biçimde</strong> silecektir.
                  Windows Çöp Kutusu kullanılmayacaktır.
                </div>
                <div
                  style={{
                    backgroundColor: "var(--cb-danger-subtle)",
                    border: "1px solid var(--cb-danger)",
                    borderRadius: "8px",
                    padding: "12px 16px",
                    marginBottom: "20px",
                    fontSize: "13px",
                    color: "var(--cb-text-primary)",
                  }}
                >
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                    <input type="checkbox" defaultChecked />
                    <span>Dosyaların kurtarılamaz şekilde silineceğini anlıyorum ve onaylıyorum.</span>
                  </label>
                </div>
                <div className="cb-modal-actions">
                  <button className="cb-btn cb-btn-secondary">İptal</button>
                  <button className="cb-btn" style={{ background: "var(--cb-danger)", color: "#fff" }}>
                    <Trash2 size={14} />
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
