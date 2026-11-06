use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteItem {
    pub id: String,
    pub label: String,
    pub path: String,
    pub created_at: String,
    pub last_used_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SortConfig {
    pub field: String,
    pub direction: String,
}

/// A user-defined AI tool. Node Cleaner never invents cleanup rules for these
/// roots: every discovered target is reported as `KEEP`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CustomAgentProvider {
    pub id: String,
    pub name: String,
    pub root_paths: Vec<String>,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentPolicy {
    /// Provider cache directories may be cleaned manually (never automatically).
    pub allow_cache_cleanup: bool,
    /// Browser recordings are only offered when the producer is idle.
    pub protect_browser_recordings: bool,
}

impl Default for AgentPolicy {
    fn default() -> Self {
        Self {
            allow_cache_cleanup: true,
            protect_browser_recordings: true,
        }
    }
}

fn default_schema_version() -> u32 {
    3
}

fn default_sidebar_mode() -> String {
    "expanded".to_string()
}

fn default_cache_measure_mode() -> String {
    "fast".to_string()
}

/// What the window close button does. `ask` keeps the three-choice guard;
/// `tray` and `quit` apply the user's remembered choice without a dialog.
fn default_close_action() -> String {
    "ask".to_string()
}

fn default_scan_profile() -> String {
    "balanced".to_string()
}

fn default_max_depth() -> usize {
    32
}

fn default_max_candidates() -> u64 {
    50_000
}

fn default_timeout_minutes() -> u64 {
    15
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum NotificationChannel {
    #[default]
    Both,
    InApp,
    Desktop,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NotificationPreferences {
    #[serde(default)]
    pub scan_complete: NotificationChannel,
    #[serde(default)]
    pub clean_complete: NotificationChannel,
    #[serde(default)]
    pub disk_pressure: NotificationChannel,
    #[serde(default)]
    pub process_lock: NotificationChannel,
    #[serde(default)]
    pub automation_webhook: NotificationChannel,
    #[serde(default = "default_true")]
    pub sound_enabled: bool,
}

impl Default for NotificationPreferences {
    fn default() -> Self {
        Self {
            scan_complete: NotificationChannel::Both,
            clean_complete: NotificationChannel::Both,
            disk_pressure: NotificationChannel::Both,
            process_lock: NotificationChannel::InApp,
            automation_webhook: NotificationChannel::Both,
            sound_enabled: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    pub theme: String,
    pub reduce_motion: bool,
    pub favorites: Vec<FavoriteItem>,
    pub recent_locations: Vec<String>,
    pub last_scan_path: Option<String>,
    pub sort: SortConfig,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub protected_paths: Vec<String>,
    #[serde(default)]
    pub excluded_names: Vec<String>,
    #[serde(default = "default_scan_profile")]
    pub scan_profile: String,
    #[serde(default = "default_max_depth")]
    pub max_depth: usize,
    #[serde(default = "default_max_candidates")]
    pub max_candidates: u64,
    #[serde(default = "default_timeout_minutes")]
    pub timeout_minutes: u64,
    #[serde(default)]
    pub min_size_bytes: u64,
    #[serde(default)]
    pub mask_paths: bool,
    #[serde(default = "default_true")]
    pub history_enabled: bool,
    #[serde(default)]
    pub agent_policy: AgentPolicy,
    #[serde(default = "default_sidebar_mode")]
    pub sidebar_mode: String,
    #[serde(default = "default_cache_measure_mode")]
    pub cache_measure_mode: String,
    #[serde(default = "default_close_action")]
    pub close_action: String,
    #[serde(default)]
    pub custom_agent_providers: Vec<CustomAgentProvider>,
    #[serde(default)]
    pub hidden_builtin_providers: Vec<String>,
    #[serde(default)]
    pub notifications: NotificationPreferences,
    #[serde(default)]
    pub webhook_url: Option<String>,
    #[serde(default = "default_true")]
    pub webhook_on_scan: bool,
    #[serde(default = "default_true")]
    pub webhook_on_clean: bool,
    #[serde(default)]
    pub shortcuts: Option<std::collections::HashMap<String, String>>,
}

fn default_true() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: 3,
            theme: "dark-transparent".to_string(),
            reduce_motion: false,
            favorites: Vec::new(),
            recent_locations: Vec::new(),
            last_scan_path: None,
            sort: SortConfig {
                field: "size".to_string(),
                direction: "desc".to_string(),
            },
            language: None,
            protected_paths: Vec::new(),
            excluded_names: Vec::new(),
            scan_profile: default_scan_profile(),
            max_depth: default_max_depth(),
            max_candidates: default_max_candidates(),
            timeout_minutes: default_timeout_minutes(),
            min_size_bytes: 0,
            mask_paths: false,
            history_enabled: true,
            agent_policy: AgentPolicy::default(),
            sidebar_mode: default_sidebar_mode(),
            cache_measure_mode: default_cache_measure_mode(),
            close_action: default_close_action(),
            custom_agent_providers: Vec::new(),
            hidden_builtin_providers: Vec::new(),
            notifications: NotificationPreferences::default(),
            webhook_url: None,
            webhook_on_scan: true,
            webhook_on_clean: true,
            shortcuts: None,
        }
    }
}

impl AppSettings {
    /// Applies version migrations without dropping user data.
    pub fn migrate(&mut self) {
        if self.schema_version < 3 {
            self.schema_version = 3;
        }
        self.normalize();
    }

    pub fn normalize(&mut self) {
        self.max_depth = self.max_depth.clamp(1, 128);
        self.max_candidates = self.max_candidates.clamp(1_000, 500_000);
        self.timeout_minutes = self.timeout_minutes.clamp(1, 120);
        if self.scan_profile.is_empty() {
            self.scan_profile = default_scan_profile();
        }

        // Protected paths are stored in a canonical, absolute form. Otherwise
        // a relative path or a `..` segment would silently fail to protect the
        // directory the user intended. Duplicates are collapsed
        // case-insensitively because Windows paths are case-insensitive.
        let mut seen = std::collections::HashSet::new();
        let mut normalized = Vec::new();
        for raw in std::mem::take(&mut self.protected_paths) {
            if let Some(path) = normalize_protected_path(&raw) {
                let key = crate::safety::path_guard::normalize_key(std::path::Path::new(&path));
                if seen.insert(key) {
                    normalized.push(path);
                }
            }
        }
        self.protected_paths = normalized;

        let mut seen_names = std::collections::HashSet::new();
        self.excluded_names = std::mem::take(&mut self.excluded_names)
            .into_iter()
            .map(|name| name.trim().to_lowercase())
            .filter(|name| !name.is_empty() && seen_names.insert(name.clone()))
            .collect();

        if self.sidebar_mode != "collapsed" {
            self.sidebar_mode = default_sidebar_mode();
        }
        if self.cache_measure_mode != "full" {
            self.cache_measure_mode = default_cache_measure_mode();
        }
        if !matches!(self.close_action.as_str(), "ask" | "tray" | "quit") {
            self.close_action = default_close_action();
        }

        let mut seen_providers = std::collections::HashSet::new();
        self.custom_agent_providers = std::mem::take(&mut self.custom_agent_providers)
            .into_iter()
            .filter_map(|mut provider| {
                provider.id = provider.id.trim().to_string();
                provider.name = provider.name.trim().to_string();
                provider.root_paths = provider
                    .root_paths
                    .iter()
                    .filter_map(|raw| normalize_protected_path(raw))
                    .collect();
                let mut seen_paths = std::collections::HashSet::new();
                provider.root_paths.retain(|path| {
                    seen_paths.insert(
                        crate::safety::path_guard::normalize_key(std::path::Path::new(path)),
                    )
                });
                if provider.id.is_empty() || provider.name.is_empty() || provider.root_paths.is_empty()
                {
                    return None;
                }
                if !seen_providers.insert(provider.id.clone()) {
                    return None;
                }
                Some(provider)
            })
            .collect();

        let mut seen_hidden = std::collections::HashSet::new();
        self.hidden_builtin_providers = std::mem::take(&mut self.hidden_builtin_providers)
            .into_iter()
            .map(|id| id.trim().to_lowercase())
            .filter(|id| !id.is_empty() && seen_hidden.insert(id.clone()))
            .collect();

        self.recent_locations.truncate(20);
    }

    pub fn scan_limits(&self) -> crate::scanner::limits::ScanLimits {
        crate::scanner::limits::ScanLimits {
            max_depth: self.max_depth,
            max_candidates: self.max_candidates,
            timeout: std::time::Duration::from_secs(self.timeout_minutes * 60),
            min_size_bytes: self.min_size_bytes,
        }
    }
}

fn expand_env_vars(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let Some(end) = after.find('%') else {
            out.push_str(&rest[start..]);
            return out;
        };
        let name = &after[..end];
        if name.is_empty() {
            out.push_str("%%");
        } else if let Ok(value) = std::env::var(name) {
            out.push_str(&value);
        } else {
            out.push('%');
            out.push_str(name);
            out.push('%');
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    out
}

fn lexical_normalize(path: &std::path::Path) -> std::path::PathBuf {
    use std::path::Component;
    let mut out = std::path::PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    out.push("..");
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Expands environment variables and `~`, makes the path absolute, removes
/// `.`/`..` segments, and prefers the canonical filesystem path when the
/// directory exists. Returns `None` for blank entries.
pub fn normalize_protected_path(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let expanded = expand_env_vars(trimmed);
    let expanded = if let Some(rest) = expanded.strip_prefix('~') {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .ok()?;
        format!("{}{}", home, rest)
    } else {
        expanded
    };

    let mut path = std::path::PathBuf::from(expanded);
    if path.is_relative() {
        path = std::env::current_dir().ok()?.join(path);
    }
    path = lexical_normalize(&path);
    if let Ok(canonical) = std::fs::canonicalize(&path) {
        path = canonical;
    }
    let mut text = path.to_string_lossy().to_string();
    while text.len() > 3 && (text.ends_with('\\') || text.ends_with('/')) {
        text.pop();
    }
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}
