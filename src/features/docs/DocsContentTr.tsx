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
import { DocsCommandList } from "./DocsCommandList";
import { APP_VERSION } from "@/lib/app-version";

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
    const regex = /(--[a-zA-Z0-9_-]+|\/[a-zA-Z0-9:_-]+|-[a-zA-Z0-9]+|"[^"]*"|'[^']*'|\b(?:dev-cleaner|cleanmgr|DISM\.exe|del|npm|nvm|pip|cargo|docker|powershell|git|New-ScheduledTaskAction|Register-ScheduledTask)\b|\d+)/g;
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
              <span className="docs-version-pill">v{APP_VERSION}</span>
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

            <div className="docs-callout">
              <Cpu className="docs-callout-icon" size={18} />
              <div>
                <strong>Tümünü tara</strong> — Projeler, AI ajan depoları ve paket önbellekleri. Bu, komut çubuğundaki
                eylemdir ve <code>--scope combined</code> ile aynıdır: projeler, AI ajan depoları ve paket önbelleği
                ölçümü tek oturumda çalışır. Sayfa içindeki düğmeler yalnızca kendi kapsamlarını tarar.
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

            <DocsCommandList
              title="Terminal CLI ile 5 Saniyede Başlayın"
              copiedKey={copiedKey}
              onCopy={copyToClipboard}
              copyLabel="Kopyala"
              copiedLabel="Kopyalandı!"
              highlight={highlightBash}
              items={[
                {
                  id: "qs-cli",
                  label: "Projeleri simülasyon (dry-run) modunda tara",
                  command: 'dev-cleaner scan "D:\\projeler" --scope all --auto-clean --dry-run',
                },
                {
                  id: "qs-combined",
                  label: "Projeler ve AI ajan depolarını tek seferde tara",
                  command: 'dev-cleaner scan "D:\\projeler" --scope combined',
                },
                {
                  id: "qs-system",
                  label: "C: sürücüsü sistem temizliği kalemlerini ölç",
                  command: "dev-cleaner system --list",
                },
              ]}
            />
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
            <DocsCommandList
              title="PowerShell ile Son Silinenleri Listele"
              copiedKey={copiedKey}
              onCopy={copyToClipboard}
              copyLabel="Kopyala"
              copiedLabel="Kopyalandı!"
              highlight={highlightBash}
              items={[
                {
                  id: "rec-ps",
                  label: "Geri Dönüşüm Kutusundaki öğeleri ad ve yol olarak listele",
                  command:
                    "(New-Object -ComObject Shell.Application).Namespace(0xa).Items() | Select-Object Name, Path",
                },
              ]}
            />

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
                Güvenlik manifestomuz gereği proje ve AI artıkları Geri Dönüşüm Kutusuna taşınır. Disk alanını kalıcı olarak serbest bırakmak için
                masaüstündeki Geri Dönüşüm Kutusunu boşaltabilir veya <strong>Sistem temizleyici</strong> sekmesindeki Geri Dönüşüm Kutusu seçeneğini kullanabilirsiniz.
              </p>
            </div>

            <div className="docs-faq-card">
              <div className="docs-faq-q">
                <HelpCircle size={16} className="text-accent" />
                <span>Tarama profilleri (Hızlı, Dengeli, Tam, Kapsamlı, Derin, Azami) neyi değiştirir?</span>
              </div>
              <p className="docs-faq-a">
                Profiller yalnızca maksimum klasör derinliği, aday sayısı ve zaman aşımı sınırlarını önceden doldurur. Varsayılan
                <strong> Dengeli</strong> profil günlük projeler için idealdir; çok iç içe geçmiş büyük monorepolarda
                <strong> Tam</strong>, <strong>Kapsamlı</strong> veya <strong>Derin</strong> profilini seçebilirsiniz.
              </p>
            </div>

            <div className="docs-faq-card">
              <div className="docs-faq-q">
                <HelpCircle size={16} className="text-accent" />
                <span>Hata günlükleri ve sistem mesajları otomatik olarak gönderiliyor mu?</span>
              </div>
              <p className="docs-faq-a">
                Hayır. Tüm günlükler yalnızca cihazınızda saklanır. <strong>Ayarlar &gt; Hata günlüğü</strong> sekmesinden
                dilerseniz tek tıkla maskelenmiş bir ZIP destek paketi oluşturup posta uygulamanızda <code>support@vellium.dev</code> için
                hazır taslak açabilirsiniz; siz Gönder&apos;e basmadan hiçbir veri paylaşılmaz.
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
            <DocsCommandList
              title={`Örnek Kullanım (${cliShell})`}
              copiedKey={copiedKey}
              onCopy={copyToClipboard}
              copyLabel="Kopyala"
              copiedLabel="Kopyalandı!"
              highlight={highlightBash}
              items={
                cliShell === "bash"
                  ? [
                      {
                        id: "cli-scan-std",
                        label: "Standart tarama ve insan okunabilir çıktı",
                        command: 'dev-cleaner scan "/d/projeler"',
                      },
                      {
                        id: "cli-scan-auto",
                        label: "Otonom temizlik (Yalnızca güvenli ve yeniden üretilebilir hedefleri çöpe taşır)",
                        command:
                          'dev-cleaner scan "/d/projeler" --auto-clean --safety safe,regenerate',
                      },
                      {
                        id: "cli-scan-dry",
                        label: "Simülasyon modu (Hiçbir şeyi silmez, nelerin temizleneceğini raporlar)",
                        command: 'dev-cleaner scan "/d/projeler" --auto-clean --dry-run',
                      },
                      {
                        id: "cli-scan-json",
                        label: "JSON çıktısı ile CI/CD entegrasyonu",
                        command: 'dev-cleaner scan "/d/projeler" --json',
                      },
                    ]
                  : [
                      {
                        id: "cli-scan-std",
                        label: "Standart tarama ve insan okunabilir çıktı",
                        command: 'dev-cleaner scan "D:\\projeler"',
                      },
                      {
                        id: "cli-scan-auto",
                        label: "Otonom temizlik (Yalnızca güvenli ve yeniden üretilebilir hedefleri çöpe taşır)",
                        command:
                          'dev-cleaner scan "D:\\projeler" --auto-clean --safety safe,regenerate',
                      },
                      {
                        id: "cli-scan-dry",
                        label: "Simülasyon modu (Hiçbir şeyi silmez, nelerin temizleneceğini raporlar)",
                        command: 'dev-cleaner scan "D:\\projeler" --auto-clean --dry-run',
                      },
                      {
                        id: "cli-scan-json",
                        label: "JSON çıktısı ile CI/CD entegrasyonu",
                        command: 'dev-cleaner scan "D:\\projeler" --json',
                      },
                    ]
              }
            />

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
                    <td><code>projects | agents | combined | all</code></td>
                    <td><code>projects</code></td>
                    <td>Taranacak hedef grubu (proje bağımlılıkları veya AI ajan depoları).</td>
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
            <DocsCommandList
              title="Önbellek Komutları"
              copiedKey={copiedKey}
              onCopy={copyToClipboard}
              copyLabel="Kopyala"
              copiedLabel="Kopyalandı!"
              highlight={highlightBash}
              items={[
                {
                  id: "cli-cache-list",
                  label: "Tüm önbellek durumunu listele",
                  command: "dev-cleaner caches",
                },
                {
                  id: "cli-cache-npm",
                  label: "Belirli bir aracın önbelleğini temizle (örn. npm, pip, cargo, docker)",
                  command: "dev-cleaner caches --clean npm",
                },
                {
                  id: "cli-cache-dry",
                  label: "Hiçbir şey silmeden tam temizliği önizle",
                  command: "dev-cleaner caches --clean all --dry-run",
                },
                {
                  id: "cli-cache-all",
                  label: "Tüm yüklü araçların önbelleklerini onaylayarak temizle",
                  command: "dev-cleaner caches --clean all --yes",
                },
              ]}
            />

            <h2 className="docs-h2">3. `dev-cleaner system`</h2>
            <p className="docs-p">C: sürücüsündeki Windows geçici dosyalarını, Prefetch, Windows Update artıkları ve WinSxS bileşen deposunu yönetir.</p>
            <DocsCommandList
              title="C: Sürücüsü Sistem Temizliği Komutları"
              copiedKey={copiedKey}
              onCopy={copyToClipboard}
              copyLabel="Kopyala"
              copiedLabel="Kopyalandı!"
              highlight={highlightBash}
              items={[
                {
                  id: "cli-sys-list",
                  label: "Tüm sistem temizliği kalemlerini ve boyutlarını listele",
                  command: "dev-cleaner system --list",
                },
                {
                  id: "cli-sys-dry",
                  label: "Hızlı profili silmeden önizle (dry-run)",
                  command: "dev-cleaner system --clean quick --dry-run",
                },
                {
                  id: "cli-sys-quick",
                  label: "Hızlı sistem temizliğini onaylayarak çalıştır",
                  command: "dev-cleaner system --clean quick --yes",
                },
                {
                  id: "cli-sys-std",
                  label: "Standart sistem temizliğini çalıştır (Yönetici önerilir)",
                  command: "dev-cleaner system --clean standard --yes",
                },
              ]}
            />

            <h2 className="docs-h2">4. `dev-cleaner history`</h2>
            <p className="docs-p">Geçmiş temizlik denetim kayıtlarını listeler.</p>
            <DocsCommandList
              title="Denetim Geçmişi Komutları"
              copiedKey={copiedKey}
              onCopy={copyToClipboard}
              copyLabel="Kopyala"
              copiedLabel="Kopyalandı!"
              highlight={highlightBash}
              items={[
                {
                  id: "cli-history",
                  label: "Son 15 temizlik kaydını göster",
                  command: "dev-cleaner history --limit 15",
                },
                {
                  id: "cli-history-json",
                  label: "Geçmişi JSON olarak dışa aktar",
                  command: "dev-cleaner history --limit 50 --json",
                },
              ]}
            />
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
                    <option value="combined">Projeler + AI Ajanları (Tümünü tara)</option>
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
                    onClick={() => copyToClipboard(generatedCliCommand, "gen-cli")}
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
              <span className="docs-version-pill">MCP v{APP_VERSION}</span>
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
            <DocsCommandList
              title="MCP Sunucu Komutları"
              copiedKey={copiedKey}
              onCopy={copyToClipboard}
              copyLabel="Kopyala"
              copiedLabel="Kopyalandı!"
              highlight={highlightBash}
              items={[
                {
                  id: "mcp-start",
                  label: "Standart modda (salt okunur + önizleme) başlat",
                  command: "dev-cleaner mcp",
                },
                {
                  id: "mcp-start-destructive",
                  label: "Yıkıcı araçlara izin vererek başlat (Ayarlar'da da açık olmalıdır)",
                  command: "dev-cleaner mcp --allow-destructive",
                },
              ]}
            />
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
                  {copiedKey === `mcp-${activeIde}`
                    ? "Kopyalandı!"
                    : mcpConfigs[activeIde].syntax === "toml"
                      ? "Kopyala"
                      : "JSON'ı Kopyala"}
                </button>
              </div>
              <pre className="docs-code-pre">
                {mcpConfigs[activeIde].syntax === "toml"
                  ? highlightBash(mcpConfigs[activeIde].json)
                  : highlightJson(mcpConfigs[activeIde].json)}
              </pre>
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
              Dev Cleaner MCP sunucusu 8 araç sunar: 6 standart araç ve yalnızca
              --allow-destructive ile görünen 2 yıkıcı araç.
            </p>

            <h2 className="docs-h2">1. `devcleaner_scan_workspace`</h2>
            <p className="docs-p">Çalışma alanını tarayarak temizlenebilir hedefleri JSON olarak sunar.</p>

            <h2 className="docs-h2">2. `devcleaner_preview_cleanup`</h2>
            <p className="docs-p">Temizlik planı oluşturur, tek kullanımlık token döner ve hiçbir şeyi silmez.</p>

            <h2 className="docs-h2">3. `devcleaner_clean_safe` (kullanımdan kaldırıldı)</h2>
            <p className="docs-p">devcleaner_preview_cleanup için eski takma addır. Yalnızca önizleme yapar; hiçbir şeyi silmez. Yeni akış preview_cleanup + execute_cleanup'tır.</p>

            <h2 className="docs-h2">4. `devcleaner_list_caches`</h2>
            <p className="docs-p">21 geliştirici aracının paket önbellek boyutlarını raporlar.</p>

            <h2 className="docs-h2">5. `devcleaner_get_history`</h2>
            <p className="docs-p">Geçmiş temizlik kayıtlarını döner.</p>

            <h2 className="docs-h2">6. `devcleaner_inspect_target`</h2>
            <p className="docs-p">Belirli bir dosya yolunun güvenlik sınıfını ve kurallarını inceler.</p>

            <h2 className="docs-h2">7. `devcleaner_execute_cleanup` (yıkıcı)</h2>
            <p className="docs-p">Önizlenen planı yürütür. confirm:true, tek kullanımlık token, --allow-destructive ve MCP yıkıcı işlem ayarı gerekir.</p>

            <h2 className="docs-h2">8. `devcleaner_clean_cache` (yıkıcı)</h2>
            <p className="docs-p">Resmi paket yöneticisi komutuyla önbelleği temizler. confirm:true, --allow-destructive ve MCP yıkıcı işlem ayarı gerekir.</p>
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

            <h2 className="docs-h2">Alan başvurusu</h2>
            <p className="docs-p">
              <code>event</code> her zaman <code>scan</code> veya <code>clean</code>&apos;dir.
              Eski <code>scan_completed</code> ve <code>cleanup_completed</code> adları takma ad
              olarak kabul edilir ve gönderimden önce standart adlara çevrilir.
            </p>
            <p className="docs-p">
              <code>timestamp</code>, <code>product</code> ve <code>version</code> olayı üreten
              kurulumu tanımlar; yük hiçbir zaman imzalanmaz.
            </p>
            <p className="docs-p">
              <code>status</code>; <code>success</code>, <code>partial</code> (tarama erken durdu)
              veya <code>cancelled</code> (kullanıcı Durdur&apos;a bastı) olur.
            </p>
            <p className="docs-p">
              <code>total_bytes</code> ölçülen geri kazanılabilir alandır;{" "}
              <code>total_human</code> bunun biçimlenmiş hâlidir. <code>cleaned_count</code> ve{" "}
              <code>cleaned_bytes</code> yalnızca temizleme olaylarında bulunur.
            </p>
            <p className="docs-p">
              Tarama olayları ayrıca <code>scan_id</code>, <code>root_path</code>,{" "}
              <code>duration_ms</code> ve sonuç eksikse <code>stop_reason</code> taşır.
            </p>
            <p className="docs-p">
              Masaüstü uygulamasından gelen temizleme olayları ayrıca <code>plan_id</code>,{" "}
              <code>mode</code>, <code>success_count</code>, <code>error_count</code>,{" "}
              <code>moved_bytes</code> ve <code>reclaim_bytes</code> taşır.
            </p>
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
        {activeTopicId === "system-cleaner" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">Windows Bakımı</span>
              <span className="docs-version-pill">Rehber</span>
            </div>
            <h1 className="docs-title">C: Sürücüsü Temizleyici &amp; Zamanlanmış Otomasyon</h1>
            <p className="docs-lead">
              Tek bir komut yazmadan sistem sürücüsünde yer açın. Hiçbir şey silinmeden önce her işlem ölçülür.
            </p>

            <h2 className="docs-h2">Neleri temizler</h2>
            <p>
              Temizleyici; geçici dosyalarınızı, Windows geçici dosyalarını, Prefetch verilerini, Windows Update
              artıklarını, Windows hata raporlarını, Geri Dönüşüm Kutusu'nu, Windows Disk Temizleme profilini ve bileşen
              deposunu (WinSxS) kapsar. Proje klasörleri, belgeler ve İndirilenler denetlenen tüm köklerin dışındadır ve
              asla seçilemez.
            </p>

            <h2 className="docs-h2">Yönetici hakları</h2>
            <p>
              Windows, sistem klasörlerini standart kullanıcılara kapatır. Bir işlem yükseltme gerektirdiğinde sayfa tek
              bir yeniden başlatma düğmesi sunar; uygulama seçiminiz korunarak aynı sayfada yeniden açılır. Uygulamanın
              kendisi yönetici hakları olmadan açılmaya devam eder; kendi dosyalarınızı taramak ve temizlemek hiçbir zaman
              onay istemez.
            </p>

            <h2 className="docs-h2">Tasarım gereği güvenli</h2>
            <p>
              Arayüz yalnızca işlem kimliklerini gönderir; yollar yerel tarafta sabit ve denetlenmiş bir listeye göre
              çözümlenir ve yeniden doğrulanır. Silme işlemi junction veya sembolik bağlantıları asla izlemez, kilitli
              dosyalar atlanır ve bildirilir; her çalıştırma yerel denetim geçmişine yazılır.
            </p>

            <div className="docs-callout docs-callout--info">
              <Info className="docs-callout-icon" size={18} />
              <div>
                <p>Hiçbir veri yüklenmez. Boyutlar, günlükler ve denetim kayıtları bu cihazda kalır.</p>
              </div>
            </div>

            <h2 className="docs-h2">Otomatik temizlik</h2>
            <p>
              Bir Windows zamanlanmış görevi, hızlı veya standart profili günlük ya da haftalık çalıştırabilir. Görev,
              hesabınızın izin verdiği en yüksek haklarla çalışır ve soru sormaz; zamanlamayı aynı panelden istediğiniz
              zaman kaldırabilirsiniz. Prefetch, Geri Dönüşüm Kutusu ve bileşen deposu asla otomatik seçilmez.
            </p>

            <h2 className="docs-h2">Komut satırı (Dev Cleaner CLI)</h2>
            <p className="docs-p">
              Aynı işlemler betikler ve CI için başsız (headless) olarak da kullanılabilir:
            </p>
            <DocsCommandList
              title="Dev Cleaner Sistem Temizleyici CLI"
              copiedKey={copiedKey}
              onCopy={copyToClipboard}
              copyLabel="Kopyala"
              copiedLabel="Kopyalandı!"
              highlight={highlightBash}
              items={[
                {
                  id: "sys-cli-list",
                  label: "Tüm sistem hedeflerini ve ölçülebilir boyutları listele",
                  command: "dev-cleaner system --list",
                },
                {
                  id: "sys-cli-dry",
                  label: "Hiçbir şey silmeden hızlı profili önizle",
                  command: "dev-cleaner system --clean quick --dry-run",
                },
                {
                  id: "sys-cli-quick",
                  label: "Hızlı profili çalıştır (kullanıcı temp + Windows Update artıkları)",
                  command: "dev-cleaner system --clean quick --yes",
                },
                {
                  id: "sys-cli-standard",
                  label: "Standart profili çalıştır (Yönetici haklarıyla temp, Prefetch, hata raporları)",
                  command: "dev-cleaner system --clean standard --yes",
                },
                {
                  id: "sys-cli-deep",
                  label: "Derin profili çalıştır (Disk Temizleme ve DISM WinSxS dâhil)",
                  command: "dev-cleaner system --clean deep --yes",
                },
              ]}
            />

            <h2 className="docs-h2">Windows CMD Referans Komutları (Yönetici)</h2>
            <p className="docs-p">
              Dev Cleaner bu işlemleri arayüzden tek tıkla yürütür. Manuel çalıştırmak isterseniz
              Komut İstemi&apos;ni <strong>Yönetici olarak</strong> açıp aşağıdaki komutları tek tek kopyalayabilirsiniz:
            </p>
            <DocsCommandList
              title="1. Windows Disk Temizleme Aracı (Cleanmgr)"
              copiedKey={copiedKey}
              onCopy={copyToClipboard}
              copyLabel="Kopyala"
              copiedLabel="Kopyalandı!"
              highlight={highlightBash}
              items={[
                {
                  id: "cmd-cleanmgr-c",
                  label: "C: diski için standart Windows Disk Temizleme arayüzünü aç",
                  command: "cleanmgr /d c:",
                },
                {
                  id: "cmd-cleanmgr-sageset",
                  label: "Otomatik temizlik profili 1'i oluştur ve temizlenecek öğeleri seç",
                  command: "cleanmgr /sageset:1",
                },
                {
                  id: "cmd-cleanmgr-sagerun",
                  label: "Profil 1'i kullanıcı onayı beklemeden arka planda çalıştır",
                  command: "cleanmgr /sagerun:1",
                },
              ]}
            />

            <DocsCommandList
              title="2. Geçici Dosyalar (Temp), Prefetch ve Windows Update (DISM)"
              copiedKey={copiedKey}
              onCopy={copyToClipboard}
              copyLabel="Kopyala"
              copiedLabel="Kopyalandı!"
              highlight={highlightBash}
              items={[
                {
                  id: "cmd-del-user-temp",
                  label: "Kullanıcı geçici dosyalarını (%TEMP%) temizle",
                  command: "del /q /f /s %TEMP%\\*",
                },
                {
                  id: "cmd-del-win-temp",
                  label: "Windows sistem geçici dosyalarını (C:\\Windows\\Temp) temizle",
                  command: "del /q /f /s C:\\Windows\\Temp\\*",
                },
                {
                  id: "cmd-del-prefetch",
                  label: "Önbellek (Prefetch) dosyalarını temizle",
                  command: "del /q /f /s C:\\Windows\\Prefetch\\*",
                },
                {
                  id: "cmd-dism-winsxs",
                  label: "Windows Update kalıntılarını ve WinSxS bileşen deposunu temizle (DISM)",
                  command: "DISM.exe /Online /Cleanup-Image /StartComponentCleanup",
                },
              ]}
            />
          </article>
        )}

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

            <h2 className="docs-h2">Tarama kapsamı</h2>
            <div className="docs-callout docs-callout--warning">
              <Info className="docs-callout-icon" size={18} />
              <div>
                <p>
                  <strong>Atlandı</strong> — Sistem tarafından korunan konumlar atlandı. Yapılacak bir şey yok.
                </p>
                <p>
                  <strong>Uyarı</strong> — Bazı konumlar okunamadı; sonuçlar eksik olabilir.
                </p>
                <p>
                  <strong>Hata</strong> — Kök klasör seçilmedi veya tarama engellendi.
                </p>
                <p>
                  <strong>Eksik</strong> — Tarama erken durdu. Temizlemeden önce durma nedenine
                  (<code>stop_reason</code>) bakın.
                </p>
              </div>
            </div>

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
