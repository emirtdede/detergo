import React, { useMemo, useState, useEffect, useRef } from "react";
import {
  BookOpen,
  Terminal,
  Cpu,
  Webhook,
  ShieldCheck,
  Search,
  Copy,
  Check,
  Sparkles,
  ExternalLink,
  Info,
  Sliders,
  Layers,
  FileCode2,
  Lock,
  Undo2,
  HelpCircle,
  Wrench,
  Bot,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { NumberField } from "@/components/primitives/NumberField";
import "./docs.css";

// --- LIGHTWEIGHT SYNTAX HIGHLIGHTER ---
function highlightBash(code: string): React.ReactNode[] {
  const lines = code.split("\n");
  return lines.map((line, lIdx) => {
    if (line.trim().startsWith("#") || line.trim().startsWith("//") || line.trim().startsWith("REM")) {
      return (
        <span key={lIdx} className="tok-comment">
          {line}
          {lIdx < lines.length - 1 ? "\n" : ""}
        </span>
      );
    }
    const regex = /(--[a-zA-Z0-9_-]+|-[a-zA-Z0-9]+|"[^"]*"|'[^']*'|\b(?:dev-cleaner|npm|nvm|pip|cargo|docker|powershell|git|New-ScheduledTaskAction|Register-ScheduledTask)\b|\d+)/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push(line.substring(lastIndex, match.index));
      }
      const tok = match[0];
      if (tok.startsWith("-")) {
        parts.push(<span key={`${lIdx}-${match.index}`} className="tok-flag">{tok}</span>);
      } else if (tok.startsWith('"') || tok.startsWith("'")) {
        parts.push(<span key={`${lIdx}-${match.index}`} className="tok-string">{tok}</span>);
      } else if (/^(dev-cleaner|npm|nvm|pip|cargo|docker|powershell|git|New-ScheduledTaskAction|Register-ScheduledTask)$/.test(tok)) {
        parts.push(<span key={`${lIdx}-${match.index}`} className="tok-cmd">{tok}</span>);
      } else if (/^\d+$/.test(tok)) {
        parts.push(<span key={`${lIdx}-${match.index}`} className="tok-num">{tok}</span>);
      } else {
        parts.push(tok);
      }
      lastIndex = match.index + tok.length;
    }
    if (lastIndex < line.length) {
      parts.push(line.substring(lastIndex));
    }
    return (
      <span key={lIdx}>
        {parts}
        {lIdx < lines.length - 1 ? "\n" : ""}
      </span>
    );
  });
}

function highlightJson(jsonStr: string): React.ReactNode[] {
  const lines = jsonStr.split("\n");
  return lines.map((line, lIdx) => {
    const regex = /(".*?"\s*:)|(".*?")|(\b(?:true|false|null)\b)|(-?\d+(?:\.\d+)?)/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push(line.substring(lastIndex, match.index));
      }
      const full = match[0];
      const key = match[1];
      const str = match[2];
      const bool = match[3];
      const num = match[4];
      if (key) {
        parts.push(<span key={`${lIdx}-${match.index}`} className="tok-key">{key}</span>);
      } else if (str) {
        parts.push(<span key={`${lIdx}-${match.index}`} className="tok-string">{str}</span>);
      } else if (bool) {
        parts.push(<span key={`${lIdx}-${match.index}`} className="tok-literal">{bool}</span>);
      } else if (num) {
        parts.push(<span key={`${lIdx}-${match.index}`} className="tok-num">{num}</span>);
      } else {
        parts.push(full);
      }
      lastIndex = match.index + full.length;
    }
    if (lastIndex < line.length) {
      parts.push(line.substring(lastIndex));
    }
    return (
      <span key={lIdx}>
        {parts}
        {lIdx < lines.length - 1 ? "\n" : ""}
      </span>
    );
  });
}

interface DocTopic {
  id: string;
  title: string;
  category: "guide" | "cli" | "mcp" | "webhook" | "safety";
  icon: React.ReactNode;
  keywords?: string[];
}

const TOPICS: DocTopic[] = [
  // 1. Rehberler & Genel Bakış
  { id: "quickstart", title: "Hızlı Başlangıç & Mimari", category: "guide", icon: <Sparkles size={14} />, keywords: ["hızlı", "başlangıç", "dry-run", "özet", "quickstart", "mod"] },
  { id: "manifesto", title: "Sıfır Veri Kaybı Garantisi", category: "guide", icon: <ShieldCheck size={14} />, keywords: ["sıfır", "veri", "kaybı", "geri", "dönüşüm", "recycle", "bin", "manifesto"] },
  { id: "recovery-guide", title: "Veri Kurtarma & Geri Yükleme", category: "guide", icon: <Undo2 size={14} />, keywords: ["kurtarma", "geri", "al", "yükle", "restore", "recycle", "bin", "yanlışlıkla", "silinen", "dosya"] },
  { id: "faq", title: "Sıkça Sorulan Sorular (FAQ)", category: "guide", icon: <HelpCircle size={14} />, keywords: ["faq", "sorular", "cevaplar", "node_modules", "docker", "target", "git", "güvenlik"] },

  // 2. Terminal & CLI
  { id: "cli-guide", title: "Terminal CLI Komutları", category: "cli", icon: <Terminal size={14} />, keywords: ["terminal", "cli", "scan", "caches", "history", "komut", "satırı", "parametre"] },
  { id: "cli-builder", title: "İnteraktif Komut Oluşturucu", category: "cli", icon: <Sliders size={14} />, keywords: ["oluşturucu", "builder", "interaktif", "min-size", "boyut", "filtre"] },
  { id: "cli-headless", title: "Headless & CI/CD Pipeline", category: "cli", icon: <Layers size={14} />, keywords: ["headless", "cron", "görev", "zamanlayıcı", "task", "scheduler", "ci", "cd", "pipeline"] },

  // 3. AI & MCP
  { id: "mcp-overview", title: "Model Context Protocol (MCP)", category: "mcp", icon: <Cpu size={14} />, keywords: ["mcp", "model", "context", "protocol", "ai", "ajan", "cursor", "claude", "windsurf"] },
  { id: "mcp-ide-setup", title: "Çoklu IDE Konfigürasyonu", category: "mcp", icon: <FileCode2 size={14} />, keywords: ["ide", "kurulum", "konfigürasyon", "config", "cursor", "windsurf", "claude", "antigravity"] },
  { id: "mcp-prompts", title: "AI Ajan Hazır İstemleri", category: "mcp", icon: <Bot size={14} />, keywords: ["prompt", "istem", "şablon", "hazır", "cursor", "claude", "otomasyon", "temizle"] },
  { id: "mcp-tools", title: "MCP Araçları Referansı", category: "mcp", icon: <BookOpen size={14} />, keywords: ["araçlar", "tools", "referans", "devcleaner_scan_workspace", "devcleaner_clean_safe"] },

  // 4. Webhook
  { id: "webhook-guide", title: "Evrensel Webhook Mimarisi", category: "webhook", icon: <Webhook size={14} />, keywords: ["webhook", "otomasyon", "n8n", "post", "http", "bildirim"] },
  { id: "webhook-schema", title: "JSON Payload Şeması", category: "webhook", icon: <ExternalLink size={14} />, keywords: ["şema", "schema", "json", "payload", "örnek", "status"] },

  // 5. Güvenlik & Hata Çözümü
  { id: "safety-architecture", title: "TOCTOU & Süreç Kilidi Koruması", category: "safety", icon: <Lock size={14} />, keywords: ["toctou", "reparse", "junction", "symlink", "kilit", "süreç", "process", "backoff"] },
  { id: "troubleshooting", title: "Sorun Giderme & Hata Matrisi", category: "safety", icon: <Wrench size={14} />, keywords: ["hata", "sorun", "target_active", "no_project_marker", "user_protected", "toctou_blocked", "kilit", "çözüm"] },
];

export const DocsView: React.FC = () => {
  const [activeTopicId, setActiveTopicId] = useState<string>("quickstart");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Shell switcher state for CLI guides
  const [cliShell, setCliShell] = useState<"powershell" | "cmd" | "bash">("powershell");

  // CLI Builder State
  const [cliPath, setCliPath] = useState<string>("D:\\projeler");
  const [cliScope, setCliScope] = useState<string>("projects");
  const [cliAutoClean, setCliAutoClean] = useState<boolean>(true);
  const [cliDryRun, setCliDryRun] = useState<boolean>(false);
  const [cliJson, setCliJson] = useState<boolean>(false);
  const [cliSafety, setCliSafety] = useState<string>("safe,regenerate");
  const [cliMinSize, setCliMinSize] = useState<string>("50");
  const [cliWebhook, setCliWebhook] = useState<string>("");

  // MCP IDE Switcher State
  const [activeIde, setActiveIde] = useState<"cursor" | "windsurf" | "claude" | "antigravity">("cursor");

  // Global Keyboard Shortcuts (Ctrl+K or / to search, Esc to clear)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (e.key === "Escape" && document.activeElement === searchInputRef.current) {
        setSearchQuery("");
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Resilient Clipboard API with fallback
  const copyToClipboard = async (text: string, key: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((curr) => (curr === key ? null : curr));
      }, 2000);
    } catch {
      // Fallback
    }
  };

  const filteredTopics = useMemo(() => {
    if (!searchQuery.trim()) return TOPICS;
    const q = searchQuery.toLowerCase();
    return TOPICS.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        (t.keywords && t.keywords.some((k) => k.toLowerCase().includes(q)))
    );
  }, [searchQuery]);

  // Dynamic CLI Command Generation
  const generatedCliCommand = useMemo(() => {
    const parts = ["dev-cleaner", "scan"];
    if (cliPath.trim()) parts.push(`"${cliPath.trim()}"`);
    if (cliScope !== "projects") parts.push(`--scope ${cliScope}`);
    if (cliAutoClean) {
      parts.push("--auto-clean");
      if (cliSafety !== "safe,regenerate") parts.push(`--safety ${cliSafety}`);
      if (cliDryRun) parts.push("--dry-run");
    }
    if (cliMinSize && Number(cliMinSize) > 0) parts.push(`--min-size ${cliMinSize}`);
    if (cliJson) parts.push("--json");
    if (cliWebhook.trim()) parts.push(`--webhook "${cliWebhook.trim()}"`);
    return parts.join(" ");
  }, [cliPath, cliScope, cliAutoClean, cliDryRun, cliJson, cliSafety, cliMinSize, cliWebhook]);

  // MCP IDE Configs
  const mcpConfigs = {
    cursor: {
      file: "%USERPROFILE%\\.cursor\\mcp.json",
      json: JSON.stringify(
        {
          mcpServers: {
            "dev-cleaner": {
              command: "dev-cleaner",
              args: ["mcp"],
            },
          },
        },
        null,
        2
      ),
    },
    windsurf: {
      file: "%USERPROFILE%\\.codeium\\windsurf\\mcp_config.json",
      json: JSON.stringify(
        {
          mcpServers: {
            "dev-cleaner": {
              command: "dev-cleaner",
              args: ["mcp"],
            },
          },
        },
        null,
        2
      ),
    },
    claude: {
      file: "%APPDATA%\\Claude\\claude_desktop_config.json",
      json: JSON.stringify(
        {
          mcpServers: {
            "dev-cleaner": {
              command: "dev-cleaner",
              args: ["mcp"],
            },
          },
        },
        null,
        2
      ),
    },
    antigravity: {
      file: "%USERPROFILE%\\.gemini\\antigravity\\mcp_settings.json",
      json: JSON.stringify(
        {
          mcpServers: {
            "dev-cleaner": {
              command: "dev-cleaner",
              args: ["mcp"],
            },
          },
        },
        null,
        2
      ),
    },
  };

  const webhookSampleJson = JSON.stringify(
    {
      event: "cleanup_completed",
      timestamp: "2026-11-06T02:30:00Z",
      product: "Dev Cleaner by Vellium",
      version: "2.2.0",
      scope: "projects",
      target_count: 24,
      total_bytes: 45678901234,
      total_human: "42.54 GB",
      status: "success",
      cleaned_count: 24,
      cleaned_bytes: 45678901234,
      cleaned_human: "42.54 GB",
      dry_run: false,
    },
    null,
    2
  );

  return (
    <div className="docs-container">
      {/* Sol Kenar Çubuğu */}
      <aside className="docs-sidebar">
        <div className="docs-sidebar-header">
          <div className="docs-search-box">
            <Search size={14} />
            <input
              ref={searchInputRef}
              type="text"
              className="docs-search-input"
              placeholder="Dokümanlarda ara... (Ctrl+K)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <kbd className="docs-search-kbd">/</kbd>
          </div>
        </div>

        <div className="docs-sidebar-scroll">
          {/* 1. Rehberler & Genel Bakış */}
          <div className="docs-nav-group">
            <span className="docs-nav-group-title">Rehberler &amp; Mimari</span>
            {filteredTopics
              .filter((t) => t.category === "guide")
              .map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`docs-nav-link ${activeTopicId === t.id ? "active" : ""}`}
                  onClick={() => setActiveTopicId(t.id)}
                >
                  {t.icon}
                  <span>{t.title}</span>
                </button>
              ))}
          </div>

          {/* 2. Terminal & CLI */}
          <div className="docs-nav-group">
            <span className="docs-nav-group-title">Terminal &amp; CLI</span>
            {filteredTopics
              .filter((t) => t.category === "cli")
              .map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`docs-nav-link ${activeTopicId === t.id ? "active" : ""}`}
                  onClick={() => setActiveTopicId(t.id)}
                >
                  {t.icon}
                  <span>{t.title}</span>
                </button>
              ))}
          </div>

          {/* 3. AI & MCP */}
          <div className="docs-nav-group">
            <span className="docs-nav-group-title">AI &amp; MCP Entegrasyonu</span>
            {filteredTopics
              .filter((t) => t.category === "mcp")
              .map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`docs-nav-link ${activeTopicId === t.id ? "active" : ""}`}
                  onClick={() => setActiveTopicId(t.id)}
                >
                  {t.icon}
                  <span>{t.title}</span>
                </button>
              ))}
          </div>

          {/* 4. Otomasyon & Webhook */}
          <div className="docs-nav-group">
            <span className="docs-nav-group-title">Otomasyon &amp; Webhook</span>
            {filteredTopics
              .filter((t) => t.category === "webhook")
              .map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`docs-nav-link ${activeTopicId === t.id ? "active" : ""}`}
                  onClick={() => setActiveTopicId(t.id)}
                >
                  {t.icon}
                  <span>{t.title}</span>
                </button>
              ))}
          </div>

          {/* 5. Güvenlik & Destek */}
          <div className="docs-nav-group">
            <span className="docs-nav-group-title">Güvenlik &amp; Destek</span>
            {filteredTopics
              .filter((t) => t.category === "safety")
              .map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`docs-nav-link ${activeTopicId === t.id ? "active" : ""}`}
                  onClick={() => setActiveTopicId(t.id)}
                >
                  {t.icon}
                  <span>{t.title}</span>
                </button>
              ))}
          </div>
        </div>
      </aside>

      {/* Sağ Okuma ve Etkileşim Alanı */}
      <main className="docs-content-pane">
        {/* TOPIC 1: QUICKSTART */}
        {activeTopicId === "quickstart" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">Genel Bakış</span>
              <span className="docs-version-pill">v2.2.0</span>
            </div>
            <h1 className="docs-title">Dev Cleaner'a Hoş Geldiniz</h1>
            <p className="docs-lead">
              Dev Cleaner, yazılım geliştiricilerin çalışma ortamlarındaki ağır bağımlılıkları (node_modules, target, .venv, build),
              yapay zeka ajan depolarını (Claude Code, Cursor, Codex) ve 21 küresel araç önbelleğini sıfır veri kaybı garantisiyle
              temizleyen profesyonel bir ekosistemdir.
            </p>

            <div className="docs-callout docs-callout--success">
              <ShieldCheck className="docs-callout-icon" size={18} />
              <div>
                <strong>Sıfır Veri Kaybı Prensibi:</strong> Dev Cleaner ile temizlenen tüm proje ve AI artıkları doğrudan
                <strong> Windows Geri Dönüşüm Kutusuna</strong> taşınır. Yanlışlıkla silinen hiçbir şey kalıcı olarak yok olmaz.
              </div>
            </div>

            <h2 className="docs-h2">4 Temel Çalışma Modu</h2>
            <p className="docs-p">
              Dev Cleaner'ı ister masaüstü arayüzünden, ister terminal CLI üzerinden, ister Claude/Cursor gibi yapay zeka ajanları
              aracılığıyla (MCP), isterseniz de n8n/CI pipeline'larında webhook entegrasyonuyla tam otonom kullanabilirsiniz.
            </p>

            <div className="docs-code-card">
              <div className="docs-code-header">
                <span className="docs-code-header-left">Terminal CLI ile 5 Saniyede Başlayın</span>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard("dev-cleaner scan D:\\projeler --scope all --auto-clean --dry-run", "qs-cli")}
                >
                  {copiedKey === "qs-cli" ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === "qs-cli" ? "Kopyalandı!" : "Kopyala"}
                </button>
              </div>
              <pre className="docs-code-pre">{highlightBash("dev-cleaner scan D:\\projeler --scope all --auto-clean --dry-run")}</pre>
            </div>
          </article>
        )}

        {/* TOPIC 2: MANIFESTO */}
        {activeTopicId === "manifesto" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">Güvenlik Manifestosu</span>
            </div>
            <h1 className="docs-title">Sıfır Veri Kaybı &amp; Güvenlik Manifestosu</h1>
            <p className="docs-lead">
              Bir temizlik aracının en önemli özelliği disk boşaltması değil, geliştiricinin hiçbir kaynak koduna veya kişisel
              verisine asla zarar vermemesidir. Dev Cleaner şu katı kurallarla çalışır:
            </p>

            <div className="docs-callout">
              <Info className="docs-callout-icon" size={18} />
              <div>
                <strong>1. Asla Kalıcı Silme Yoktur:</strong> Tüm işlemler Windows Shell COM API'si üzerinden Geri Dönüşüm
                Kutusuna taşınır. Kullanıcı dilediği zaman tek tıkla geri yükleyebilir.
              </div>
            </div>

            <div className="docs-callout docs-callout--warning">
              <Lock className="docs-callout-icon" size={18} />
              <div>
                <strong>2. TOCTOU &amp; Sembolik Bağ Savunması:</strong> Hedef dizin taranırken ve silinirken sembolik bağlar
                (symlinks) ve NTFS Junction noktaları taranmaz ve silinmez. Sistem klasörlerine (C:\Windows, ~/.ssh) yönelen
                tüm reparse noktaları anında bloke edilir.
              </div>
            </div>

            <div className="docs-callout docs-callout--success">
              <ShieldCheck className="docs-callout-icon" size={18} />
              <div>
                <strong>3. Süreç Kilidi Koruması:</strong> Aktif olarak çalışan bir Node.js veya Cargo süreci hedef klasörü
                kullanıyorsa, Dev Cleaner dosyayı zorla silmeye çalışmaz; atlar ve raporda durumu bildirir.
              </div>
            </div>
          </article>
        )}

        {/* TOPIC 3: RECOVERY GUIDE (NEW!) */}
        {activeTopicId === "recovery-guide" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">Güvenlik &amp; Kurtarma</span>
              <span className="docs-version-pill">Adım Adım Kılavuz</span>
            </div>
            <h1 className="docs-title">Yanlışlıkla Silinen Bir Dosyayı Geri Yükleme</h1>
            <p className="docs-lead">
              Dev Cleaner ile temizlenen hiçbir dosya anında kalıcı olarak silinmez. Tüm dosyalarınız Windows Geri Dönüşüm
              Kutusunda orijinal yolları ve meta verileriyle saklanır. Yanlışlıkla sildiğiniz bir projeyi saniyeler içinde kurtarabilirsiniz:
            </p>

            <h2 className="docs-h2">Yöntem 1: Windows Masaüstünden Tek Tıkla Geri Yükleme</h2>
            <div className="docs-callout docs-callout--success">
              <RotateCcw className="docs-callout-icon" size={18} />
              <div>
                <strong>1. Masaüstündeki Geri Dönüşüm Kutusunu Açın:</strong> Çift tıklayarak Windows Recycle Bin klasörüne gidin.<br />
                <strong>2. Silinen Klasörü Bulun:</strong> Proje adını veya silinme tarihini kullanarak klasörü tespit edin.<br />
                <strong>3. Sağ Tıklayın &gt; "Geri Yükle" (Restore) Seçin:</strong> Windows, klasörü silindiği tam orijinal dizinine (örneğin <code>D:\projeler\app\node_modules</code>) anında geri taşır.
              </div>
            </div>

            <h2 className="docs-h2">Yöntem 2: PowerShell ile Terminalden Kurtarma</h2>
            <p className="docs-p">Terminalden ayrılmadan Geri Dönüşüm Kutusundaki silinen öğeleri sorgulamak ve incelemek için:</p>
            <div className="docs-code-card">
              <div className="docs-code-header">
                <span>PowerShell ile Son Silinenleri Listele</span>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard('(New-Object -ComObject Shell.Application).Namespace(0xa).Items() | Select-Object Name, Path', 'rec-ps')}
                >
                  {copiedKey === 'rec-ps' ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === 'rec-ps' ? 'Kopyalandı!' : 'Kopyala'}
                </button>
              </div>
              <pre className="docs-code-pre">{highlightBash('(New-Object -ComObject Shell.Application).Namespace(0xa).Items() | Select-Object Name, Path')}</pre>
            </div>

            <div className="docs-callout">
              <ShieldCheck className="docs-callout-icon" size={18} />
              <div>
                <strong>Git Repoları Asla Zarar Görmez:</strong> Dev Cleaner çekirdek seviyesinde <code>.git</code> dizinlerini,
                <code>.env</code> dosyalarını ve kaynak kod uzantılarını asla hedeflemez. Kodunuz her durumda güvendedir.
              </div>
            </div>
          </article>
        )}

        {/* TOPIC 4: FAQ (NEW!) */}
        {activeTopicId === "faq" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">Destek</span>
              <span className="docs-version-pill">Sıkça Sorulan Sorular</span>
            </div>
            <h1 className="docs-title">Geliştirici Sıkça Sorulan Sorular (FAQ)</h1>
            <p className="docs-lead">
              Dev Cleaner kullanımı ve temizlik mantığı hakkında geliştiricilerin en sık sorduğu soruların yanıtları:
            </p>

            <div className="docs-faq-card">
              <div className="docs-faq-q">
                <HelpCircle size={16} className="text-accent" />
                <span><code>node_modules</code> veya <code>.venv</code> silersem kodumu kaybeder miyim?</span>
              </div>
              <p className="docs-faq-a">
                Kesinlikle hayır. Bu klasörler yalnızca indirilen üçüncü taraf paketlerdir. Projenizdeki <code>package.json</code>
                veya <code>requirements.txt</code> dosyası korunduğu sürece, dilediğiniz zaman <code>npm install</code> veya
                <code>pip install -r requirements.txt</code> çalıştırarak projenizi sıfırdan ve tertemiz yeniden üretebilirsiniz.
              </p>
            </div>

            <div className="docs-faq-card">
              <div className="docs-faq-q">
                <HelpCircle size={16} className="text-accent" />
                <span>Docker önbelleğini temizlemek çalışan konteynerlarımı durdurur mu?</span>
              </div>
              <p className="docs-faq-a">
                Hayır. Dev Cleaner resmi <code>docker builder prune -f</code> komutunu çağırır. Çalışan konteynerlar, aktif veritabanı
                volume'ları ve adlandırılmış imajlar asla silinmez; yalnızca atıl ara derleme katmanları temizlenir.
              </p>
            </div>

            <div className="docs-faq-card">
              <div className="docs-faq-q">
                <HelpCircle size={16} className="text-accent" />
                <span>Terminalde <code>dev-cleaner</code> komutu bulunamadı (Command not found) hatası alıyorum?</span>
              </div>
              <p className="docs-faq-a">
                Dev Cleaner, <code>%LOCALAPPDATA%\Microsoft\WindowsApps\dev-cleaner.exe</code> konumuna kurulur. Eğer terminaliniz
                açıkken kurulum yaptıysanız, terminalin ortam değişkenlerini yenilemek için terminal penceresini kapatıp yeniden açmanız yeterlidir.
              </p>
            </div>

            <div className="docs-faq-card">
              <div className="docs-faq-q">
                <HelpCircle size={16} className="text-accent" />
                <span>Temizlikten sonra diskim neden anında boşalmadı?</span>
              </div>
              <p className="docs-faq-a">
                Güvenlik manifestomuz gereği dosyalar Geri Dönüşüm Kutusuna taşınır. Disk alanını kalıcı olarak serbest bırakmak için
                masaüstündeki Geri Dönüşüm Kutusunu sağ tıklayıp "Geri Dönüşüm Kutusunu Boşalt" seçeneğini kullanabilirsiniz.
              </p>
            </div>
          </article>
        )}

        {/* TOPIC 5: CLI GUIDE */}
        {activeTopicId === "cli-guide" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">Terminal CLI</span>
            </div>
            <h1 className="docs-title">Terminal CLI Komut Kılavuzu</h1>
            <p className="docs-lead">
              Dev Cleaner, Windows PATH üzerinde genel bir komut olarak çalışır. Terminalinizden dilediğiniz zaman çağırabilirsiniz:
            </p>

            {/* Shell Switcher Tabs */}
            <div className="ide-tabs-bar">
              <button
                type="button"
                className={`ide-tab-btn ${cliShell === "powershell" ? "active" : ""}`}
                onClick={() => setCliShell("powershell")}
              >
                PowerShell
              </button>
              <button
                type="button"
                className={`ide-tab-btn ${cliShell === "cmd" ? "active" : ""}`}
                onClick={() => setCliShell("cmd")}
              >
                CMD
              </button>
              <button
                type="button"
                className={`ide-tab-btn ${cliShell === "bash" ? "active" : ""}`}
                onClick={() => setCliShell("bash")}
              >
                Git Bash / WSL
              </button>
            </div>

            <h2 className="docs-h2">1. `dev-cleaner scan`</h2>
            <p className="docs-p">Hedef dizindeki geliştirici bağımlılıklarını tarar veya otonom temizler.</p>
            <div className="docs-code-card">
              <div className="docs-code-header">
                <span>Örnek Kullanım ({cliShell})</span>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard(
                    cliShell === "bash"
                      ? "dev-cleaner scan /d/projeler --auto-clean --safety safe,regenerate"
                      : "dev-cleaner scan \"D:\\projeler\" --auto-clean --safety safe,regenerate",
                    "cli-scan"
                  )}
                >
                  {copiedKey === "cli-scan" ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === "cli-scan" ? "Kopyalandı" : "Kopyala"}
                </button>
              </div>
              <pre className="docs-code-pre">
                {cliShell === "bash"
                  ? highlightBash(
`# Standart tarama ve insan okunabilir çıktı
dev-cleaner scan "/d/projeler"

# Otonom temizlik (Yalnızca güvenli ve yeniden üretilebilir hedefleri çöpe taşır)
dev-cleaner scan "/d/projeler" --auto-clean --safety safe,regenerate

# Simülasyon modu (Hiçbir şeyi silmez, nelerin temizleneceğini raporlar)
dev-cleaner scan "/d/projeler" --auto-clean --dry-run

# JSON çıktısı ile CI/CD entegrasyonu
dev-cleaner scan "/d/projeler" --json`
                    )
                  : highlightBash(
`# Standart tarama ve insan okunabilir çıktı
dev-cleaner scan "D:\\projeler"

# Otonom temizlik (Yalnızca güvenli ve yeniden üretilebilir hedefleri çöpe taşır)
dev-cleaner scan "D:\\projeler" --auto-clean --safety safe,regenerate

# Simülasyon modu (Hiçbir şeyi silmez, nelerin temizleneceğini raporlar)
dev-cleaner scan "D:\\projeler" --auto-clean --dry-run

# JSON çıktısı ile CI/CD entegrasyonu
dev-cleaner scan "D:\\projeler" --json`
                    )}
              </pre>
            </div>

            <h2 className="docs-h2">2. `dev-cleaner caches`</h2>
            <p className="docs-p">21 geliştirici aracının paket önbelleklerini listeler veya resmi komutla temizler.</p>
            <div className="docs-code-card">
              <div className="docs-code-header">
                <span>Önbellek Komutları</span>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard("dev-cleaner caches --clean all", "cli-cache")}
                >
                  {copiedKey === "cli-cache" ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === "cli-cache" ? "Kopyalandı" : "Kopyala"}
                </button>
              </div>
              <pre className="docs-code-pre">
                {highlightBash(
`# Tüm önbellek durumunu listele
dev-cleaner caches

# Belirli bir aracın önbelleğini temizle (örn. npm, pip, cargo, docker)
dev-cleaner caches --clean npm

# Tüm yüklü araçların önbelleklerini temizle
dev-cleaner caches --clean all`
                )}
              </pre>
            </div>

            <h2 className="docs-h2">3. `dev-cleaner history`</h2>
            <p className="docs-p">Geçmiş temizlik denetim kayıtlarını listeler.</p>
            <div className="docs-code-card">
              <pre className="docs-code-pre">{highlightBash("dev-cleaner history --limit 15")}</pre>
            </div>
          </article>
        )}

        {/* TOPIC 6: CLI BUILDER */}
        {activeTopicId === "cli-builder" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">İnteraktif Araç</span>
            </div>
            <h1 className="docs-title">İnteraktif CLI Komut Oluşturucu</h1>
            <p className="docs-lead">
              Aşağıdaki seçenekleri yapılandırın; Dev Cleaner sizin için kopyalanmaya hazır terminal komutunu dinamik olarak oluştursun:
            </p>

            <div className="cli-builder-card">
              <div className="cli-builder-grid">
                <div className="cli-builder-field">
                  <label className="cli-builder-label">Hedef Dizin:</label>
                  <input
                    type="text"
                    className="cli-builder-input"
                    value={cliPath}
                    onChange={(e) => setCliPath(e.target.value)}
                    placeholder="D:\\projeler"
                  />
                </div>

                <div className="cli-builder-field">
                  <label className="cli-builder-label">Tarama Kapsamı:</label>
                  <select
                    className="cli-builder-input"
                    value={cliScope}
                    onChange={(e) => setCliScope(e.target.value)}
                  >
                    <option value="projects">Projeler (Dependencies, build, cache)</option>
                    <option value="agents">AI Ajanları (Claude, Cursor, Codex)</option>
                    <option value="caches">Geliştirici Önbellekleri</option>
                    <option value="all">Tam Tarama (Tümü)</option>
                  </select>
                </div>

                <div className="cli-builder-field">
                  <label className="cli-builder-label">Minimum Boyut Eşiği (MB):</label>
                  <NumberField
                    value={Number(cliMinSize) || 0}
                    min={0}
                    max={100000}
                    step={10}
                    ariaLabel="Minimum Boyut Eşiği (MB)"
                    increaseLabel="Arttır"
                    decreaseLabel="Azalt"
                    onCommit={(val) => setCliMinSize(String(val))}
                  />
                </div>

                <div className="cli-builder-field">
                  <label className="cli-builder-label">Webhook URL (İsteğe bağlı):</label>
                  <input
                    type="url"
                    className="cli-builder-input"
                    value={cliWebhook}
                    onChange={(e) => setCliWebhook(e.target.value)}
                    placeholder="https://n8n.sirket.com/clean"
                  />
                </div>

                <div className="cli-builder-field">
                  <label className="cli-builder-label">Güvenlik Filtresi:</label>
                  <select
                    className="cli-builder-input"
                    value={cliSafety}
                    onChange={(e) => setCliSafety(e.target.value)}
                  >
                    <option value="safe,regenerate">Safe &amp; Regenerate (Önerilen)</option>
                    <option value="safe">Yalnızca Safe (En Katı)</option>
                    <option value="safe,regenerate,review">Tümü (Review Dahil)</option>
                  </select>
                </div>
              </div>

              <div className="cli-builder-checkboxes">
                <label className="cli-checkbox-label">
                  <input
                    type="checkbox"
                    checked={cliAutoClean}
                    onChange={(e) => setCliAutoClean(e.target.checked)}
                  />
                  <span>--auto-clean (Otomatik Geri Dönüşüme Taşı)</span>
                </label>

                {cliAutoClean && (
                  <label className="cli-checkbox-label">
                    <input
                      type="checkbox"
                      checked={cliDryRun}
                      onChange={(e) => setCliDryRun(e.target.checked)}
                    />
                    <span>--dry-run (Simülasyon Modu)</span>
                  </label>
                )}

                <label className="cli-checkbox-label">
                  <input
                    type="checkbox"
                    checked={cliJson}
                    onChange={(e) => setCliJson(e.target.checked)}
                  />
                  <span>--json (Makine Okunabilir JSON Çıktısı)</span>
                </label>
              </div>

              <div className="docs-code-card" style={{ marginTop: 8 }}>
                <div className="docs-code-header">
                  <span className="docs-code-header-left">Oluşturulan Terminal Komutu</span>
                  <button
                    type="button"
                    className="docs-copy-action"
                  >
                    {copiedKey === "gen-cli" ? <Check size={13} /> : <Copy size={13} />}
                    {copiedKey === "gen-cli" ? "Kopyalandı!" : "Komutu Kopyala"}
                  </button>
                </div>
                <pre className="docs-code-pre">{highlightBash(generatedCliCommand)}</pre>
              </div>
            </div>
          </article>
        )}

        {/* TOPIC 7: CLI HEADLESS */}
        {activeTopicId === "cli-headless" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">Otomasyon</span>
            </div>
            <h1 className="docs-title">Headless Cron &amp; CI/CD Pipeline Entegrasyonu</h1>
            <p className="docs-lead">
              Dev Cleaner, Windows Görev Zamanlayıcısı (Task Scheduler) veya GitHub Actions / GitLab CI runner'larında
              arayüzsüz (headless) çalışarak disk doluluğunu periyodik olarak temizleyebilir.
            </p>

            <h2 className="docs-h2">Windows Görev Zamanlayıcısı ile Haftalık Temizlik</h2>
            <div className="docs-code-card">
              <div className="docs-code-header">
                <span>PowerShell Görev Tanımlama</span>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard(
`$Action = New-ScheduledTaskAction -Execute "dev-cleaner.exe" -Argument "scan C:\\dev --auto-clean --min-size 100 --webhook https://n8n.sirket.com/cleanup"
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 3am
Register-ScheduledTask -Action $Action -Trigger $Trigger -TaskName "DevCleanerWeekly" -Description "Haftalık güvenli bağımlılık temizliği"`,
                    "cron-task"
                  )}
                >
                  {copiedKey === "cron-task" ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === "cron-task" ? "Kopyalandı" : "Kopyala"}
                </button>
              </div>
              <pre className="docs-code-pre">
                {highlightBash(
`# PowerShell ile Pazar günleri 03:00'da çalışan otonom görev tanımlama
$Action = New-ScheduledTaskAction -Execute "dev-cleaner.exe" -Argument "scan C:\\dev --auto-clean --min-size 100 --webhook https://n8n.sirket.com/cleanup"
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 3am
Register-ScheduledTask -Action $Action -Trigger $Trigger -TaskName "DevCleanerWeekly" -Description "Haftalık güvenli bağımlılık temizliği"`
                )}
              </pre>
            </div>
          </article>
        )}

        {/* TOPIC 8: MCP OVERVIEW */}
        {activeTopicId === "mcp-overview" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">AI Protokolü</span>
              <span className="docs-version-pill">MCP v2.2.0</span>
            </div>
            <h1 className="docs-title">Model Context Protocol (MCP) Sunucusu</h1>
            <p className="docs-lead">
              Dev Cleaner, Anthropic ve Linux Foundation tarafından desteklenen <strong>Model Context Protocol (MCP)</strong>
              standart sunucusunu yerel olarak barındırır. Bu sayede Cursor, Windsurf veya Claude Code gibi AI ajanları doğrudan
              çalışma alanınızdaki disk yükünü sorgulayabilir ve onayınızla güvenli temizlik yapabilir.
            </p>

            <div className="docs-callout docs-callout--success">
              <Cpu className="docs-callout-icon" size={18} />
              <div>
                <strong>Prompt Injection Koruması:</strong> AI ajanları rastgele dosya yolu silme yetkisine sahip değildir.
                Yalnızca geçerli tarama oturumunda doğrulanmış ve güvenlik sınıfı Safe/Regenerate olan hedeflerin ID'lerini
                çöpe taşıyabilirler.
              </div>
            </div>

            <h2 className="docs-h2">Sunucuyu Başlatma</h2>
            <div className="docs-code-card">
              <pre className="docs-code-pre">{highlightBash("dev-cleaner mcp")}</pre>
            </div>
          </article>
        )}

        {/* TOPIC 9: MCP IDE SETUP */}
        {activeTopicId === "mcp-ide-setup" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">IDE Kurulumu</span>
            </div>
            <h1 className="docs-title">Çoklu IDE MCP Konfigürasyonu</h1>
            <p className="docs-lead">
              Kullandığınız geliştirme ortamını seçin ve tek tıkla yapılandırma dosyanıza ekleyin:
            </p>

            {/* IDE Tabs */}
            <div className="ide-tabs-bar">
              <button
                type="button"
                className={`ide-tab-btn ${activeIde === "cursor" ? "active" : ""}`}
                onClick={() => setActiveIde("cursor")}
              >
                Cursor
              </button>
              <button
                type="button"
                className={`ide-tab-btn ${activeIde === "windsurf" ? "active" : ""}`}
                onClick={() => setActiveIde("windsurf")}
              >
                Windsurf
              </button>
              <button
                type="button"
                className={`ide-tab-btn ${activeIde === "claude" ? "active" : ""}`}
                onClick={() => setActiveIde("claude")}
              >
                Claude Desktop
              </button>
              <button
                type="button"
                className={`ide-tab-btn ${activeIde === "antigravity" ? "active" : ""}`}
                onClick={() => setActiveIde("antigravity")}
              >
                Antigravity
              </button>
            </div>

            <div className="docs-code-card">
              <div className="docs-code-header">
                <span className="docs-code-header-left">Hedef Dosya: {mcpConfigs[activeIde].file}</span>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard(mcpConfigs[activeIde].json, `mcp-${activeIde}`)}
                >
                  {copiedKey === `mcp-${activeIde}` ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === `mcp-${activeIde}` ? "Kopyalandı!" : "JSON'ı Kopyala"}
                </button>
              </div>
              <pre className="docs-code-pre">{highlightJson(mcpConfigs[activeIde].json)}</pre>
            </div>
          </article>
        )}

        {/* TOPIC 10: MCP PROMPTS (NEW!) */}
        {activeTopicId === "mcp-prompts" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">Yapay Zeka Şablonları</span>
              <span className="docs-version-pill">Tek Tıkla Kopyala</span>
            </div>
            <h1 className="docs-title">Cursor &amp; Claude Code Hazır İstem Kütüphanesi</h1>
            <p className="docs-lead">
              Dev Cleaner MCP sunucusunu IDE'nize bağladıktan sonra, AI asistanınızla konuşurken kullanabileceğiniz
              yüksek verimli, doğrudan sonuç üreten hazır istem kartları:
            </p>

            <div className="docs-prompt-card">
              <div className="docs-prompt-header">
                <div className="docs-prompt-title">
                  <Bot size={16} className="text-accent" />
                  <span>Şablon 1: Güvenli Alan Açma &amp; Analiz</span>
                </div>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard('Dev Cleaner MCP sunucusunu kullanarak çalışma alanımdaki projeleri tara. 100 MB\'tan büyük node_modules, target ve derleme artıklarını listele; onayımı alarak güvenle Geri Dönüşüm Kutusuna taşı.', 'pr-1')}
                >
                  {copiedKey === 'pr-1' ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === 'pr-1' ? 'İstem Kopyalandı!' : 'İstemi Kopyala'}
                </button>
              </div>
              <div className="docs-prompt-body">
                "Dev Cleaner MCP sunucusunu kullanarak çalışma alanımdaki projeleri tara. 100 MB'tan büyük node_modules, target ve derleme artıklarını listele; onayımı alarak güvenle Geri Dönüşüm Kutusuna taşı."
              </div>
            </div>

            <div className="docs-prompt-card">
              <div className="docs-prompt-header">
                <div className="docs-prompt-title">
                  <Bot size={16} className="text-accent" />
                  <span>Şablon 2: Paket Önbellekleri Denetimi</span>
                </div>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard('devcleaner_list_caches aracını çağır. npm, pip, cargo ve docker önbelleklerimin ne kadar disk alanı kapladığını incele ve bana bir temizlik özeti çıkar.', 'pr-2')}
                >
                  {copiedKey === 'pr-2' ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === 'pr-2' ? 'İstem Kopyalandı!' : 'İstemi Kopyala'}
                </button>
              </div>
              <div className="docs-prompt-body">
                "devcleaner_list_caches aracını çağır. npm, pip, cargo ve docker önbelleklerimin ne kadar disk alanı kapladığını incele ve bana bir temizlik özeti çıkar."
              </div>
            </div>

            <div className="docs-prompt-card">
              <div className="docs-prompt-header">
                <div className="docs-prompt-title">
                  <Bot size={16} className="text-accent" />
                  <span>Şablon 3: Dry-Run Simülasyonu</span>
                </div>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard('Proje klasörümde simülasyon (dry-run) modunda tarama yap. Hiçbir dosyayı silmeden yalnızca temizlenebilecek alan toplamını ve hedefleri raporla.', 'pr-3')}
                >
                  {copiedKey === 'pr-3' ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === 'pr-3' ? 'İstem Kopyalandı!' : 'İstemi Kopyala'}
                </button>
              </div>
              <div className="docs-prompt-body">
                "Proje klasörümde simülasyon (dry-run) modunda tarama yap. Hiçbir dosyayı silmeden yalnızca temizlenebilecek alan toplamını ve hedefleri raporla."
              </div>
            </div>
          </article>
        )}

        {/* TOPIC 11: MCP TOOLS */}
        {activeTopicId === "mcp-tools" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">MCP Araçları</span>
            </div>
            <h1 className="docs-title">Dev Cleaner MCP Araçları Referansı</h1>
            <p className="docs-lead">
              Dev Cleaner MCP sunucusu yapay zeka modellerine 6 otonom araç sağlar:
            </p>

            <h2 className="docs-h2">1. `devcleaner_scan_workspace`</h2>
            <p className="docs-p">Çalışma alanını tarayarak temizlenebilir hedefleri JSON olarak sunar.</p>

            <h2 className="docs-h2">2. `devcleaner_clean_safe`</h2>
            <p className="docs-p">Doğrulanmış hedef ID'lerini Windows Geri Dönüşüm Kutusuna taşır.</p>

            <h2 className="docs-h2">3. `devcleaner_list_caches`</h2>
            <p className="docs-p">21 geliştirici aracının paket önbellek boyutlarını raporlar.</p>

            <h2 className="docs-h2">4. `devcleaner_clean_cache`</h2>
            <p className="docs-p">Resmi paket yöneticisi komutuyla önbelleği temizler.</p>

            <h2 className="docs-h2">5. `devcleaner_get_history`</h2>
            <p className="docs-p">Geçmiş temizlik kayıtlarını döner.</p>

            <h2 className="docs-h2">6. `devcleaner_inspect_target`</h2>
            <p className="docs-p">Belirli bir dosya yolunun güvenlik sınıfını ve kurallarını inceler.</p>
          </article>
        )}

        {/* TOPIC 12: WEBHOOK GUIDE */}
        {activeTopicId === "webhook-guide" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">Entegrasyon</span>
            </div>
            <h1 className="docs-title">Evrensel Webhook &amp; Otomasyon Mimarisi</h1>
            <p className="docs-lead">
              Dev Cleaner, ister masaüstü arayüzünden ister CLI üzerinden başlatılsın; tarama veya temizlik bittiğinde
              yapılandırılmış Webhook adresine HTTP POST ile canlı bildirim iletir.
            </p>

            <div className="docs-callout docs-callout--success">
              <Webhook className="docs-callout-icon" size={18} />
              <div>
                <strong>Kolay Kurulum:</strong> Ayarlar sayfasındaki <strong>"Otomasyon &amp; Webhook"</strong> kartından
                URL'nizi girip tek tıkla canlı test isteği gönderebilirsiniz.
              </div>
            </div>
          </article>
        )}

        {/* TOPIC 13: WEBHOOK SCHEMA */}
        {activeTopicId === "webhook-schema" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">JSON Şeması</span>
            </div>
            <h1 className="docs-title">Webhook JSON Payload Şeması</h1>
            <p className="docs-lead">
              Temizlik veya tarama tamamlandığında hedef sunucuya iletilen JSON nesnesi:
            </p>

            <div className="docs-code-card">
              <div className="docs-code-header">
                <span>Örnek Payload</span>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard(webhookSampleJson, "wh-json")}
                >
                  {copiedKey === "wh-json" ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === "wh-json" ? "Kopyalandı" : "JSON Kopyala"}
                </button>
              </div>
              <pre className="docs-code-pre">{highlightJson(webhookSampleJson)}</pre>
            </div>
          </article>
        )}

        {/* TOPIC 14: SAFETY ARCHITECTURE */}
        {activeTopicId === "safety-architecture" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">Sistem Mimarisi</span>
            </div>
            <h1 className="docs-title">TOCTOU &amp; Süreç Kilidi Savunması</h1>
            <p className="docs-lead">
              Time-of-Check to Time-of-Use (TOCTOU) yarış durumlarına karşı Dev Cleaner'ın uyguladığı endüstri standardı
              savunma mekanizmaları:
            </p>

            <div className="docs-callout">
              <Lock className="docs-callout-icon" size={18} />
              <div>
                <strong>NTFS Reparse Point Analizi:</strong> Bir dizin silinmeden hemen önce <code>symlink_metadata</code> ile denetlenir.
                Eğer dosya bir Directory Junction veya Symlink haline geldiyse silme derhal iptal edilir.
              </div>
            </div>

            <div className="docs-callout docs-callout--success">
              <ShieldCheck className="docs-callout-icon" size={18} />
              <div>
                <strong>3 Aşamalı Exponential Backoff:</strong> Windows Defender veya arama dizinleyicileri tarafından geçici
                olarak kilitlenen dosyalarda 100ms, 250ms ve 500ms aralıklarla yeniden denenir; kilit çözülmezse güvenle atlanır.
              </div>
            </div>
          </article>
        )}

        {/* TOPIC 15: TROUBLESHOOTING (NEW!) */}
        {activeTopicId === "troubleshooting" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">Hata Çözüm Matrisi</span>
              <span className="docs-version-pill">Sözlük</span>
            </div>
            <h1 className="docs-title">Sorun Giderme &amp; Hata Kodları Sözlüğü</h1>
            <p className="docs-lead">
              Tarama veya temizleme işlemi sırasında Dev Cleaner koruma mekanizmaları devreye girdiğinde karşılaşabileceğiniz
              uyarı kodları ve çözüm adımları:
            </p>

            <div className="docs-trouble-card">
              <div className="docs-faq-q">
                <AlertTriangle size={16} className="text-warning" />
                <span><code>TARGET_ACTIVE</code> / <code>PROVIDER_ACTIVE</code> (Süreç Kilidi Aktif)</span>
              </div>
              <p className="docs-faq-a">
                <strong>Neden Oldu?</strong> Silinmek istenen hedefteki bir dosya arka planda çalışan bir <code>node.exe</code>,
                <code>vite</code>, <code>cargo.exe</code> veya VS Code süreci tarafından kilitli tutuluyor.<br />
                <strong>Çözüm:</strong> Arka plandaki geliştirici sunucusunu durdurun veya terminali kapatıp taramayı tekrarlayın.
              </p>
            </div>

            <div className="docs-trouble-card docs-trouble-card--info">
              <div className="docs-faq-q">
                <Info size={16} className="text-accent" />
                <span><code>NO_PROJECT_MARKER</code> (Proje Kanıtı Eksik)</span>
              </div>
              <p className="docs-faq-a">
                <strong>Neden Oldu?</strong> <code>build</code>, <code>dist</code> veya <code>out</code> isimli bir klasör tespit edildi;
                ancak kök dizinde <code>package.json</code>, <code>Cargo.toml</code> veya <code>pom.xml</code> bulunamadı.<br />
                <strong>Güvenlik Garantisi:</strong> Dev Cleaner kullanıcının kişisel fotoğraflarını veya belgelerini "build"
                adıyla kaydetmiş olabileceği ihtimaline karşı proje kanıtı olmayan hedefleri asla temizlemez.
              </p>
            </div>

            <div className="docs-trouble-card docs-trouble-card--info">
              <div className="docs-faq-q">
                <ShieldCheck size={16} className="text-accent" />
                <span><code>USER_PROTECTED</code> (Kullanıcı Korumalı Dizin)</span>
              </div>
              <p className="docs-faq-a">
                <strong>Neden Oldu?</strong> Bu yol Ayarlar sayfasında tanımladığınız koruma listesiyle eşleşiyor.<br />
                <strong>Çözüm:</strong> Bu klasörü temizlemek istiyorsanız <strong>Ayarlar &gt; Koruma Listesi</strong> sekmesinden hariç tutulan dizini silebilirsiniz.
              </p>
            </div>

            <div className="docs-trouble-card docs-trouble-card--danger">
              <div className="docs-faq-q">
                <Lock size={16} className="text-danger" />
                <span><code>TOCTOU_BLOCKED</code> (Sembolik Bağ Güvenlik Engeli)</span>
              </div>
              <p className="docs-faq-a">
                <strong>Neden Oldu?</strong> Klasör tarandıktan sonra silinme anında bir Junction noktasına dönüştürüldü.<br />
                <strong>Güvenlik Garantisi:</strong> Sistem klasörlerine yetkisiz sıçramaları önlemek için işlem anında bloke edildi.
              </p>
            </div>
          </article>
        )}
      </main>
    </div>
  );
};
