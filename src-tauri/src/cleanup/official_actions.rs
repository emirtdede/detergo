use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::catalog::TargetKind;
use crate::error::AppError;
use crate::scanner::cancellation::CancellationToken;
use crate::scanner::measurement::measure_path_with_deadline;

const COMMAND_TIMEOUT: Duration = Duration::from_secs(600);
/// One `--version` probe is capped at 1.5 s. Probes for every provider run in
/// parallel under [`VERSION_BUDGET`], so a slow shim (npx, conda) can no longer
/// make the caches page take minutes to open.
const VERSION_TIMEOUT: Duration = Duration::from_millis(1500);
const VERSION_BUDGET: Duration = Duration::from_secs(2);
/// Preview/after-measurement runs inside the command handler, so it must not
/// walk a multi-gigabyte cache for minutes and freeze the dialog. Paths that
/// cannot be measured within this budget are reported as "not measured".
const PREVIEW_MEASURE_BUDGET: Duration = Duration::from_secs(8);
/// Per-path measurement budget for `measure_cache_providers` so massive global
/// caches (pnpm/npm/cargo/gradle/nuget) never hang CLI `c -j`, `s -t all -j`,
/// or MCP `devcleaner_list_caches` past client timeouts.
const CACHE_PATH_MEASURE_BUDGET: Duration = Duration::from_secs(8);

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachePathInfo {
    pub path: String,
    pub exists: bool,
    #[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number<u64>>))]
    pub bytes: Option<u64>,
    /// Why `bytes` is `None` even though the path exists (`readOnly`, `error`).
    /// Without this the UI could only say "not measured" and never explain that
    /// a read-only provider is intentionally never walked.
    pub unmeasured_reason: Option<String>,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialActionInfo {
    pub id: String,
    pub label: String,
    pub description: String,
    pub executable: Option<String>,
    pub args: Vec<String>,
    pub available: bool,
    pub unavailable_reason: Option<String>,
    pub requires_network: bool,
    pub impact: String,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheProviderInfo {
    pub id: String,
    pub name: String,
    pub detected: bool,
    pub version: Option<String>,
    pub cache_paths: Vec<CachePathInfo>,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub total_bytes: u64,
    pub actions: Vec<OfficialActionInfo>,
    pub read_only: bool,
    pub note: Option<String>,
    /// False until the streaming measurement pass has reported a value.
    pub measured: bool,
}

/// Progress events for the asynchronous cache measurement pass.
#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CacheMeasureEvent {
    Started {
        #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<usize>))]
        provider_count: usize,
    },
    PathMeasured {
        provider_id: String,
        path: String,
        exists: bool,
        #[cfg_attr(feature = "bindings", specta(type = Option<specta_typescript::Number<u64>>))]
        bytes: Option<u64>,
        unmeasured_reason: Option<String>,
    },
    ProviderFinished {
        provider_id: String,
        #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
        total_bytes: u64,
    },
    Finished,
    Cancelled,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialActionPreview {
    pub token: String,
    pub provider_id: String,
    pub action_id: String,
    pub executable: String,
    pub args: Vec<String>,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub before_bytes: u64,
    /// True when the before-size measurement hit its time limit, so some paths
    /// are not included. This flag is the machine-readable source of truth; the
    /// old free-text `warning` duplicated it and was never rendered.
    pub measurement_truncated: bool,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub expires_ms: u64,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialActionResult {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub provider_id: String,
    pub action_id: String,
    pub label: String,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub before_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub after_bytes: u64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<i64>))]
    pub delta_bytes: i64,
    #[cfg_attr(feature = "bindings", specta(type = specta_typescript::Number<u64>))]
    pub duration_ms: u64,
    pub stdout_tail: String,
    pub stderr_tail: String,
    pub note: Option<String>,
    /// True when the post-action size measurement was cut short (time budget),
    /// so `delta_bytes` is a lower bound rather than a complete change value.
    pub measurement_truncated: bool,
    /// Set when the cleanup completed but the audit/history record could not be
    /// written. The command still succeeds, but the failure is surfaced.
    pub audit_error: Option<String>,
}

struct ActionDef {
    id: &'static str,
    exe: &'static str,
    args: &'static [&'static str],
    label: &'static str,
    description: &'static str,
    requires_network: bool,
    impact: &'static str,
}

struct ProviderDef {
    id: &'static str,
    name: &'static str,
    cache_paths: &'static [&'static str],
    version_exe: &'static str,
    actions: &'static [ActionDef],
    read_only: bool,
    note: Option<&'static str>,
}

const NPM_CACHE: &[&str] = &["%LOCALAPPDATA%\\npm-cache"];
const PNPM_STORE: &[&str] = &["%LOCALAPPDATA%\\pnpm\\store"];
const YARN_CACHE: &[&str] = &["%LOCALAPPDATA%\\Yarn\\Cache"];
const BUN_CACHE: &[&str] = &["%USERPROFILE%\\.bun\\install\\cache"];
const PIP_CACHE: &[&str] = &["%LOCALAPPDATA%\\pip\\Cache"];
const NUGET_CACHE: &[&str] = &["%USERPROFILE%\\.nuget\\packages"];
const GO_CACHE: &[&str] = &["%USERPROFILE%\\go\\pkg\\mod", "%LOCALAPPDATA%\\go-build"];
const UV_CACHE: &[&str] = &["%LOCALAPPDATA%\\uv\\cache"];
const CARGO_CACHE: &[&str] = &[
    "%USERPROFILE%\\.cargo\\registry\\cache",
    "%USERPROFILE%\\.cargo\\git\\db",
];
const GRADLE_CACHE: &[&str] = &[
    "%USERPROFILE%\\.gradle\\caches",
    "%USERPROFILE%\\.gradle\\wrapper\\dists",
];
const MAVEN_CACHE: &[&str] = &["%USERPROFILE%\\.m2\\repository"];
const COMPOSER_CACHE: &[&str] = &[
    "%LOCALAPPDATA%\\Composer\\repo",
    "%APPDATA%\\Composer\\cache",
];
const CONDA_CACHE: &[&str] = &[
    "%USERPROFILE%\\.conda\\pkgs",
    "%USERPROFILE%\\miniconda3\\pkgs",
    "%USERPROFILE%\\anaconda3\\pkgs",
];
const PLAYWRIGHT_CACHE: &[&str] = &["%LOCALAPPDATA%\\ms-playwright"];
const CYPRESS_CACHE: &[&str] = &["%LOCALAPPDATA%\\Cypress\\Cache"];
const VCPKG_CACHE: &[&str] = &["%LOCALAPPDATA%\\vcpkg\\archives"];
const HUGGINGFACE_CACHE: &[&str] = &["%USERPROFILE%\\.cache\\huggingface\\hub"];
const PUB_CACHE: &[&str] = &["%LOCALAPPDATA%\\Pub\\Cache"];
const ELECTRON_CACHE: &[&str] = &["%LOCALAPPDATA%\\electron\\Cache"];

const ACTIONS: &[ProviderDef] = &[
    ProviderDef {
        id: "npm",
        name: "npm",
        cache_paths: NPM_CACHE,
        version_exe: "npm",
        read_only: false,
        note: None,
        actions: &[ActionDef {
            id: "npm.cache.clean",
            exe: "npm",
            args: &["cache", "clean", "--force"],
            label: "npm cache clean --force",
            description: "Cleans npm cache via the official command.",
            requires_network: false,
            impact: "Subsequent installs may re-download packages.",
        }],
    },
    ProviderDef {
        id: "pnpm",
        name: "pnpm",
        cache_paths: PNPM_STORE,
        version_exe: "pnpm",
        read_only: false,
        note: None,
        actions: &[ActionDef {
            id: "pnpm.store.prune",
            exe: "pnpm",
            args: &["store", "prune"],
            label: "pnpm store prune",
            description: "Prunes unused pnpm packages via the official command.",
            requires_network: false,
            impact: "Subsequent installs may re-download packages.",
        }],
    },
    ProviderDef {
        id: "yarn",
        name: "Yarn",
        cache_paths: YARN_CACHE,
        version_exe: "yarn",
        read_only: false,
        note: None,
        actions: &[ActionDef {
            id: "yarn.cache.clean",
            exe: "yarn",
            args: &["cache", "clean"],
            label: "yarn cache clean",
            description: "Cleans Yarn cache via the official command.",
            requires_network: false,
            impact: "Subsequent installs may re-download packages.",
        }],
    },
    ProviderDef {
        id: "bun",
        name: "Bun",
        cache_paths: BUN_CACHE,
        version_exe: "bun",
        read_only: false,
        note: None,
        actions: &[ActionDef {
            id: "bun.cache.rm",
            exe: "bun",
            args: &["pm", "cache", "rm"],
            label: "bun pm cache rm",
            description: "Cleans Bun package cache via the official command.",
            requires_network: false,
            impact: "Subsequent installs may re-download packages.",
        }],
    },
    ProviderDef {
        id: "pip",
        name: "pip",
        cache_paths: PIP_CACHE,
        version_exe: "pip",
        read_only: false,
        note: None,
        actions: &[ActionDef {
            id: "pip.cache.purge",
            exe: "pip",
            args: &["cache", "purge"],
            label: "pip cache purge",
            description: "Purges pip wheel cache via the official command.",
            requires_network: false,
            impact: "Subsequent installs may re-download packages.",
        }],
    },
    ProviderDef {
        id: "uv",
        name: "uv",
        cache_paths: UV_CACHE,
        version_exe: "uv",
        read_only: false,
        note: None,
        actions: &[ActionDef {
            id: "uv.cache.clean",
            exe: "uv",
            args: &["cache", "clean"],
            label: "uv cache clean",
            description: "Cleans uv package and wheel cache via the official command.",
            requires_network: false,
            impact: "Subsequent virtual environment builds will re-download packages as needed.",
        }],
    },
    ProviderDef {
        id: "cargo",
        name: "Cargo",
        cache_paths: CARGO_CACHE,
        version_exe: "cargo",
        read_only: false,
        note: Some(
            "Downloaded .crate archives and git repositories cache. Re-downloaded during compilation as needed.",
        ),
        actions: &[],
    },
    ProviderDef {
        id: "gradle",
        name: "Gradle",
        cache_paths: GRADLE_CACHE,
        version_exe: "gradle",
        read_only: false,
        note: Some(
            "Gradle dependency and wrapper cache. Automatically re-downloaded during Android/Java builds.",
        ),
        actions: &[],
    },
    ProviderDef {
        id: "maven",
        name: "Maven",
        cache_paths: MAVEN_CACHE,
        version_exe: "mvn",
        read_only: false,
        note: Some(
            "Global .m2 local repository library cache. Re-fetched when projects build.",
        ),
        actions: &[],
    },
    ProviderDef {
        id: "composer",
        name: "Composer",
        cache_paths: COMPOSER_CACHE,
        version_exe: "composer",
        read_only: false,
        note: None,
        actions: &[ActionDef {
            id: "composer.clear-cache",
            exe: "composer",
            args: &["clear-cache"],
            label: "composer clear-cache",
            description: "Cleans Composer download and metadata cache via the official command.",
            requires_network: false,
            impact: "Subsequent dependency installs may re-download packages.",
        }],
    },
    ProviderDef {
        id: "conda",
        name: "Conda",
        cache_paths: CONDA_CACHE,
        version_exe: "conda",
        read_only: false,
        note: Some(
            "Package tarballs and index cache are cleaned; existing environments are preserved.",
        ),
        actions: &[ActionDef {
            id: "conda.clean.all",
            exe: "conda",
            args: &["clean", "--all", "-y"],
            label: "conda clean --all -y",
            description: "Cleans unused Conda package tarballs and temporary caches.",
            requires_network: false,
            impact: "Only package cache is cleaned; installed environments are unaffected.",
        }],
    },
    ProviderDef {
        id: "playwright",
        name: "Playwright",
        cache_paths: PLAYWRIGHT_CACHE,
        version_exe: "playwright",
        read_only: false,
        note: Some(
            "Test browsers (Chromium, Firefox, WebKit) are removed; reinstall via npx playwright install.",
        ),
        actions: &[ActionDef {
            id: "playwright.uninstall.all",
            exe: "npx",
            args: &["playwright", "uninstall", "--all"],
            label: "npx playwright uninstall --all",
            description: "Removes downloaded Playwright test browsers via the official command.",
            requires_network: false,
            impact: "Browser binaries are removed; re-downloaded when tests run.",
        }],
    },
    ProviderDef {
        id: "cypress",
        name: "Cypress",
        cache_paths: CYPRESS_CACHE,
        version_exe: "cypress",
        read_only: false,
        note: Some(
            "Cached Cypress runtime versions are cleaned; re-downloaded when tests run.",
        ),
        actions: &[ActionDef {
            id: "cypress.cache.clear",
            exe: "npx",
            args: &["cypress", "cache", "clear"],
            label: "npx cypress cache clear",
            description: "Clears downloaded Cypress runtime versions via the official command.",
            requires_network: false,
            impact: "Cypress binaries are deleted; re-downloaded during subsequent test runs.",
        }],
    },
    ProviderDef {
        id: "vcpkg",
        name: "vcpkg",
        cache_paths: VCPKG_CACHE,
        version_exe: "vcpkg",
        read_only: false,
        note: Some(
            "vcpkg binary package archives cache. Recreated when packages are recompiled.",
        ),
        actions: &[],
    },
    ProviderDef {
        id: "huggingface",
        name: "Hugging Face",
        cache_paths: HUGGINGFACE_CACHE,
        version_exe: "huggingface-cli",
        read_only: false,
        note: Some(
            "Downloaded local AI model weights and tokenizer cache. Re-fetched when model code runs.",
        ),
        actions: &[],
    },
    ProviderDef {
        id: "nuget",
        name: "NuGet / .NET",
        cache_paths: NUGET_CACHE,
        version_exe: "dotnet",
        read_only: false,
        note: Some("If global packages folder is cleared, projects will restore packages on next build."),
        actions: &[ActionDef {
            id: "dotnet.nuget.clear",
            exe: "dotnet",
            args: &["nuget", "locals", "all", "--clear"],
            label: "dotnet nuget locals all --clear",
            description: "Clears NuGet http-cache and global packages cache via the official command.",
            requires_network: true,
            impact: "Subsequent builds may re-download packages.",
        }],
    },
    ProviderDef {
        id: "go",
        name: "Go",
        cache_paths: GO_CACHE,
        version_exe: "go",
        read_only: false,
        note: None,
        actions: &[ActionDef {
            id: "go.clean.modcache",
            exe: "go",
            args: &["clean", "-modcache"],
            label: "go clean -modcache",
            description: "Cleans Go module cache via the official command.",
            requires_network: true,
            impact: "Subsequent builds may re-download modules.",
        }],
    },
    ProviderDef {
        id: "docker",
        name: "Docker",
        cache_paths: &[
            "%LOCALAPPDATA%\\Docker\\wsl\\disk\\docker_data.vhdx",
            "%USERPROFILE%\\.docker",
        ],
        version_exe: "docker",
        read_only: true,
        note: Some(
            "Docker image and volume data is not deleted by Dev Cleaner. Use Docker Desktop for management.",
        ),
        actions: &[],
    },
    ProviderDef {
        id: "wsl",
        name: "WSL",
        cache_paths: &["%LOCALAPPDATA%\\Packages"],
        version_exe: "wsl",
        read_only: true,
        note: Some(
            "WSL virtual disk (VHDX) size is not reclaimable raw space; Dev Cleaner does not delete or compact this file.",
        ),
        actions: &[],
    },
    ProviderDef {
        id: "pub",
        name: "Dart / Flutter (Pub)",
        cache_paths: PUB_CACHE,
        version_exe: "dart",
        read_only: false,
        note: None,
        actions: &[ActionDef {
            id: "dart.pub.cache.clean",
            exe: "dart",
            args: &["pub", "cache", "clean", "--force"],
            label: "dart pub cache clean",
            description: "Cleans Dart and Flutter package cache via the official command.",
            requires_network: false,
            impact: "Subsequent build steps may re-download packages.",
        }],
    },
    ProviderDef {
        id: "electron",
        name: "Electron",
        cache_paths: ELECTRON_CACHE,
        version_exe: "electron",
        read_only: false,
        note: Some(
            "Downloaded Electron binaries and runtime cache. Re-fetched when projects build.",
        ),
        actions: &[],
    },
];

fn expand(path: &str) -> PathBuf {
    let mut out = path.to_string();
    for (key, value) in [
        ("%LOCALAPPDATA%", std::env::var("LOCALAPPDATA").ok()),
        ("%APPDATA%", std::env::var("APPDATA").ok()),
        ("%USERPROFILE%", std::env::var("USERPROFILE").ok()),
        ("%TEMP%", std::env::var("TEMP").ok()),
    ] {
        if let Some(value) = value {
            out = out.replace(key, &value);
        }
    }
    PathBuf::from(out)
}

pub fn find_executable(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        for ext in ["exe", "cmd", "bat"] {
            let candidate = dir.join(format!("{}.{}", name, ext));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Kills a process and all its descendants. `Child::kill` only terminates the
/// direct child, which leaves the real tool running when the command was
/// launched through `cmd.exe`.
fn terminate_process_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    // Windows-only product: there is no other platform to support. The previous
    // POSIX branch sent `kill -TERM -pid`, which is wrong for this target and
    // would never be compiled anyway.
    let mut cmd = Command::new("taskkill");
    cmd.args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let _ = cmd.status();
}

/// Runs a command with a hard timeout. Output is collected by
/// `wait_with_output` on a worker thread, so a tool that writes more than the
/// OS pipe buffer cannot deadlock the caller. On timeout the whole process tree
/// is terminated.
fn run_command_with_timeout(mut cmd: Command, timeout: Duration) -> Result<Output, AppError> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd
        .spawn()
        .map_err(|e| AppError::Unknown(format!("Failed to spawn command: {}", e)))?;
    let pid = child.id();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(e)) => Err(AppError::Unknown(format!(
            "Failed to read command output: {}",
            e
        ))),
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            terminate_process_tree(pid);
            // Give the waiter a chance to reap the killed child, but never
            // block the caller indefinitely if a grandchild escaped.
            let _ = rx.recv_timeout(Duration::from_secs(10));
            Err(AppError::Unknown(format!(
                "Tool command timed out after {} seconds; process tree was terminated.",
                timeout.as_secs()
            )))
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => Err(AppError::Unknown(
            "Command monitor channel closed unexpectedly.".to_string(),
        )),
    }
}

/// Quotes one argument for `cmd.exe /C`. Rust's default argument quoting
/// follows the MSVC runtime rules, but `cmd` applies its own parsing first, so
/// a path such as `C:\Program Files\nodejs\npm.cmd` must reach it wrapped in
/// explicit quotes.
///
/// Inside double quotes cmd treats `&`, `|`, `<`, `>` and `^` literally, so one
/// pair of quotes per token is enough. A literal `"` becomes `""`.
///
/// `%NAME%` is *not* escapable on a `/C` command line: doubling it (the batch
/// file rule) would insert a second percent sign here, and there is no other
/// syntax that suppresses expansion. Since the executable path is *discovered*
/// from disk (a user can own a directory literally named `%TEMP%`), silently
/// expanding it could run a different program than the one that was previewed.
/// Such a value is rejected instead of being passed through.
fn quote_cmd_arg(value: &str) -> Result<String, CmdQuoteError> {
    if value.contains('%') {
        return Err(CmdQuoteError::PercentExpansion);
    }
    if value.chars().any(|c| c.is_control()) {
        return Err(CmdQuoteError::ControlChar);
    }
    let escaped = value.replace('"', "\"\"");
    Ok(format!("\"{escaped}\""))
}

/// Why a token cannot be handed to `cmd.exe /C` safely.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CmdQuoteError {
    /// `%VAR%` would be expanded by cmd and cannot be escaped there.
    PercentExpansion,
    /// A control character could terminate the command line early.
    ControlChar,
}

impl std::fmt::Display for CmdQuoteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PercentExpansion => write!(
                f,
                "the tool path contains '%', which cmd.exe would expand; \
                 move the tool to a path without percent signs"
            ),
            Self::ControlChar => {
                write!(f, "the tool path contains a control character")
            }
        }
    }
}

fn command_for_executable(exe: &Path, args: &[String]) -> Result<Command, AppError> {
    if exe
        .extension()
        .map(|e| e.eq_ignore_ascii_case("exe"))
        .unwrap_or(false)
    {
        let mut command = Command::new(exe);
        command.args(args);
        return Ok(command);
    }

    // `.cmd`/`.bat` shims must run through cmd.exe. `Command::arg` would
    // quote the executable for the MSVC runtime, not for cmd's own parser,
    // so a space in the path broke the official cache cleanup (L14).
    let mut command = Command::new("cmd");
    command.arg("/C");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut line = quote_cmd_arg(&exe.to_string_lossy())
            .map_err(|err| AppError::InvalidPath(format!("Cannot run {}: {err}", exe.display())))?;
        for arg in args {
            line.push(' ');
            line.push_str(&quote_cmd_arg(arg).map_err(|err| {
                AppError::InvalidPath(format!(
                    "Cannot pass an argument to {}: {err}",
                    exe.display()
                ))
            })?);
        }
        command.raw_arg(line);
    }
    #[cfg(not(windows))]
    {
        command.arg(exe).args(args);
    }
    Ok(command)
}

fn version_args(name: &str) -> &'static [&'static str] {
    match name {
        // `go --version` is not a valid flag; the tool wants the subcommand.
        "go" => &["version"],
        _ => &["--version"],
    }
}

/// Decodes tool output that may be UTF-16LE (WSL on Windows writes UTF-16).
fn decode_output(bytes: &[u8]) -> String {
    let nul = bytes.iter().filter(|b| **b == 0).count();
    if bytes.len() >= 2 && nul * 3 >= bytes.len() {
        let units: Vec<u16> = bytes
            .as_chunks::<2>()
            .0
            .iter()
            .map(|chunk| u16::from_le_bytes(*chunk))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).to_string()
    }
}

/// Pulls just the version token out of a tool banner. Tools are not consistent:
/// `pip --version` prints "pip 26.2.1 from C:\...\packages\pip (python 3.12)",
/// Docker prints "Docker version 29.9.2, build a82e528" and Go prints
/// "go version go1.27.0 windows/amd64". Showing the whole first line blows up
/// the version chip and forces the card grid to overflow, so only the numeric
/// part is kept.
fn extract_version(line: &str) -> Option<String> {
    for raw in line.split_whitespace() {
        let token = raw.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '-');
        // Strip a product name glued to the number, e.g. "go1.27.0".
        let token = match token.find(|c: char| c.is_ascii_digit()) {
            Some(0) => token,
            Some(index) if token[..index].chars().all(|c| c.is_ascii_alphabetic()) => {
                &token[index..]
            }
            _ => continue,
        };
        let token = token.trim_start_matches(['v', 'V']).trim_matches('.');
        if token.is_empty() || !token.contains('.') {
            continue;
        }
        if token.chars().all(|c| c.is_ascii_digit() || c == '.') {
            return Some(token.to_string());
        }
    }
    None
}

/// Probes every unique executable's version banner concurrently and returns a
/// map keyed by executable name. The whole batch is bounded by
/// [`VERSION_BUDGET`]; names that did not answer in time are simply absent.
fn probe_versions(names: &[&str]) -> HashMap<String, String> {
    let mut unique: Vec<String> = Vec::new();
    for name in names {
        if !unique.iter().any(|existing| existing == name) {
            unique.push((*name).to_string());
        }
    }

    let (tx, rx) = std::sync::mpsc::channel::<(String, Option<String>)>();
    let total = unique.len();
    for name in unique {
        let tx = tx.clone();
        std::thread::spawn(move || {
            let version = tool_version(&name);
            let _ = tx.send((name, version));
        });
    }
    drop(tx);

    let deadline = Instant::now() + VERSION_BUDGET;
    let mut out = HashMap::with_capacity(total);
    let mut received = 0usize;
    while received < total {
        let now = Instant::now();
        let Some(remaining) = deadline.checked_duration_since(now) else {
            break;
        };
        match rx.recv_timeout(remaining) {
            Ok((name, Some(version))) => {
                out.insert(name, version);
                received += 1;
            }
            Ok((_, None)) => received += 1,
            Err(_) => break,
        }
    }
    out
}

fn tool_version(name: &str) -> Option<String> {
    let exe = find_executable(name)?;
    let args: Vec<String> = version_args(name).iter().map(|s| s.to_string()).collect();
    // A path that cmd.exe would expand (`%TEMP%`) cannot be probed safely; the
    // card then simply shows no version instead of running the wrong program.
    let cmd = command_for_executable(&exe, &args).ok()?;
    let output = run_command_with_timeout(cmd, VERSION_TIMEOUT).ok()?;
    let text = if output.stdout.is_empty() {
        decode_output(&output.stderr)
    } else {
        decode_output(&output.stdout)
    };
    let first = text.lines().map(str::trim).find(|line| !line.is_empty())?;
    let cleaned = first.trim_start_matches('\u{feff}').trim();
    if cleaned.is_empty() {
        None
    } else if let Some(version) = extract_version(cleaned) {
        Some(version)
    } else {
        // Unrecognised banner: keep a short, single-line fallback rather than
        // letting an arbitrary long line into the chip.
        Some(
            cleaned
                .chars()
                .take(24)
                .collect::<String>()
                .trim_end()
                .to_string(),
        )
    }
}

fn action_infos(def: &ProviderDef) -> Vec<OfficialActionInfo> {
    def.actions
        .iter()
        .map(|a| {
            let exe = find_executable(a.exe);
            OfficialActionInfo {
                id: a.id.to_string(),
                label: a.label.to_string(),
                description: a.description.to_string(),
                executable: exe.as_ref().map(|p| p.to_string_lossy().to_string()),
                args: a.args.iter().map(|s| s.to_string()).collect(),
                available: exe.is_some(),
                unavailable_reason: if exe.is_none() {
                    Some(format!("'{}' was not found on the system PATH.", a.exe))
                } else {
                    None
                },
                requires_network: a.requires_network,
                impact: a.impact.to_string(),
            }
        })
        .collect()
}

/// Lists providers and their paths without walking any directory. This is the
/// fast call the UI renders first; sizes arrive later from
/// [`measure_cache_providers`].
pub fn list_cache_providers() -> Vec<CacheProviderInfo> {
    let version_names: Vec<&str> = ACTIONS.iter().map(|def| def.version_exe).collect();
    // One parallel batch instead of a blocking `--version` per provider (M9).
    let versions = probe_versions(&version_names);

    ACTIONS
        .iter()
        .map(|def| {
            let paths: Vec<CachePathInfo> = def
                .cache_paths
                .iter()
                .map(|p| {
                    let expanded = expand(p);
                    CachePathInfo {
                        path: expanded.to_string_lossy().to_string(),
                        exists: expanded.exists(),
                        bytes: None,
                        unmeasured_reason: if def.read_only {
                            Some("readOnly".to_string())
                        } else {
                            None
                        },
                    }
                })
                .collect();

            let detected =
                paths.iter().any(|p| p.exists) || find_executable(def.version_exe).is_some();

            CacheProviderInfo {
                id: def.id.to_string(),
                name: def.name.to_string(),
                detected,
                version: versions.get(def.version_exe).cloned(),
                cache_paths: paths,
                total_bytes: 0,
                actions: action_infos(def),
                read_only: def.read_only,
                note: def.note.map(|n| n.to_string()),
                measured: false,
            }
        })
        .collect()
}

fn measure_dirs(
    paths: &[CachePathInfo],
    token: &CancellationToken,
    files_only: bool,
    read_only: bool,
    deadline: Option<Instant>,
) -> Vec<CachePathInfo> {
    paths
        .iter()
        .map(|info| {
            let path = PathBuf::from(&info.path);
            let bytes = if !path.exists() || (files_only && !path.is_file()) {
                None
            } else {
                measure_path_with_deadline(&path, TargetKind::Directory, token, deadline)
                    .map(|s| s.allocated_bytes.unwrap_or(s.logical_bytes))
            };
            let unmeasured_reason = if bytes.is_none() && path.exists() {
                Some(if read_only { "readOnly" } else { "error" }.to_string())
            } else {
                None
            };
            CachePathInfo {
                path: info.path.clone(),
                exists: path.exists(),
                bytes,
                unmeasured_reason,
            }
        })
        .collect()
}

/// Measures one cache path. A plain file (e.g. a Docker VHDX) is read from its
/// metadata instead of being walked, and read-only providers never walk
/// directories: those trees belong to another tool and walking them took
/// minutes on real machines without producing an actionable number.
fn measure_cache_path(
    def: &ProviderDef,
    path: &Path,
    token: &CancellationToken,
    deadline: Instant,
) -> Option<u64> {
    if !path.exists() {
        return None;
    }
    if path.is_file() {
        return std::fs::metadata(path).ok().map(|m| m.len());
    }
    if def.read_only {
        return None;
    }
    measure_path_with_deadline(path, TargetKind::Directory, token, Some(deadline))
        .map(|s| s.allocated_bytes.unwrap_or(s.logical_bytes))
}

/// Streams one event per measured path so the UI can show progress and cancel.
///
/// `provider_ids` narrows the run to the providers that actually changed (for
/// example the one a just-executed official action touched). Passing `None` or
/// an empty slice keeps the historical behaviour and measures everything.
pub fn measure_cache_providers<F>(
    token: &CancellationToken,
    provider_ids: Option<&[String]>,
    mut emit: F,
) where
    F: FnMut(CacheMeasureEvent),
{
    let selected: Vec<&ProviderDef> = match provider_ids {
        Some(ids) if !ids.is_empty() => ACTIONS
            .iter()
            .filter(|def| ids.iter().any(|id| id == def.id))
            .collect(),
        _ => ACTIONS.iter().collect(),
    };

    emit(CacheMeasureEvent::Started {
        provider_count: selected.len(),
    });

    if selected.is_empty() {
        emit(CacheMeasureEvent::Finished);
        return;
    }

    // Measure up to 4 cache providers in parallel while streaming events back
    // over a channel so the UI updates progressively without serial stalls.
    let worker_count = selected.len().min(4);
    let next_index = std::sync::atomic::AtomicUsize::new(0);
    let (tx, rx) = crossbeam_channel::unbounded::<CacheMeasureEvent>();

    std::thread::scope(|scope| {
        for _ in 0..worker_count {
            let tx = tx.clone();
            let selected = &selected;
            let next_index = &next_index;
            scope.spawn(move || loop {
                if token.is_cancelled() {
                    return;
                }
                let idx = next_index.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let Some(def) = selected.get(idx) else {
                    return;
                };
                let mut total_bytes = 0u64;
                for raw in def.cache_paths {
                    if token.is_cancelled() {
                        return;
                    }
                    let path = expand(raw);
                    let exists = path.exists();
                    let deadline = Instant::now() + CACHE_PATH_MEASURE_BUDGET;
                    let bytes = measure_cache_path(def, &path, token, deadline);
                    if let Some(bytes) = bytes {
                        total_bytes = total_bytes.saturating_add(bytes);
                    }
                    let unmeasured_reason = if bytes.is_none() && exists {
                        let reason = if def.read_only {
                            "readOnly"
                        } else if Instant::now() >= deadline {
                            "timedOut"
                        } else {
                            "error"
                        };
                        Some(reason.to_string())
                    } else {
                        None
                    };
                    let _ = tx.send(CacheMeasureEvent::PathMeasured {
                        provider_id: def.id.to_string(),
                        path: path.to_string_lossy().to_string(),
                        exists,
                        bytes,
                        unmeasured_reason,
                    });
                }
                if token.is_cancelled() {
                    return;
                }
                let _ = tx.send(CacheMeasureEvent::ProviderFinished {
                    provider_id: def.id.to_string(),
                    total_bytes,
                });
            });
        }
        drop(tx);

        for event in rx {
            if token.is_cancelled() {
                break;
            }
            emit(event);
        }
    });

    if token.is_cancelled() {
        emit(CacheMeasureEvent::Cancelled);
    } else {
        emit(CacheMeasureEvent::Finished);
    }
}

/// Pending official-action previews kept at once.
///
/// Each entry is small, but the map was only pruned by age: a client that
/// previews in a loop kept one entry per attempt for the whole five minute
/// window. The newest token is the one the user/agent can still confirm, so the
/// oldest is evicted.
const MAX_PENDING_ACTIONS: usize = 16;

const PENDING_TTL: Duration = Duration::from_secs(300);

struct PendingAction {
    provider_id: String,
    action_id: String,
    before_bytes: u64,
    /// The preview measurement hit its time budget, so `before_bytes` is a
    /// lower bound. Carried to the result so the delta is not presented as an
    /// exact change value.
    before_truncated: bool,
    /// The executable resolved for the preview.
    ///
    /// Execution used to resolve the name against `PATH` again, so a `PATH`
    /// change (or a shim dropped into an earlier directory) between the preview
    /// the user approved and the run could execute a different program than the
    /// one shown in the dialog. The confirmed path is pinned here instead.
    exe: PathBuf,
    created: Instant,
}

#[derive(Default)]
pub struct OfficialActionRegistry {
    pending: Mutex<HashMap<String, PendingAction>>,
}

impl OfficialActionRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// A poisoned lock still guards a consistent map (the critical section is
    /// just an insert/remove), so recover instead of panicking the app.
    fn lock_pending(&self) -> std::sync::MutexGuard<'_, HashMap<String, PendingAction>> {
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn issue(
        &self,
        provider_id: &str,
        action_id: &str,
        exe: PathBuf,
        before_bytes: u64,
        before_truncated: bool,
    ) -> String {
        let token = uuid::Uuid::new_v4().simple().to_string();
        let mut pending = self.lock_pending();
        pending.retain(|_, p| p.created.elapsed() < PENDING_TTL);
        if pending.len() >= MAX_PENDING_ACTIONS {
            let oldest = pending
                .iter()
                .min_by_key(|(_, p)| p.created)
                .map(|(token, _)| token.clone());
            if let Some(token) = oldest {
                pending.remove(&token);
            }
        }
        pending.insert(
            token.clone(),
            PendingAction {
                provider_id: provider_id.to_string(),
                action_id: action_id.to_string(),
                before_bytes,
                before_truncated,
                exe,
                created: Instant::now(),
            },
        );
        token
    }

    fn take(&self, token: &str) -> Result<PendingAction, AppError> {
        let mut pending = self.lock_pending();
        let action = pending
            .remove(token)
            .ok_or_else(|| AppError::PlanInvalid("Action preview token is invalid.".to_string()))?;
        if action.created.elapsed() >= PENDING_TTL {
            return Err(AppError::PlanExpired(
                "Action preview token has expired.".to_string(),
            ));
        }
        Ok(action)
    }
}

fn provider_def(id: &str) -> Option<(usize, &'static ProviderDef)> {
    ACTIONS.iter().enumerate().find(|(_, p)| p.id == id)
}

pub fn preview_action(
    registry: &OfficialActionRegistry,
    provider_id: &str,
    action_id: &str,
    token: &CancellationToken,
) -> Result<OfficialActionPreview, AppError> {
    let (_, def) = provider_def(provider_id)
        .ok_or_else(|| AppError::InvalidPath(format!("Unknown provider: {}", provider_id)))?;
    if def.read_only {
        return Err(AppError::Blocked(
            "This provider is read-only; automated cleanup is not supported.".to_string(),
        ));
    }
    let action = def
        .actions
        .iter()
        .find(|a| a.id == action_id)
        .ok_or_else(|| AppError::InvalidPath(format!("Unknown action: {}", action_id)))?;
    let exe = find_executable(action.exe)
        .ok_or_else(|| AppError::PlatformUnsupported(format!("'{}' not found.", action.exe)))?;

    let paths: Vec<CachePathInfo> = def
        .cache_paths
        .iter()
        .map(|p| {
            let expanded = expand(p);
            CachePathInfo {
                path: expanded.to_string_lossy().to_string(),
                exists: expanded.exists(),
                bytes: None,
                unmeasured_reason: None,
            }
        })
        .collect();
    let measured = measure_dirs(
        &paths,
        token,
        false,
        false,
        Some(Instant::now() + PREVIEW_MEASURE_BUDGET),
    );
    let before: u64 = measured.iter().filter_map(|p| p.bytes).sum();
    let truncated = measured.iter().any(|p| p.exists && p.bytes.is_none());
    let token = registry.issue(provider_id, action_id, exe.clone(), before, truncated);

    Ok(OfficialActionPreview {
        token,
        provider_id: provider_id.to_string(),
        action_id: action_id.to_string(),
        executable: exe.to_string_lossy().to_string(),
        args: action.args.iter().map(|s| s.to_string()).collect(),
        before_bytes: before,
        measurement_truncated: truncated,
        expires_ms: crate::cleanup::plan::now_ms() + 300_000,
    })
}

pub fn execute_action(
    registry: &OfficialActionRegistry,
    token: &str,
) -> Result<OfficialActionResult, AppError> {
    let pending = registry.take(token)?;
    let provider_id = pending.provider_id;
    let action_id = pending.action_id;
    let before = pending.before_bytes;
    let before_truncated = pending.before_truncated;
    let (_, def) = provider_def(&provider_id)
        .ok_or_else(|| AppError::InvalidPath("Unknown provider.".to_string()))?;
    let action = def
        .actions
        .iter()
        .find(|a| a.id == action_id)
        .ok_or_else(|| AppError::InvalidPath("Unknown action.".to_string()))?;
    // Run the exact executable that was measured and shown in the preview. It
    // can still be missing (uninstalled in between), in which case the action is
    // refused rather than silently resolving another program from `PATH`.
    let exe = pending.exe;
    if !exe.is_file() {
        return Err(AppError::PlatformUnsupported(format!(
            "'{}' is no longer available.",
            action.exe
        )));
    }

    let started = Instant::now();
    let args: Vec<String> = action.args.iter().map(|s| s.to_string()).collect();
    let cmd = command_for_executable(&exe, &args)?;
    let output = run_command_with_timeout(cmd, COMMAND_TIMEOUT)?;
    let status = output.status;
    let stdout_tail = tail(&String::from_utf8_lossy(&output.stdout), 2000);
    let stderr_tail = tail(&String::from_utf8_lossy(&output.stderr), 2000);

    let token_cancel = CancellationToken::new();
    let paths: Vec<CachePathInfo> = def
        .cache_paths
        .iter()
        .map(|p| {
            let expanded = expand(p);
            CachePathInfo {
                path: expanded.to_string_lossy().to_string(),
                exists: expanded.exists(),
                bytes: None,
                unmeasured_reason: None,
            }
        })
        .collect();
    let measured = measure_dirs(
        &paths,
        &token_cancel,
        false,
        false,
        Some(Instant::now() + PREVIEW_MEASURE_BUDGET),
    );
    let after: u64 = measured.iter().filter_map(|p| p.bytes).sum();
    let after_truncated = measured.iter().any(|p| p.exists && p.bytes.is_none());
    let delta = after as i64 - before as i64;
    // A truncated "before" makes the delta just as unreliable as a truncated
    // "after"; both must be reported so the UI never presents a partial number
    // as the exact change.
    let measurement_truncated = before_truncated || after_truncated;

    Ok(OfficialActionResult {
        success: status.success(),
        exit_code: status.code(),
        provider_id: provider_id.clone(),
        action_id: action_id.clone(),
        label: action.label.to_string(),
        before_bytes: before,
        after_bytes: after,
        delta_bytes: delta,
        duration_ms: started.elapsed().as_millis() as u64,
        stdout_tail,
        stderr_tail,
        note: Some(if measurement_truncated {
            let reason = if before_truncated && after_truncated {
                "Size measurements before and after the action were time-limited; the change value is incomplete."
            } else if before_truncated {
                "The size measurement before the action was time-limited; the change value is incomplete."
            } else {
                "Size measurement after the action was time-limited; the change value is incomplete."
            };
            format!(
                "Exit code for {}: {:?}. {}",
                action.label,
                status.code(),
                reason
            )
        } else {
            format!("Exit code for {}: {:?}", action.label, status.code())
        }),
        measurement_truncated,
        audit_error: None,
    })
}

fn tail(text: &str, max: usize) -> String {
    let trimmed = text.trim();
    if trimmed.len() <= max {
        return trimmed.to_string();
    }
    let mut start = trimmed.len() - max;
    // Byte slicing must never split a multi-byte UTF-8 character, otherwise
    // `tail` panics when a tool prints non-ASCII output.
    while start < trimmed.len() && !trimmed.is_char_boundary(start) {
        start += 1;
    }
    trimmed[start..].to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        extract_version, quote_cmd_arg, tail, CacheMeasureEvent, CmdQuoteError,
        OfficialActionRegistry, MAX_PENDING_ACTIONS, PENDING_TTL,
    };
    use std::time::{Duration, Instant};

    #[test]
    fn quote_cmd_arg_keeps_shell_metacharacters_inside_quotes() {
        assert_eq!(
            quote_cmd_arg("C:\\Program Files\\nodejs\\npm.cmd").unwrap(),
            "\"C:\\Program Files\\nodejs\\npm.cmd\""
        );
        assert_eq!(quote_cmd_arg("a&b|c<d>e^f").unwrap(), "\"a&b|c<d>e^f\"");
        assert_eq!(quote_cmd_arg("say \"hi\"").unwrap(), "\"say \"\"hi\"\"\"");
    }

    #[test]
    fn quote_cmd_arg_rejects_unrecoverable_tokens() {
        // `%VAR%` is expanded by cmd.exe on a /C line and cannot be escaped.
        assert_eq!(
            quote_cmd_arg("C:\\Users\\me\\%TEMP%\\npm.cmd"),
            Err(CmdQuoteError::PercentExpansion)
        );
        // A control character could terminate the command line early.
        assert_eq!(quote_cmd_arg("a\nb"), Err(CmdQuoteError::ControlChar));
        assert_eq!(quote_cmd_arg("a\0b"), Err(CmdQuoteError::ControlChar));
    }

    #[test]
    fn tail_is_utf8_safe() {
        let text = "başlangıç".repeat(400);
        let result = tail(&text, 101);
        assert!(result.len() <= 101);
        assert!(text.ends_with(&result));
    }

    #[test]
    fn tail_keeps_short_text() {
        assert_eq!(tail("  kısa çıktı  ", 100), "kısa çıktı");
    }

    #[test]
    fn version_banners_reduce_to_the_numeric_part() {
        // Real-world banners: keeping the whole line overflowed the card grid.
        assert_eq!(
            extract_version("pip 26.2.1 from C:\\Users\\emir\\AppData\\Local\\Programs\\Python\\Python312\\Lib\\site-packages\\pip (python 3.12)").as_deref(),
            Some("26.2.1")
        );
        assert_eq!(
            extract_version("Docker version 29.9.2, build a82e528").as_deref(),
            Some("29.9.2")
        );
        assert_eq!(
            extract_version("go version go1.27.0 windows/amd64").as_deref(),
            Some("1.27.0")
        );
        assert_eq!(extract_version("npm 11.9.1").as_deref(), Some("11.9.1"));
        assert_eq!(extract_version("10.0.403").as_deref(), Some("10.0.403"));
        assert_eq!(
            extract_version("WSL sürümü: 2.7.14.0").as_deref(),
            Some("2.7.14.0")
        );
        assert_eq!(extract_version("Yarn 1.22.22").as_deref(), Some("1.22.22"));
    }

    #[test]
    fn version_extraction_rejects_non_versions() {
        assert_eq!(extract_version("command not found"), None);
        assert_eq!(extract_version("v2"), None);
        assert_eq!(extract_version(""), None);
    }

    #[test]
    fn pending_actions_stay_bounded_and_drop_the_oldest() {
        let registry = OfficialActionRegistry::new();
        let mut tokens = Vec::new();
        for _ in 0..MAX_PENDING_ACTIONS {
            tokens.push(registry.issue(
                "npm",
                "npm.cache.clean",
                std::path::PathBuf::from("npm.cmd"),
                0,
                false,
            ));
        }
        // Make the order deterministic: the map is filled within microseconds,
        // so rely on explicit ages instead of insertion timing.
        {
            let now = Instant::now();
            let mut pending = registry.lock_pending();
            for (index, token) in tokens.iter().enumerate() {
                let age = u64::try_from(MAX_PENDING_ACTIONS - index).unwrap_or(0);
                let action = pending.get_mut(token).expect("token was just issued");
                action.created = now.checked_sub(Duration::from_secs(age)).unwrap_or(now);
            }
        }

        let newest = registry.issue(
            "npm",
            "npm.cache.clean",
            std::path::PathBuf::from("npm.cmd"),
            0,
            false,
        );

        // Exactly the oldest preview was evicted; the rest is still capped.
        assert!(registry.take(&tokens[0]).is_err());
        assert!(registry.take(&tokens[1]).is_ok());
        assert!(registry.take(&newest).is_ok());
        assert_eq!(
            registry.lock_pending().len(),
            MAX_PENDING_ACTIONS - 2,
            "two tokens were consumed after exactly one was evicted"
        );
    }

    #[test]
    fn an_expired_action_token_is_rejected() {
        let registry = OfficialActionRegistry::new();
        let token = registry.issue(
            "npm",
            "npm.cache.clean",
            std::path::PathBuf::from("npm.cmd"),
            0,
            false,
        );
        {
            let mut pending = registry.lock_pending();
            let action = pending.get_mut(&token).expect("token was just issued");
            action.created = Instant::now()
                .checked_sub(PENDING_TTL + Duration::from_secs(1))
                .unwrap_or_else(Instant::now);
        }
        assert!(registry.take(&token).is_err());
        assert!(
            registry.lock_pending().is_empty(),
            "an expired token is removed, not left to grow the map"
        );
    }

    #[test]
    fn cache_measure_events_serialize_as_camel_case() {
        // The frontend switches on these exact keys; a snake_case regression
        // would silently freeze the progress display.
        let started =
            serde_json::to_value(CacheMeasureEvent::Started { provider_count: 5 }).unwrap();
        assert_eq!(started["type"], "started");
        assert_eq!(started["providerCount"], 5);

        let path = serde_json::to_value(CacheMeasureEvent::PathMeasured {
            provider_id: "pnpm".to_string(),
            path: "C:\\cache".to_string(),
            exists: true,
            bytes: Some(42),
            unmeasured_reason: None,
        })
        .unwrap();
        assert_eq!(path["type"], "pathMeasured");
        assert_eq!(path["providerId"], "pnpm");
        assert_eq!(path["bytes"], 42);
    }
}
