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
} from "lucide-react";

export interface DocTopic {
  id: string;
  title: string;
  category: "guide" | "cli" | "mcp" | "webhook" | "safety";
  icon: React.ReactNode;
  keywords?: string[];
}

export function getDocsTopics(isTr: boolean): DocTopic[] {
  return [
    // 1. Rehberler / Guides
    {
      id: "quickstart",
      title: isTr ? "Hızlı Başlangıç & Mimari" : "Quickstart & Architecture",
      category: "guide",
      icon: <Sparkles size={14} />,
      keywords: ["quickstart", "start", "hızlı", "başlangıç", "dry-run", "mode"],
    },
    {
      id: "manifesto",
      title: isTr ? "Sıfır Veri Kaybı Garantisi" : "Zero Data Loss Guarantee",
      category: "guide",
      icon: <ShieldCheck size={14} />,
      keywords: ["recycle", "bin", "manifesto", "güvenlik", "veri", "kaybı", "safety"],
    },
    {
      id: "recovery-guide",
      title: isTr ? "Veri Kurtarma & Geri Yükleme" : "Data Recovery & Restoration",
      category: "guide",
      icon: <Undo2 size={14} />,
      keywords: ["restore", "recovery", "kurtarma", "geri", "yükle", "trash"],
    },
    {
      id: "faq",
      title: isTr ? "Sıkça Sorulan Sorular (FAQ)" : "Frequently Asked Questions (FAQ)",
      category: "guide",
      icon: <HelpCircle size={14} />,
      keywords: ["faq", "sorular", "cevaplar", "questions", "node_modules", "target"],
    },

    // 2. Terminal & CLI
    {
      id: "cli-guide",
      title: isTr ? "Terminal CLI Komutları" : "Terminal CLI Commands",
      category: "cli",
      icon: <Terminal size={14} />,
      keywords: ["terminal", "cli", "scan", "caches", "history", "komut", "satırı"],
    },
    {
      id: "cli-builder",
      title: isTr ? "İnteraktif Komut Oluşturucu" : "Interactive Command Builder",
      category: "cli",
      icon: <Sliders size={14} />,
      keywords: ["builder", "interactive", "oluşturucu", "filtre", "command"],
    },
    {
      id: "cli-headless",
      title: isTr ? "Headless & CI/CD Pipeline" : "Headless & CI/CD Pipelines",
      category: "cli",
      icon: <Layers size={14} />,
      keywords: ["headless", "cron", "ci", "cd", "pipeline", "scheduler", "task"],
    },

    // 3. AI & MCP
    {
      id: "mcp-overview",
      title: isTr ? "Model Context Protocol (MCP)" : "Model Context Protocol (MCP)",
      category: "mcp",
      icon: <Cpu size={14} />,
      keywords: ["mcp", "ai", "model", "context", "protocol", "cursor", "claude"],
    },
    {
      id: "mcp-ide-setup",
      title: isTr ? "Çoklu IDE Konfigürasyonu" : "Multi-IDE Configuration",
      category: "mcp",
      icon: <FileCode2 size={14} />,
      keywords: ["ide", "setup", "config", "cursor", "windsurf", "claude", "antigravity"],
    },
    {
      id: "mcp-prompts",
      title: isTr ? "AI Ajan Hazır İstemleri" : "AI Agent System Prompts",
      category: "mcp",
      icon: <Bot size={14} />,
      keywords: ["prompt", "istem", "templates", "ai", "cursor", "claude", "automation"],
    },
    {
      id: "mcp-tools",
      title: isTr ? "MCP Araçları Referansı" : "MCP Tools Reference",
      category: "mcp",
      icon: <BookOpen size={14} />,
      keywords: ["tools", "reference", "devcleaner_scan_workspace", "devcleaner_clean_safe"],
    },

    // 4. Webhook
    {
      id: "webhook-guide",
      title: isTr ? "Evrensel Webhook Mimarisi" : "Universal Webhook Architecture",
      category: "webhook",
      icon: <Webhook size={14} />,
      keywords: ["webhook", "automation", "n8n", "post", "http", "notifications"],
    },
    {
      id: "webhook-schema",
      title: isTr ? "JSON Payload Şeması" : "JSON Payload Schema",
      category: "webhook",
      icon: <ExternalLink size={14} />,
      keywords: ["schema", "json", "payload", "example", "status", "şema"],
    },

    // 5. Güvenlik & Destek / Safety
    {
      id: "safety-architecture",
      title: isTr ? "TOCTOU & Süreç Kilidi Koruması" : "TOCTOU & Process Lock Protection",
      category: "safety",
      icon: <Lock size={14} />,
      keywords: ["toctou", "junction", "symlink", "lock", "process", "backoff", "güvenlik"],
    },
    {
      id: "troubleshooting",
      title: isTr ? "Sorun Giderme & Hata Matrisi" : "Troubleshooting & Error Matrix",
      category: "safety",
      icon: <Wrench size={14} />,
      keywords: ["troubleshooting", "error", "matrix", "hata", "sorun", "target_active"],
    },
  ];
}
