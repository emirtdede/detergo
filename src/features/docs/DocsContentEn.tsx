import React, { useMemo } from "react";
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
import { Button } from "@/components/primitives/Button";
import { Checkbox } from "@/components/primitives/Checkbox";
import { NumberField } from "@/components/primitives/NumberField";
import { getMcpConfigs, webhookSampleJson } from "./docs-data";
import { APP_VERSION } from "@/lib/app-version";
import { McpIdeSelector } from "./McpIdeSelector";
import { DocsCommandList } from "./DocsCommandList";
import { DocsContentProps, highlightBash, highlightJson } from "./docs-highlight";
import { useDocsT } from "./docs-i18n";
import { useUIText } from "@/lib/ui-text";

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
  cliEnv,
  cliPathBusy,
  onRegisterCliPath,
  mcpCommand,
}) => {
  const t = useDocsT();
  const ui = useUIText();
  const activeMcpConfigs = useMemo(() => getMcpConfigs(mcpCommand), [mcpCommand]);

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
            <h1 className="docs-title">{t("Welcome to Detergo")}</h1>
            <p className="docs-lead">
              
              {t("Detergo is a high-performance desktop utility designed to purge heavy dependencies (node_modules, target, .venv, build), AI coding agent caches (Claude Code, Cursor, Codex), and 21 global package caches with zero data loss guarantee.")}
            </p>

            <div className="docs-callout docs-callout--success">
              <ShieldCheck className="docs-callout-icon" size={18} />
              <div>
              <strong>{t("Zero Data Loss Principle:")}</strong>  {t("All project and AI artifacts cleaned by Detergo are moved directly to the")} <strong>{t("Windows Recycle Bin")}</strong>{t(". Nothing is permanently destroyed by accident.")}
              </div>
            </div>

            <div className="docs-callout">
              <Cpu className="docs-callout-icon" size={18} />
              <div>
                <strong>Unified Top Command Bar:</strong> All scans start from the single scan hub
                in the top bar. Run <strong>{ui.common.scanAll}</strong> (Projects, AI Tools,
                Package Caches and System Cleaner - CLI <code>-t all</code>) in one click, or pick
                any 1-3 targets via checkboxes. While running, the header shows the active scope and
                live progress alongside Stop.
              </div>
            </div>

            <h2 className="docs-h2">{t("4 Core Operating Modes")}</h2>
            <p className="docs-p">
              
              {t("Detergo adapts seamlessly to your developer workflow through 4 distinct operating paradigms:")}
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
                  
                  {t("High-speed terminal operations via")} <code>{t("detergo")}</code>  {t("across PowerShell, CMD, and Bash with")} <code>{t("--dry-run")}</code>  {t("simulations and headless automation.")}
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

            <DocsCommandList
              title={t("Get Started with Terminal CLI in 5 Seconds")}
              copiedKey={copiedKey}
              onCopy={copyToClipboard}
              copyLabel={ui.docs.copy}
              copiedLabel={ui.docs.copied}
              highlight={highlightBash}
              items={[
                {
                  id: "qs-cli",
                  label: t("Simulation mode (dry-run without modifying or removing any files)"),
                  command: 'detergo s "D:\\projects" -t p,a -c -n',
                },
                {
                  id: "qs-combined",
                  label: `${ui.common.scanAll} (Projects + AI + Caches + System)`,
                  command: 'detergo s "D:\\projects" -t all',
                },
                {
                  id: "qs-system",
                  label: ui.system.title,
                  command: "detergo sys",
                },
              ]}
            />
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
              
              {t("The primary virtue of a cleaning tool is not simply freeing disk space, but ensuring no developer source code or personal data is ever damaged. Detergo adheres strictly to these rules:")}
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
                <strong>{t("3. Process Lock Protection:")}</strong>  {t("If an active Node.js, Cargo, or IDE process holds a lock on a target folder, Detergo never forces deletion; it safely skips the target and reports it in the summary.")}
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
              
              {t("No file cleaned with Detergo is ever permanently deleted immediately. All items reside safely in the Windows Recycle Bin preserving original metadata and paths. You can restore an accidentally cleaned folder in seconds:")}
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
            <DocsCommandList
              title={t("List Recently Deleted with PowerShell")}
              copiedKey={copiedKey}
              onCopy={copyToClipboard}
              copyLabel={ui.docs.copy}
              copiedLabel={ui.docs.copied}
              highlight={highlightBash}
              items={[
                {
                  id: "rec-ps",
                  label: t("List Recently Deleted with PowerShell"),
                  command:
                    "(New-Object -ComObject Shell.Application).Namespace(0xa).Items() | Select-Object Name, Path",
                },
              ]}
            />

            <div className="docs-callout">
              <ShieldCheck className="docs-callout-icon" size={18} />
              <div>
                <strong>{t("Git Repositories Are Always Immune:")}</strong>  {t("Detergo kernel-level rules strictly prohibit targeting")} <code>{t(".git")}</code>  {t("folders,")}
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
              
              {t("Answers to the most frequently asked technical questions regarding Detergo logic:")}
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
                  
                  {t("Detergo does not stop running containers; it executes the official command")} <code>{t("docker builder prune -f")}</code>.{" "}
                  {t("Active containers, database volumes, and tagged images are untouched; only stale intermediate build stages are removed.")}
              </p>
            </div>

            <div className="docs-faq-card">
              <div className="docs-faq-q">
                <HelpCircle size={16} className="text-accent" />
                <span>{t("Getting \"Command not found\" for")} <code>{t("detergo")}</code>  {t("in terminal?")}</span>
              </div>
              <p className="docs-faq-a">
                The NSIS installer adds <code>detergo</code> to your user <code>PATH</code> automatically.
                When running the portable executable, click <strong>Add CLI to PATH</strong> in the{" "}
                <strong>Terminal CLI Command Guide</strong> to create{" "}
                <code>%LOCALAPPDATA%\detergo\bin\detergo.cmd</code> and register it on your user PATH.
                Close and reopen any existing terminal window to pick up the updated PATH.
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

            <div className="docs-faq-card">
              <div className="docs-faq-q">
                <HelpCircle size={16} className="text-accent" />
                <span>What do the scan profiles (Fast, Balanced, Full, Thorough, Deep, Maximum) change?</span>
              </div>
              <p className="docs-faq-a">
                Profiles only pre-fill maximum folder depth, candidate budget, and timeout limits.
                Balanced is the default for day-to-day workspaces; choose Full, Thorough, or Deep for
                large nested monorepos and full drives.
              </p>
            </div>

            <div className="docs-faq-card">
              <div className="docs-faq-q">
                <HelpCircle size={16} className="text-accent" />
                <span>Are error logs or diagnostics uploaded automatically?</span>
              </div>
              <p className="docs-faq-a">
                Never. All logs remain strictly on your device. From Settings &gt; Error log you can
                optionally zip your masked logs into one archive and open a ready mail draft to{" "}
                <code>support@vellium.dev</code>; nothing is sent until you press Send in your mail app.
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
              
              {t("Detergo runs as a global command on your Windows PATH. You can invoke it from any terminal at any time:")}
            </p>

            {onRegisterCliPath && (
              <div className="docs-cli-env-banner">
                <div className="docs-cli-env-copy">
                  <strong>
                    {cliEnv?.inPath && cliEnv?.shimUpToDate
                      ? "CLI is ready on your user PATH"
                      : "detergo is not registered on your user PATH yet"}
                  </strong>
                  <span>
                    {cliEnv?.executablePath ? (
                      <>
                        Executable: <code>{cliEnv.executablePath}</code>
                      </>
                    ) : (
                      "Register a shim in %LOCALAPPDATA%\\detergo\\bin with one click, then open a new terminal."
                    )}
                  </span>
                </div>
                <Button
                  variant={cliEnv?.inPath && cliEnv?.shimUpToDate ? "secondary" : "primary"}
                  size="sm"
                  disabled={cliPathBusy}
                  onClick={onRegisterCliPath}
                >
                  {cliEnv?.inPath && cliEnv?.shimUpToDate
                    ? "Update CLI in PATH"
                    : "Add CLI to PATH"}
                </Button>
              </div>
            )}

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

            <h2 className="docs-h2">1. `detergo s` (`scan`)</h2>
            <p className="docs-p">
              Short, concise CLI syntax with multi-target selection (<code>-t p,a,c,s</code>). All
              long flags (<code>scan</code>, <code>--auto-clean</code>, <code>--dry-run</code>)
              remain 100% supported for existing scripts.
            </p>
            <DocsCommandList
              title={`${t("Example Usage (")}${cliShell})`}
              copiedKey={copiedKey}
              onCopy={copyToClipboard}
              copyLabel={ui.docs.copy}
              copiedLabel={ui.docs.copied}
              highlight={highlightBash}
              items={
                cliShell === "bash"
                  ? [
                      {
                        id: "cli-scan-std",
                        label: t("Standard scan with human-readable console summary"),
                        command: 'detergo s "/d/projects"',
                      },
                      {
                        id: "cli-scan-targets",
                        label: "Selected targets (Projects + AI Tools + Package Caches)",
                        command: 'detergo s "/d/projects" -t p,a,c',
                      },
                      {
                        id: "cli-scan-all",
                        label: "All targets in one command (Projects + AI + Caches + System)",
                        command: 'detergo s "/d/projects" -t all',
                      },
                      {
                        id: "cli-scan-auto",
                        label: t(
                          "Autonomous cleanup (moves only safe and regenerate targets to Recycle Bin)",
                        ),
                        command: 'detergo s "/d/projects" -c',
                      },
                      {
                        id: "cli-scan-dry",
                        label: t(
                          "Simulation mode (dry-run without modifying or removing any files)",
                        ),
                        command: 'detergo s "/d/projects" -c -n',
                      },
                      {
                        id: "cli-scan-json",
                        label: t("Structured JSON output for CI/CD and script automation"),
                        command: 'detergo s "/d/projects" -j',
                      },
                    ]
                  : [
                      {
                        id: "cli-scan-std",
                        label: t("Standard scan with human-readable console summary"),
                        command: 'detergo s "D:\\projects"',
                      },
                      {
                        id: "cli-scan-targets",
                        label: "Selected targets (Projects + AI Tools + Package Caches)",
                        command: 'detergo s "D:\\projects" -t p,a,c',
                      },
                      {
                        id: "cli-scan-all",
                        label: "All targets in one command (Projects + AI + Caches + System)",
                        command: 'detergo s "D:\\projects" -t all',
                      },
                      {
                        id: "cli-scan-auto",
                        label: t(
                          "Autonomous cleanup (moves only safe and regenerate targets to Recycle Bin)",
                        ),
                        command: 'detergo s "D:\\projects" -c',
                      },
                      {
                        id: "cli-scan-dry",
                        label: t(
                          "Simulation mode (dry-run without modifying or removing any files)",
                        ),
                        command: 'detergo s "D:\\projects" -c -n',
                      },
                      {
                        id: "cli-scan-json",
                        label: t("Structured JSON output for CI/CD and script automation"),
                        command: 'detergo s "D:\\projects" -j',
                      },
                    ]
              }
            />

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
                    <td><code>-t, --targets &lt;list&gt;</code></td>
                    <td><code>p,a,c,s,drives,all</code></td>
                    <td><code>p</code></td>
                    <td>Comma-separated targets: <code>p</code> (projects), <code>a</code> (AI), <code>c</code> (caches), <code>s</code> (system), <code>drives</code> (all fixed drives), <code>all</code> (everything).</td>
                  </tr>
                  <tr>
                    <td><code>-c, --auto-clean</code></td>
                    <td>{t("boolean")}</td>
                    <td><code>{t("false")}</code></td>
                    <td>{t("Automatically cleans matching targets that satisfy the active safety filter.")}</td>
                  </tr>
                  <tr>
                    <td><code>-n, --dry-run</code></td>
                    <td>{t("boolean")}</td>
                    <td><code>{t("false")}</code></td>
                    <td>{t("Simulation mode; inspects and reports without moving any files.")}</td>
                  </tr>
                  <tr>
                    <td><code>-s, --safety &lt;classes&gt;</code></td>
                    <td>{t("safe,regenerate,review")}</td>
                    <td><code>{t("safe,regenerate")}</code></td>
                    <td>{t("Comma-separated list of safety tiers permitted for automatic deletion.")}</td>
                  </tr>
                  <tr>
                    <td><code>-m, --min-size &lt;mb&gt;</code></td>
                    <td>{t("number")}</td>
                    <td><code>0</code></td>
                    <td>{t("Only targets strictly larger than the specified Megabytes are processed.")}</td>
                  </tr>
                  <tr>
                    <td><code>-i, --interactive</code></td>
                    <td>{t("boolean")}</td>
                    <td><code>{t("false")}</code></td>
                    <td>Number selectable targets, pick interactively, and move to Recycle Bin.</td>
                  </tr>
                  <tr>
                    <td><code>-j, --json</code></td>
                    <td>{t("boolean")}</td>
                    <td><code>{t("false")}</code></td>
                    <td>{t("Outputs pure JSON payload to stdout instead of the human-readable table.")}</td>
                  </tr>
                  <tr>
                    <td><code>-w, --webhook &lt;url&gt;</code></td>
                    <td>{t("string (URL)")}</td>
                    <td><code>{t("null")}</code></td>
                    <td>{t("HTTP webhook endpoint to POST the final completion JSON payload to.")}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h2 className="docs-h2">2. `detergo c` (`caches`)</h2>
            <p className="docs-p">{t("Queries package caches for 21 developer tools or purges them via official CLI commands.")}</p>
            <DocsCommandList
              title={t("Cache Commands")}
              copiedKey={copiedKey}
              onCopy={copyToClipboard}
              copyLabel={ui.docs.copy}
              copiedLabel={ui.docs.copied}
              highlight={highlightBash}
              items={[
                {
                  id: "cli-cache-list",
                  label: t("List metrics for all supported package caches"),
                  command: "detergo c",
                },
                {
                  id: "cli-cache-npm",
                  label: t("Purge a specific tool cache (e.g., npm, pip, cargo, docker)"),
                  command: "detergo c npm",
                },
                {
                  id: "cli-cache-dry",
                  label: t("Preview a full purge without deleting anything"),
                  command: "detergo c all -n",
                },
                {
                  id: "cli-cache-all",
                  label: t("Purge caches for all detected installed tools"),
                  command: "detergo c all -y",
                },
              ]}
            />

            <h2 className="docs-h2">3. `detergo sys` (`system`)</h2>
            <p className="docs-p">{ui.system.subtitle}</p>
            <DocsCommandList
              title={ui.system.title}
              copiedKey={copiedKey}
              onCopy={copyToClipboard}
              copyLabel={ui.docs.copy}
              copiedLabel={ui.docs.copied}
              highlight={highlightBash}
              items={[
                {
                  id: "cli-sys-list",
                  label: "List all C: drive cleanup actions and measured sizes",
                  command: "detergo sys",
                },
                {
                  id: "cli-sys-dry",
                  label: "Preview quick cleanup without deleting anything",
                  command: "detergo sys quick -n",
                },
                {
                  id: "cli-sys-quick",
                  label: "Run quick system cleanup (user temp + Windows Update leftovers)",
                  command: "detergo sys quick -y",
                },
                {
                  id: "cli-sys-std",
                  label: "Run standard system cleanup (Administrator recommended)",
                  command: "detergo sys standard -y",
                },
              ]}
            />

            <h2 className="docs-h2">4. `detergo hist` (`history`)</h2>
            <p className="docs-p">{t("Lists historical cleanup records and reclaimed bytes audit logs.")}</p>
            <DocsCommandList
              title="Audit History Commands"
              copiedKey={copiedKey}
              onCopy={copyToClipboard}
              copyLabel={ui.docs.copy}
              copiedLabel={ui.docs.copied}
              highlight={highlightBash}
              items={[
                {
                  id: "cli-history",
                  label: "Show the 15 most recent cleanup records",
                  command: "detergo hist 15",
                },
                {
                  id: "cli-history-json",
                  label: "Export cleanup history as JSON",
                  command: "detergo hist 50 -j",
                },
              ]}
            />
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
              
              {t("Configure the options below; Detergo dynamically generates a ready-to-run terminal command for you:")}
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
                    <option value="p,a">Projects + AI Tools (-t p,a)</option>
                    <option value="p,a,c">Projects + AI + Caches (-t p,a,c)</option>
                    <option value="all">{ui.common.scanAll} (-t all)</option>
                    <option value="drives">{ui.common.allDrives} (-t drives)</option>
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
                <Checkbox
                  id="docs-en-cli-autoclean"
                  checked={cliAutoClean}
                  onChange={setCliAutoClean}
                  label={`-c / ${t("--auto-clean (Automatically move to Recycle Bin)")}`}
                />

                {cliAutoClean && (
                  <Checkbox
                    id="docs-en-cli-dryrun"
                    checked={cliDryRun}
                    onChange={setCliDryRun}
                    label={`-n / ${t("--dry-run (Simulation Mode)")}`}
                  />
                )}

                <Checkbox
                  id="docs-en-cli-json"
                  checked={cliJson}
                  onChange={setCliJson}
                  label={`-j / ${t("--json (Machine-readable JSON Output)")}`}
                />
              </div>

              <div className="docs-code-card" style={{ marginTop: 8 }}>
                <div className="docs-code-header">
                  <span className="docs-code-header-left">{t("Generated Terminal Command")}</span>
                  <button
                    type="button"
                    className="docs-copy-action"
                    onClick={() => copyToClipboard(generatedCliCommand, "gen-cli")}
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
              
              {t("Detergo can execute in headless mode via Windows Task Scheduler or CI/CD runners to maintain disk headroom periodically.")}
            </p>

            <h2 className="docs-h2">{t("Weekly Automation with Windows Task Scheduler")}</h2>
            <div className="docs-code-card">
              <div className="docs-code-header">
                <span>{t("PowerShell Task Definition")}</span>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard(
`$Action = New-ScheduledTaskAction -Execute "detergo.exe" -Argument "s C:\\dev -c -m 100 -w https://n8n.company.com/cleanup"
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 3am
Register-ScheduledTask -Action $Action -Trigger $Trigger -TaskName "DetergoWeekly" -Description \"${t("Weekly automated safe dependency cleanup")}\"`,
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
$Action = New-ScheduledTaskAction -Execute "detergo.exe" -Argument "s C:\\dev -c -m 100 -w https://n8n.company.com/cleanup"
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 3am
Register-ScheduledTask -Action $Action -Trigger $Trigger -TaskName "DetergoWeekly" -Description \"${t("Weekly automated safe dependency cleanup")}\"`
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
              
              {t("Detergo natively hosts a")} <strong>{t("Model Context Protocol (MCP)")}</strong>  {t("server supported by Anthropic and the Linux Foundation. AI coding assistants (Cursor, Windsurf, Claude Code) can query workspace disk pressure and execute safe cleanups with your permission.")}
            </p>

            <div className="docs-callout docs-callout--success">
              <Cpu className="docs-callout-icon" size={18} />
              <div>
                <strong>{t("Prompt Injection Defense:")}</strong>  {t("AI agents cannot supply arbitrary deletion paths. They may only request removal of validated target IDs marked Safe or Regenerate during active verified scans.")}
              </div>
            </div>

            <h2 className="docs-h2">{t("Starting the Server")}</h2>
            <DocsCommandList
              title="MCP Server"
              copiedKey={copiedKey}
              onCopy={copyToClipboard}
              copyLabel={ui.docs.copy}
              copiedLabel={ui.docs.copied}
              highlight={highlightBash}
              items={[
                {
                  id: "mcp-start",
                  label: "Start in standard read-only / preview mode",
                  command: "detergo mcp",
                },
                {
                  id: "mcp-start-destructive",
                  label: "Start with destructive tools enabled (must also be enabled in Settings)",
                  command: "detergo mcp --allow-destructive",
                },
              ]}
            />
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

            {onRegisterCliPath && cliEnv && (!cliEnv.inPath || !cliEnv.shimUpToDate) && (
              <div className="docs-cli-env-banner">
                <div className="docs-cli-env-copy">
                  <strong>Using full executable path automatically</strong>
                  <span>
                    Because <code>detergo</code> is not on your PATH yet, the snippet below points
                    directly to <code>{cliEnv.executablePath}</code>. You can also add it to PATH in one click.
                  </span>
                </div>
                <Button variant="primary" size="sm" disabled={cliPathBusy} onClick={onRegisterCliPath}>
                  Add CLI to PATH
                </Button>
              </div>
            )}

            <div className="docs-code-card">
              <div className="docs-code-header">
                <span className="docs-code-header-left">{t("Target File:")} {activeMcpConfigs[activeIde].file}</span>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard(activeMcpConfigs[activeIde].json, `mcp-${activeIde}`)}
                >
                  {copiedKey === `mcp-${activeIde}` ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === `mcp-${activeIde}`
                    ? ui.docs.copied
                    : activeMcpConfigs[activeIde].syntax === "toml"
                      ? ui.docs.copy
                      : `${ui.docs.copy} JSON`}
                </button>
              </div>
              <pre className="docs-code-pre">
                {activeMcpConfigs[activeIde].syntax === "toml"
                  ? highlightBash(activeMcpConfigs[activeIde].json)
                  : highlightJson(activeMcpConfigs[activeIde].json)}
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
              
              {t("High-efficiency, battle-tested system prompt cards for instructing your AI coding assistant after connecting Detergo MCP:")}
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
                  onClick={() => copyPrompt('Use Detergo MCP to inspect workspace projects. List node_modules, target, and build artifacts larger than 100 MB; with my confirmation, move them safely to the Recycle Bin.', 'pr-1')}
                >
                  {copiedKey === 'pr-1' ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === 'pr-1' ? ui.docs.copied : ui.docs.copy}
                </button>
              </div>
              <div className="docs-prompt-body">
                
                {t("\"Use Detergo MCP to inspect workspace projects. List node_modules, target, and build artifacts larger than 100 MB; with my confirmation, move them safely to the Recycle Bin.\"")}
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
                  onClick={() => copyPrompt('Call detergo_list_caches. Inspect how much storage npm, pip, cargo and docker caches consume and provide a summary.', 'pr-2')}
                >
                  {copiedKey === 'pr-2' ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === 'pr-2' ? ui.docs.copied : ui.docs.copy}
                </button>
              </div>
              <div className="docs-prompt-body">
                
                {t("\"Call detergo_list_caches. Inspect how much storage npm, pip, cargo and docker caches consume and provide a summary.\"")}
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
            <h1 className="docs-title">{t("Detergo MCP Tools Reference")}</h1>
            <p className="docs-lead">
              The Detergo MCP server exposes 11 tools: 8 read-only / preview tools plus 3 destructive tools
              that require <code>--allow-destructive</code> and a single-use preview token.
            </p>

            <h2 className="docs-h2">{t("1. `detergo_scan_workspace`")}</h2>
            <p className="docs-p">{t("Scans the workspace and yields cleanable candidates as structured JSON.")}</p>

            <h2 className="docs-h2">{t("2. `detergo_preview_cleanup`")}</h2>
            <p className="docs-p">{t("Builds a cleanup plan, returns a single-use token and never deletes anything.")}</p>

            <h2 className="docs-h2">{t("3. `detergo_list_caches`")}</h2>
            <p className="docs-p">{t("Reports cache metrics for 21 developer tools and package managers.")}</p>

            <h2 className="docs-h2">4. `detergo_preview_cache`</h2>
            <p className="docs-p">Measures and previews an official package manager cache cleanup action and returns a single-use <code>preview_token</code>.</p>

            <h2 className="docs-h2">5. `detergo_system_scan`</h2>
            <p className="docs-p">Measures C: drive system cleanup actions, volume free space, and elevation requirements.</p>

            <h2 className="docs-h2">6. `detergo_system_preview`</h2>
            <p className="docs-p">Builds a single-use preview token for selected C: drive system cleanup actions or a profile.</p>

            <h2 className="docs-h2">{t("7. `detergo_get_history`")}</h2>
            <p className="docs-p">{t("Returns historical records of previous cleanup operations.")}</p>

            <h2 className="docs-h2">{t("8. `detergo_inspect_target`")}</h2>
            <p className="docs-p">{t("Inspects safety rules and classifications for a specific path.")}</p>

            <h2 className="docs-h2">{t("9. `detergo_execute_cleanup` (destructive)")}</h2>
            <p className="docs-p">{t("Executes a previously previewed plan. Requires confirm:true, a single-use token, --allow-destructive and the MCP destructive setting.")}</p>

            <h2 className="docs-h2">{t("10. `detergo_clean_cache` (destructive)")}</h2>
            <p className="docs-p">Executes a previewed package manager cache action using its <code>preview_token</code>. Requires <code>confirm:true</code>, <code>--allow-destructive</code>, and the MCP destructive setting.</p>

            <h2 className="docs-h2">11. `detergo_system_execute` (destructive)</h2>
            <p className="docs-p">Executes a previewed C: drive system cleanup token and records the result in audit history.</p>
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
              
              {t("Whether triggered via the desktop UI or CLI, Detergo dispatches HTTP POST payloads to your configured webhook URL upon scan or cleanup completion.")}
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
              
              {t("Defensive architectures applied by Detergo against Time-of-Check to Time-of-Use (TOCTOU) race conditions:")}
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
        {activeTopicId === "system-cleaner" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">{t("Windows Maintenance")}</span>
              <span className="docs-version-pill">{t("Guide")}</span>
            </div>
            <h1 className="docs-title">{t("C: Drive Cleaner & Scheduled Automation")}</h1>
            <p className="docs-lead">
              {t("Reclaim space on the system drive without typing a single command. Every action is measured before anything is deleted.")}
            </p>

            <h2 className="docs-h2">{t("What it cleans")}</h2>
            <p>
              {t("The cleaner covers your temporary files, Windows temporary files, Prefetch data, Windows Update leftovers, Windows error reports, the Recycle Bin, the Windows Disk Cleanup profile and the component store (WinSxS). Project folders, documents and Downloads sit outside every audited root and can never be selected.")}
            </p>

            <h2 className="docs-h2">{t("Administrator rights")}</h2>
            <p>
              {t("Windows blocks system folders for standard users. When an action needs elevation the page offers a single restart button; the app reopens on the same page with your selection intact. The app itself still starts without administrator rights, so scanning and cleaning your own files never needs a prompt.")}
            </p>

            <h2 className="docs-h2">{t("Safe by design")}</h2>
            <p>
              {t("The interface only sends action identifiers; paths are resolved and re-verified on the native side against a fixed audited list. Deletion never follows junctions or symbolic links, locked files are skipped and reported, and every run is written to the local audit history.")}
            </p>

            <div className="docs-callout docs-callout--info">
              <Info className="docs-callout-icon" size={18} />
              <div>
                <p>{t("Nothing is uploaded. Sizes, logs and audit records stay on this device.")}</p>
              </div>
            </div>

            <h2 className="docs-h2">{t("Automatic cleanup")}</h2>
            <p>
              {t("A Windows scheduled task can run the quick or standard profile daily or weekly. The task runs with the highest rights your account allows and asks nothing; remove the schedule from the same panel at any time. Prefetch, the Recycle Bin and the component store are never chosen automatically.")}
            </p>

            <h2 className="docs-h2">{t("Command line")}</h2>
            <p className="docs-p">
              The same actions are available headlessly for scripts and CI with short commands:{" "}
              <code>detergo sys</code>, <code>detergo sys quick -n</code>, or{" "}
              <code>detergo sys quick -y</code> (legacy <code>system --clean</code> flags still
              work).
            </p>
            <DocsCommandList
              title="Detergo System Cleaner CLI"
              copiedKey={copiedKey}
              onCopy={copyToClipboard}
              copyLabel={ui.docs.copy}
              copiedLabel={ui.docs.copied}
              highlight={highlightBash}
              items={[
                {
                  id: "sys-cli-list",
                  label: "List all system actions and measurable sizes",
                  command: "detergo sys",
                },
                {
                  id: "sys-cli-dry",
                  label: "Preview quick cleanup without deleting anything",
                  command: "detergo sys quick -n",
                },
                {
                  id: "sys-cli-quick",
                  label: "Run quick cleanup (user temp + Windows Update leftovers)",
                  command: "detergo sys quick -y",
                },
                {
                  id: "sys-cli-standard",
                  label: "Run standard cleanup (Administrator: temp, Prefetch, WER)",
                  command: "detergo sys standard -y",
                },
                {
                  id: "sys-cli-deep",
                  label: "Run deep cleanup (includes Disk Cleanup & DISM WinSxS)",
                  command: "detergo sys deep -y",
                },
              ]}
            />

            <h2 className="docs-h2">Windows CMD Reference Commands (Administrator)</h2>
            <p className="docs-p">
              Detergo automates these tasks from the UI. If you prefer running them manually,
              open Command Prompt as Administrator and copy any command below with one click:
            </p>
            <DocsCommandList
              title="1. Windows Disk Cleanup (cleanmgr)"
              copiedKey={copiedKey}
              onCopy={copyToClipboard}
              copyLabel={ui.docs.copy}
              copiedLabel={ui.docs.copied}
              highlight={highlightBash}
              items={[
                {
                  id: "cmd-cleanmgr-c",
                  label: "Open the standard Windows Disk Cleanup wizard for C:",
                  command: "cleanmgr /d c:",
                },
                {
                  id: "cmd-cleanmgr-sageset",
                  label: "Configure automated cleanup profile 1 once",
                  command: "cleanmgr /sageset:1",
                },
                {
                  id: "cmd-cleanmgr-sagerun",
                  label: "Run profile 1 unattended in the background",
                  command: "cleanmgr /sagerun:1",
                },
              ]}
            />

            <DocsCommandList
              title="2. Temporary Files (Temp), Prefetch & Windows Update (DISM)"
              copiedKey={copiedKey}
              onCopy={copyToClipboard}
              copyLabel={ui.docs.copy}
              copiedLabel={ui.docs.copied}
              highlight={highlightBash}
              items={[
                {
                  id: "cmd-del-user-temp",
                  label: "Clear user temporary files (%TEMP%)",
                  command: "del /q /f /s %TEMP%\\*",
                },
                {
                  id: "cmd-del-win-temp",
                  label: "Clear Windows temporary files (C:\\Windows\\Temp)",
                  command: "del /q /f /s C:\\Windows\\Temp\\*",
                },
                {
                  id: "cmd-del-prefetch",
                  label: "Clear Windows Prefetch cache",
                  command: "del /q /f /s C:\\Windows\\Prefetch\\*",
                },
                {
                  id: "cmd-dism-winsxs",
                  label: "Clean superseded Windows Update components (WinSxS via DISM)",
                  command: "DISM.exe /Online /Cleanup-Image /StartComponentCleanup",
                },
              ]}
            />
          </article>
        )}

        {activeTopicId === "troubleshooting" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">{t("Error Resolution Matrix")}</span>
              <span className="docs-version-pill">{t("Dictionary")}</span>
            </div>
            <h1 className="docs-title">{t("Troubleshooting & Error Code Dictionary")}</h1>
            <p className="docs-lead">
              
              {t("Warning codes and resolution steps encountered when Detergo defense mechanisms trigger:")}
            </p>

            <h2 className="docs-h2">{ui.overview.coverage}</h2>
            <div className="docs-callout docs-callout--warning">
              <Info className="docs-callout-icon" size={18} />
              <div>
                <p>
                  <strong>{ui.overview.sectionSkipped}</strong> - {ui.overview.noticeInfoHint}
                </p>
                <p>
                  <strong>{ui.overview.warnings}</strong> - {ui.overview.noticeIssueHint}
                </p>
                <p>
                  <strong>{ui.overview.errors}</strong> - {ui.overview.sectionNoRoot} /{" "}
                  {ui.overview.sectionFailed}
                </p>
                <p>
                  <strong>{ui.overview.sectionPartial}</strong> - {ui.overview.partial}{" "}
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
                  <strong>{t("Safety Guarantee:")}</strong>  {t("Detergo never deletes unverified directories that might contain personal user documents or photos.")}

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
