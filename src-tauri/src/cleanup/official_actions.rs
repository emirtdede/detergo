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
    /// False until the streaming measurement pass has reported a value.
    pub measured: bool,
}

/// Progress events for the asynchronous cache measurement pass.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum CacheMeasureEvent {
    Started { provider_count: usize },
    PathMeasured {
        provider_id: String,
        path: String,
        exists: bool,
        bytes: Option<u64>,
    },
    ProviderFinished {
        provider_id: String,
        total_bytes: u64,
    },
    Finished,
    Cancelled,
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
            description: "uv paket ve wheel önbelleğini resmî komutla temizler.",
            requires_network: false,
            impact: "Sonraki sanal ortam kurulumlarında paketler ihtiyaç halinde yeniden indirilir.",
        }],
    },
    ProviderDef {
        id: "cargo",
        name: "Cargo",
        cache_paths: CARGO_CACHE,
        version_exe: "cargo",
        read_only: false,
        note: Some(
            "İndirilen .crate arşivleri ve git depoları önbelleğidir. Gerektiğinde derleme sırasında yeniden indirilir.",
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
            "Gradle bağımlılık ve wrapper önbelleğidir. Android/Java derlemelerinde otomatik yeniden indirilir.",
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
            "Global .m2 yerel depo kütüphane önbelleğidir. Projeler build edildiğinde eksikler yeniden çekilir.",
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
            description: "Composer indirme ve paket metaveri önbelleğini resmî komutla temizler.",
            requires_network: false,
            impact: "Sonraki bağımlılık kurulumlarında paketler yeniden indirebilir.",
        }],
    },
    ProviderDef {
        id: "conda",
        name: "Conda",
        cache_paths: CONDA_CACHE,
        version_exe: "conda",
        read_only: false,
        note: Some(
            "Paket tarball ve indeks önbelleği temizlenir; mevcut sanal ortamlar korunur.",
        ),
        actions: &[ActionDef {
            id: "conda.clean.all",
            exe: "conda",
            args: &["clean", "--all", "-y"],
            label: "conda clean --all -y",
            description: "Kullanılmayan Conda paket tarball'larını ve geçici önbellekleri temizler.",
            requires_network: false,
            impact: "Yalnızca paket önbelleği temizlenir; kurulu ortamlar etkilenmez.",
        }],
    },
    ProviderDef {
        id: "playwright",
        name: "Playwright",
        cache_paths: PLAYWRIGHT_CACHE,
        version_exe: "playwright",
        read_only: false,
        note: Some(
            "Test tarayıcıları (Chromium, Firefox, WebKit) temizlenir; npx playwright install ile yeniden yüklenir.",
        ),
        actions: &[ActionDef {
            id: "playwright.uninstall.all",
            exe: "npx",
            args: &["playwright", "uninstall", "--all"],
            label: "npx playwright uninstall --all",
            description: "İndirilmiş Playwright test tarayıcılarını resmî komutla temizler.",
            requires_network: false,
            impact: "Tarayıcı ikilileri kaldırılır; testler çalıştırıldığında yeniden indirilir.",
        }],
    },
    ProviderDef {
        id: "cypress",
        name: "Cypress",
        cache_paths: CYPRESS_CACHE,
        version_exe: "cypress",
        read_only: false,
        note: Some(
            "Önbelleğe alınmış Cypress çalışma sürümleri temizlenir; test çalıştırıldığında tekrar indirilir.",
        ),
        actions: &[ActionDef {
            id: "cypress.cache.clear",
            exe: "npx",
            args: &["cypress", "cache", "clear"],
            label: "npx cypress cache clear",
            description: "İndirilmiş Cypress çalışma zamanı sürümlerini resmî komutla temizler.",
            requires_network: false,
            impact: "Cypress ikilileri silinir; sonraki test çalıştırmasında yeniden indirilir.",
        }],
    },
    ProviderDef {
        id: "vcpkg",
        name: "vcpkg",
        cache_paths: VCPKG_CACHE,
        version_exe: "vcpkg",
        read_only: false,
        note: Some(
            "vcpkg ikili paket arşivleri önbelleğidir. Paketler yeniden derlendiğinde arşivler tekrar oluşur.",
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
            "İndirilen yerel yapay zeka model ağırlıkları ve tokenizer önbelleğidir. Kod çalıştırıldığında model tekrar çekilir.",
        ),
        actions: &[],
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
        name: "Docker",
        cache_paths: &[
            "%LOCALAPPDATA%\\Docker\\wsl\\disk\\docker_data.vhdx",
            "%USERPROFILE%\\.docker",
        ],
        version_exe: "docker",
        read_only: true,
        note: Some(
            "Docker imaj/volume verisi Dev Cleaner tarafından silinmez. Yönetim için Docker Desktop kullanın.",
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
            "WSL sanal disk (VHDX) boyutu gerçek boş alan değildir; Dev Cleaner bu dosyayı silmez veya küçültmez.",
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
            description: "Dart ve Flutter paket önbelleğini resmî komutla temizler.",
            requires_network: false,
            impact: "Sonraki build işlemlerinde paketler yeniden indirilebilir.",
        }],
    },
    ProviderDef {
        id: "electron",
        name: "Electron",
        cache_paths: ELECTRON_CACHE,
        version_exe: "electron",
        read_only: false,
        note: Some(
            "İndirilmiş Electron ikili dosyaları ve çalışma zamanı önbelleğidir. Proje derlendiğinde yeniden çekilir.",
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
            Some(index) if token[..index].chars().all(|c| c.is_ascii_alphabetic()) => &token[index..],
            _ => continue,
        };
        let token = token.trim_start_matches(['v', 'V']).trim_matches('.');
        if token.is_empty() || !token.contains('.') {
            continue;
        }
        if token
            .chars()
            .all(|c| c.is_ascii_digit() || c == '.')
        {
            return Some(token.to_string());
        }
    }
    None
}

fn tool_version(name: &str) -> Option<String> {
    let exe = find_executable(name)?;
    let args: Vec<String> = version_args(name).iter().map(|s| s.to_string()).collect();
    let cmd = command_for_executable(&exe, &args);
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
        Some(cleaned.chars().take(24).collect::<String>().trim_end().to_string())
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
                    Some(format!("'{}' sistem PATH üzerinde bulunamadı.", a.exe))
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

            let detected =
                paths.iter().any(|p| p.exists) || find_executable(def.version_exe).is_some();

            CacheProviderInfo {
                id: def.id.to_string(),
                name: def.name.to_string(),
                detected,
                version: tool_version(def.version_exe),
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

/// Measures one cache path. A plain file (e.g. a Docker VHDX) is read from its
/// metadata instead of being walked, and read-only providers never walk
/// directories: those trees belong to another tool and walking them took
/// minutes on real machines without producing an actionable number.
fn measure_cache_path(
    def: &ProviderDef,
    path: &Path,
    token: &CancellationToken,
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
    measure_path(path, TargetKind::Directory, token)
        .map(|s| s.allocated_bytes.unwrap_or(s.logical_bytes))
}

/// Streams one event per measured path so the UI can show progress and cancel.
pub fn measure_cache_providers<F>(token: &CancellationToken, mut emit: F)
where
    F: FnMut(CacheMeasureEvent),
{
    emit(CacheMeasureEvent::Started {
        provider_count: ACTIONS.len(),
    });

    for def in ACTIONS {
        if token.is_cancelled() {
            emit(CacheMeasureEvent::Cancelled);
            return;
        }
        let mut total_bytes = 0u64;
        for raw in def.cache_paths {
            if token.is_cancelled() {
                emit(CacheMeasureEvent::Cancelled);
                return;
            }
            let path = expand(raw);
            let exists = path.exists();
            let bytes = measure_cache_path(def, &path, token);
            if let Some(bytes) = bytes {
                total_bytes = total_bytes.saturating_add(bytes);
            }
            emit(CacheMeasureEvent::PathMeasured {
                provider_id: def.id.to_string(),
                path: path.to_string_lossy().to_string(),
                exists,
                bytes,
            });
        }
        if token.is_cancelled() {
            emit(CacheMeasureEvent::Cancelled);
            return;
        }
        emit(CacheMeasureEvent::ProviderFinished {
            provider_id: def.id.to_string(),
            total_bytes,
        });
    }

    emit(CacheMeasureEvent::Finished);
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
    use super::{extract_version, tail, CacheMeasureEvent};

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
        assert_eq!(extract_version("WSL sürümü: 2.7.14.0").as_deref(), Some("2.7.14.0"));
        assert_eq!(extract_version("Yarn 1.22.22").as_deref(), Some("1.22.22"));
    }

    #[test]
    fn version_extraction_rejects_non_versions() {
        assert_eq!(extract_version("command not found"), None);
        assert_eq!(extract_version("v2"), None);
        assert_eq!(extract_version(""), None);
    }

    #[test]
    fn cache_measure_events_serialize_as_camel_case() {
        // The frontend switches on these exact keys; a snake_case regression
        // would silently freeze the progress display.
        let started = serde_json::to_value(CacheMeasureEvent::Started {
            provider_count: 5,
        })
        .unwrap();
        assert_eq!(started["type"], "started");
        assert_eq!(started["providerCount"], 5);

        let path = serde_json::to_value(CacheMeasureEvent::PathMeasured {
            provider_id: "pnpm".to_string(),
            path: "C:\\cache".to_string(),
            exists: true,
            bytes: Some(42),
        })
        .unwrap();
        assert_eq!(path["type"], "pathMeasured");
        assert_eq!(path["providerId"], "pnpm");
        assert_eq!(path["bytes"], 42);
    }
}
