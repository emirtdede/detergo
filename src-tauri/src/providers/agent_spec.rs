use crate::catalog::model::{CleanupMethod, SafetyClass};

/// A single storage target inside an agent root.
#[derive(Debug, Clone, Copy)]
pub struct AgentTargetSpec {
    pub rel: &'static str,
    pub rule_id: &'static str,
    pub category: &'static str,
    pub safety: SafetyClass,
    pub cleanup: CleanupMethod,
    pub protected: bool,
    pub requires_idle: bool,
    pub note: Option<&'static str>,
}

const fn keep(
    rel: &'static str,
    rule_id: &'static str,
    category: &'static str,
    note: Option<&'static str>,
) -> AgentTargetSpec {
    AgentTargetSpec {
        rel,
        rule_id,
        category,
        safety: SafetyClass::Keep,
        cleanup: CleanupMethod::None,
        protected: true,
        requires_idle: false,
        note,
    }
}

const fn review(
    rel: &'static str,
    rule_id: &'static str,
    category: &'static str,
    note: Option<&'static str>,
) -> AgentTargetSpec {
    AgentTargetSpec {
        rel,
        rule_id,
        category,
        safety: SafetyClass::Review,
        cleanup: CleanupMethod::Trash,
        protected: false,
        requires_idle: false,
        note,
    }
}

const fn safe(rel: &'static str, rule_id: &'static str, category: &'static str) -> AgentTargetSpec {
    AgentTargetSpec {
        rel,
        rule_id,
        category,
        safety: SafetyClass::Safe,
        cleanup: CleanupMethod::Trash,
        protected: false,
        requires_idle: false,
        note: None,
    }
}

pub const CODEX_TARGETS: &[AgentTargetSpec] = &[
    keep(
        "sessions",
        "codex.sessions",
        "sessions",
        Some("Conversation history; must be managed from within Codex."),
    ),
    keep(
        "archived_sessions",
        "codex.archived_sessions",
        "sessions",
        Some("Archived sessions; managed via official commands."),
    ),
    keep(
        "worktrees",
        "codex.worktrees",
        "worktrees",
        Some("Git worktrees; cannot be removed directly from the file system."),
    ),
    review(
        "log",
        "codex.logs",
        "diagnostics",
        Some("Diagnostic logs; safe to review and clean when Codex is idle."),
    ),
    keep(
        "logs_2.sqlite",
        "codex.log_db",
        "diagnostics",
        Some("SQLite diagnostic database; preserved alongside WAL/SHM files."),
    ),
    keep("skills", "codex.skills", "configuration", None),
    keep("memories", "codex.memories", "memory", None),
    keep("config.toml", "codex.config", "configuration", None),
    keep("auth.json", "codex.auth", "credentials", None),
];

pub const CLAUDE_HOME_TARGETS: &[AgentTargetSpec] = &[
    keep(
        "projects",
        "claude.projects",
        "conversations",
        Some("Project conversations; preserved by default."),
    ),
    keep(
        "file-history",
        "claude.file_history",
        "checkpoints",
        Some("Checkpoint rewind data; never deleted automatically."),
    ),
    keep("settings.json", "claude.settings", "configuration", None),
    keep("plans", "claude.plans", "plans", None),
    keep("plugins", "claude.plugins", "configuration", None),
    keep("skills", "claude.skills", "configuration", None),
    keep("todos", "claude.todos", "conversations", None),
    review("debug", "claude.debug", "diagnostics", Some("Debug logs.")),
    review("shell-snapshots", "claude.shell_snapshots", "cache", None),
    review("statsig", "claude.statsig", "cache", None),
    review(
        "tasks",
        "claude.tasks",
        "task-output",
        Some("Task outputs can grow large; cannot be deleted if an active task exists."),
    ),
    safe("image-cache", "claude.image_cache", "cache"),
    safe("paste-cache", "claude.paste_cache", "cache"),
];

pub const CLAUDE_TEMP_TARGETS: &[AgentTargetSpec] = &[
    review(
        "tasks",
        "claude.temp_tasks",
        "task-output",
        Some("Temporary task outputs."),
    ),
    review("shell-snapshots", "claude.temp_shell", "cache", None),
];

pub const ANTIGRAVITY_DATA_TARGETS: &[AgentTargetSpec] = &[
    keep(
        "brain",
        "antigravity.brain",
        "brain",
        Some("Agent memory and artifacts; preserved by default."),
    ),
    keep(
        "conversations",
        "antigravity.conversations",
        "conversations",
        None,
    ),
    keep("backups", "antigravity.backups", "backups", None),
    AgentTargetSpec {
        rel: "browser_recordings",
        rule_id: "antigravity.browser_recordings",
        category: "browser-recordings",
        safety: SafetyClass::Review,
        cleanup: CleanupMethod::Trash,
        protected: false,
        requires_idle: true,
        note: Some(
            "Browser recordings can grow large; can only be cleaned when recording has stopped.",
        ),
    },
    keep(
        "skills",
        "antigravity.skills",
        "configuration",
        Some("User-installed agent skills; preserved by default."),
    ),
];

pub const ANTIGRAVITY_BACKUP_TARGETS: &[AgentTargetSpec] = &[
    keep(
        "brain",
        "antigravity.backup_brain",
        "backups",
        Some("Backup brain data is preserved."),
    ),
    keep(
        "conversations",
        "antigravity.backup_conversations",
        "backups",
        None,
    ),
];

pub const ANTIGRAVITY_APP_TARGETS: &[AgentTargetSpec] = &[
    keep(
        "User",
        "antigravity.user_data",
        "configuration",
        Some("User settings and workspace data."),
    ),
    keep(
        "Local State",
        "antigravity.local_state",
        "configuration",
        None,
    ),
    safe("Cache", "antigravity.app_cache", "cache"),
    safe("Code Cache", "antigravity.app_code_cache", "cache"),
    safe("GPUCache", "antigravity.app_gpu_cache", "cache"),
    safe("CachedData", "antigravity.app_cached_data", "cache"),
    safe(
        "DawnGraphiteCache",
        "antigravity.app_graphite_cache",
        "cache",
    ),
    safe("DawnWebGPUCache", "antigravity.app_webgpu_cache", "cache"),
    review("Crashpad", "antigravity.app_crashpad", "diagnostics", None),
    review("logs", "antigravity.app_logs", "diagnostics", None),
];

pub const ANTIGRAVITY_LOCAL_TARGETS: &[AgentTargetSpec] = &[
    keep("User", "antigravity.local_user", "configuration", None),
    review("Cache", "antigravity.chromium_cache", "cache", None),
    review("Code Cache", "antigravity.code_cache", "cache", None),
    review("GPUCache", "antigravity.gpu_cache", "cache", None),
    review("CachedData", "antigravity.cached_data", "cache", None),
];

pub const OPENCODE_CONFIG_TARGETS: &[AgentTargetSpec] = &[
    keep(
        "opencode.json",
        "opencode.config",
        "configuration",
        Some("User settings and API keys."),
    ),
    keep(
        "opencode.jsonc",
        "opencode.config_jsonc",
        "configuration",
        Some("User settings."),
    ),
    keep("tui.json", "opencode.tui_config", "configuration", None),
];

pub const OPENCODE_SHARE_TARGETS: &[AgentTargetSpec] = &[
    keep(
        "opencode.db",
        "opencode.db",
        "sessions",
        Some("Session and message history database; preserved."),
    ),
    keep("opencode.db-wal", "opencode.db_wal", "sessions", None),
    keep("opencode.db-shm", "opencode.db_shm", "sessions", None),
    review(
        "log",
        "opencode.logs",
        "diagnostics",
        Some("Diagnostic logs."),
    ),
    review(
        "shell",
        "opencode.shell",
        "cache",
        Some("Shell execution snapshots."),
    ),
    review(
        "snapshot",
        "opencode.snapshot",
        "cache",
        Some("Code snapshots."),
    ),
    review(
        "tool-output",
        "opencode.tool_output",
        "task-output",
        Some("Large tool and task outputs; can be cleaned."),
    ),
    review(
        "repos",
        "opencode.repos",
        "cache",
        Some("Cached repository clones."),
    ),
];

pub const OPENCODE_APP_TARGETS: &[AgentTargetSpec] = &[
    keep(
        "drafts.sqlite",
        "opencode.drafts",
        "sessions",
        Some("Drafts are preserved."),
    ),
    safe("Cache", "opencode.cache", "cache"),
    safe("Code Cache", "opencode.code_cache", "cache"),
    safe("GPUCache", "opencode.gpu_cache", "cache"),
    safe("DawnGraphiteCache", "opencode.graphite_cache", "cache"),
    safe("DawnWebGPUCache", "opencode.webgpu_cache", "cache"),
    safe("compile-cache", "opencode.compile_cache", "cache"),
    review("Crashpad", "opencode.crashpad", "diagnostics", None),
];

pub const OPENCODE_UPDATER_TARGETS: &[AgentTargetSpec] =
    &[safe("pending", "opencode.updater_pending", "cache")];

pub const T3CODE_APP_TARGETS: &[AgentTargetSpec] = &[
    keep(
        "Local Storage",
        "t3code.local_storage",
        "configuration",
        Some("User preferences and session connections."),
    ),
    keep(
        "IndexedDB",
        "t3code.indexed_db",
        "sessions",
        Some("Session and thread history."),
    ),
    safe("Cache", "t3code.cache", "cache"),
    safe("Code Cache", "t3code.code_cache", "cache"),
    safe("GPUCache", "t3code.gpu_cache", "cache"),
    safe("GPUPersistentCache", "t3code.gpu_persistent", "cache"),
    safe("GrShaderCache", "t3code.gr_shader", "cache"),
    safe("DawnGraphiteCache", "t3code.graphite_cache", "cache"),
    safe("DawnWebGPUCache", "t3code.webgpu_cache", "cache"),
];

pub const T3CODE_UPDATER_TARGETS: &[AgentTargetSpec] =
    &[safe("pending", "t3code.updater_pending", "cache")];

pub const BIONIC_APP_TARGETS: &[AgentTargetSpec] = &[
    keep(
        "Preferences",
        "bionic.preferences",
        "configuration",
        Some("User configuration and settings."),
    ),
    keep(
        "Local Storage",
        "bionic.local_storage",
        "configuration",
        None,
    ),
    keep("Network", "bionic.network", "configuration", None),
    safe("Cache", "bionic.cache", "cache"),
    safe("Code Cache", "bionic.code_cache", "cache"),
    review("Crashpad", "bionic.crashpad", "diagnostics", None),
    review("logs", "bionic.logs", "diagnostics", None),
];

pub const CURSOR_USER_TARGETS: &[AgentTargetSpec] = &[
    keep(
        "rules",
        "cursor.rules",
        "configuration",
        Some("User and project AI rules."),
    ),
    keep("tunnels", "cursor.tunnels", "configuration", None),
    review(
        "projects",
        "cursor.projects_cache",
        "cache",
        Some("Project context caches."),
    ),
    review("logs", "cursor.user_logs", "diagnostics", None),
];

pub const CURSOR_APP_TARGETS: &[AgentTargetSpec] = &[
    keep(
        "User",
        "cursor.user_settings",
        "configuration",
        Some("User settings, keybindings, and extensions."),
    ),
    keep(
        "User/workspaceStorage",
        "cursor.workspace_storage",
        "sessions",
        Some("Workspace sessions and chat histories."),
    ),
    safe("Cache", "cursor.cache", "cache"),
    safe("Code Cache", "cursor.code_cache", "cache"),
    safe("GPUCache", "cursor.gpu_cache", "cache"),
    safe("CachedData", "cursor.cached_data", "cache"),
    safe("CachedExtensionVSIXs", "cursor.cached_vsix", "cache"),
    safe("CachedProfilesData", "cursor.cached_profiles", "cache"),
    safe("DawnGraphiteCache", "cursor.graphite_cache", "cache"),
    safe("DawnWebGPUCache", "cursor.webgpu_cache", "cache"),
    review("Crashpad", "cursor.crashpad", "diagnostics", None),
    review("logs", "cursor.app_logs", "diagnostics", None),
];

pub const WINDSURF_CODEIUM_TARGETS: &[AgentTargetSpec] = &[
    keep(
        "cascade",
        "windsurf.cascade_history",
        "sessions",
        Some("Cascade chat history and conversation memory."),
    ),
    review("logs", "windsurf.codeium_logs", "diagnostics", None),
];

pub const WINDSURF_USER_TARGETS: &[AgentTargetSpec] = &[keep(
    "extensions",
    "windsurf.extensions",
    "configuration",
    None,
)];

pub const WINDSURF_APP_TARGETS: &[AgentTargetSpec] = &[
    keep(
        "User",
        "windsurf.user_settings",
        "configuration",
        Some("User settings and workspace data."),
    ),
    keep(
        "User/workspaceStorage",
        "windsurf.workspace_storage",
        "sessions",
        Some("Workspace sessions and chat histories."),
    ),
    safe("Cache", "windsurf.cache", "cache"),
    safe("Code Cache", "windsurf.code_cache", "cache"),
    safe("GPUCache", "windsurf.gpu_cache", "cache"),
    safe("CachedData", "windsurf.cached_data", "cache"),
    safe("CachedExtensionVSIXs", "windsurf.cached_vsix", "cache"),
    safe("CachedProfilesData", "windsurf.cached_profiles", "cache"),
    safe("DawnGraphiteCache", "windsurf.graphite_cache", "cache"),
    safe("DawnWebGPUCache", "windsurf.webgpu_cache", "cache"),
    review("Crashpad", "windsurf.crashpad", "diagnostics", None),
    review("logs", "windsurf.app_logs", "diagnostics", None),
];

pub const OLLAMA_USER_TARGETS: &[AgentTargetSpec] = &[
    keep(
        "models",
        "ollama.models",
        "models",
        Some("Downloaded local AI model weights and manifests."),
    ),
    keep("id_ed25519", "ollama.key", "credentials", None),
    keep("id_ed25519.pub", "ollama.pubkey", "credentials", None),
];

pub const OLLAMA_LOCAL_TARGETS: &[AgentTargetSpec] = &[
    review(
        "server.log",
        "ollama.server_log",
        "diagnostics",
        Some("Server log file."),
    ),
    review("logs", "ollama.logs", "diagnostics", None),
    safe("temp", "ollama.temp", "cache"),
    safe("updates", "ollama.updates", "cache"),
];

pub const CLAUDE_DESKTOP_APP_TARGETS: &[AgentTargetSpec] = &[
    keep(
        "claude_desktop_config.json",
        "claude_desktop.config",
        "configuration",
        Some("MCP servers and desktop preferences."),
    ),
    keep(
        "Local Storage",
        "claude_desktop.local_storage",
        "configuration",
        None,
    ),
    keep("IndexedDB", "claude_desktop.indexed_db", "sessions", None),
    keep("Network", "claude_desktop.network", "credentials", None),
    safe("Cache", "claude_desktop.cache", "cache"),
    safe("Code Cache", "claude_desktop.code_cache", "cache"),
    safe("GPUCache", "claude_desktop.gpu_cache", "cache"),
    safe(
        "DawnGraphiteCache",
        "claude_desktop.graphite_cache",
        "cache",
    ),
    safe("DawnWebGPUCache", "claude_desktop.webgpu_cache", "cache"),
    review("Crashpad", "claude_desktop.crashpad", "diagnostics", None),
    review("logs", "claude_desktop.logs", "diagnostics", None),
];

pub const COPILOT_TARGETS: &[AgentTargetSpec] = &[
    keep("hosts.json", "copilot.hosts", "credentials", None),
    keep("apps.json", "copilot.apps", "credentials", None),
    keep("config.json", "copilot.config", "configuration", None),
    keep("versions.json", "copilot.versions", "configuration", None),
    review("logs", "copilot.logs", "diagnostics", None),
    safe("cache", "copilot.cache", "cache"),
];

pub const CLINE_TARGETS: &[AgentTargetSpec] = &[
    keep(
        "tasks",
        "cline.tasks",
        "conversations",
        Some("Cline task history and conversation logs."),
    ),
    keep("settings", "cline.settings", "configuration", None),
    keep("checkpoints", "cline.checkpoints", "checkpoints", None),
    review("cache", "cline.cache", "cache", None),
    review(
        "puppeteer",
        "cline.puppeteer",
        "cache",
        Some("Downloaded Chromium browser for headless tool use."),
    ),
];

pub const ROO_CODE_TARGETS: &[AgentTargetSpec] = &[
    keep(
        "tasks",
        "roo_code.tasks",
        "conversations",
        Some("Roo Code task history and conversation logs."),
    ),
    keep("settings", "roo_code.settings", "configuration", None),
    keep("checkpoints", "roo_code.checkpoints", "checkpoints", None),
    review("cache", "roo_code.cache", "cache", None),
    review(
        "puppeteer",
        "roo_code.puppeteer",
        "cache",
        Some("Downloaded Chromium browser for headless tool use."),
    ),
];

pub const AIDER_TARGETS: &[AgentTargetSpec] = &[
    keep("config", "aider.config", "configuration", None),
    review("caches", "aider.caches", "cache", None),
    review("logs", "aider.logs", "diagnostics", None),
    safe("repomap.cache.v1", "aider.repomap_cache", "cache"),
];

pub const CONTINUE_TARGETS: &[AgentTargetSpec] = &[
    keep("config.json", "continue.config_json", "configuration", None),
    keep("config.yaml", "continue.config_yaml", "configuration", None),
    keep("sessions", "continue.sessions", "sessions", None),
    safe("index", "continue.index", "cache"),
    review("dev_data", "continue.dev_data", "diagnostics", None),
    review("logs", "continue.logs", "diagnostics", None),
];

pub const ZED_TARGETS: &[AgentTargetSpec] = &[
    keep(
        "db",
        "zed.db",
        "sessions",
        Some("Workspace and thread databases."),
    ),
    keep("conversations", "zed.conversations", "conversations", None),
    keep("prompts", "zed.prompts", "configuration", None),
    keep("extensions", "zed.extensions", "configuration", None),
    review(
        "languages",
        "zed.languages",
        "cache",
        Some("Auto-downloaded language servers."),
    ),
    review("copilot", "zed.copilot", "cache", None),
    review("supermaven", "zed.supermaven", "cache", None),
    review(
        "node",
        "zed.node",
        "cache",
        Some("Managed Node runtime for extensions."),
    ),
    review("logs", "zed.logs", "diagnostics", None),
];

pub const LM_STUDIO_TARGETS: &[AgentTargetSpec] = &[
    keep(
        "models",
        "lm_studio.models",
        "models",
        Some("Downloaded GGUF/MLX local model weights; preserved read-only."),
    ),
    keep(
        "conversations",
        "lm_studio.conversations",
        "conversations",
        None,
    ),
    keep("settings.json", "lm_studio.settings", "configuration", None),
    keep("credentials", "lm_studio.credentials", "credentials", None),
    keep("extensions", "lm_studio.extensions", "configuration", None),
    safe("temp", "lm_studio.temp", "cache"),
    safe("updates", "lm_studio.updates", "cache"),
    review("logs", "lm_studio.logs", "diagnostics", None),
    review("server-logs", "lm_studio.server_logs", "diagnostics", None),
];

pub fn specs_for(kind: &str) -> &'static [AgentTargetSpec] {
    match kind {
        "codex-home" => CODEX_TARGETS,
        "claude-home" => CLAUDE_HOME_TARGETS,
        "claude-temp" => CLAUDE_TEMP_TARGETS,
        "antigravity-data" => ANTIGRAVITY_DATA_TARGETS,
        "antigravity-backup" => ANTIGRAVITY_BACKUP_TARGETS,
        "antigravity-app" => ANTIGRAVITY_APP_TARGETS,
        "antigravity-local" => ANTIGRAVITY_LOCAL_TARGETS,
        "opencode-config" => OPENCODE_CONFIG_TARGETS,
        "opencode-share" => OPENCODE_SHARE_TARGETS,
        "opencode-app" => OPENCODE_APP_TARGETS,
        "opencode-updater" => OPENCODE_UPDATER_TARGETS,
        "t3code-app" => T3CODE_APP_TARGETS,
        "t3code-updater" => T3CODE_UPDATER_TARGETS,
        "bionic-app" => BIONIC_APP_TARGETS,
        "cursor-user" => CURSOR_USER_TARGETS,
        "cursor-app" => CURSOR_APP_TARGETS,
        "windsurf-codeium" => WINDSURF_CODEIUM_TARGETS,
        "windsurf-user" => WINDSURF_USER_TARGETS,
        "windsurf-app" => WINDSURF_APP_TARGETS,
        "ollama-user" => OLLAMA_USER_TARGETS,
        "ollama-local" => OLLAMA_LOCAL_TARGETS,
        "claude-desktop-app" => CLAUDE_DESKTOP_APP_TARGETS,
        "copilot" => COPILOT_TARGETS,
        "cline" => CLINE_TARGETS,
        "roo-code" => ROO_CODE_TARGETS,
        "aider" => AIDER_TARGETS,
        "continue" => CONTINUE_TARGETS,
        "zed" => ZED_TARGETS,
        "lm-studio" => LM_STUDIO_TARGETS,
        _ => &[],
    }
}

/// Single authoritative catalog of built-in AI providers (`(id, display_name, default_note)`).
pub const BUILTIN_PROVIDER_CATALOG: &[(&str, &str, Option<&str>)] = &[
    (
        "codex",
        "OpenAI Codex",
        Some("Sessions, worktrees, and SQLite diagnostics are preserved; plain text diagnostic logs can be reviewed when idle."),
    ),
    (
        "claude-code",
        "Claude Code",
        Some("Conversations and file-history are preserved; only verified cache and task outputs can be cleaned."),
    ),
    (
        "claude-desktop",
        "Claude Desktop",
        Some("MCP config, conversations, and credentials are preserved; Chromium/Electron caches and logs can be cleaned."),
    ),
    (
        "antigravity",
        "Google Antigravity",
        Some("Brain, skills, and conversations are preserved; browser recordings and Electron caches can be cleaned when idle."),
    ),
    (
        "opencode",
        "OpenCode",
        Some("Configuration and opencode.db are preserved; task outputs, logs, and build caches can be cleaned."),
    ),
    (
        "t3code",
        "T3 Code",
        Some("User profile is preserved; GPU/Code Cache and obsolete installer remnants can be cleaned."),
    ),
    (
        "bionic",
        "Bionic",
        Some("User settings are preserved; temporary Web/Code Cache and log files can be cleaned."),
    ),
    (
        "cursor",
        "Cursor",
        Some("Settings and workspace chat history are preserved; GPU, Code Cache, VSIX, and web caches can be cleaned."),
    ),
    (
        "windsurf",
        "Windsurf",
        Some("Cascade chat history and workspace storage are preserved; Electron, VSIX, and GPU caches can be cleaned."),
    ),
    (
        "copilot",
        "GitHub Copilot",
        Some("Credentials and config are preserved; Copilot caches and logs can be cleaned."),
    ),
    (
        "cline",
        "Cline",
        Some("Tasks, settings, and checkpoints are preserved; browser and tool caches can be reviewed."),
    ),
    (
        "roo-code",
        "Roo Code",
        Some("Tasks, settings, and checkpoints are preserved; browser and tool caches can be reviewed."),
    ),
    (
        "aider",
        "Aider",
        Some("Config is preserved; repo-map caches and logs can be cleaned."),
    ),
    (
        "continue",
        "Continue",
        Some("Config and sessions are preserved; index cache and logs can be cleaned."),
    ),
    (
        "zed",
        "Zed",
        Some("Databases, conversations, prompts, and extensions are preserved; language-server and extension runtime caches can be reviewed."),
    ),
    (
        "ollama",
        "Ollama",
        Some("Downloaded local models and identities are preserved read-only; temporary logs and update remnants can be cleaned."),
    ),
    (
        "lm-studio",
        "LM Studio",
        Some("Local GGUF/MLX models, conversations, and credentials are preserved read-only; temp files, updates, and logs can be cleaned."),
    ),
];

pub fn is_builtin_provider(provider: &str) -> bool {
    BUILTIN_PROVIDER_CATALOG
        .iter()
        .any(|(id, _, _)| *id == provider)
}

pub fn provider_display_name(provider: &str) -> &'static str {
    BUILTIN_PROVIDER_CATALOG
        .iter()
        .find(|(id, _, _)| *id == provider)
        .map(|(_, name, _)| *name)
        .unwrap_or("Unknown provider")
}
