use std::path::{Path, PathBuf};

/// A discovered data root for an AI coding agent.
#[derive(Debug, Clone)]
pub struct AgentRoot {
    pub provider: &'static str,
    pub kind: &'static str,
    pub path: PathBuf,
    pub source: String,
}

fn home() -> Option<PathBuf> {
    env_path("USERPROFILE").or_else(|| env_path("HOME"))
}

fn env_path(key: &str) -> Option<PathBuf> {
    std::env::var(key)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .map(PathBuf::from)
}

/// Platform app-config root (`%APPDATA%` on Windows, `~/Library/Application Support`
/// on macOS, `$XDG_CONFIG_HOME` or `~/.config` on Linux).
fn app_config_root() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        env_path("APPDATA")
    }
    #[cfg(target_os = "macos")]
    {
        home().map(|h| h.join("Library").join("Application Support"))
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        env_path("XDG_CONFIG_HOME").or_else(|| home().map(|h| h.join(".config")))
    }
}

/// Platform local-data/cache root (`%LOCALAPPDATA%` on Windows, `~/Library/Caches`
/// on macOS, `$XDG_CACHE_HOME` or `~/.cache` on Linux).
fn app_local_root() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        env_path("LOCALAPPDATA")
    }
    #[cfg(target_os = "macos")]
    {
        home().map(|h| h.join("Library").join("Caches"))
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        env_path("XDG_CACHE_HOME").or_else(|| home().map(|h| h.join(".cache")))
    }
}

fn xdg_config_home() -> Option<PathBuf> {
    env_path("XDG_CONFIG_HOME").or_else(|| home().map(|h| h.join(".config")))
}

fn xdg_data_home() -> Option<PathBuf> {
    env_path("XDG_DATA_HOME").or_else(|| home().map(|h| h.join(".local").join("share")))
}

fn normalize(path: &Path) -> String {
    crate::safety::path_guard::normalize_key(path)
}

/// Discovers agent roots from environment overrides and conventional locations.
/// WSL and remote file systems are intentionally out of scope.
pub fn locate_agent_roots() -> Vec<AgentRoot> {
    let mut roots: Vec<AgentRoot> = Vec::new();
    let user_home = home();
    let app_cfg = app_config_root();
    let app_local = app_local_root();

    if let Some(codex_home) = env_path("CODEX_HOME") {
        roots.push(AgentRoot {
            provider: "codex",
            kind: "codex-home",
            path: codex_home,
            source: "CODEX_HOME".to_string(),
        });
    } else if let Some(ref home) = user_home {
        roots.push(AgentRoot {
            provider: "codex",
            kind: "codex-home",
            path: home.join(".codex"),
            source: "default".to_string(),
        });
    }

    if let Some(claude_dir) = env_path("CLAUDE_CONFIG_DIR") {
        roots.push(AgentRoot {
            provider: "claude-code",
            kind: "claude-home",
            path: claude_dir,
            source: "CLAUDE_CONFIG_DIR".to_string(),
        });
    } else if let Some(ref home) = user_home {
        roots.push(AgentRoot {
            provider: "claude-code",
            kind: "claude-home",
            path: home.join(".claude"),
            source: "default".to_string(),
        });
    }

    if let Some(tmp) = env_path("CLAUDE_CODE_TMPDIR") {
        roots.push(AgentRoot {
            provider: "claude-code",
            kind: "claude-temp",
            path: tmp,
            source: "CLAUDE_CODE_TMPDIR".to_string(),
        });
    } else {
        let temp = env_path("TEMP")
            .or_else(|| env_path("TMPDIR"))
            .unwrap_or_else(std::env::temp_dir);
        roots.push(AgentRoot {
            provider: "claude-code",
            kind: "claude-temp",
            path: temp.join("claude"),
            source: "default-temp".to_string(),
        });
    }

    if let Some(ref home) = user_home {
        for (sub, kind) in [
            ("antigravity", "antigravity-data"),
            ("antigravity-ide", "antigravity-data"),
            ("antigravity-backup", "antigravity-backup"),
        ] {
            roots.push(AgentRoot {
                provider: "antigravity",
                kind,
                path: home.join(".gemini").join(sub),
                source: "default".to_string(),
            });
        }
    }
    if let Some(ref appdata) = app_cfg {
        roots.push(AgentRoot {
            provider: "antigravity",
            kind: "antigravity-app",
            path: appdata.join("Antigravity"),
            source: "default".to_string(),
        });
        roots.push(AgentRoot {
            provider: "antigravity",
            kind: "antigravity-app",
            path: appdata.join("Antigravity IDE"),
            source: "default".to_string(),
        });
    }
    if let Some(ref local) = app_local {
        roots.push(AgentRoot {
            provider: "antigravity",
            kind: "antigravity-local",
            path: local.join("Antigravity"),
            source: "default".to_string(),
        });
        roots.push(AgentRoot {
            provider: "antigravity",
            kind: "antigravity-local",
            path: local.join("Antigravity IDE"),
            source: "default".to_string(),
        });
    }

    // OpenCode
    if let Some(opencode_cfg) = env_path("OPENCODE_CONFIG") {
        let dir = if opencode_cfg.is_file() {
            opencode_cfg
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or(opencode_cfg)
        } else {
            opencode_cfg
        };
        roots.push(AgentRoot {
            provider: "opencode",
            kind: "opencode-config",
            path: dir,
            source: "OPENCODE_CONFIG".to_string(),
        });
    } else if let Some(xdg) = xdg_config_home() {
        roots.push(AgentRoot {
            provider: "opencode",
            kind: "opencode-config",
            path: xdg.join("opencode"),
            source: "default".to_string(),
        });
    }
    if let Some(share) = xdg_data_home() {
        roots.push(AgentRoot {
            provider: "opencode",
            kind: "opencode-share",
            path: share.join("opencode"),
            source: "default".to_string(),
        });
    }
    if let Some(ref appdata) = app_cfg {
        roots.push(AgentRoot {
            provider: "opencode",
            kind: "opencode-app",
            path: appdata.join("ai.opencode.desktop"),
            source: "default".to_string(),
        });
    }
    if let Some(ref local) = app_local {
        roots.push(AgentRoot {
            provider: "opencode",
            kind: "opencode-updater",
            path: local.join("@opencodedesktop-updater"),
            source: "default".to_string(),
        });
    }

    // T3 Code
    if let Some(ref appdata) = app_cfg {
        roots.push(AgentRoot {
            provider: "t3code",
            kind: "t3code-app",
            path: appdata.join("t3code-v2"),
            source: "default".to_string(),
        });
    }
    if let Some(ref local) = app_local {
        roots.push(AgentRoot {
            provider: "t3code",
            kind: "t3code-updater",
            path: local.join("t3code-updater"),
            source: "default".to_string(),
        });
    }

    // Bionic
    if let Some(ref appdata) = app_cfg {
        roots.push(AgentRoot {
            provider: "bionic",
            kind: "bionic-app",
            path: appdata.join("Bionic"),
            source: "default".to_string(),
        });
    }

    // Cursor
    if let Some(ref home) = user_home {
        roots.push(AgentRoot {
            provider: "cursor",
            kind: "cursor-user",
            path: home.join(".cursor"),
            source: "default".to_string(),
        });
    }
    if let Some(ref appdata) = app_cfg {
        roots.push(AgentRoot {
            provider: "cursor",
            kind: "cursor-app",
            path: appdata.join("Cursor"),
            source: "default".to_string(),
        });
    }

    // Windsurf
    if let Some(ref home) = user_home {
        roots.push(AgentRoot {
            provider: "windsurf",
            kind: "windsurf-codeium",
            path: home.join(".codeium").join("windsurf"),
            source: "default".to_string(),
        });
        roots.push(AgentRoot {
            provider: "windsurf",
            kind: "windsurf-user",
            path: home.join(".windsurf"),
            source: "default".to_string(),
        });
    }
    if let Some(ref appdata) = app_cfg {
        roots.push(AgentRoot {
            provider: "windsurf",
            kind: "windsurf-app",
            path: appdata.join("Windsurf"),
            source: "default".to_string(),
        });
    }

    // Ollama
    if let Some(models_dir) = env_path("OLLAMA_MODELS") {
        let base = models_dir
            .parent()
            .filter(|_| {
                models_dir
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.eq_ignore_ascii_case("models"))
            })
            .map(Path::to_path_buf)
            .unwrap_or(models_dir);
        roots.push(AgentRoot {
            provider: "ollama",
            kind: "ollama-user",
            path: base,
            source: "OLLAMA_MODELS".to_string(),
        });
    }
    if let Some(ref home) = user_home {
        roots.push(AgentRoot {
            provider: "ollama",
            kind: "ollama-user",
            path: home.join(".ollama"),
            source: "default".to_string(),
        });
    }
    if let Some(ref local) = app_local {
        roots.push(AgentRoot {
            provider: "ollama",
            kind: "ollama-local",
            path: local.join("Ollama"),
            source: "default".to_string(),
        });
    }

    // Claude Desktop
    if let Some(ref appdata) = app_cfg {
        roots.push(AgentRoot {
            provider: "claude-desktop",
            kind: "claude-desktop-app",
            path: appdata.join("Claude"),
            source: "default".to_string(),
        });
    }

    // GitHub Copilot
    if let Some(ref home) = user_home {
        roots.push(AgentRoot {
            provider: "copilot",
            kind: "copilot",
            path: home.join(".copilot"),
            source: "default".to_string(),
        });
    }
    if let Some(ref local) = app_local {
        roots.push(AgentRoot {
            provider: "copilot",
            kind: "copilot",
            path: local.join("github-copilot"),
            source: "default".to_string(),
        });
    }
    if let Some(xdg) = xdg_config_home() {
        roots.push(AgentRoot {
            provider: "copilot",
            kind: "copilot",
            path: xdg.join("github-copilot"),
            source: "default".to_string(),
        });
    }

    // Cline & Roo Code (VS Code / Cursor / Windsurf globalStorage)
    if let Some(ref appdata) = app_cfg {
        for ide in ["Code", "Code - Insiders", "Cursor", "Windsurf"] {
            let gs = appdata.join(ide).join("User").join("globalStorage");
            roots.push(AgentRoot {
                provider: "cline",
                kind: "cline",
                path: gs.join("saoudrizwan.claude-dev"),
                source: format!("{ide} globalStorage"),
            });
            roots.push(AgentRoot {
                provider: "roo-code",
                kind: "roo-code",
                path: gs.join("rooveterinaryinc.roo-cline"),
                source: format!("{ide} globalStorage"),
            });
        }
    }

    // Aider
    if let Some(ref home) = user_home {
        roots.push(AgentRoot {
            provider: "aider",
            kind: "aider",
            path: home.join(".aider"),
            source: "default".to_string(),
        });
    }
    if let Some(ref local) = app_local {
        roots.push(AgentRoot {
            provider: "aider",
            kind: "aider",
            path: local.join("aider"),
            source: "default".to_string(),
        });
    }

    // Continue
    if let Some(ref home) = user_home {
        roots.push(AgentRoot {
            provider: "continue",
            kind: "continue",
            path: home.join(".continue"),
            source: "default".to_string(),
        });
    }

    // Zed
    #[cfg(windows)]
    if let Some(ref local) = app_local {
        roots.push(AgentRoot {
            provider: "zed",
            kind: "zed",
            path: local.join("Zed"),
            source: "default".to_string(),
        });
    }
    #[cfg(target_os = "macos")]
    if let Some(ref appdata) = app_cfg {
        roots.push(AgentRoot {
            provider: "zed",
            kind: "zed",
            path: appdata.join("Zed"),
            source: "default".to_string(),
        });
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    if let Some(share) = xdg_data_home() {
        roots.push(AgentRoot {
            provider: "zed",
            kind: "zed",
            path: share.join("zed"),
            source: "default".to_string(),
        });
    }

    // LM Studio
    if let Some(lm_home) = env_path("LMSTUDIO_HOME") {
        roots.push(AgentRoot {
            provider: "lm-studio",
            kind: "lm-studio",
            path: lm_home,
            source: "LMSTUDIO_HOME".to_string(),
        });
    } else if let Some(ref home) = user_home {
        roots.push(AgentRoot {
            provider: "lm-studio",
            kind: "lm-studio",
            path: home.join(".lmstudio"),
            source: "default".to_string(),
        });
        roots.push(AgentRoot {
            provider: "lm-studio",
            kind: "lm-studio",
            path: home.join(".cache").join("lm-studio"),
            source: "default".to_string(),
        });
    }

    let mut seen = std::collections::HashSet::new();
    roots.retain(|r| seen.insert(normalize(&r.path)));
    roots
}

pub fn root_exists(root: &AgentRoot) -> bool {
    root.path.is_dir()
}

/// True when any file under `path` changed within the given window.
///
/// The walk must finish: an early `entry count > 200` break meant a recently
/// touched file living after 200 older entries was never seen, so a recording
/// guard silently treated an active root as idle.
pub fn recently_modified(path: &Path, window_secs: u64) -> bool {
    let window = std::time::Duration::from_secs(window_secs);
    let now = std::time::SystemTime::now();
    for entry in walkdir::WalkDir::new(path)
        .follow_links(false)
        .max_depth(3)
        // `follow_links(false)` does not descend through symlink targets, but a
        // junction or other reparse point must still be pruned explicitly (every
        // other walk in this project does the same). Without it, a reparse point
        // inside an Electron cache tree was walked as an ordinary directory,
        // reading an arbitrary tree outside `path`.
        .into_iter()
        .filter_entry(|entry| {
            entry.depth() == 0 || !crate::platform::is_reparse_point(entry.path())
        })
        .filter_map(Result::ok)
    {
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let Ok(modified) = meta.modified() else {
            continue;
        };
        if counts_as_recent(modified, now, window) {
            return true;
        }
    }
    false
}

/// True when `modified` is at most `window` in the past.
///
/// Age, not `modified >= now - window`: a future mtime (zip extraction, a clock
/// moved backwards) satisfied the old comparison forever and kept an idle root
/// permanently "recording active", blocking a cleanup that was safe to run.
fn counts_as_recent(
    modified: std::time::SystemTime,
    now: std::time::SystemTime,
    window: std::time::Duration,
) -> bool {
    now.duration_since(modified)
        .map(|age| age <= window)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::{counts_as_recent, recently_modified};
    use std::time::{Duration, SystemTime};

    #[test]
    fn a_fresh_file_counts_as_recent_activity() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("recording.mp4"), b"x").unwrap();
        assert!(recently_modified(dir.path(), 120));
    }

    #[test]
    fn a_future_timestamp_is_not_recent_activity() {
        let now = SystemTime::now();
        let window = Duration::from_secs(120);

        assert!(counts_as_recent(now, now, window));
        assert!(counts_as_recent(now - Duration::from_secs(60), now, window));
        assert!(!counts_as_recent(
            now - Duration::from_secs(600),
            now,
            window
        ));
        // Zip extraction preserving source timestamps or a clock moved
        // backwards: the file reads as "modified in the future".
        assert!(!counts_as_recent(
            now + Duration::from_secs(3_600),
            now,
            window
        ));
    }
}
