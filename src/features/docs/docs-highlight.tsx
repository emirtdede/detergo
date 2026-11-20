import React from "react";
import { CliEnvironmentStatus } from "@/types";
import { McpIdeKey } from "./docs-data";

export function highlightBash(code: string): React.ReactNode[] {
  const lines = code.split("\n");
  return lines.map((line, lIdx) => {
    if (
      line.trim().startsWith("#") ||
      line.trim().startsWith("//") ||
      line.trim().startsWith("REM")
    ) {
      return (
        <span key={lIdx} className="tok-comment">
          {line}
          {lIdx < lines.length - 1 ? "\n" : ""}
        </span>
      );
    }
    const regex =
      /(--[a-zA-Z0-9_-]+|\/[a-zA-Z0-9:_-]+|-[a-zA-Z0-9]+|"[^"]*"|'[^']*'|\b(?:dev-cleaner|cleanmgr|DISM\.exe|del|npm|nvm|pip|cargo|docker|powershell|git|New-ScheduledTaskAction|Register-ScheduledTask)\b|\d+)/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push(line.substring(lastIndex, match.index));
      }
      const tok = match[0];
      if (tok.startsWith("-")) {
        parts.push(
          <span key={`${lIdx}-${match.index}`} className="tok-flag">
            {tok}
          </span>,
        );
      } else if (tok.startsWith('"') || tok.startsWith("'")) {
        parts.push(
          <span key={`${lIdx}-${match.index}`} className="tok-str">
            {tok}
          </span>,
        );
      } else if (/^\d+$/.test(tok)) {
        parts.push(
          <span key={`${lIdx}-${match.index}`} className="tok-num">
            {tok}
          </span>,
        );
      } else {
        parts.push(
          <span key={`${lIdx}-${match.index}`} className="tok-cmd">
            {tok}
          </span>,
        );
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

export function highlightJson(code: string): React.ReactNode[] {
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
        parts.push(
          <span key={`${lIdx}-${match.index}`} className="tok-key">
            {full}
          </span>,
        );
      } else if (full.startsWith('"')) {
        parts.push(
          <span key={`${lIdx}-${match.index}`} className="tok-str">
            {full}
          </span>,
        );
      } else if (/^\d+$/.test(full)) {
        parts.push(
          <span key={`${lIdx}-${match.index}`} className="tok-num">
            {full}
          </span>,
        );
      } else {
        parts.push(
          <span key={`${lIdx}-${match.index}`} className="tok-bool">
            {full}
          </span>,
        );
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
  cliEnv?: CliEnvironmentStatus | null;
  cliPathBusy?: boolean;
  onRegisterCliPath?: () => void;
  mcpCommand?: string;
}
