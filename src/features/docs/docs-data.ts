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

export const mcpConfigs: Record<McpIdeKey, { file: string; json: string }> = mcpConfigList.reduce(
  (acc, item) => {
    acc[item.id] = { file: item.file, json: item.json };
    return acc;
  },
  {} as Record<McpIdeKey, { file: string; json: string }>
);

export const webhookSampleJson = JSON.stringify(
  {
    event: "cleanup_completed",
    timestamp: "2026-11-06T02:30:00Z",
    product: "Dev Cleaner by Vellium",
    version: "2.2.1",
    scope: "projects",
    target_count: 24,
    total_bytes: 45678901234,
    total_human: "42.54 GB",
    status: "success",
    cleaned_count: 24,
    cleaned_bytes: 45678901234,
    cleaned_human: "42.54 GB",
    dry_run: false,
  },
  null,
  2
);
