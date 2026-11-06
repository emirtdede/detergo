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
} from "lucide-react";
import { NumberField } from "@/components/primitives/NumberField";
import { mcpConfigs, webhookSampleJson } from "./docs-data";

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
  activeIde: "cursor" | "windsurf" | "claude" | "antigravity";
  setActiveIde: (ide: "cursor" | "windsurf" | "claude" | "antigravity") => void;
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
  return (
    <>

        {/* TOPIC 1: QUICKSTART */}
        {activeTopicId === "quickstart" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">Overview</span>
              <span className="docs-version-pill">v2.2.0</span>
            </div>
            <h1 className="docs-title">Welcome to Dev Cleaner</h1>
            <p className="docs-lead">
              Dev Cleaner is a high-performance desktop utility designed to purge heavy dependencies (node_modules, target, .venv, build),
              AI coding agent caches (Claude Code, Cursor, Codex), and 21 global package caches with zero data loss guarantee.
              temizleyen profesyonel bir ekosistemdir.
            </p>

            <div className="docs-callout docs-callout--success">
              <ShieldCheck className="docs-callout-icon" size={18} />
              <div>
              <strong>Zero Data Loss Principle:</strong> All project and AI artifacts cleaned by Dev Cleaner are moved directly
              to the <strong>Windows Recycle Bin</strong>. Nothing is permanently destroyed by accident.
              </div>
            </div>

            <h2 className="docs-h2">4 Core Operating Modes</h2>
            <p className="docs-p">
              Use Dev Cleaner seamlessly via the desktop UI, through the standalone terminal CLI, via AI agent protocols (MCP) in Claude Code and Cursor, or fully autonomously through Webhooks in n8n and CI/CD pipelines.
            </p>

            <div className="docs-code-card">
              <div className="docs-code-header">
                <span className="docs-code-header-left">Get Started with Terminal CLI in 5 Seconds</span>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard("dev-cleaner scan D:\\projeler --scope all --auto-clean --dry-run", "qs-cli")}
                >
                  {copiedKey === "qs-cli" ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === "qs-cli" ? "Copied!" : "Copy"}
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
              <span className="docs-category-pill">Safety Manifesto</span>
            </div>
            <h1 className="docs-title">Zero Data Loss &amp; Safety Manifesto</h1>
            <p className="docs-lead">
              The primary virtue of a cleaning tool is not simply freeing disk space, but ensuring no developer source code or personal
              data is ever damaged. Dev Cleaner adheres strictly to these rules:
            </p>

            <div className="docs-callout">
              <Info className="docs-callout-icon" size={18} />
              <div>
                <strong>1. Never Permanently Destroyed:</strong> All operations dispatch items via the native Windows Shell COM API to
                the Recycle Bin. Users can restore any folder in one click at any time.
              </div>
            </div>

            <div className="docs-callout docs-callout--warning">
              <Lock className="docs-callout-icon" size={18} />
              <div>
                <strong>2. TOCTOU &amp; Symlink Defense:</strong> Symlinks and NTFS Junction points are strictly excluded during scan and deletion.
                Any reparse point pointing outside the project tree (such as C:\Windows or ~/.ssh) is immediately blocked.
              </div>
            </div>

            <div className="docs-callout docs-callout--success">
              <ShieldCheck className="docs-callout-icon" size={18} />
              <div>
                <strong>3. Process Lock Protection:</strong> If an active Node.js, Cargo, or IDE process holds a lock on a target folder,
                Dev Cleaner never forces deletion; it safely skips the target and reports it in the summary.
              </div>
            </div>
          </article>
        )}

        {/* TOPIC 3: RECOVERY GUIDE (NEW!) */}
        {activeTopicId === "recovery-guide" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">Safety &amp; Recovery</span>
              <span className="docs-version-pill">Step-by-Step Guide</span>
            </div>
            <h1 className="docs-title">Restoring Accidentally Removed Targets</h1>
            <p className="docs-lead">
              No file cleaned with Dev Cleaner is ever permanently deleted immediately. All items reside safely in the Windows
              Recycle Bin preserving original metadata and paths. You can restore an accidentally cleaned folder in seconds:
            </p>

            <h2 className="docs-h2">Method 1: One-Click Restoration from Windows Desktop</h2>
            <div className="docs-callout docs-callout--success">
              <RotateCcw className="docs-callout-icon" size={18} />
              <div>
                <strong>1. Open the Recycle Bin:</strong> Double-click the Recycle Bin icon on your desktop.<br />
                <strong>2. Locate the Folder:</strong> Search or sort by deletion date or project name.<br />
                <strong>3. Right-Click &gt; Select "Restore":</strong> Windows immediately restores the directory to its exact original path (e.g. <code>D:\projects\app\node_modules</code>).
              </div>
            </div>

            <h2 className="docs-h2">Method 2: Restoring via PowerShell Terminal</h2>
            <p className="docs-p">To query and inspect items in the Recycle Bin without leaving your terminal:</p>
            <div className="docs-code-card">
              <div className="docs-code-header">
                <span>PowerShell ile Son Silinenleri Listele</span>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard('(New-Object -ComObject Shell.Application).Namespace(0xa).Items() | Select-Object Name, Path', 'rec-ps')}
                >
                  {copiedKey === 'rec-ps' ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === 'rec-ps' ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <pre className="docs-code-pre">{highlightBash('(New-Object -ComObject Shell.Application).Namespace(0xa).Items() | Select-Object Name, Path')}</pre>
            </div>

            <div className="docs-callout">
              <ShieldCheck className="docs-callout-icon" size={18} />
              <div>
                <strong>Git Repositories Are Always Immune:</strong> Dev Cleaner kernel-level rules strictly prohibit targeting <code>.git</code> folders,
                <code>.env</code> files, and source code. Your work and git histories are 100% safe.
              </div>
            </div>
          </article>
        )}

        {/* TOPIC 4: FAQ (NEW!) */}
        {activeTopicId === "faq" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">Destek</span>
              <span className="docs-version-pill">Frequently Asked Questions</span>
            </div>
            <h1 className="docs-title">Developer Frequently Asked Questions (FAQ)</h1>
            <p className="docs-lead">
              Answers to the most frequently asked technical questions regarding Dev Cleaner logic:
            </p>

            <div className="docs-faq-card">
              <div className="docs-faq-q">
                <HelpCircle size={16} className="text-accent" />
                <span><code>node_modules</code> veya <code>.venv</code> silersem kodumu kaybeder miyim?</span>
              </div>
              <p className="docs-faq-a">
                  Absolutely not. These directories hold cached third-party packages or compilation outputs. As long as your <code>package.json</code>
                  or <code>Cargo.toml</code> is intact, running <code>npm install</code> or <code>cargo build</code> restores the dependencies cleanly.

              </p>
            </div>

            <div className="docs-faq-card">
              <div className="docs-faq-q">
                <HelpCircle size={16} className="text-accent" />
                <span>Does clearing the Docker cache stop running containers?</span>
              </div>
              <p className="docs-faq-a">
                  No. Dev Cleaner executes the official <code>docker builder prune -f</code> command. Active containers, database volumes,
                  and tagged images are untouched; only stale intermediate build stages are removed.
              </p>
            </div>

            <div className="docs-faq-card">
              <div className="docs-faq-q">
                <HelpCircle size={16} className="text-accent" />
                <span>Getting "Command not found" for <code>dev-cleaner</code> in terminal?</span>
              </div>
              <p className="docs-faq-a">
                  Dev Cleaner installs to <code>%LOCALAPPDATA%\Microsoft\WindowsApps\dev-cleaner.exe</code>. If your terminal was open during
                  installation, simply close and restart your terminal window to refresh your PATH environment variable.
              </p>
            </div>

            <div className="docs-faq-card">
              <div className="docs-faq-q">
                <HelpCircle size={16} className="text-accent" />
                <span>Why wasn't disk space freed immediately after cleanup?</span>
              </div>
              <p className="docs-faq-a">
                  By default safety design, deleted files are moved to the Recycle Bin. To reclaim raw drive capacity permanently,
                  right-click the Recycle Bin icon on your desktop and select "Empty Recycle Bin".
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
            <h1 className="docs-title">Terminal CLI Command Guide</h1>
            <p className="docs-lead">
              Dev Cleaner runs as a global command on your Windows PATH. You can invoke it from any terminal at any time:
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
            <p className="docs-p">Scans candidate project dependencies in the target directory or cleans them autonomously.</p>
            <div className="docs-code-card">
              <div className="docs-code-header">
                <span>Example Usage ({cliShell})</span>
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
                  {copiedKey === "cli-scan" ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="docs-code-pre">
                {cliShell === "bash"
                  ? highlightBash(
`# Standard scan with human-readable console summary
dev-cleaner scan "/d/projeler"

# Autonomous cleanup (moves only safe and regenerate targets to Recycle Bin)
dev-cleaner scan "/d/projeler" --auto-clean --safety safe,regenerate

# Simulation mode (dry-run without modifying or removing any files)
dev-cleaner scan "/d/projeler" --auto-clean --dry-run

# Structured JSON output for CI/CD and script automation
dev-cleaner scan "/d/projeler" --json`
                    )
                  : highlightBash(
`# Standard scan with human-readable console summary
dev-cleaner scan "D:\\projeler"

# Autonomous cleanup (moves only safe and regenerate targets to Recycle Bin)
dev-cleaner scan "D:\\projeler" --auto-clean --safety safe,regenerate

# Simulation mode (dry-run without modifying or removing any files)
dev-cleaner scan "D:\\projeler" --auto-clean --dry-run

# Structured JSON output for CI/CD and script automation
dev-cleaner scan "D:\\projeler" --json`
                    )}
              </pre>
            </div>

            <h2 className="docs-h2">2. `dev-cleaner caches`</h2>
            <p className="docs-p">Queries package caches for 21 developer tools or purges them via official CLI commands.</p>
            <div className="docs-code-card">
              <div className="docs-code-header">
                <span>Cache Commands</span>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard("dev-cleaner caches --clean all", "cli-cache")}
                >
                  {copiedKey === "cli-cache" ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === "cli-cache" ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="docs-code-pre">
                {highlightBash(
`# List metrics for all supported package caches
dev-cleaner caches

# Purge a specific tool cache (e.g., npm, pip, cargo, docker)
dev-cleaner caches --clean npm

# Purge caches for all detected installed tools
dev-cleaner caches --clean all`
                )}
              </pre>
            </div>

            <h2 className="docs-h2">3. `dev-cleaner history`</h2>
            <p className="docs-p">Lists historical cleanup records and reclaimed bytes audit logs.</p>
            <div className="docs-code-card">
              <pre className="docs-code-pre">{highlightBash("dev-cleaner history --limit 15")}</pre>
            </div>
          </article>
        )}

        {/* TOPIC 6: CLI BUILDER */}
        {activeTopicId === "cli-builder" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">Interactive Tool</span>
            </div>
            <h1 className="docs-title">Interactive CLI Command Builder</h1>
            <p className="docs-lead">
              Configure the options below; Dev Cleaner dynamically generates a ready-to-run terminal command for you:
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
                  <label className="cli-builder-label">Scan Scope:</label>
                  <select
                    className="cli-builder-input"
                    value={cliScope}
                    onChange={(e) => setCliScope(e.target.value)}
                  >
                    <option value="projects">Projeler (Dependencies, build, cache)</option>
                    <option value="agents">AI Coding Agents (Claude, Cursor, Codex)</option>
                    <option value="caches">Developer Tool Caches</option>
                    <option value="all">Full System Scan (All)</option>
                  </select>
                </div>

                <div className="cli-builder-field">
                  <label className="cli-builder-label">Minimum Size Threshold (MB):</label>
                  <NumberField
                    value={Number(cliMinSize) || 0}
                    min={0}
                    max={100000}
                    step={10}
                    ariaLabel="Minimum Size Threshold (MB)"
                    increaseLabel="Increase"
                    decreaseLabel="Decrease"
                    onCommit={(val) => setCliMinSize(String(val))}
                  />
                </div>

                <div className="cli-builder-field">
                  <label className="cli-builder-label">Webhook URL (Optional):</label>
                  <input
                    type="url"
                    className="cli-builder-input"
                    value={cliWebhook}
                    onChange={(e) => setCliWebhook(e.target.value)}
                    placeholder="https://n8n.sirket.com/clean"
                  />
                </div>

                <div className="cli-builder-field">
                  <label className="cli-builder-label">Safety Filter:</label>
                  <select
                    className="cli-builder-input"
                    value={cliSafety}
                    onChange={(e) => setCliSafety(e.target.value)}
                  >
                    <option value="safe,regenerate">Safe &amp; Regenerate (Recommended)</option>
                    <option value="safe">Safe Only (Most Strict)</option>
                    <option value="safe,regenerate,review">All Classes (Including Review)</option>
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
                  <span>--auto-clean (Automatically move to Recycle Bin)</span>
                </label>

                {cliAutoClean && (
                  <label className="cli-checkbox-label">
                    <input
                      type="checkbox"
                      checked={cliDryRun}
                      onChange={(e) => setCliDryRun(e.target.checked)}
                    />
                    <span>--dry-run (Simulation Mode)</span>
                  </label>
                )}

                <label className="cli-checkbox-label">
                  <input
                    type="checkbox"
                    checked={cliJson}
                    onChange={(e) => setCliJson(e.target.checked)}
                  />
                  <span>--json (Machine-readable JSON Output)</span>
                </label>
              </div>

              <div className="docs-code-card" style={{ marginTop: 8 }}>
                <div className="docs-code-header">
                  <span className="docs-code-header-left">Generated Terminal Command</span>
                  <button
                    type="button"
                    className="docs-copy-action"
                  >
                    {copiedKey === "gen-cli" ? <Check size={13} /> : <Copy size={13} />}
                    {copiedKey === "gen-cli" ? "Copied!" : "Copy Command"}
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
              <span className="docs-category-pill">Automation</span>
            </div>
            <h1 className="docs-title">Headless Cron &amp; CI/CD Pipeline Integration</h1>
            <p className="docs-lead">
              Dev Cleaner can execute in headless mode via Windows Task Scheduler or CI/CD runners to maintain disk headroom periodically.
            </p>

            <h2 className="docs-h2">Weekly Automation with Windows Task Scheduler</h2>
            <div className="docs-code-card">
              <div className="docs-code-header">
                <span>PowerShell Task Definition</span>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard(
`$Action = New-ScheduledTaskAction -Execute "dev-cleaner.exe" -Argument "scan C:\\dev --auto-clean --min-size 100 --webhook https://n8n.sirket.com/cleanup"
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 3am
Register-ScheduledTask -Action $Action -Trigger $Trigger -TaskName "DevCleanerWeekly" -Description "Weekly automated safe dependency cleanup"`,
                    "cron-task"
                  )}
                >
                  {copiedKey === "cron-task" ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === "cron-task" ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="docs-code-pre">
                {highlightBash(
`# Configure autonomous task running every Sunday at 03:00 via PowerShell
$Action = New-ScheduledTaskAction -Execute "dev-cleaner.exe" -Argument "scan C:\\dev --auto-clean --min-size 100 --webhook https://n8n.sirket.com/cleanup"
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 3am
Register-ScheduledTask -Action $Action -Trigger $Trigger -TaskName "DevCleanerWeekly" -Description "Weekly automated safe dependency cleanup"`
                )}
              </pre>
            </div>
          </article>
        )}

        {/* TOPIC 8: MCP OVERVIEW */}
        {activeTopicId === "mcp-overview" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">AI Protocol</span>
              <span className="docs-version-pill">MCP v2.2.0</span>
            </div>
            <h1 className="docs-title">Model Context Protocol (MCP) Server</h1>
            <p className="docs-lead">
              Dev Cleaner natively hosts a <strong>Model Context Protocol (MCP)</strong> server supported by Anthropic and the Linux Foundation.
              AI coding assistants (Cursor, Windsurf, Claude Code) can query workspace disk pressure and execute safe cleanups with your permission.
            </p>

            <div className="docs-callout docs-callout--success">
              <Cpu className="docs-callout-icon" size={18} />
              <div>
                <strong>Prompt Injection Defense:</strong> AI agents cannot supply arbitrary deletion paths.
                They may only request removal of validated target IDs marked Safe or Regenerate during active verified scans.
              </div>
            </div>

            <h2 className="docs-h2">Starting the Server</h2>
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
            <h1 className="docs-title">Multi-IDE MCP Configuration</h1>
            <p className="docs-lead">
              Select your development environment and add the configuration snippet with one click:
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
                <span className="docs-code-header-left">Target File: {mcpConfigs[activeIde].file}</span>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard(mcpConfigs[activeIde].json, `mcp-${activeIde}`)}
                >
                  {copiedKey === `mcp-${activeIde}` ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === `mcp-${activeIde}` ? "Copied!" : "Copy JSON"}
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
              <span className="docs-category-pill">AI Prompt Templates</span>
              <span className="docs-version-pill">One-Click Copy</span>
            </div>
            <h1 className="docs-title">Cursor &amp; Claude Code System Prompt Library</h1>
            <p className="docs-lead">
              High-efficiency, battle-tested system prompt cards for instructing your AI coding assistant after connecting Dev Cleaner MCP:
            </p>

            <div className="docs-prompt-card">
              <div className="docs-prompt-header">
                <div className="docs-prompt-title">
                  <Bot size={16} className="text-accent" />
                  <span>Template 1: Safe Disk Reclamation &amp; Analysis</span>
                </div>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard('Use Dev Cleaner MCP to inspect workspace projects. List node_modules, target, and build artifacts larger than 100 MB; with my confirmation, move them safely to the Recycle Bin.', 'pr-1')}
                >
                  {copiedKey === 'pr-1' ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === 'pr-1' ? 'Prompt Copied!' : 'Copy Prompt'}
                </button>
              </div>
              <div className="docs-prompt-body">
                "Use Dev Cleaner MCP to inspect workspace projects. List node_modules, target, and build artifacts larger than 100 MB; with my confirmation, move them safely to the Recycle Bin."
              </div>
            </div>

            <div className="docs-prompt-card">
              <div className="docs-prompt-header">
                <div className="docs-prompt-title">
                  <Bot size={16} className="text-accent" />
                  <span>Template 2: Developer Caches Audit</span>
                </div>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard('Call devcleaner_list_caches. Inspect how much storage npm, pip, cargo and docker caches consume and provide a summary.', 'pr-2')}
                >
                  {copiedKey === 'pr-2' ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === 'pr-2' ? 'Prompt Copied!' : 'Copy Prompt'}
                </button>
              </div>
              <div className="docs-prompt-body">
                "Call devcleaner_list_caches. Inspect how much storage npm, pip, cargo and docker caches consume and provide a summary."
              </div>
            </div>

            <div className="docs-prompt-card">
              <div className="docs-prompt-header">
                <div className="docs-prompt-title">
                  <Bot size={16} className="text-accent" />
                  <span>Template 3: Dry-Run Simulation</span>
                </div>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard('Run a scan in dry-run mode on my projects directory. Without deleting any files, report the total reclaimable bytes and target list.', 'pr-3')}
                >
                  {copiedKey === 'pr-3' ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === 'pr-3' ? 'Prompt Copied!' : 'Copy Prompt'}
                </button>
              </div>
              <div className="docs-prompt-body">
                "Run a scan in dry-run mode on my projects directory. Without deleting any files, report the total reclaimable bytes and target list."
              </div>
            </div>
          </article>
        )}

        {/* TOPIC 11: MCP TOOLS */}
        {activeTopicId === "mcp-tools" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">MCP Tools</span>
            </div>
            <h1 className="docs-title">Dev Cleaner MCP Tools Reference</h1>
            <p className="docs-lead">
              The Dev Cleaner MCP server exposes 6 autonomous tools to AI models:
            </p>

            <h2 className="docs-h2">1. `devcleaner_scan_workspace`</h2>
            <p className="docs-p">Scans the workspace and yields cleanable candidates as structured JSON.</p>

            <h2 className="docs-h2">2. `devcleaner_clean_safe`</h2>
            <p className="docs-p">Safely dispatches confirmed target IDs to the Windows Recycle Bin.</p>

            <h2 className="docs-h2">3. `devcleaner_list_caches`</h2>
            <p className="docs-p">Reports cache metrics for 21 developer tools and package managers.</p>

            <h2 className="docs-h2">4. `devcleaner_clean_cache`</h2>
            <p className="docs-p">Invokes official package manager CLI commands to purge cache.</p>

            <h2 className="docs-h2">5. `devcleaner_get_history`</h2>
            <p className="docs-p">Returns historical records of previous cleanup operations.</p>

            <h2 className="docs-h2">6. `devcleaner_inspect_target`</h2>
            <p className="docs-p">Inspects safety rules and classifications for a specific path.</p>
          </article>
        )}

        {/* TOPIC 12: WEBHOOK GUIDE */}
        {activeTopicId === "webhook-guide" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">Entegrasyon</span>
            </div>
            <h1 className="docs-title">Universal Webhook &amp; Automation Architecture</h1>
            <p className="docs-lead">
              Whether triggered via the desktop UI or CLI, Dev Cleaner dispatches HTTP POST payloads to your configured webhook URL upon scan or cleanup completion.
            </p>

            <div className="docs-callout docs-callout--success">
              <Webhook className="docs-callout-icon" size={18} />
              <div>
                <strong>Easy Setup:</strong> Enter your webhook URL in Settings &gt; Automation &amp; Webhook and trigger a live test request with one click.
              </div>
            </div>
          </article>
        )}

        {/* TOPIC 13: WEBHOOK SCHEMA */}
        {activeTopicId === "webhook-schema" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">JSON Schema</span>
            </div>
            <h1 className="docs-title">Webhook JSON Payload Schema</h1>
            <p className="docs-lead">
              Standard JSON payload dispatched to the webhook target upon completion:
            </p>

            <div className="docs-code-card">
              <div className="docs-code-header">
                <span>Sample Payload</span>
                <button
                  type="button"
                  className="docs-copy-action"
                  onClick={() => copyToClipboard(webhookSampleJson, "wh-json")}
                >
                  {copiedKey === "wh-json" ? <Check size={13} /> : <Copy size={13} />}
                  {copiedKey === "wh-json" ? "Copied" : "Copy JSON"}
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
            <h1 className="docs-title">TOCTOU &amp; Process Lock Defense</h1>
            <p className="docs-lead">
              Defensive architectures applied by Dev Cleaner against Time-of-Check to Time-of-Use (TOCTOU) race conditions:
            </p>

            <div className="docs-callout">
              <Lock className="docs-callout-icon" size={18} />
              <div>
                <strong>NTFS Reparse Point Analysis:</strong> Right before deletion, the directory handle is inspected via <code>symlink_metadata</code>.
                If the target was transformed into a Junction or Symlink, deletion is instantly aborted.
              </div>
            </div>

            <div className="docs-callout docs-callout--success">
              <ShieldCheck className="docs-callout-icon" size={18} />
              <div>
                <strong>3-Stage Exponential Backoff:</strong> For targets temporarily locked by antivirus or indexers, operations retry at 100ms, 250ms, and 500ms intervals before skipping gracefully.
              </div>
            </div>
          </article>
        )}

        {/* TOPIC 15: TROUBLESHOOTING (NEW!) */}
        {activeTopicId === "troubleshooting" && (
          <article className="docs-article">
            <div className="docs-badge-row">
              <span className="docs-category-pill">Error Resolution Matrix</span>
              <span className="docs-version-pill">Dictionary</span>
            </div>
            <h1 className="docs-title">Troubleshooting &amp; Error Code Dictionary</h1>
            <p className="docs-lead">
              Warning codes and resolution steps encountered when Dev Cleaner defense mechanisms trigger:
            </p>

            <div className="docs-trouble-card">
              <div className="docs-faq-q">
                <AlertTriangle size={16} className="text-warning" />
                <span><code>TARGET_ACTIVE</code> / <code>PROVIDER_ACTIVE</code> (Active Process Lock)</span>
              </div>
              <p className="docs-faq-a">
                  <strong>Root Cause:</strong> A file in the target directory is locked by a running <code>node.exe</code>,
                  <code>vite</code>, <code>cargo.exe</code>, or VS Code process.<br />
                  <strong>Resolution:</strong> Stop the background dev server or close the terminal, then retry the scan.
              </p>
            </div>

            <div className="docs-trouble-card docs-trouble-card--info">
              <div className="docs-faq-q">
                <Info size={16} className="text-accent" />
                <span><code>NO_PROJECT_MARKER</code> (Missing Project Marker)</span>
              </div>
              <p className="docs-faq-a">
                  <strong>Root Cause:</strong> A folder named <code>build</code>, <code>dist</code>, or <code>out</code> was found,
                  but no root marker like <code>package.json</code> or <code>Cargo.toml</code> exists.<br />
                  <strong>Safety Guarantee:</strong> Dev Cleaner never deletes unverified directories that might contain personal user documents or photos.

              </p>
            </div>

            <div className="docs-trouble-card docs-trouble-card--info">
              <div className="docs-faq-q">
                <ShieldCheck size={16} className="text-accent" />
                <span><code>USER_PROTECTED</code> (User Protected Path)</span>
              </div>
              <p className="docs-faq-a">
                  <strong>Root Cause:</strong> This path matches a custom rule in your Protection List in Settings.<br />
                <strong>Resolution:</strong> If you wish to clean this directory, remove it under <strong>Settings &gt; Protection List</strong>.
              </p>
            </div>

            <div className="docs-trouble-card docs-trouble-card--danger">
              <div className="docs-faq-q">
                <Lock size={16} className="text-danger" />
                <span><code>TOCTOU_BLOCKED</code> (Symlink Defense Blocked)</span>
              </div>
              <p className="docs-faq-a">
                  <strong>Root Cause:</strong> The target directory was converted to a Junction point between scan and cleanup time.<br />
                  <strong>Safety Guarantee:</strong> Operation was immediately aborted to prevent traversal into system folders.
              </p>
            </div>
          </article>
        )}
      
    </>
  );
};
