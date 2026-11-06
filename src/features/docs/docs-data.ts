export const mcpConfigs = {
  cursor: {
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
  windsurf: {
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
  claude: {
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
  antigravity: {
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
};

export const webhookSampleJson = JSON.stringify(
  {
    event: "cleanup_completed",
    timestamp: "2026-11-06T02:30:00Z",
    product: "Dev Cleaner by Vellium",
    version: "2.2.0",
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
