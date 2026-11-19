import React from "react";
import {
  Sparkles,
  ShieldCheck,
  Undo2,
  HelpCircle,
  Terminal,
  Sliders,
  Layers,
  Cpu,
  FileCode2,
  Bot,
  BookOpen,
  Webhook,
  ExternalLink,
  Lock,
  Wrench,
  HardDrive,
} from "lucide-react";
import { translateDocs } from "./docs-i18n";

export interface DocTopic {
  id: string;
  title: string;
  category: "guide" | "cli" | "mcp" | "webhook" | "safety";
  icon: React.ReactNode;
  keywords?: string[];
}

export function getDocsTopics(locale = "en"): DocTopic[] {
  const topics: DocTopic[] = [
    // 1. Rehberler / Guides
    {
      id: "quickstart",
      title: "Quickstart & Architecture",
      category: "guide",
      icon: <Sparkles size={14} />,
      keywords: ["quickstart", "start", "hızlı", "başlangıç", "dry-run", "mode"],
    },
    {
      id: "manifesto",
      title: "Zero Data Loss Guarantee",
      category: "guide",
      icon: <ShieldCheck size={14} />,
      keywords: ["recycle", "bin", "manifesto", "güvenlik", "veri", "kaybı", "safety"],
    },
    {
      id: "recovery-guide",
      title: "Data Recovery & Restoration",
      category: "guide",
      icon: <Undo2 size={14} />,
      keywords: ["restore", "recovery", "kurtarma", "geri", "yükle", "trash"],
    },
    {
      id: "faq",
      title: "Frequently Asked Questions (FAQ)",
      category: "guide",
      icon: <HelpCircle size={14} />,
      keywords: ["faq", "sorular", "cevaplar", "questions", "node_modules", "target"],
    },
    {
      id: "system-cleaner",
      title: "C: Drive Cleaner & Scheduled Automation",
      category: "guide",
      icon: <HardDrive size={14} />,
      keywords: ["system", "windows", "temp", "prefetch", "cleanmgr", "dism", "scheduler"],
    },

    // 2. Terminal & CLI
    {
      id: "cli-guide",
      title: "Terminal CLI Commands",
      category: "cli",
      icon: <Terminal size={14} />,
      keywords: ["terminal", "cli", "scan", "caches", "history", "komut", "satırı"],
    },
    {
      id: "cli-builder",
      title: "Interactive Command Builder",
      category: "cli",
      icon: <Sliders size={14} />,
      keywords: ["builder", "interactive", "oluşturucu", "filtre", "command"],
    },
    {
      id: "cli-headless",
      title: "Headless & CI/CD Pipelines",
      category: "cli",
      icon: <Layers size={14} />,
      keywords: ["headless", "cron", "ci", "cd", "pipeline", "scheduler", "task"],
    },

    // 3. AI & MCP
    {
      id: "mcp-overview",
      title: "Model Context Protocol (MCP)",
      category: "mcp",
      icon: <Cpu size={14} />,
      keywords: ["mcp", "ai", "model", "context", "protocol", "cursor", "claude"],
    },
    {
      id: "mcp-ide-setup",
      title: "Multi-IDE Configuration",
      category: "mcp",
      icon: <FileCode2 size={14} />,
      keywords: ["ide", "setup", "config", "cursor", "windsurf", "claude", "antigravity"],
    },
    {
      id: "mcp-prompts",
      title: "AI Agent System Prompts",
      category: "mcp",
      icon: <Bot size={14} />,
      keywords: ["prompt", "istem", "templates", "ai", "cursor", "claude", "automation"],
    },
    {
      id: "mcp-tools",
      title: "MCP Tools Reference",
      category: "mcp",
      icon: <BookOpen size={14} />,
      keywords: ["tools", "reference", "devcleaner_scan_workspace", "devcleaner_clean_safe"],
    },

    // 4. Webhook
    {
      id: "webhook-guide",
      title: "Universal Webhook Architecture",
      category: "webhook",
      icon: <Webhook size={14} />,
      keywords: ["webhook", "automation", "n8n", "post", "http", "notifications"],
    },
    {
      id: "webhook-schema",
      title: "JSON Payload Schema",
      category: "webhook",
      icon: <ExternalLink size={14} />,
      keywords: ["schema", "json", "payload", "example", "status", "şema"],
    },

    // 5. Güvenlik & Destek / Safety
    {
      id: "safety-architecture",
      title: "TOCTOU & Process Lock Protection",
      category: "safety",
      icon: <Lock size={14} />,
      keywords: ["toctou", "junction", "symlink", "lock", "process", "backoff", "güvenlik"],
    },
    {
      id: "troubleshooting",
      title: "Troubleshooting & Error Matrix",
      category: "safety",
      icon: <Wrench size={14} />,
      keywords: ["troubleshooting", "error", "matrix", "hata", "sorun", "target_active"],
    },
  ];

  return topics.map((topic) => ({
    ...topic,
    title: translateDocs(locale, topic.title),
    keywords: topic.keywords?.flatMap((keyword) => [keyword, translateDocs(locale, keyword)]),
  }));
}
