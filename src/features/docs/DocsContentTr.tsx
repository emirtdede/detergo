import React from "react";
import {
  ShieldCheck,
  HelpCircle,
  Cpu,
  Bot,
  Webhook,
  Lock,
  Check,
  Copy,
  Info,
  AlertTriangle,
  RotateCcw,
  Laptop,
  Terminal,
  Target,
} from "lucide-react";
import { NumberField } from "@/components/primitives/NumberField";
import { McpIdeKey, mcpConfigs, webhookSampleJson } from "./docs-data";
import { McpIdeSelector } from "./McpIdeSelector";

// Syntax highlighter function
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
        parts.push(<span key={`${lIdx}-${match.index}`} className="tok-str">{tok}</span>);
      } else if (/^\d+$/.test(tok)) {
        parts.push(<span key={`${lIdx}-${match.index}`} className="tok-num">{tok}</span>);
      } else {
        parts.push(<span key={`${lIdx}-${match.index}`} className="tok-cmd">{tok}</span>);
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

function highlightJson(code: string): React.ReactNode[] {
  const lines = code.split("\n");
  return lines.map((line, lIdx) => {
    const parts: React.ReactNode[] = [];
    const regex = /("[^"]*"(?:\s*:)?|true|false|null|\d+)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push(line.substring(lastIndex, match.index));
      }
      const full = match[0];
      if (full.endsWith(":")) {
        parts.push(<span key={`${lIdx}-${match.index}`} className="tok-key">{full}</span>);
      } else if (full.startsWith('"')) {
        parts.push(<span key={`${lIdx}-${match.index}`} className="tok-str">{full}</span>);
      } else if (/^\d+$/.test(full)) {
        parts.push(<span key={`${lIdx}-${match.index}`} className="tok-num">{full}</span>);
      } else {
        parts.push(<span key={`${lIdx}-${match.index}`} className="tok-bool">{full}</span>);
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

export interface DocsContentProps {
  activeTopicId: string;
  copiedKey: string | null;
  copyToClipboard: (text: string, key: string) => void;
  cliShell: "powershell" | "cmd" | "bash";
  setCliShell: (shell: "powershell" | "cmd" | "bash") => void;
  cliPath: string;
  setCliPath: (path: string) => void;
  cliScope: string;
  setCliScope: (scope: string) => void;
  cliAutoClean: boolean;
  setCliAutoClean: (val: boolean) => void;
  cliDryRun: boolean;
  setCliDryRun: (val: boolean) => void;
  cliJson: boolean;
  setCliJson: (val: boolean) => void;
  cliSafety: string;
  setCliSafety: (val: string) => void;
  cliMinSize: string;
  setCliMinSize: (val: string) => void;
  cliWebhook: string;
  setCliWebhook: (val: string) => void;
  activeIde: McpIdeKey;
  setActiveIde: (ide: McpIdeKey) => void;
  generatedCliCommand: string;
}

export const DocsContentTr: React.FC<DocsContentProps> = ({
  activeTopicId,
  copiedKey,
  copyToClipboard,
  cliShell,
  setCliShell,
  cliPath,
  setCliPath,
  cliScope,
  setCliScope,
  cliAutoClean,
  setCliAutoClean,
  cliDryRun,
  setCliDryRun,
  cliJson,
  setCliJson,
  cliSafety,
  setCliSafety,
  cliMinSize,
  setCliMinSize,
  cliWebhook,
  setCliWebhook,
  activeIde,
  setActiveIde,
  generatedCliCommand,
}) => {
  return (
    <>

        {/* TOPIC 1: QUICKSTART */}
        {activeTopicId === "quickstart" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">Genel Bakış</span>
              <span className="docs-version-pill">v2.2.2</span>
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
              Dev Cleaner, geliştirici alışkanlıklarınıza ve iş akışınıza tam uyum sağlayan 4 farklı çalışma paradigması sunar:
            </p>

            <div className="docs-modes-grid">
              <div className="docs-mode-card">
                <div className="docs-mode-header">
                  <span className="docs-mode-icon docs-mode-icon--blue">
                    <Laptop size={16} />
                  </span>
                  <div className="docs-mode-title-wrap">
                    <strong className="docs-mode-title">1. Masaüstü Grafik Arayüzü</strong>
                    <span className="docs-mode-badge">Görsel GUI</span>
                  </div>
                </div>
                <p className="docs-mode-desc">
                  Tek tıkla disk taraması, kategorik filtreler, depolama dağılım grafikleri ve Geri Dönüşüm Kutusu güvencesiyle sezgisel temizlik.
                </p>
                <div className="docs-mode-target">
                  <Target size={13} className="docs-mode-target-icon" />
                  <span className="docs-mode-target-label">En Uygun:</span> Görsel kontrol ve manuel seçim isteyen geliştiriciler
                </div>
              </div>

              <div className="docs-mode-card">
                <div className="docs-mode-header">
                  <span className="docs-mode-icon docs-mode-icon--green">
                    <Terminal size={16} />
                  </span>
                  <div className="docs-mode-title-wrap">
                    <strong className="docs-mode-title">2. Terminal Komut Satırı</strong>
                    <span className="docs-mode-badge">CLI Engine</span>
                  </div>
                </div>
                <p className="docs-mode-desc">
                  PowerShell, CMD ve Bash üzerinden doğrudan <code>dev-cleaner</code> komutuyla yüksek hızlı tarama, <code>--dry-run</code> simülasyonu ve script otomasyonu.
                </p>
                <div className="docs-mode-target">
                  <Target size={13} className="docs-mode-target-icon" />
                  <span className="docs-mode-target-label">En Uygun:</span> Hız, klavye kısayolu ve terminalden ayrılmak istemeyenler
                </div>
              </div>

              <div className="docs-mode-card">
                <div className="docs-mode-header">
                  <span className="docs-mode-icon docs-mode-icon--purple">
                    <Bot size={16} />
                  </span>
                  <div className="docs-mode-title-wrap">
                    <strong className="docs-mode-title">3. Yapay Zeka Ajan Protokolü</strong>
                    <span className="docs-mode-badge">MCP Sunucusu</span>
                  </div>
                </div>
                <p className="docs-mode-desc">
                  Cursor, Windsurf, Claude Code ve Antigravity ile Model Context Protocol (MCP) üzerinden doğal dille temizlik ve disk analizi.
                </p>
                <div className="docs-mode-target">
                  <Target size={13} className="docs-mode-target-icon" />
                  <span className="docs-mode-target-label">En Uygun:</span> Claude &amp; Cursor ile pair programming yapan yapay zeka odaklı geliştiriciler
                </div>
              </div>

              <div className="docs-mode-card">
                <div className="docs-mode-header">
                  <span className="docs-mode-icon docs-mode-icon--orange">
                    <Webhook size={16} />
                  </span>
                  <div className="docs-mode-title-wrap">
                    <strong className="docs-mode-title">4. Otonom Webhook &amp; CI/CD</strong>
                    <span className="docs-mode-badge">Pipeline Entegrasyonu</span>
                  </div>
                </div>
                <p className="docs-mode-desc">
                  n8n, GitHub Actions veya kurumsal webhook endpoint'lerine tarama/temizlik tamamlandığında otomatik JSON telemetrisi gönderimi.
                </p>
                <div className="docs-mode-target">
                  <Target size={13} className="docs-mode-target-icon" />
                  <span className="docs-mode-target-label">En Uygun:</span> DevOps mühendisleri, sunucu yöneticileri ve n8n otomasyon kurucuları
                </div>
              </div>
            </div>

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

            <div className="docs-table-wrapper">
              <table className="docs-table">
                <thead>
                  <tr>
                    <th>Parametre (Flag)</th>
                    <th>Tür</th>
                    <th>Varsayılan</th>
                    <th>Açıklama</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>&lt;dizin&gt;</code></td>
                    <td>string</td>
                    <td><code>.</code> (aktif dizin)</td>
                    <td>Taranacak kök klasör yolu (örn: <code>D:\projeler</code>).</td>
                  </tr>
                  <tr>
                    <td><code>--scope &lt;kapsam&gt;</code></td>
                    <td>projects | agents | caches | all</td>
                    <td><code>projects</code></td>
                    <td>Taranacak hedef grubu (proje bağımlılıkları, AI depoları, paket önbellekleri).</td>
                  </tr>
                  <tr>
                    <td><code>--auto-clean</code></td>
                    <td>boolean</td>
                    <td><code>false</code></td>
                    <td>Tarama bittiğinde belirlenen güvenlik filtrelerine uygun hedefleri otomatik siler.</td>
                  </tr>
                  <tr>
                    <td><code>--dry-run</code></td>
                    <td>boolean</td>
                    <td><code>false</code></td>
                    <td>Simülasyon modu; hiçbir dosyaya dokunmadan nelerin temizleneceğini simüle eder.</td>
                  </tr>
                  <tr>
                    <td><code>--safety &lt;sınıflar&gt;</code></td>
                    <td>safe,regenerate,review</td>
                    <td><code>safe,regenerate</code></td>
                    <td>Temizlenecek güvenlik sınıfları virgülle ayrılarak belirtilir.</td>
                  </tr>
                  <tr>
                    <td><code>--min-size &lt;mb&gt;</code></td>
                    <td>number</td>
                    <td><code>0</code></td>
                    <td>Yalnızca belirtilen Megabayt değerinden büyük olan hedefleri kapsama alır.</td>
                  </tr>
                  <tr>
                    <td><code>--json</code></td>
                    <td>boolean</td>
                    <td><code>false</code></td>
                    <td>İnsan okunabilir tablo yerine scriptler ve CI/CD için saf JSON çıktısı üretir.</td>
                  </tr>
                  <tr>
                    <td><code>--webhook &lt;url&gt;</code></td>
                    <td>string (URL)</td>
                    <td><code>null</code></td>
                    <td>İşlem tamamlandığında JSON özet yükünü POST edecek HTTP webhook adresi.</td>
                  </tr>
                </tbody>
              </table>
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
              <span className="docs-version-pill">MCP v2.2.2</span>
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

            {/* Single Dropdown Button */}
            <McpIdeSelector
              activeIde={activeIde}
              onSelect={setActiveIde}
            />

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
      
    </>
  );
};
