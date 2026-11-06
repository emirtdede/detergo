use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::platform::{is_in_use, running_process_names};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActiveUse {
    Yes,
    No,
    Unknown,
}

impl ActiveUse {
    pub fn blocks_deletion(self) -> bool {
        matches!(self, ActiveUse::Yes | ActiveUse::Unknown)
    }
}

const CODEX_PROCESSES: &[&str] = &["codex"];
const CLAUDE_PROCESSES: &[&str] = &["claude"];
// "electron" is intentionally not included: it is shared by many unrelated
// desktop applications and would block Antigravity cleanup on most machines.
const ANTIGRAVITY_PROCESSES: &[&str] = &["antigravity", "antigravity-ide", "antigravity ide"];
const OPENCODE_PROCESSES: &[&str] = &["opencode", "ai.opencode.desktop"];
const T3CODE_PROCESSES: &[&str] = &["t3code", "t3code-v2"];
const BIONIC_PROCESSES: &[&str] = &["bionic"];
const CURSOR_PROCESSES: &[&str] = &["cursor"];
const WINDSURF_PROCESSES: &[&str] = &["windsurf", "codeium"];
const OLLAMA_PROCESSES: &[&str] = &["ollama", "ollama_app"];

pub fn provider_processes(provider: &str) -> &'static [&'static str] {
    match provider {
        "codex" => CODEX_PROCESSES,
        "claude-code" => CLAUDE_PROCESSES,
        "antigravity" => ANTIGRAVITY_PROCESSES,
        "opencode" => OPENCODE_PROCESSES,
        "t3code" => T3CODE_PROCESSES,
        "bionic" => BIONIC_PROCESSES,
        "cursor" => CURSOR_PROCESSES,
        "windsurf" => WINDSURF_PROCESSES,
        "ollama" => OLLAMA_PROCESSES,
        _ => &[],
    }
}

/// Provider-level activity. A running agent marks all of its storage as in use.
pub fn active_use_for_provider(provider: &str, path: &Path) -> ActiveUse {
    if provider != "project" && provider != "global-cache" {
        let running = running_process_names(provider_processes(provider));
        if !running.is_empty() {
            return ActiveUse::Yes;
        }
    }
    is_target_in_use(path)
}

pub fn is_target_in_use(path: &Path) -> ActiveUse {
    match is_in_use(path) {
        Some(true) => ActiveUse::Yes,
        Some(false) => ActiveUse::No,
        None => ActiveUse::Unknown,
    }
}
