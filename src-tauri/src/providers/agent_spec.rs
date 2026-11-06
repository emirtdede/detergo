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
        Some("Konuşma geçmişi; yalnızca Codex içinden yönetilmeli."),
    ),
    keep(
        "archived_sessions",
        "codex.archived_sessions",
        "sessions",
        Some("Arşivlenmiş oturumlar; resmî komutla yönetilir."),
    ),
    keep(
        "worktrees",
        "codex.worktrees",
        "worktrees",
        Some("Git worktree'leri; dosya sistemiyle silinemez."),
    ),
    keep("log", "codex.logs", "diagnostics", Some("Tanılama günlükleri.")),
    keep(
        "logs_2.sqlite",
        "codex.log_db",
        "diagnostics",
        Some("SQLite tanılama veritabanı; WAL/SHM dosyalarıyla birlikte korunur."),
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
        Some("Proje konuşmaları; varsayılan olarak korunur."),
    ),
    keep(
        "file-history",
        "claude.file_history",
        "checkpoints",
        Some("Checkpoint geri alma verisi; asla otomatik silinmez."),
    ),
    keep("settings.json", "claude.settings", "configuration", None),
    keep("plans", "claude.plans", "plans", None),
    keep("plugins", "claude.plugins", "configuration", None),
    keep("skills", "claude.skills", "configuration", None),
    keep("todos", "claude.todos", "conversations", None),
    review("debug", "claude.debug", "diagnostics", Some("Hata ayıklama günlükleri.")),
    review("shell-snapshots", "claude.shell_snapshots", "cache", None),
    review("statsig", "claude.statsig", "cache", None),
    review(
        "tasks",
        "claude.tasks",
        "task-output",
        Some("Görev çıktıları çok büyüyebilir; aktif görev varsa silinemez."),
    ),
    safe("image-cache", "claude.image_cache", "cache"),
    safe("paste-cache", "claude.paste_cache", "cache"),
];

pub const CLAUDE_TEMP_TARGETS: &[AgentTargetSpec] = &[
    review("tasks", "claude.temp_tasks", "task-output", Some("Geçici görev çıktıları.")),
    review("shell-snapshots", "claude.temp_shell", "cache", None),
];

pub const ANTIGRAVITY_DATA_TARGETS: &[AgentTargetSpec] = &[
    keep(
        "brain",
        "antigravity.brain",
        "brain",
        Some("Ajan belleği ve artefaktları; varsayılan olarak korunur."),
    ),
    keep("conversations", "antigravity.conversations", "conversations", None),
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
            "Tarayıcı kayıtları çok büyüyebilir; yalnızca kayıt üretimi durduğunda temizlenebilir.",
        ),
    },
    review("skills", "antigravity.skills", "configuration", None),
];

pub const ANTIGRAVITY_BACKUP_TARGETS: &[AgentTargetSpec] = &[
    keep(
        "brain",
        "antigravity.backup_brain",
        "backups",
        Some("Yedek beyin verisi korunur."),
    ),
    keep("conversations", "antigravity.backup_conversations", "backups", None),
];

pub const ANTIGRAVITY_APP_TARGETS: &[AgentTargetSpec] = &[
    keep(
        "User",
        "antigravity.user_data",
        "configuration",
        Some("Kullanıcı ayarları ve çalışma alanı verisi."),
    ),
    keep("Local State", "antigravity.local_state", "configuration", None),
];

pub const ANTIGRAVITY_LOCAL_TARGETS: &[AgentTargetSpec] = &[
    keep("User", "antigravity.local_user", "configuration", None),
    review("Cache", "antigravity.chromium_cache", "cache", None),
    review("Code Cache", "antigravity.code_cache", "cache", None),
    review("GPUCache", "antigravity.gpu_cache", "cache", None),
    review("CachedData", "antigravity.cached_data", "cache", None),
];

pub const OPENCODE_CONFIG_TARGETS: &[AgentTargetSpec] = &[
    keep("opencode.json", "opencode.config", "configuration", Some("Kullanıcı ayarları ve API anahtarları.")),
    keep("opencode.jsonc", "opencode.config_jsonc", "configuration", Some("Kullanıcı ayarları.")),
    keep("tui.json", "opencode.tui_config", "configuration", None),
];

pub const OPENCODE_SHARE_TARGETS: &[AgentTargetSpec] = &[
    keep("opencode.db", "opencode.db", "sessions", Some("Oturum ve mesaj geçmişi veritabanı; korunur.")),
    keep("opencode.db-wal", "opencode.db_wal", "sessions", None),
    keep("opencode.db-shm", "opencode.db_shm", "sessions", None),
    review("log", "opencode.logs", "diagnostics", Some("Tanılama günlükleri.")),
    review("shell", "opencode.shell", "cache", Some("Shell çalıştırma anlık görüntüleri.")),
    review("snapshot", "opencode.snapshot", "cache", Some("Kod anlık görüntüleri.")),
    review("tool-output", "opencode.tool_output", "task-output", Some("Büyük araç ve görev çıktıları; temizlenebilir.")),
    review("repos", "opencode.repos", "cache", Some("Önbelleğe alınmış depo kopyaları.")),
];

pub const OPENCODE_APP_TARGETS: &[AgentTargetSpec] = &[
    keep("drafts.sqlite", "opencode.drafts", "sessions", Some("Taslaklar korunur.")),
    safe("Cache", "opencode.cache", "cache"),
    safe("Code Cache", "opencode.code_cache", "cache"),
    safe("GPUCache", "opencode.gpu_cache", "cache"),
    safe("DawnGraphiteCache", "opencode.graphite_cache", "cache"),
    safe("DawnWebGPUCache", "opencode.webgpu_cache", "cache"),
    safe("compile-cache", "opencode.compile_cache", "cache"),
    review("Crashpad", "opencode.crashpad", "diagnostics", None),
];

pub const OPENCODE_UPDATER_TARGETS: &[AgentTargetSpec] = &[
    safe("pending", "opencode.updater_pending", "cache"),
];

pub const T3CODE_APP_TARGETS: &[AgentTargetSpec] = &[
    keep("Local Storage", "t3code.local_storage", "configuration", Some("Kullanıcı tercihleri ve oturum bağlantıları.")),
    keep("IndexedDB", "t3code.indexed_db", "sessions", Some("Oturum ve iş parçacığı geçmişi.")),
    safe("Cache", "t3code.cache", "cache"),
    safe("Code Cache", "t3code.code_cache", "cache"),
    safe("GPUCache", "t3code.gpu_cache", "cache"),
    safe("GPUPersistentCache", "t3code.gpu_persistent", "cache"),
    safe("GrShaderCache", "t3code.gr_shader", "cache"),
    safe("DawnGraphiteCache", "t3code.graphite_cache", "cache"),
    safe("DawnWebGPUCache", "t3code.webgpu_cache", "cache"),
];

pub const T3CODE_UPDATER_TARGETS: &[AgentTargetSpec] = &[
    safe("pending", "t3code.updater_pending", "cache"),
];

pub const BIONIC_APP_TARGETS: &[AgentTargetSpec] = &[
    keep("Preferences", "bionic.preferences", "configuration", Some("Kullanıcı yapılandırması ve ayarları.")),
    keep("Local Storage", "bionic.local_storage", "configuration", None),
    keep("Network", "bionic.network", "configuration", None),
    safe("Cache", "bionic.cache", "cache"),
    safe("Code Cache", "bionic.code_cache", "cache"),
    review("Crashpad", "bionic.crashpad", "diagnostics", None),
    review("logs", "bionic.logs", "diagnostics", None),
];

pub const CURSOR_USER_TARGETS: &[AgentTargetSpec] = &[
    keep("rules", "cursor.rules", "configuration", Some("Kullanıcı ve proje AI kuralları.")),
    keep("tunnels", "cursor.tunnels", "configuration", None),
    review("projects", "cursor.projects_cache", "cache", Some("Proje bağlam önbellekleri.")),
    review("logs", "cursor.user_logs", "diagnostics", None),
];

pub const CURSOR_APP_TARGETS: &[AgentTargetSpec] = &[
    keep("User", "cursor.user_settings", "configuration", Some("Kullanıcı ayarları, tuş atamaları ve eklentiler.")),
    keep("workspaceStorage", "cursor.workspace_storage", "sessions", Some("Çalışma alanı oturumları ve sohbet geçmişleri.")),
    safe("Cache", "cursor.cache", "cache"),
    safe("Code Cache", "cursor.code_cache", "cache"),
    safe("GPUCache", "cursor.gpu_cache", "cache"),
    safe("CachedData", "cursor.cached_data", "cache"),
    review("Crashpad", "cursor.crashpad", "diagnostics", None),
    review("logs", "cursor.app_logs", "diagnostics", None),
];

pub const WINDSURF_CODEIUM_TARGETS: &[AgentTargetSpec] = &[
    keep("cascade", "windsurf.cascade_history", "sessions", Some("Cascade sohbet geçmişi ve konuşma belleği.")),
    review("logs", "windsurf.codeium_logs", "diagnostics", None),
];

pub const WINDSURF_USER_TARGETS: &[AgentTargetSpec] = &[
    keep("extensions", "windsurf.extensions", "configuration", None),
];

pub const WINDSURF_APP_TARGETS: &[AgentTargetSpec] = &[
    keep("User", "windsurf.user_settings", "configuration", Some("Kullanıcı ayarları ve çalışma alanı verisi.")),
    keep("workspaceStorage", "windsurf.workspace_storage", "sessions", None),
    safe("Cache", "windsurf.cache", "cache"),
    safe("Code Cache", "windsurf.code_cache", "cache"),
    safe("GPUCache", "windsurf.gpu_cache", "cache"),
    safe("CachedData", "windsurf.cached_data", "cache"),
    review("Crashpad", "windsurf.crashpad", "diagnostics", None),
    review("logs", "windsurf.app_logs", "diagnostics", None),
];

pub const OLLAMA_USER_TARGETS: &[AgentTargetSpec] = &[
    keep("models", "ollama.models", "models", Some("İndirilmiş yerel yapay zeka model ağırlıkları ve manifestoları.")),
    keep("id_ed25519", "ollama.key", "credentials", None),
    keep("id_ed25519.pub", "ollama.pubkey", "credentials", None),
];

pub const OLLAMA_LOCAL_TARGETS: &[AgentTargetSpec] = &[
    review("server.log", "ollama.server_log", "diagnostics", Some("Sunucu günlük dosyası.")),
    review("logs", "ollama.logs", "diagnostics", None),
    safe("temp", "ollama.temp", "cache"),
    safe("updates", "ollama.updates", "cache"),
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
        _ => &[],
    }
}

pub fn provider_display_name(provider: &str) -> &'static str {
    match provider {
        "codex" => "OpenAI Codex",
        "claude-code" => "Claude Code",
        "antigravity" => "Google Antigravity",
        "opencode" => "OpenCode",
        "t3code" => "T3 Code",
        "bionic" => "Bionic",
        "cursor" => "Cursor",
        "windsurf" => "Windsurf",
        "ollama" => "Ollama",
        _ => "Bilinmeyen sağlayıcı",
    }
}
