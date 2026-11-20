import React, { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUiStore } from "@/stores/ui-store";
import { useUIText, resolveUiLocale } from "@/lib/ui-text";
import { getDocsTopics, DocTopic } from "./docs-topics";
import { getDocsBodyIndex } from "./docs-search";
import { useDocsLocale } from "./docs-i18n";
import { McpIdeKey } from "./docs-data";
import { normalizeSearchText } from "@/lib/search";
import { DocsContentEn } from "./DocsContentEn";
import { DocsContentTr } from "./DocsContentTr";
import "./docs.css";

/**
 * The article bodies are large trees and none of their props depend on the
 * sidebar search box. Memoizing them here (rather than inside the generated
 * docs sources, which `build-docs-index.mjs` parses) keeps a search keystroke
 * from rebuilding the whole documentation pane.
 */
const MemoDocsContentEn = React.memo(DocsContentEn);
const MemoDocsContentTr = React.memo(DocsContentTr);

/** Quotes one CLI argument for the shell the generated command targets. */
function quoteCliArg(value: string, shell: "powershell" | "cmd" | "bash"): string {
  if (shell === "powershell") {
    // PowerShell single quotes are literal; a quote is escaped by doubling it.
    return `'${value.replace(/'/g, "''")}'`;
  }
  if (shell === "bash") {
    // Close the quote, emit an escaped quote, and reopen it.
    return `'${value.replace(/'/g, "'\\''")}'`;
  }
  // cmd.exe: double quotes group the argument; an embedded quote is doubled.
  return `"${value.replace(/"/g, '""')}"`;
}

export const DocsView: React.FC = () => {
  const ui = useUIText();
  const language = usePreferencesStore((s) => s.language);
  const isTr = resolveUiLocale(language) === "tr";

  // The docs dictionaries load per language; this revision changes once the
  // active one is available so derived topic titles and search recompute.
  const docsLocaleRevision = useDocsLocale(language);

  const topics = useMemo(
    () => getDocsTopics(language ?? "en"),
    [language, docsLocaleRevision],
  );
  const [activeTopicId, setActiveTopicId] = useState<string>("quickstart");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useUiStore((s) => s.showToast);

  // The "Copied" badge timer must not outlive the view.
  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    },
    [],
  );

  // Shell switcher state for CLI guides
  const [cliShell, setCliShell] = useState<"powershell" | "cmd" | "bash">("powershell");

  // CLI Builder State. The target starts at the folder the user actually
  // scanned instead of a hard-coded `D:\projects`; a `pathTouched` flag makes
  // sure a later scan never overwrites something the user typed.
  const lastScanPath = usePreferencesStore((s) => s.lastScanPath);
  const [cliPath, setCliPathState] = useState<string>(() => lastScanPath ?? "");
  const [cliPathTouched, setCliPathTouched] = useState(false);
  const setCliPath = useCallback((path: string) => {
    setCliPathTouched(true);
    setCliPathState(path);
  }, []);

  useEffect(() => {
    if (!cliPathTouched) setCliPathState(lastScanPath ?? "");
  }, [lastScanPath, cliPathTouched]);
  const [cliScope, setCliScope] = useState<string>("projects");
  const [cliAutoClean, setCliAutoClean] = useState<boolean>(true);
  const [cliDryRun, setCliDryRun] = useState<boolean>(false);
  const [cliJson, setCliJson] = useState<boolean>(false);
  const [cliSafety, setCliSafety] = useState<string>("safe,regenerate");
  const [cliMinSize, setCliMinSize] = useState<string>("50");
  const [cliWebhook, setCliWebhook] = useState<string>("");

  // MCP IDE Switcher State
  const [activeIde, setActiveIde] = useState<McpIdeKey>("cursor");

  // Global Keyboard Shortcuts (Ctrl+K or / to search, Esc to clear)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // A modal owns the keyboard (same rule as SearchField and the global
      // shortcuts). Without this, "/" or Ctrl+K moved focus into the Docs
      // search box behind the overlay.
      if (document.querySelector('[aria-modal="true"]')) return;

      const tag = document.activeElement?.tagName;
      const editing =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (document.activeElement as HTMLElement | null)?.isContentEditable === true;

      if (!editing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (e.key === "/" && !editing) {
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

  const copyToClipboard = useCallback(
    async (text: string, key: string) => {
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
        if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => {
          copyTimerRef.current = null;
          setCopiedKey((curr) => (curr === key ? null : curr));
        }, 2000);
      } catch {
        // Clipboard access can be denied outright; a silent no-op left the user
        // convinced the command had been copied.
        showToast(ui.errors.unknown, "error");
      }
    },
    [showToast, ui.errors.unknown],
  );

  const normalizedTitles = useMemo(() => {
    // Case/diacritic folding is the expensive part of a search. The title never
    // changes while the user types, so derive it once per locale instead of
    // re-normalising every topic on every keystroke.
    const index = new Map<string, string>();
    for (const topic of topics) {
      index.set(topic.id, normalizeSearchText(topic.title, language));
    }
    return index;
  }, [topics, language]);

  const filteredTopics = useMemo(() => {
    const query = normalizeSearchText(searchQuery.trim(), language);
    if (!query) return topics;
    // Lazily built on the first keystroke and memoized per locale; includes the
    // article body, not just titles and keywords.
    const bodyIndex = getDocsBodyIndex(language);
    return topics.filter(
      (t) =>
        (normalizedTitles.get(t.id) ?? "").includes(query) ||
        (t.keywords &&
          t.keywords.some((k) => normalizeSearchText(k, language).includes(query))) ||
        (bodyIndex[t.id]?.includes(query) ?? false),
    );
  }, [searchQuery, topics, language, docsLocaleRevision, normalizedTitles]);

  // One pass instead of five: the sidebar used to call `.filter` for every
  // category on the same array, scanning the whole result set five times per
  // keystroke.
  const groupedTopics = useMemo(() => {
    const groups: Record<DocTopic["category"], DocTopic[]> = {
      guide: [],
      cli: [],
      mcp: [],
      webhook: [],
      safety: [],
    };
    for (const topic of filteredTopics) {
      groups[topic.category].push(topic);
    }
    return groups;
  }, [filteredTopics]);

  // Dynamic CLI Command Generation (short & concise syntax)
  const generatedCliCommand = useMemo(() => {
    const parts = ["dev-cleaner", "s"];
    if (cliPath.trim() && cliScope !== "agents" && cliScope !== "drives") {
      parts.push(quoteCliArg(cliPath.trim(), cliShell));
    }
    if (cliScope === "agents") parts.push("-t a");
    else if (cliScope === "p,a" || cliScope === "combined") parts.push("-t p,a");
    else if (cliScope === "p,a,c") parts.push("-t p,a,c");
    else if (cliScope === "all") parts.push("-t all");
    else if (cliScope === "drives") parts.push("-t drives");
    if (cliAutoClean) {
      parts.push("-c");
      if (cliSafety !== "safe,regenerate") parts.push(`-s ${cliSafety}`);
      if (cliDryRun) parts.push("-n");
    }
    if (cliMinSize && Number(cliMinSize) > 0) parts.push(`-m ${cliMinSize}`);
    if (cliJson) parts.push("-j");
    if (cliWebhook.trim()) parts.push(`-w ${quoteCliArg(cliWebhook.trim(), cliShell)}`);
    return parts.join(" ");
  }, [
    cliPath,
    cliShell,
    cliScope,
    cliAutoClean,
    cliDryRun,
    cliJson,
    cliSafety,
    cliMinSize,
    cliWebhook,
  ]);

  // The article bodies are large and do not depend on the search box. Keeping
  // this object stable lets the memoized `DocsContentEn`/`DocsContentTr` skip a
  // full re-render on every search keystroke.
  const contentProps = useMemo(
    () => ({
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
    }),
    [
      activeTopicId,
      copiedKey,
      copyToClipboard,
      cliShell,
      cliPath,
      cliScope,
      cliAutoClean,
      cliDryRun,
      cliJson,
      cliSafety,
      cliMinSize,
      cliWebhook,
      activeIde,
      generatedCliCommand,
    ],
  );

  return (
    <div className="docs-container">
      {/* Sidebar */}
      <aside className="docs-sidebar">
        <div className="docs-sidebar-header">
          <div className="docs-search-box">
            <Search size={14} />
            <input
              ref={searchInputRef}
              type="text"
              className="docs-search-input"
              placeholder={ui.docs.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <kbd className="docs-search-kbd">/</kbd>
          </div>
        </div>

        <div className="docs-sidebar-scroll">
          {/* 1. Guides */}
          <div className="docs-nav-group">
            <span className="docs-nav-group-title">{ui.docs.catGuide}</span>
            {groupedTopics.guide.map((t) => (
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

          {/* 2. CLI */}
          <div className="docs-nav-group">
            <span className="docs-nav-group-title">{ui.docs.catCli}</span>
            {groupedTopics.cli.map((t) => (
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

          {/* 3. MCP */}
          <div className="docs-nav-group">
            <span className="docs-nav-group-title">{ui.docs.catMcp}</span>
            {groupedTopics.mcp.map((t) => (
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

          {/* 4. Webhook */}
          <div className="docs-nav-group">
            <span className="docs-nav-group-title">{ui.docs.catWebhook}</span>
            {groupedTopics.webhook.map((t) => (
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

          {/* 5. Safety */}
          <div className="docs-nav-group">
            <span className="docs-nav-group-title">{ui.docs.catSafety}</span>
            {groupedTopics.safety.map((t) => (
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

      {/* Content Pane */}
      <main className="docs-content-pane">
        {!isTr && language && resolveUiLocale(language) !== "en" && (
          <div
            role="note"
            className="docs-english-notice"
            style={{
              margin: "0 0 16px",
              padding: "10px 14px",
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: "var(--surface-2, rgba(127,127,127,0.08))",
              color: "var(--text-muted, inherit)",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {ui.docs.englishNotice}
          </div>
        )}
        {isTr ? <MemoDocsContentTr {...contentProps} /> : <MemoDocsContentEn {...contentProps} />}
      </main>
    </div>
  );
};
