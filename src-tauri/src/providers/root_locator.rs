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
    std::env::var("USERPROFILE").ok().map(PathBuf::from)
}

fn env_path(key: &str) -> Option<PathBuf> {
    std::env::var(key)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .map(PathBuf::from)
}

fn normalize(path: &Path) -> String {
    let mut s = path.to_string_lossy().replace('/', "\\");
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        s = stripped.to_string();
    }
    while s.len() > 3 && s.ends_with('\\') {
        s.pop();
    }
    s.to_lowercase()
}

/// Discovers agent roots from environment overrides and conventional locations.
/// WSL and remote file systems are intentionally out of scope.
pub fn locate_agent_roots() -> Vec<AgentRoot> {
    let mut roots: Vec<AgentRoot> = Vec::new();

    if let Some(codex_home) = env_path("CODEX_HOME") {
        roots.push(AgentRoot {
            provider: "codex",
            kind: "codex-home",
            path: codex_home,
            source: "CODEX_HOME".to_string(),
        });
    } else if let Some(home) = home() {
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
    } else if let Some(home) = home() {
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
    } else if let Some(temp) = env_path("TEMP") {
        roots.push(AgentRoot {
            provider: "claude-code",
            kind: "claude-temp",
            path: temp.join("claude"),
            source: "default-temp".to_string(),
        });
    }

    if let Some(home) = home() {
        for (dir, kind) in [
            (".gemini\\antigravity", "antigravity-data"),
            (".gemini\\antigravity-ide", "antigravity-data"),
            (".gemini\\antigravity-backup", "antigravity-backup"),
        ] {
            roots.push(AgentRoot {
                provider: "antigravity",
                kind,
                path: home.join(dir),
                source: "default".to_string(),
            });
        }
    }
    if let Some(appdata) = env_path("APPDATA") {
        roots.push(AgentRoot {
            provider: "antigravity",
            kind: "antigravity-app",
            path: appdata.join("Antigravity"),
            source: "default".to_string(),
        });
        // The Electron IDE build uses a separate app-data folder name.
        roots.push(AgentRoot {
            provider: "antigravity",
            kind: "antigravity-app",
            path: appdata.join("Antigravity IDE"),
            source: "default".to_string(),
        });
    }
    if let Some(local) = env_path("LOCALAPPDATA") {
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
    if let Some(home) = home() {
        roots.push(AgentRoot {
            provider: "opencode",
            kind: "opencode-config",
            path: home.join(".config\\opencode"),
            source: "default".to_string(),
        });
        roots.push(AgentRoot {
            provider: "opencode",
            kind: "opencode-share",
            path: home.join(".local\\share\\opencode"),
            source: "default".to_string(),
        });
    }
    if let Some(appdata) = env_path("APPDATA") {
        roots.push(AgentRoot {
            provider: "opencode",
            kind: "opencode-app",
            path: appdata.join("ai.opencode.desktop"),
            source: "default".to_string(),
        });
    }
    if let Some(local) = env_path("LOCALAPPDATA") {
        roots.push(AgentRoot {
            provider: "opencode",
            kind: "opencode-updater",
            path: local.join("@opencodedesktop-updater"),
            source: "default".to_string(),
        });
    }

    // T3 Code
    if let Some(appdata) = env_path("APPDATA") {
        roots.push(AgentRoot {
            provider: "t3code",
            kind: "t3code-app",
            path: appdata.join("t3code-v2"),
            source: "default".to_string(),
        });
    }
    if let Some(local) = env_path("LOCALAPPDATA") {
        roots.push(AgentRoot {
            provider: "t3code",
            kind: "t3code-updater",
            path: local.join("t3code-updater"),
            source: "default".to_string(),
        });
    }

    // Bionic
    if let Some(appdata) = env_path("APPDATA") {
        roots.push(AgentRoot {
            provider: "bionic",
            kind: "bionic-app",
            path: appdata.join("Bionic"),
            source: "default".to_string(),
        });
    }

    // Cursor
    if let Some(home) = home() {
        roots.push(AgentRoot {
            provider: "cursor",
            kind: "cursor-user",
            path: home.join(".cursor"),
            source: "default".to_string(),
        });
    }
    if let Some(appdata) = env_path("APPDATA") {
        roots.push(AgentRoot {
            provider: "cursor",
            kind: "cursor-app",
            path: appdata.join("Cursor"),
            source: "default".to_string(),
        });
    }

    // Windsurf
    if let Some(home) = home() {
        roots.push(AgentRoot {
            provider: "windsurf",
            kind: "windsurf-codeium",
            path: home.join(".codeium\\windsurf"),
            source: "default".to_string(),
        });
        roots.push(AgentRoot {
            provider: "windsurf",
            kind: "windsurf-user",
            path: home.join(".windsurf"),
            source: "default".to_string(),
        });
    }
    if let Some(appdata) = env_path("APPDATA") {
        roots.push(AgentRoot {
            provider: "windsurf",
            kind: "windsurf-app",
            path: appdata.join("Windsurf"),
            source: "default".to_string(),
        });
    }

    // Ollama
    if let Some(home) = home() {
        roots.push(AgentRoot {
            provider: "ollama",
            kind: "ollama-user",
            path: home.join(".ollama"),
            source: "default".to_string(),
        });
    }
    if let Some(local) = env_path("LOCALAPPDATA") {
        roots.push(AgentRoot {
            provider: "ollama",
            kind: "ollama-local",
            path: local.join("Ollama"),
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
pub fn recently_modified(path: &Path, window_secs: u64) -> bool {
    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(window_secs));
    let Some(cutoff) = cutoff else {
        return false;
    };
    let mut count = 0u64;
    for entry in walkdir::WalkDir::new(path)
        .follow_links(false)
        .max_depth(3)
        .into_iter()
        .filter_map(Result::ok)
    {
        count += 1;
        if count > 200 {
            break;
        }
        if let Ok(meta) = entry.metadata() {
            if let Ok(modified) = meta.modified() {
                if modified >= cutoff {
                    return true;
                }
            }
        }
    }
    false
}
