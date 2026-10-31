use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::error::AppError;
use crate::scanner::cancellation::CancellationToken;
use crate::scanner::measurement::measure_path;
use crate::catalog::TargetKind;

const COMMAND_TIMEOUT: Duration = Duration::from_secs(600);
const VERSION_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachePathInfo {
    pub path: String,
    pub exists: bool,
    pub bytes: Option<u64>,
}

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheProviderInfo {
    pub id: String,
    pub name: String,
    pub detected: bool,
    pub version: Option<String>,
    pub cache_paths: Vec<CachePathInfo>,
    pub total_bytes: u64,
    pub actions: Vec<OfficialActionInfo>,
    pub read_only: bool,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialActionPreview {
    pub token: String,
    pub provider_id: String,
    pub action_id: String,
    pub executable: String,
    pub args: Vec<String>,
    pub before_bytes: u64,
    pub warning: String,
    pub expires_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialActionResult {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub provider_id: String,
    pub action_id: String,
    pub label: String,
    pub before_bytes: u64,
    pub after_bytes: u64,
    pub delta_bytes: i64,
    pub duration_ms: u64,
    pub stdout_tail: String,
    pub stderr_tail: String,
    pub note: Option<String>,
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
            description: "npm önbelleğini resmî komutla temizler.",
            requires_network: false,
            impact: "Sonraki kurulumlar paketleri yeniden indirebilir.",
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
            description: "Kullanılmayan pnpm paketlerini resmî komutla kaldırır.",
            requires_network: false,
            impact: "Sonraki kurulumlar paketleri yeniden indirebilir.",
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
            description: "Yarn önbelleğini resmî komutla temizler.",
            requires_network: false,
            impact: "Sonraki kurulumlar paketleri yeniden indirebilir.",
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
            description: "Bun paket önbelleğini resmi komutla temizler.",
            requires_network: false,
            impact: "Sonraki kurulumlar paketleri yeniden indirebilir.",
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
            description: "pip tekerlek önbelleğini resmî komutla temizler.",
            requires_network: false,
            impact: "Sonraki kurulumlar paketleri yeniden indirebilir.",
        }],
    },
    ProviderDef {
        id: "nuget",
        name: "NuGet / .NET",
        cache_paths: NUGET_CACHE,
        version_exe: "dotnet",
        read_only: false,
        note: Some("Global paket klasörü temizlenirse projeler yeniden restore edilir."),
        actions: &[ActionDef {
            id: "dotnet.nuget.clear",
            exe: "dotnet",
            args: &["nuget", "locals", "all", "--clear"],
            label: "dotnet nuget locals all --clear",
            description: "NuGet http-cache ve global paket önbelleğini resmî komutla temizler.",
            requires_network: true,
            impact: "Sonraki derlemeler paketleri yeniden indirebilir.",
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
            description: "Go modül önbelleğini resmî komutla temizler.",
            requires_network: true,
            impact: "Sonraki derlemeler modülleri yeniden indirebilir.",
        }],
    },
    ProviderDef {
        id: "docker",
        name: "Docker (salt okunur)",
        cache_paths: &[
            "%LOCALAPPDATA%\\Docker\\wsl\\disk\\docker_data.vhdx",
            "%USERPROFILE%\\.docker",
        ],
        version_exe: "docker",
        read_only: true,
        note: Some(
            "Docker imaj/volume verisi Node Cleaner tarafından silinmez. Yönetim için Docker Desktop kullanın.",
        ),
        actions: &[],
    },
    ProviderDef {
        id: "wsl",
        name: "WSL (salt okunur)",
        cache_paths: &["%LOCALAPPDATA%\\Packages"],
        version_exe: "wsl",
        read_only: true,
        note: Some(
            "WSL sanal disk (VHDX) boyutu gerçek boş alan değildir; Node Cleaner bu dosyayı silmez veya küçültmez.",
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
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let mut cmd = Command::new("taskkill");
        cmd.args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let _ = cmd.status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &format!("-{}", pid)])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
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
        .map_err(|e| AppError::Unknown(format!("Komut başlatılamadı: {}", e)))?;
    let pid = child.id();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(e)) => Err(AppError::Unknown(format!(
            "Komut çıktısı okunamadı: {}",
            e
        ))),
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            terminate_process_tree(pid);
            // Give the waiter a chance to reap the killed child, but never
            // block the caller indefinitely if a grandchild escaped.
            let _ = rx.recv_timeout(Duration::from_secs(10));
            Err(AppError::Unknown(format!(
                "Araç komutu {} saniye içinde tamamlanmadı; süreç ağacı durduruldu.",
                timeout.as_secs()
            )))
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => Err(AppError::Unknown(
            "Komut izleyicisi beklenmedik biçimde kapandı.".to_string(),
        )),
    }
}

fn command_for_executable(exe: &Path, args: &[String]) -> Command {
    if exe
        .extension()
        .map(|e| e.eq_ignore_ascii_case("exe"))
        .unwrap_or(false)
    {
        let mut command = Command::new(exe);
        command.args(args);
        command
    } else {
        let mut command = Command::new("cmd");
        command.arg("/C").arg(exe);
        command.args(args);
        command
    }
}

fn tool_version(name: &str) -> Option<String> {
    let exe = find_executable(name)?;
    let cmd = command_for_executable(&exe, &["--version".to_string()]);
    let output = run_command_with_timeout(cmd, VERSION_TIMEOUT).ok()?;
    let text = if output.stdout.is_empty() {
        String::from_utf8_lossy(&output.stderr).to_string()
    } else {
        String::from_utf8_lossy(&output.stdout).to_string()
    };
    let first = text.lines().next().unwrap_or("").trim();
    if first.is_empty() {
        None
    } else {
        Some(first.chars().take(80).collect())
    }
}

fn measure_dirs(paths: &[CachePathInfo], token: &CancellationToken, files_only: bool) -> Vec<CachePathInfo> {
    paths
        .iter()
        .map(|info| {
            let path = PathBuf::from(&info.path);
            let bytes = if !path.exists() || (files_only && !path.is_file()) {
                None
            } else {
                measure_path(&path, TargetKind::Directory, token)
                    .map(|s| s.allocated_bytes.unwrap_or(s.logical_bytes))
            };
            CachePathInfo {
                path: info.path.clone(),
                exists: path.exists(),
                bytes,
            }
        })
        .collect()
}

pub fn list_cache_providers(token: &CancellationToken) -> Vec<CacheProviderInfo> {
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
                    }
                })
                .collect();
            let paths = measure_dirs(&paths, token, def.read_only);
            let total_bytes: u64 = paths.iter().filter_map(|p| p.bytes).sum();

            let actions = def
                .actions
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
                            Some(format!("'{}' sistem PATH üzerinde bulunamadı.", a.exe))
                        } else {
                            None
                        },
                        requires_network: a.requires_network,
                        impact: a.impact.to_string(),
                    }
                })
                .collect();

            let detected = paths.iter().any(|p| p.exists) || find_executable(def.version_exe).is_some();

            CacheProviderInfo {
                id: def.id.to_string(),
                name: def.name.to_string(),
                detected,
                version: tool_version(def.version_exe),
                cache_paths: paths,
                total_bytes,
                actions,
                read_only: def.read_only,
                note: def.note.map(|n| n.to_string()),
            }
        })
        .collect()
}

struct PendingAction {
    provider_id: String,
    action_id: String,
    before_bytes: u64,
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

    fn issue(&self, provider_id: &str, action_id: &str, before_bytes: u64) -> String {
        let token = uuid::Uuid::new_v4().simple().to_string();
        let mut pending = self.pending.lock().unwrap();
        pending.retain(|_, p| p.created.elapsed() < Duration::from_secs(300));
        pending.insert(
            token.clone(),
            PendingAction {
                provider_id: provider_id.to_string(),
                action_id: action_id.to_string(),
                before_bytes,
                created: Instant::now(),
            },
        );
        token
    }

    fn take(&self, token: &str) -> Result<(String, String, u64), AppError> {
        let mut pending = self.pending.lock().unwrap();
        let action = pending
            .remove(token)
            .ok_or_else(|| AppError::PlanInvalid("Araç işlem belirteci geçersiz.".to_string()))?;
        if action.created.elapsed() >= Duration::from_secs(300) {
            return Err(AppError::PlanExpired(
                "Araç işlem belirtecinin süresi doldu.".to_string(),
            ));
        }
        Ok((action.provider_id, action.action_id, action.before_bytes))
    }
}

fn provider_def(id: &str) -> Option<(usize, &'static ProviderDef)> {
    ACTIONS.iter().enumerate().find(|(_, p)| p.id == id)
}

pub fn preview_action(
    registry: &OfficialActionRegistry,
    provider_id: &str,
    action_id: &str,
) -> Result<OfficialActionPreview, AppError> {
    let (_, def) = provider_def(provider_id)
        .ok_or_else(|| AppError::InvalidPath(format!("Bilinmeyen sağlayıcı: {}", provider_id)))?;
    if def.read_only {
        return Err(AppError::Blocked(
            "Bu sağlayıcı salt okunur; otomatik temizleme desteklenmiyor.".to_string(),
        ));
    }
    let action = def
        .actions
        .iter()
        .find(|a| a.id == action_id)
        .ok_or_else(|| AppError::InvalidPath(format!("Bilinmeyen işlem: {}", action_id)))?;
    let exe = find_executable(action.exe).ok_or_else(|| {
        AppError::PlatformUnsupported(format!("'{}' bulunamadı.", action.exe))
    })?;

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
            }
        })
        .collect();
    let measured = measure_dirs(&paths, &token_cancel, false);
    let before: u64 = measured.iter().filter_map(|p| p.bytes).sum();
    let token = registry.issue(provider_id, action_id, before);

    Ok(OfficialActionPreview {
        token,
        provider_id: provider_id.to_string(),
        action_id: action_id.to_string(),
        executable: exe.to_string_lossy().to_string(),
        args: action.args.iter().map(|s| s.to_string()).collect(),
        before_bytes: before,
        warning: format!(
            "{} — Bu işlem yalnızca {} önbelleğini etkiler. {}",
            action.label, def.name, action.impact
        ),
        expires_ms: crate::cleanup::plan::now_ms() + 300_000,
    })
}

pub fn execute_action(
    registry: &OfficialActionRegistry,
    token: &str,
) -> Result<OfficialActionResult, AppError> {
    let (provider_id, action_id, before) = registry.take(token)?;
    let (_, def) = provider_def(&provider_id)
        .ok_or_else(|| AppError::InvalidPath("Bilinmeyen sağlayıcı.".to_string()))?;
    let action = def
        .actions
        .iter()
        .find(|a| a.id == action_id)
        .ok_or_else(|| AppError::InvalidPath("Bilinmeyen işlem.".to_string()))?;
    let exe = find_executable(action.exe)
        .ok_or_else(|| AppError::PlatformUnsupported(format!("'{}' bulunamadı.", action.exe)))?;

    let started = Instant::now();
    let args: Vec<String> = action.args.iter().map(|s| s.to_string()).collect();
    let cmd = command_for_executable(&exe, &args);
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
            }
        })
        .collect();
    let measured = measure_dirs(&paths, &token_cancel, false);
    let after: u64 = measured.iter().filter_map(|p| p.bytes).sum();
    let delta = after as i64 - before as i64;

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
        note: Some(format!(
            "{} komutu için çıkış kodu: {:?}",
            action.label,
            status.code()
        )),
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

pub fn _path_display(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::tail;

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
}
