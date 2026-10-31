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

pub fn specs_for(kind: &str) -> &'static [AgentTargetSpec] {
    match kind {
        "codex-home" => CODEX_TARGETS,
        "claude-home" => CLAUDE_HOME_TARGETS,
        "claude-temp" => CLAUDE_TEMP_TARGETS,
        "antigravity-data" => ANTIGRAVITY_DATA_TARGETS,
        "antigravity-backup" => ANTIGRAVITY_BACKUP_TARGETS,
        "antigravity-app" => ANTIGRAVITY_APP_TARGETS,
        "antigravity-local" => ANTIGRAVITY_LOCAL_TARGETS,
        _ => &[],
    }
}

pub fn provider_display_name(provider: &str) -> &'static str {
    match provider {
        "codex" => "OpenAI Codex",
        "claude-code" => "Claude Code",
        "antigravity" => "Google Antigravity",
        _ => "Bilinmeyen sağlayıcı",
    }
}
