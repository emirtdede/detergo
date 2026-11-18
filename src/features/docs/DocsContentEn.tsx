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
} from "lucide-react";
import { NumberField } from "@/components/primitives/NumberField";
import { McpIdeKey, mcpConfigs, webhookSampleJson } from "./docs-data";
import { APP_VERSION } from "@/lib/app-version";
import { McpIdeSelector } from "./McpIdeSelector";
import { useDocsT } from "./docs-i18n";
import { useUIText } from "@/lib/ui-text";

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

export const DocsContentEn: React.FC<DocsContentProps> = ({
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
  const t = useDocsT();
  const ui = useUIText();

  /**
   * Copies the localized prompt body (the display translation is keyed with the
   * surrounding quotes, so they are stripped for the clipboard payload).
   */
  const copyPrompt = (englishPrompt: string, key: string) => {
    const localized = t(`"${englishPrompt}"`).replace(/^"|"$/g, "");
    copyToClipboard(localized, key);
  };

  return (
    <>

        {/* TOPIC 1: QUICKSTART */}
        {activeTopicId === "quickstart" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">{t("Overview")}</span>
              <span className="docs-version-pill">v{APP_VERSION}</span>
            </div>
            <h1 className="docs-title">{t("Welcome to Dev Cleaner")}</h1>
            <p className="docs-lead">
              
              {t("Dev Cleaner is a high-performance desktop utility designed to purge heavy dependencies (node_modules, target, .venv, build), AI coding agent caches (Claude Code, Cursor, Codex), and 21 global package caches with zero data loss guarantee.")}
            </p>

            <div className="docs-callout docs-callout--success">
              <ShieldCheck className="docs-callout-icon" size={18} />
              <div>
              <strong>{t("Zero Data Loss Principle:")}</strong>  {t("All project and AI artifacts cleaned by Dev Cleaner are moved directly to the")} <strong>{t("Windows Recycle Bin")}</strong>{t(". Nothing is permanently destroyed by accident.")}
              </div>
            </div>

            <div className="docs-callout">
              <Cpu className="docs-callout-icon" size={18} />
              <div>
                <strong>{ui.common.scanAll}</strong> — {ui.common.scanAllDesc}. This is
                the command bar action, and it is the same as{" "}
                <code>--scope combined</code>: projects, AI tool storage and the
                package-cache measurement run in one session. The buttons inside a
                page scan only that page&apos;s scope.
              </div>
            </div>

            <h2 className="docs-h2">{t("4 Core Operating Modes")}</h2>
            <p className="docs-p">
              
              {t("Dev Cleaner adapts seamlessly to your developer workflow through 4 distinct operating paradigms:")}
            </p>

            <div className="docs-modes-grid">
              <div className="docs-mode-card">
                <div className="docs-mode-header">
                  <span className="docs-mode-icon docs-mode-icon--blue">
                    <Laptop size={16} />
                  </span>
                  <div className="docs-mode-title-wrap">
                    <strong className="docs-mode-title">{t("1. Desktop Graphical Interface")}</strong>
                    <span className="docs-mode-badge">{t("Visual GUI")}</span>
                  </div>
                </div>
                <p className="docs-mode-desc">
                  
                  {t("One-click disk inspection, categorized filters, visual storage distribution charts, and Recycle Bin-backed safety.")}
                </p>
                <div className="docs-mode-target">
                  <span className="docs-mode-target-label">{t("🎯 Best For:")}</span>  {t("Developers who prefer visual control and manual inspection")}
                </div>
              </div>

              <div className="docs-mode-card">
                <div className="docs-mode-header">
                  <span className="docs-mode-icon docs-mode-icon--green">
                    <Terminal size={16} />
                  </span>
                  <div className="docs-mode-title-wrap">
                    <strong className="docs-mode-title">{t("2. Terminal Command Line")}</strong>
                    <span className="docs-mode-badge">{t("CLI Engine")}</span>
                  </div>
                </div>
                <p className="docs-mode-desc">
                  
                  {t("High-speed terminal operations via")} <code>{t("dev-cleaner")}</code>  {t("across PowerShell, CMD, and Bash with")} <code>{t("--dry-run")}</code>  {t("simulations and headless automation.")}
                </p>
                <div className="docs-mode-target">
                  <span className="docs-mode-target-label">{t("🎯 Best For:")}</span>  {t("Fast keyboard-centric workflows, scripts, and terminal power users")}
                </div>
              </div>

              <div className="docs-mode-card">
                <div className="docs-mode-header">
                  <span className="docs-mode-icon docs-mode-icon--purple">
                    <Bot size={16} />
                  </span>
                  <div className="docs-mode-title-wrap">
                    <strong className="docs-mode-title">{t("3. AI Agent Protocol")}</strong>
                    <span className="docs-mode-badge">{t("MCP Server")}</span>
                  </div>
                </div>
                <p className="docs-mode-desc">
                  
                  {t("Direct connection to Cursor, Windsurf, Claude Code, and Antigravity via Model Context Protocol (MCP) for conversational workspace management.")}
                </p>
                <div className="docs-mode-target">
                  <span className="docs-mode-target-label">{t("🎯 Best For:")}</span>  {t("AI-assisted engineers pairing with Cursor, Claude, or Windsurf")}
                </div>
              </div>

              <div className="docs-mode-card">
                <div className="docs-mode-header">
                  <span className="docs-mode-icon docs-mode-icon--orange">
                    <Webhook size={16} />
                  </span>
                  <div className="docs-mode-title-wrap">
                    <strong className="docs-mode-title">{t("4. Autonomous Webhooks & CI/CD")}</strong>
                    <span className="docs-mode-badge">{t("Pipeline Integration")}</span>
                  </div>
                </div>
                <p className="docs-mode-desc">
                  
                  {t("Automatic real-time JSON event payloads dispatched to n8n, GitHub Actions, or custom webhooks upon scan and cleanup completion.")}
                </p>
                <div className="docs-mode-target">
                  <span className="docs-mode-target-label">{t("🎯 Best For:")}</span>  {t("DevOps engineers, automated server cron tasks, and n8n pipelines")}
                </div>
              </div>
            </div>

            <div className="docs-code-card">
              <div className="docs-code-header">
                <span className="docs-code-header-left">{t("Get Started with Terminal CLI in 5 Seconds")}</span>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard("dev-cleaner scan D:\\projects --scope all --auto-clean --dry-run", "qs-cli")}
                >
                  {copiedKey === "qs-cli" ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === "qs-cli" ? ui.docs.copied : ui.docs.copy}
                </button>
              </div>
              <pre className="docs-code-pre">{highlightBash("dev-cleaner scan D:\\projects --scope all --auto-clean --dry-run")}</pre>
            </div>
          </article>
        )}

        {/* TOPIC 2: MANIFESTO */}
        {activeTopicId === "manifesto" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">{t("Safety Manifesto")}</span>
            </div>
            <h1 className="docs-title">{t("Zero Data Loss & Safety Manifesto")}</h1>
            <p className="docs-lead">
              
              {t("The primary virtue of a cleaning tool is not simply freeing disk space, but ensuring no developer source code or personal data is ever damaged. Dev Cleaner adheres strictly to these rules:")}
            </p>

            <div className="docs-callout">
              <Info className="docs-callout-icon" size={18} />
              <div>
                <strong>{t("1. Never Permanently Destroyed:")}</strong>  {t("All operations dispatch items via the native Windows Shell COM API to the Recycle Bin. Users can restore any folder in one click at any time.")}
              </div>
            </div>

            <div className="docs-callout docs-callout--warning">
              <Lock className="docs-callout-icon" size={18} />
              <div>
                <strong>{t("2. TOCTOU & Symlink Defense:")}</strong>  {t("Symlinks and NTFS Junction points are strictly excluded during scan and deletion. Any reparse point pointing outside the project tree (such as C:\\Windows or ~/.ssh) is immediately blocked.")}
              </div>
            </div>

            <div className="docs-callout docs-callout--success">
              <ShieldCheck className="docs-callout-icon" size={18} />
              <div>
                <strong>{t("3. Process Lock Protection:")}</strong>  {t("If an active Node.js, Cargo, or IDE process holds a lock on a target folder, Dev Cleaner never forces deletion; it safely skips the target and reports it in the summary.")}
              </div>
            </div>
          </article>
        )}

        {/* TOPIC 3: RECOVERY GUIDE (NEW!) */}
        {activeTopicId === "recovery-guide" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">{t("Safety & Recovery")}</span>
              <span className="docs-version-pill">{t("Step-by-Step Guide")}</span>
            </div>
            <h1 className="docs-title">{t("Restoring Accidentally Removed Targets")}</h1>
            <p className="docs-lead">
              
              {t("No file cleaned with Dev Cleaner is ever permanently deleted immediately. All items reside safely in the Windows Recycle Bin preserving original metadata and paths. You can restore an accidentally cleaned folder in seconds:")}
            </p>

            <h2 className="docs-h2">{t("Method 1: One-Click Restoration from Windows Desktop")}</h2>
            <div className="docs-callout docs-callout--success">
              <RotateCcw className="docs-callout-icon" size={18} />
              <div>
                <strong>{t("1. Open the Recycle Bin:")}</strong>  {t("Double-click the Recycle Bin icon on your desktop.")}<br />
                <strong>{t("2. Locate the Folder:")}</strong>  {t("Search or sort by deletion date or project name.")}<br />
                <strong>{t("3. Right-Click > Select \"Restore\":")}</strong>  {t("Windows immediately restores the directory to its exact original path (e.g.")} <code>{t("D:\\projects\\app\\node_modules")}</code>).
              </div>
            </div>

            <h2 className="docs-h2">{t("Method 2: Restoring via PowerShell Terminal")}</h2>
            <p className="docs-p">{t("To query and inspect items in the Recycle Bin without leaving your terminal:")}</p>
            <div className="docs-code-card">
              <div className="docs-code-header">
                <span>{t("List Recently Deleted with PowerShell")}</span>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard('(New-Object -ComObject Shell.Application).Namespace(0xa).Items() | Select-Object Name, Path', 'rec-ps')}
                >
                  {copiedKey === 'rec-ps' ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === 'rec-ps' ? ui.docs.copied : ui.docs.copy}
                </button>
              </div>
              <pre className="docs-code-pre">{highlightBash('(New-Object -ComObject Shell.Application).Namespace(0xa).Items() | Select-Object Name, Path')}</pre>
            </div>

            <div className="docs-callout">
              <ShieldCheck className="docs-callout-icon" size={18} />
              <div>
                <strong>{t("Git Repositories Are Always Immune:")}</strong>  {t("Dev Cleaner kernel-level rules strictly prohibit targeting")} <code>{t(".git")}</code>  {t("folders,")}
                <code>{t(".env")}</code>  {t("files, and source code. Your work and git histories are 100% safe.")}
              </div>
            </div>
          </article>
        )}

        {/* TOPIC 4: FAQ (NEW!) */}
        {activeTopicId === "faq" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">{t("Support")}</span>
              <span className="docs-version-pill">{t("Frequently Asked Questions")}</span>
            </div>
            <h1 className="docs-title">{t("Developer Frequently Asked Questions (FAQ)")}</h1>
            <p className="docs-lead">
              
              {t("Answers to the most frequently asked technical questions regarding Dev Cleaner logic:")}
            </p>

            <div className="docs-faq-card">
              <div className="docs-faq-q">
                <HelpCircle size={16} className="text-accent" />
                <span>{t("Will I lose my code if I delete")} <code>{t("node_modules")}</code>  {t("or")} <code>{t(".venv")}</code>?</span>
              </div>
              <p className="docs-faq-a">
                  
                  {t("Absolutely not. These directories hold cached third-party packages or compilation outputs. As long as your")} <code>{t("package.json")}</code>
                  
                  {t("or")} <code>{t("Cargo.toml")}</code>  {t("is intact, running")} <code>{t("npm install")}</code>  {t("or")} <code>{t("cargo build")}</code>  {t("restores the dependencies cleanly.")}

              </p>
            </div>

            <div className="docs-faq-card">
              <div className="docs-faq-q">
                <HelpCircle size={16} className="text-accent" />
                <span>{t("Does clearing the Docker cache stop running containers?")}</span>
              </div>
              <p className="docs-faq-a">
                  
                  {t("Dev Cleaner does not stop running containers; it executes the official command")} <code>{t("docker builder prune -f")}</code>.{" "}
                  {t("Active containers, database volumes, and tagged images are untouched; only stale intermediate build stages are removed.")}
              </p>
            </div>

            <div className="docs-faq-card">
              <div className="docs-faq-q">
                <HelpCircle size={16} className="text-accent" />
                <span>{t("Getting \"Command not found\" for")} <code>{t("dev-cleaner")}</code>  {t("in terminal?")}</span>
              </div>
              <p className="docs-faq-a">
                  
                  {t("Dev Cleaner installs to")} <code>{t("%LOCALAPPDATA%\\Microsoft\\WindowsApps\\dev-cleaner.exe")}</code>{t(". If your terminal was open during installation, simply close and restart your terminal window to refresh your PATH environment variable.")}
              </p>
            </div>

            <div className="docs-faq-card">
              <div className="docs-faq-q">
                <HelpCircle size={16} className="text-accent" />
                <span>{t("Why wasn't disk space freed immediately after cleanup?")}</span>
              </div>
              <p className="docs-faq-a">
                  
                  {t("By default safety design, deleted files are moved to the Recycle Bin. To reclaim raw drive capacity permanently, right-click the Recycle Bin icon on your desktop and select \"Empty Recycle Bin\".")}
              </p>
            </div>
          </article>
        )}

        {/* TOPIC 5: CLI GUIDE */}
        {activeTopicId === "cli-guide" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">{t("Terminal CLI")}</span>
            </div>
            <h1 className="docs-title">{t("Terminal CLI Command Guide")}</h1>
            <p className="docs-lead">
              
              {t("Dev Cleaner runs as a global command on your Windows PATH. You can invoke it from any terminal at any time:")}
            </p>

            {/* Shell Switcher Tabs */}
            <div className="ide-tabs-bar">
              <button
                type="button"
                className={`ide-tab-btn ${cliShell === "powershell" ? "active" : ""}`}
                onClick={() => setCliShell("powershell")}
              >
                
                {t("PowerShell")}
              </button>
              <button
                type="button"
                className={`ide-tab-btn ${cliShell === "cmd" ? "active" : ""}`}
                onClick={() => setCliShell("cmd")}
              >
                
                {t("CMD")}
              </button>
              <button
                type="button"
                className={`ide-tab-btn ${cliShell === "bash" ? "active" : ""}`}
                onClick={() => setCliShell("bash")}
              >
                
                {t("Git Bash / WSL")}
              </button>
            </div>

            <h2 className="docs-h2">{t("1. `dev-cleaner scan`")}</h2>
            <p className="docs-p">{t("Scans candidate project dependencies in the target directory or cleans them autonomously.")}</p>
            <div className="docs-code-card">
              <div className="docs-code-header">
                <span>{t("Example Usage (")}{cliShell})</span>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard(
                    cliShell === "bash"
                      ? "dev-cleaner scan /d/projects --auto-clean --safety safe,regenerate"
                      : "dev-cleaner scan \"D:\\projects\" --auto-clean --safety safe,regenerate",
                    "cli-scan"
                  )}
                >
                  {copiedKey === "cli-scan" ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === "cli-scan" ? ui.docs.copied : ui.docs.copy}
                </button>
              </div>
              <pre className="docs-code-pre">
                {cliShell === "bash"
                  ? highlightBash(
`# ${t("Standard scan with human-readable console summary")}
dev-cleaner scan "/d/projects"

# ${t("Autonomous cleanup (moves only safe and regenerate targets to Recycle Bin)")}
dev-cleaner scan "/d/projects" --auto-clean --safety safe,regenerate

# ${t("Simulation mode (dry-run without modifying or removing any files)")}
dev-cleaner scan "/d/projects" --auto-clean --dry-run

# ${t("Structured JSON output for CI/CD and script automation")}
dev-cleaner scan "/d/projects" --json`
                    )
                  : highlightBash(
`# ${t("Standard scan with human-readable console summary")}
dev-cleaner scan "D:\\projects"

# ${t("Autonomous cleanup (moves only safe and regenerate targets to Recycle Bin)")}
dev-cleaner scan "D:\\projects" --auto-clean --safety safe,regenerate

# ${t("Simulation mode (dry-run without modifying or removing any files)")}
dev-cleaner scan "D:\\projects" --auto-clean --dry-run

# ${t("Structured JSON output for CI/CD and script automation")}
dev-cleaner scan "D:\\projects" --json`
                    )}
              </pre>
            </div>

            <div className="docs-table-wrapper">
              <table className="docs-table">
                <thead>
                  <tr>
                    <th>{t("Parameter (Flag)")}</th>
                    <th>{t("Type")}</th>
                    <th>{t("Default")}</th>
                    <th>{t("Description")}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>{t("<path>")}</code></td>
                    <td>{t("string")}</td>
                    <td><code>.</code>  {t("(current dir)")}</td>
                    <td>{t("Target root folder path to inspect (e.g.,")} <code>{t("D:\\projects")}</code>).</td>
                  </tr>
                  <tr>
                    <td><code>{t("--scope <scope>")}</code></td>
                    <td><code>projects | agents | combined | all</code></td>
                    <td><code>{t("projects")}</code></td>
                    <td>{t("Target group to scan (project dependencies or AI agent storage).")}</td>
                  </tr>
                  <tr>
                    <td><code>{t("--auto-clean")}</code></td>
                    <td>{t("boolean")}</td>
                    <td><code>{t("false")}</code></td>
                    <td>{t("Automatically cleans matching targets that satisfy the active safety filter.")}</td>
                  </tr>
                  <tr>
                    <td><code>{t("--dry-run")}</code></td>
                    <td>{t("boolean")}</td>
                    <td><code>{t("false")}</code></td>
                    <td>{t("Simulation mode; inspects and reports without moving any files.")}</td>
                  </tr>
                  <tr>
                    <td><code>{t("--safety <classes>")}</code></td>
                    <td>{t("safe,regenerate,review")}</td>
                    <td><code>{t("safe,regenerate")}</code></td>
                    <td>{t("Comma-separated list of safety tiers permitted for automatic deletion.")}</td>
                  </tr>
                  <tr>
                    <td><code>{t("--min-size <mb>")}</code></td>
                    <td>{t("number")}</td>
                    <td><code>0</code></td>
                    <td>{t("Only targets strictly larger than the specified Megabytes are processed.")}</td>
                  </tr>
                  <tr>
                    <td><code>{t("--json")}</code></td>
                    <td>{t("boolean")}</td>
                    <td><code>{t("false")}</code></td>
                    <td>{t("Outputs pure JSON payload to stdout instead of the human-readable table.")}</td>
                  </tr>
                  <tr>
                    <td><code>{t("--webhook <url>")}</code></td>
                    <td>{t("string (URL)")}</td>
                    <td><code>{t("null")}</code></td>
                    <td>{t("HTTP webhook endpoint to POST the final completion JSON payload to.")}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h2 className="docs-h2">{t("2. `dev-cleaner caches`")}</h2>
            <p className="docs-p">{t("Queries package caches for 21 developer tools or purges them via official CLI commands.")}</p>
            <div className="docs-code-card">
              <div className="docs-code-header">
                <span>{t("Cache Commands")}</span>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard("dev-cleaner caches --clean all --yes", "cli-cache")}
                >
                  {copiedKey === "cli-cache" ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === "cli-cache" ? ui.docs.copied : ui.docs.copy}
                </button>
              </div>
              <pre className="docs-code-pre">
                {highlightBash(
`# ${t("List metrics for all supported package caches")}
dev-cleaner caches

# ${t("Purge a specific tool cache (e.g., npm, pip, cargo, docker)")}
dev-cleaner caches --clean npm

# ${t("Preview a full purge without deleting anything")}
dev-cleaner caches --clean all --dry-run

# ${t("Purge caches for all detected installed tools")}
dev-cleaner caches --clean all --yes`
                )}
              </pre>
            </div>

            <h2 className="docs-h2">{t("3. `dev-cleaner history`")}</h2>
            <p className="docs-p">{t("Lists historical cleanup records and reclaimed bytes audit logs.")}</p>
            <div className="docs-code-card">
              <pre className="docs-code-pre">{highlightBash("dev-cleaner history --limit 15")}</pre>
            </div>
          </article>
        )}

        {/* TOPIC 6: CLI BUILDER */}
        {activeTopicId === "cli-builder" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">{t("Interactive Tool")}</span>
            </div>
            <h1 className="docs-title">{t("Interactive CLI Command Builder")}</h1>
            <p className="docs-lead">
              
              {t("Configure the options below; Dev Cleaner dynamically generates a ready-to-run terminal command for you:")}
            </p>

            <div className="cli-builder-card">
              <div className="cli-builder-grid">
                <div className="cli-builder-field">
                  <label className="cli-builder-label">{t("Target Directory:")}</label>
                  <input
                    type="text"
                    className="cli-builder-input"
                    value={cliPath}
                    onChange={(e) => setCliPath(e.target.value)}
                    placeholder={t("D:\\\\projects")}
                  />
                </div>

                <div className="cli-builder-field">
                  <label className="cli-builder-label">{t("Scan Scope:")}</label>
                  <select
                    className="cli-builder-input"
                    value={cliScope}
                    onChange={(e) => setCliScope(e.target.value)}
                  >
                    <option value="projects">{t("Projects (Dependencies, build, cache)")}</option>
                    <option value="agents">{t("AI Coding Agents (Claude, Cursor, Codex)")}</option>
                    <option value="combined">{ui.common.scanAll}</option>
                    <option value="all">{t("Full System Scan (All)")}</option>
                  </select>
                </div>

                <div className="cli-builder-field">
                  <label className="cli-builder-label">{t("Minimum Size Threshold (MB):")}</label>
                  <NumberField
                    value={Number(cliMinSize) || 0}
                    min={0}
                    max={100000}
                    step={10}
                    ariaLabel={t("Minimum Size Threshold (MB)")}
                    increaseLabel={t("Increase")}
                    decreaseLabel={t("Decrease")}
                    onCommit={(val) => setCliMinSize(String(val))}
                  />
                </div>

                <div className="cli-builder-field">
                  <label className="cli-builder-label">{t("Webhook URL (Optional):")}</label>
                  <input
                    type="url"
                    className="cli-builder-input"
                    value={cliWebhook}
                    onChange={(e) => setCliWebhook(e.target.value)}
                    placeholder={t("https://n8n.company.com/clean")}
                  />
                </div>

                <div className="cli-builder-field">
                  <label className="cli-builder-label">{t("Safety Filter:")}</label>
                  <select
                    className="cli-builder-input"
                    value={cliSafety}
                    onChange={(e) => setCliSafety(e.target.value)}
                  >
                    <option value="safe,regenerate">{t("Safe & Regenerate (Recommended)")}</option>
                    <option value="safe">{t("Safe Only (Most Strict)")}</option>
                    <option value="safe,regenerate,review">{t("All Classes (Including Review)")}</option>
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
                  <span>{t("--auto-clean (Automatically move to Recycle Bin)")}</span>
                </label>

                {cliAutoClean && (
                  <label className="cli-checkbox-label">
                    <input
                      type="checkbox"
                      checked={cliDryRun}
                      onChange={(e) => setCliDryRun(e.target.checked)}
                    />
                    <span>{t("--dry-run (Simulation Mode)")}</span>
                  </label>
                )}

                <label className="cli-checkbox-label">
                  <input
                    type="checkbox"
                    checked={cliJson}
                    onChange={(e) => setCliJson(e.target.checked)}
                  />
                  <span>{t("--json (Machine-readable JSON Output)")}</span>
                </label>
              </div>

              <div className="docs-code-card" style={{ marginTop: 8 }}>
                <div className="docs-code-header">
                  <span className="docs-code-header-left">{t("Generated Terminal Command")}</span>
                  <button
                    type="button"
                    className="docs-copy-action"
                  >
                    {copiedKey === "gen-cli" ? <Check size={13} /> : <Copy size={13} />}
                    {copiedKey === "gen-cli" ? ui.docs.copied : t("Copy Command")}
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
              <span className="docs-category-pill">{t("Automation")}</span>
            </div>
            <h1 className="docs-title">{t("Headless Cron & CI/CD Pipeline Integration")}</h1>
            <p className="docs-lead">
              
              {t("Dev Cleaner can execute in headless mode via Windows Task Scheduler or CI/CD runners to maintain disk headroom periodically.")}
            </p>

            <h2 className="docs-h2">{t("Weekly Automation with Windows Task Scheduler")}</h2>
            <div className="docs-code-card">
              <div className="docs-code-header">
                <span>{t("PowerShell Task Definition")}</span>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard(
`$Action = New-ScheduledTaskAction -Execute "dev-cleaner.exe" -Argument "scan C:\\dev --auto-clean --min-size 100 --webhook https://n8n.company.com/cleanup"
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 3am
Register-ScheduledTask -Action $Action -Trigger $Trigger -TaskName "DevCleanerWeekly" -Description \"${t("Weekly automated safe dependency cleanup")}\"`,
                    "cron-task"
                  )}
                >
                  {copiedKey === "cron-task" ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === "cron-task" ? ui.docs.copied : ui.docs.copy}
                </button>
              </div>
              <pre className="docs-code-pre">
                {highlightBash(
`# ${t("Configure autonomous task running every Sunday at 03:00 via PowerShell")}
$Action = New-ScheduledTaskAction -Execute "dev-cleaner.exe" -Argument "scan C:\\dev --auto-clean --min-size 100 --webhook https://n8n.company.com/cleanup"
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 3am
Register-ScheduledTask -Action $Action -Trigger $Trigger -TaskName "DevCleanerWeekly" -Description \"${t("Weekly automated safe dependency cleanup")}\"`
                )}
              </pre>
            </div>
          </article>
        )}

        {/* TOPIC 8: MCP OVERVIEW */}
        {activeTopicId === "mcp-overview" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">{t("AI Protocol")}</span>
              <span className="docs-version-pill">MCP v{APP_VERSION}</span>
            </div>
            <h1 className="docs-title">{t("Model Context Protocol (MCP) Server")}</h1>
            <p className="docs-lead">
              
              {t("Dev Cleaner natively hosts a")} <strong>{t("Model Context Protocol (MCP)")}</strong>  {t("server supported by Anthropic and the Linux Foundation. AI coding assistants (Cursor, Windsurf, Claude Code) can query workspace disk pressure and execute safe cleanups with your permission.")}
            </p>

            <div className="docs-callout docs-callout--success">
              <Cpu className="docs-callout-icon" size={18} />
              <div>
                <strong>{t("Prompt Injection Defense:")}</strong>  {t("AI agents cannot supply arbitrary deletion paths. They may only request removal of validated target IDs marked Safe or Regenerate during active verified scans.")}
              </div>
            </div>

            <h2 className="docs-h2">{t("Starting the Server")}</h2>
            <div className="docs-code-card">
              <pre className="docs-code-pre">{highlightBash("dev-cleaner mcp")}</pre>
            </div>
          </article>
        )}

        {/* TOPIC 9: MCP IDE SETUP */}
        {activeTopicId === "mcp-ide-setup" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">{t("IDE Setup")}</span>
            </div>
            <h1 className="docs-title">{t("Multi-IDE MCP Configuration")}</h1>
            <p className="docs-lead">
              
              {t("Select your development environment and add the configuration snippet with one click:")}
            </p>

            {/* Single Dropdown Button */}
            <McpIdeSelector
              activeIde={activeIde}
              onSelect={setActiveIde}
            />

            <div className="docs-code-card">
              <div className="docs-code-header">
                <span className="docs-code-header-left">{t("Target File:")} {mcpConfigs[activeIde].file}</span>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard(mcpConfigs[activeIde].json, `mcp-${activeIde}`)}
                >
                  {copiedKey === `mcp-${activeIde}` ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === `mcp-${activeIde}`
                    ? ui.docs.copied
                    : mcpConfigs[activeIde].syntax === "toml"
                      ? ui.docs.copy
                      : `${ui.docs.copy} JSON`}
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
              <span className="docs-category-pill">{t("AI Prompt Templates")}</span>
              <span className="docs-version-pill">{t("One-Click Copy")}</span>
            </div>
            <h1 className="docs-title">{t("Cursor & Claude Code System Prompt Library")}</h1>
            <p className="docs-lead">
              
              {t("High-efficiency, battle-tested system prompt cards for instructing your AI coding assistant after connecting Dev Cleaner MCP:")}
            </p>

            <div className="docs-prompt-card">
              <div className="docs-prompt-header">
                <div className="docs-prompt-title">
                  <Bot size={16} className="text-accent" />
                  <span>{t("Template 1: Safe Disk Reclamation & Analysis")}</span>
                </div>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyPrompt('Use Dev Cleaner MCP to inspect workspace projects. List node_modules, target, and build artifacts larger than 100 MB; with my confirmation, move them safely to the Recycle Bin.', 'pr-1')}
                >
                  {copiedKey === 'pr-1' ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === 'pr-1' ? ui.docs.copied : ui.docs.copy}
                </button>
              </div>
              <div className="docs-prompt-body">
                
                {t("\"Use Dev Cleaner MCP to inspect workspace projects. List node_modules, target, and build artifacts larger than 100 MB; with my confirmation, move them safely to the Recycle Bin.\"")}
              </div>
            </div>

            <div className="docs-prompt-card">
              <div className="docs-prompt-header">
                <div className="docs-prompt-title">
                  <Bot size={16} className="text-accent" />
                  <span>{t("Template 2: Developer Caches Audit")}</span>
                </div>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyPrompt('Call devcleaner_list_caches. Inspect how much storage npm, pip, cargo and docker caches consume and provide a summary.', 'pr-2')}
                >
                  {copiedKey === 'pr-2' ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === 'pr-2' ? ui.docs.copied : ui.docs.copy}
                </button>
              </div>
              <div className="docs-prompt-body">
                
                {t("\"Call devcleaner_list_caches. Inspect how much storage npm, pip, cargo and docker caches consume and provide a summary.\"")}
              </div>
            </div>

            <div className="docs-prompt-card">
              <div className="docs-prompt-header">
                <div className="docs-prompt-title">
                  <Bot size={16} className="text-accent" />
                  <span>{t("Template 3: Dry-Run Simulation")}</span>
                </div>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyPrompt('Run a scan in dry-run mode on my projects directory. Without deleting any files, report the total reclaimable bytes and target list.', 'pr-3')}
                >
                  {copiedKey === 'pr-3' ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === 'pr-3' ? ui.docs.copied : ui.docs.copy}
                </button>
              </div>
              <div className="docs-prompt-body">
                
                {t("\"Run a scan in dry-run mode on my projects directory. Without deleting any files, report the total reclaimable bytes and target list.\"")}
              </div>
            </div>
          </article>
        )}

        {/* TOPIC 11: MCP TOOLS */}
        {activeTopicId === "mcp-tools" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">{t("MCP Tools")}</span>
            </div>
            <h1 className="docs-title">{t("Dev Cleaner MCP Tools Reference")}</h1>
            <p className="docs-lead">
              
              {t("The Dev Cleaner MCP server exposes 8 tools: 6 standard tools plus 2 destructive tools that are hidden unless the server runs with --allow-destructive.")}
            </p>

            <h2 className="docs-h2">{t("1. `devcleaner_scan_workspace`")}</h2>
            <p className="docs-p">{t("Scans the workspace and yields cleanable candidates as structured JSON.")}</p>

            <h2 className="docs-h2">{t("2. `devcleaner_preview_cleanup`")}</h2>
            <p className="docs-p">{t("Builds a cleanup plan, returns a single-use token and never deletes anything.")}</p>

            <h2 className="docs-h2">{t("3. `devcleaner_clean_safe` (deprecated alias)")}</h2>
            <p className="docs-p">{t("Deprecated alias of devcleaner_preview_cleanup. It only previews a plan and never deletes anything; use preview_cleanup plus execute_cleanup.")}</p>

            <h2 className="docs-h2">{t("4. `devcleaner_list_caches`")}</h2>
            <p className="docs-p">{t("Reports cache metrics for 21 developer tools and package managers.")}</p>

            <h2 className="docs-h2">{t("5. `devcleaner_get_history`")}</h2>
            <p className="docs-p">{t("Returns historical records of previous cleanup operations.")}</p>

            <h2 className="docs-h2">{t("6. `devcleaner_inspect_target`")}</h2>
            <p className="docs-p">{t("Inspects safety rules and classifications for a specific path.")}</p>

            <h2 className="docs-h2">{t("7. `devcleaner_execute_cleanup` (destructive)")}</h2>
            <p className="docs-p">{t("Executes a previously previewed plan. Requires confirm:true, a single-use token, --allow-destructive and the MCP destructive setting.")}</p>

            <h2 className="docs-h2">{t("8. `devcleaner_clean_cache` (destructive)")}</h2>
            <p className="docs-p">{t("Invokes official package manager CLI commands to purge cache. Requires confirm:true, --allow-destructive and the MCP destructive setting.")}</p>
          </article>
        )}

        {/* TOPIC 12: WEBHOOK GUIDE */}
        {activeTopicId === "webhook-guide" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">{t("Integration")}</span>
            </div>
            <h1 className="docs-title">{t("Universal Webhook & Automation Architecture")}</h1>
            <p className="docs-lead">
              
              {t("Whether triggered via the desktop UI or CLI, Dev Cleaner dispatches HTTP POST payloads to your configured webhook URL upon scan or cleanup completion.")}
            </p>

            <div className="docs-callout docs-callout--success">
              <Webhook className="docs-callout-icon" size={18} />
              <div>
                <strong>{t("Easy Setup:")}</strong>  {t("Enter your webhook URL in Settings > Automation & Webhook and trigger a live test request with one click.")}
              </div>
            </div>
          </article>
        )}

        {/* TOPIC 13: WEBHOOK SCHEMA */}
        {activeTopicId === "webhook-schema" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">{t("JSON Schema")}</span>
            </div>
            <h1 className="docs-title">{t("Webhook JSON Payload Schema")}</h1>
            <p className="docs-lead">
              
              {t("Standard JSON payload dispatched to the webhook target upon completion:")}
            </p>

            <div className="docs-code-card">
              <div className="docs-code-header">
                <span>{t("Sample Payload")}</span>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard(webhookSampleJson, "wh-json")}
                >
                  {copiedKey === "wh-json" ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === "wh-json" ? ui.docs.copied : `${ui.docs.copy} JSON`}
                </button>
              </div>
              <pre className="docs-code-pre">{highlightJson(webhookSampleJson)}</pre>
            </div>

            <h2 className="docs-h2">Field reference</h2>
            <p className="docs-p">
              <code>event</code> is always <code>scan</code> or <code>clean</code>.
              The legacy names <code>scan_completed</code> and{" "}
              <code>cleanup_completed</code> are accepted as aliases and are
              rewritten to the canonical names before delivery.
            </p>
            <p className="docs-p">
              <code>timestamp</code>, <code>product</code> and{" "}
              <code>version</code> identify the installation that raised the
              event; the payload is never signed.
            </p>
            <p className="docs-p">
              <code>status</code> is <code>success</code>, <code>partial</code>{" "}
              (the scan stopped early) or <code>cancelled</code> (the user pressed
              Stop).
            </p>
            <p className="docs-p">
              <code>total_bytes</code> is the reclaimable space that was measured;{" "}
              <code>total_human</code> is its formatted form.{" "}
              <code>cleaned_count</code> and <code>cleaned_bytes</code> only appear
              on cleanup events.
            </p>
            <p className="docs-p">
              Scan events also carry <code>scan_id</code>, <code>root_path</code>,{" "}
              <code>duration_ms</code> and, when the result is partial,{" "}
              <code>stop_reason</code>.
            </p>
            <p className="docs-p">
              Cleanup events from the desktop app also carry <code>plan_id</code>,{" "}
              <code>mode</code>, <code>success_count</code>,{" "}
              <code>error_count</code>, <code>moved_bytes</code> and{" "}
              <code>reclaim_bytes</code>.
            </p>
          </article>
        )}

        {/* TOPIC 14: SAFETY ARCHITECTURE */}
        {activeTopicId === "safety-architecture" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">{t("System Architecture")}</span>
            </div>
            <h1 className="docs-title">{t("TOCTOU & Process Lock Defense")}</h1>
            <p className="docs-lead">
              
              {t("Defensive architectures applied by Dev Cleaner against Time-of-Check to Time-of-Use (TOCTOU) race conditions:")}
            </p>

            <div className="docs-callout">
              <Lock className="docs-callout-icon" size={18} />
              <div>
                <strong>{t("NTFS Reparse Point Analysis:")}</strong>  {t("Right before deletion, the directory handle is inspected via")} <code>{t("symlink_metadata")}</code>{t(". If the target was transformed into a Junction or Symlink, deletion is instantly aborted.")}
              </div>
            </div>

            <div className="docs-callout docs-callout--success">
              <ShieldCheck className="docs-callout-icon" size={18} />
              <div>
                <strong>{t("3-Stage Exponential Backoff:")}</strong>  {t("For targets temporarily locked by antivirus or indexers, operations retry at 100ms, 250ms, and 500ms intervals before skipping gracefully.")}
              </div>
            </div>
          </article>
        )}

        {/* TOPIC 15: TROUBLESHOOTING (NEW!) */}
        {activeTopicId === "troubleshooting" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">{t("Error Resolution Matrix")}</span>
              <span className="docs-version-pill">{t("Dictionary")}</span>
            </div>
            <h1 className="docs-title">{t("Troubleshooting & Error Code Dictionary")}</h1>
            <p className="docs-lead">
              
              {t("Warning codes and resolution steps encountered when Dev Cleaner defense mechanisms trigger:")}
            </p>

            <h2 className="docs-h2">{ui.overview.coverage}</h2>
            <div className="docs-callout docs-callout--warning">
              <Info className="docs-callout-icon" size={18} />
              <div>
                <p>
                  <strong>{ui.overview.sectionSkipped}</strong> — {ui.overview.noticeInfoHint}
                </p>
                <p>
                  <strong>{ui.overview.warnings}</strong> — {ui.overview.noticeIssueHint}
                </p>
                <p>
                  <strong>{ui.overview.errors}</strong> — {ui.overview.sectionNoRoot} /{" "}
                  {ui.overview.sectionFailed}
                </p>
                <p>
                  <strong>{ui.overview.sectionPartial}</strong> — {ui.overview.partial}{" "}
                  {ui.overview.stopReason}: <code>stop_reason</code>
                </p>
              </div>
            </div>

            <div className="docs-trouble-card">
              <div className="docs-faq-q">
                <AlertTriangle size={16} className="text-warning" />
                <span><code>{t("TARGET_ACTIVE")}</code> / <code>{t("PROVIDER_ACTIVE")}</code>  {t("(Active Process Lock)")}</span>
              </div>
              <p className="docs-faq-a">
                  <strong>{t("Root Cause:")}</strong>  {t("A file in the target directory is locked by a running")} <code>{t("node.exe")}</code>,
                  <code>{t("vite")}</code>, <code>{t("cargo.exe")}</code>{t(", or VS Code process.")}<br />
                  <strong>{t("Resolution:")}</strong>  {t("Stop the background dev server or close the terminal, then retry the scan.")}
              </p>
            </div>

            <div className="docs-trouble-card docs-trouble-card--info">
              <div className="docs-faq-q">
                <Info size={16} className="text-accent" />
                <span><code>{t("NO_PROJECT_MARKER")}</code>  {t("(Missing Project Marker)")}</span>
              </div>
              <p className="docs-faq-a">
                  <strong>{t("Root Cause:")}</strong>  {t("A folder named")} <code>{t("build")}</code>, <code>{t("dist")}</code>{t(", or")} <code>{t("out")}</code>  {t("was found, but no root marker like")} <code>{t("package.json")}</code>  {t("or")} <code>{t("Cargo.toml")}</code>  {t("exists.")}<br />
                  <strong>{t("Safety Guarantee:")}</strong>  {t("Dev Cleaner never deletes unverified directories that might contain personal user documents or photos.")}

              </p>
            </div>

            <div className="docs-trouble-card docs-trouble-card--info">
              <div className="docs-faq-q">
                <ShieldCheck size={16} className="text-accent" />
                <span><code>{t("USER_PROTECTED")}</code>  {t("(User Protected Path)")}</span>
              </div>
              <p className="docs-faq-a">
                  <strong>{t("Root Cause:")}</strong>  {t("This path matches a custom rule in your Protection List in Settings.")}<br />
                <strong>{t("Resolution:")}</strong>  {t("If you wish to clean this directory, remove it under")} <strong>{t("Settings > Protection List")}</strong>.
              </p>
            </div>

            <div className="docs-trouble-card docs-trouble-card--danger">
              <div className="docs-faq-q">
                <Lock size={16} className="text-danger" />
                <span><code>{t("TOCTOU_BLOCKED")}</code>  {t("(Symlink Defense Blocked)")}</span>
              </div>
              <p className="docs-faq-a">
                  <strong>{t("Root Cause:")}</strong>  {t("The target directory was converted to a Junction point between scan and cleanup time.")}<br />
                  <strong>{t("Safety Guarantee:")}</strong>  {t("Operation was immediately aborted to prevent traversal into system folders.")}
              </p>
            </div>
          </article>
        )}
      
    </>
  );
};
