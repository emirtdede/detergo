import { APP_VERSION } from "@/lib/app-version";

export type McpIdeKey =
  | "cursor"
  | "windsurf"
  | "claude-code"
  | "antigravity"
  | "opencode"
  | "codex"
  | "t3code"
  | "bionic"
  | "ollama"
  | "claude"
  | "vscode-cline"
  | "vscode-roo"
  | "jetbrains"
  | "zed";

export interface McpConfigItem {
  id: McpIdeKey;
  name: string;
  category: "agents-tab" | "other";
  tag: string;
  file: string;
  json: string;
  /**
   * Config syntax of `json`. Codex and a few CLIs read TOML, so the docs must
   * not hand them a JSON body for a `.toml` file.
   */
  syntax?: "json" | "toml";
}

export const mcpConfigList: McpConfigItem[] = [
  // 1. Tools in the AI Tools tab (Agents Tab Tools)
  {
    id: "cursor",
    name: "Cursor",
    category: "agents-tab",
    tag: "AI IDE",
    file: "%USERPROFILE%\\.cursor\\mcp.json",
    json: JSON.stringify(
      {
        mcpServers: {
          "dev-cleaner": {
            command: "dev-cleaner",
            args: ["mcp"],
          },
        },
      },
      null,
      2
    ),
  },
  {
    id: "windsurf",
    name: "Windsurf",
    category: "agents-tab",
    tag: "AI IDE",
    file: "%USERPROFILE%\\.codeium\\windsurf\\mcp_config.json",
    json: JSON.stringify(
      {
        mcpServers: {
          "dev-cleaner": {
            command: "dev-cleaner",
            args: ["mcp"],
          },
        },
      },
      null,
      2
    ),
  },
  {
    id: "claude-code",
    name: "Claude Code",
    category: "agents-tab",
    tag: "CLI Agent",
    file: "%USERPROFILE%\\.claude.json",
    json: JSON.stringify(
      {
        mcpServers: {
          "dev-cleaner": {
            command: "dev-cleaner",
            args: ["mcp"],
          },
        },
      },
      null,
      2
    ),
  },
  {
    id: "antigravity",
    name: "Antigravity",
    category: "agents-tab",
    tag: "AI Agent IDE",
    file: "%USERPROFILE%\\.gemini\\antigravity\\mcp_settings.json",
    json: JSON.stringify(
      {
        mcpServers: {
          "dev-cleaner": {
            command: "dev-cleaner",
            args: ["mcp"],
          },
        },
      },
      null,
      2
    ),
  },
  {
    id: "opencode",
    name: "OpenCode",
    category: "agents-tab",
    tag: "AI Agent",
    file: "%USERPROFILE%\\.opencode\\mcp.json",
    json: JSON.stringify(
      {
        mcpServers: {
          "dev-cleaner": {
            command: "dev-cleaner",
            args: ["mcp"],
          },
        },
      },
      null,
      2
    ),
  },
  {
    id: "codex",
    name: "Codex",
    category: "agents-tab",
    tag: "AI CLI",
    file: "%USERPROFILE%\\.codex\\config.toml",
    // Codex reads TOML, not JSON: a JSON body in config.toml is ignored.
    syntax: "toml",
    json: ['[mcp_servers.dev-cleaner]', 'command = "dev-cleaner"', 'args = ["mcp"]'].join("\n"),
  },
  {
    id: "t3code",
    name: "T3 Code",
    category: "agents-tab",
    tag: "AI IDE",
    file: "%APPDATA%\\t3code\\mcp.json",
    json: JSON.stringify(
      {
        mcpServers: {
          "dev-cleaner": {
            command: "dev-cleaner",
            args: ["mcp"],
          },
        },
      },
      null,
      2
    ),
  },
  {
    id: "bionic",
    name: "Bionic",
    category: "agents-tab",
    tag: "AI Agent",
    file: "%APPDATA%\\bionic\\mcp.json",
    json: JSON.stringify(
      {
        mcpServers: {
          "dev-cleaner": {
            command: "dev-cleaner",
            args: ["mcp"],
          },
        },
      },
      null,
      2
    ),
  },
  {
    id: "ollama",
    name: "Ollama",
    category: "agents-tab",
    tag: "Local LLM",
    file: "%USERPROFILE%\\.ollama\\mcp.json",
    json: JSON.stringify(
      {
        mcpServers: {
          "dev-cleaner": {
            command: "dev-cleaner",
            args: ["mcp"],
          },
        },
      },
      null,
      2
    ),
  },

  // 2. Other development environments & extensions
  {
    id: "claude",
    name: "Claude Desktop",
    category: "other",
    tag: "Desktop App",
    file: "%APPDATA%\\Claude\\claude_desktop_config.json",
    json: JSON.stringify(
      {
        mcpServers: {
          "dev-cleaner": {
            command: "dev-cleaner",
            args: ["mcp"],
          },
        },
      },
      null,
      2
    ),
  },
  {
    id: "vscode-cline",
    name: "VS Code (Cline)",
    category: "other",
    tag: "Extension",
    file: "%APPDATA%\\Code\\User\\globalStorage\\saoudrizwan.claude-dev\\settings\\cline_mcp_settings.json",
    json: JSON.stringify(
      {
        mcpServers: {
          "dev-cleaner": {
            command: "dev-cleaner",
            args: ["mcp"],
          },
        },
      },
      null,
      2
    ),
  },
  {
    id: "vscode-roo",
    name: "VS Code (Roo Code)",
    category: "other",
    tag: "Extension",
    file: "%APPDATA%\\Code\\User\\globalStorage\\rooveterinaryinc.roo-cline\\settings\\cline_mcp_settings.json",
    json: JSON.stringify(
      {
        mcpServers: {
          "dev-cleaner": {
            command: "dev-cleaner",
            args: ["mcp"],
          },
        },
      },
      null,
      2
    ),
  },
  {
    id: "jetbrains",
    name: "JetBrains / Continue",
    category: "other",
    tag: "Plugin",
    file: "%USERPROFILE%\\.continue\\config.json",
    json: JSON.stringify(
      {
        mcpServers: [
          {
            name: "dev-cleaner",
            command: "dev-cleaner",
            args: ["mcp"],
          },
        ],
      },
      null,
      2
    ),
  },
  {
    id: "zed",
    name: "Zed Editor",
    category: "other",
    tag: "Editor",
    file: "%APPDATA%\\Zed\\settings.json",
    json: JSON.stringify(
      {
        context_servers: [
          {
            id: "dev-cleaner",
            command: {
              path: "dev-cleaner",
              args: ["mcp"],
            },
          },
        ],
      },
      null,
      2
    ),
  },
];

export const mcpConfigs: Record<
  McpIdeKey,
  { file: string; json: string; syntax: "json" | "toml" }
> = mcpConfigList.reduce(
  (acc, item) => {
    acc[item.id] = { file: item.file, json: item.json, syntax: item.syntax ?? "json" };
    return acc;
  },
  {} as Record<McpIdeKey, { file: string; json: string; syntax: "json" | "toml" }>
);

/**
 * The documented webhook body.
 *
 * It mirrors `WebhookPayload` in `src-tauri/src/cli/mod.rs` — the struct the
 * backend actually serialises — plus the envelope the GUI events are
 * canonicalised into. Fields that only exist in one of the two producers
 * (`scan_id`, `duration_ms`, `stop_reason`, `plan_id`, `success_count`,
 * `reclaim_bytes`) are documented in the surrounding text rather than invented
 * here: a sample that shows a field the backend never sends is worse than no
 * sample at all.
 */
export const webhookSampleJson = JSON.stringify(
  {
    event: "clean",
    timestamp: "2026-11-17T02:30:00Z",
    product: "Dev Cleaner by Vellium",
    version: APP_VERSION,
    scope: "projects",
    target_count: 24,
    total_bytes: 45678901234,
    total_human: "42.54 GB",
    status: "success",
    cleaned_count: 24,
    cleaned_bytes: 45678901234,
    dry_run: false,
  },
  null,
  2
);
