import React, { useMemo, useState, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { usePreferencesStore } from "@/stores/preferences-store";
import { useUIText, resolveUiLocale } from "@/lib/ui-text";
import { getDocsTopics } from "./docs-topics";
import { DocsContentTr } from "./DocsContentTr";
import { DocsContentEn } from "./DocsContentEn";
import "./docs.css";

export const DocsView: React.FC = () => {
  const ui = useUIText();
  const language = usePreferencesStore((s) => s.language);
  const isTr = resolveUiLocale(language) === "tr";

  const topics = useMemo(() => getDocsTopics(isTr), [isTr]);
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
    if (!searchQuery.trim()) return topics;
    const q = searchQuery.toLowerCase();
    return topics.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        (t.keywords && t.keywords.some((k) => k.toLowerCase().includes(q)))
    );
  }, [searchQuery, topics]);

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

  const contentProps = {
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
  };

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

          {/* 2. CLI */}
          <div className="docs-nav-group">
            <span className="docs-nav-group-title">{ui.docs.catCli}</span>
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

          {/* 3. MCP */}
          <div className="docs-nav-group">
            <span className="docs-nav-group-title">{ui.docs.catMcp}</span>
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

          {/* 4. Webhook */}
          <div className="docs-nav-group">
            <span className="docs-nav-group-title">{ui.docs.catWebhook}</span>
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

          {/* 5. Safety */}
          <div className="docs-nav-group">
            <span className="docs-nav-group-title">{ui.docs.catSafety}</span>
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

      {/* Content Pane */}
      <main className="docs-content-pane">
        {isTr ? (
          <DocsContentTr {...contentProps} />
        ) : (
          <DocsContentEn {...contentProps} />
        )}
      </main>
    </div>
  );
};
