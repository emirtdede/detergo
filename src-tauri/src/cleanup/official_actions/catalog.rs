//! Declarative catalog of supported developer tool caches and safe cleanup actions.

use std::path::{Path, PathBuf};

#[derive(Clone, Copy)]
pub(super) enum ActionKind {
    /// Invoke the tool's own verified CLI subcommand with fixed argv.
    Command {
        exe: &'static str,
        args: &'static [&'static str],
    },
    /// Move the provider's audited, regenerable cache subdirectories to the OS
    /// Recycle Bin via `PathGuard` + `RecycleBinSession` (never touching user
    /// config, credentials, or installed binaries).
    SafeCacheRecycle {
        /// Optional process stems that must not be running during cleanup.
        blocked_processes: &'static [&'static str],
    },
}

pub(super) struct ActionDef {
    pub id: &'static str,
    pub kind: ActionKind,
    pub label: &'static str,
    pub description: &'static str,
    pub requires_network: bool,
    pub impact: &'static str,
}

pub(super) struct ProviderDef {
    pub id: &'static str,
    pub name: &'static str,
    pub version_exe: &'static str,
    pub actions: &'static [ActionDef],
    pub read_only: bool,
    /// When `true`, bulk commands like `detergo c all -y` skip this
    /// provider unless explicitly requested by ID (e.g. multi-GB local LLM
    /// model weights in Ollama or Hugging Face).
    pub opt_in_only: bool,
    pub note: Option<&'static str>,
}

pub(super) const ACTIONS: &[ProviderDef] = &[
    ProviderDef {
        id: "npm",
        name: "npm",
        version_exe: "npm",
        read_only: false,
        opt_in_only: false,
        note: None,
        actions: &[ActionDef {
            id: "npm.cache.clean",
            kind: ActionKind::Command {
                exe: "npm",
                args: &["cache", "clean", "--force"],
            },
            label: "npm cache clean --force",
            description: "Cleans npm cache via the official command.",
            requires_network: false,
            impact: "Subsequent installs may re-download packages.",
        }],
    },
    ProviderDef {
        id: "pnpm",
        name: "pnpm",
        version_exe: "pnpm",
        read_only: false,
        opt_in_only: false,
        note: None,
        actions: &[ActionDef {
            id: "pnpm.store.prune",
            kind: ActionKind::Command {
                exe: "pnpm",
                args: &["store", "prune"],
            },
            label: "pnpm store prune",
            description: "Prunes unused pnpm packages via the official command.",
            requires_network: false,
            impact: "Subsequent installs may re-download packages.",
        }],
    },
    ProviderDef {
        id: "yarn",
        name: "Yarn",
        version_exe: "yarn",
        read_only: false,
        opt_in_only: false,
        note: None,
        actions: &[ActionDef {
            id: "yarn.cache.clean",
            kind: ActionKind::Command {
                exe: "yarn",
                args: &["cache", "clean"],
            },
            label: "yarn cache clean",
            description: "Cleans Yarn cache via the official command.",
            requires_network: false,
            impact: "Subsequent installs may re-download packages.",
        }],
    },
    ProviderDef {
        id: "bun",
        name: "Bun",
        version_exe: "bun",
        read_only: false,
        opt_in_only: false,
        note: None,
        actions: &[ActionDef {
            id: "bun.cache.rm",
            kind: ActionKind::Command {
                exe: "bun",
                args: &["pm", "cache", "rm"],
            },
            label: "bun pm cache rm",
            description: "Cleans Bun package cache via the official command.",
            requires_network: false,
            impact: "Subsequent installs may re-download packages.",
        }],
    },
    ProviderDef {
        id: "pip",
        name: "pip",
        version_exe: "pip",
        read_only: false,
        opt_in_only: false,
        note: None,
        actions: &[ActionDef {
            id: "pip.cache.purge",
            kind: ActionKind::Command {
                exe: "pip",
                args: &["cache", "purge"],
            },
            label: "pip cache purge",
            description: "Purges pip wheel cache via the official command.",
            requires_network: false,
            impact: "Subsequent installs may re-download packages.",
        }],
    },
    ProviderDef {
        id: "uv",
        name: "uv",
        version_exe: "uv",
        read_only: false,
        opt_in_only: false,
        note: None,
        actions: &[ActionDef {
            id: "uv.cache.clean",
            kind: ActionKind::Command {
                exe: "uv",
                args: &["cache", "clean"],
            },
            label: "uv cache clean",
            description: "Cleans uv package and wheel cache via the official command.",
            requires_network: false,
            impact: "Subsequent virtual environment builds will re-download packages as needed.",
        }],
    },
    ProviderDef {
        id: "poetry",
        name: "Poetry",
        version_exe: "poetry",
        read_only: false,
        opt_in_only: false,
        note: Some(
            "Poetry package and wheel cache. Project virtualenvs and pyproject.toml are preserved.",
        ),
        actions: &[ActionDef {
            id: "poetry.cache.clear",
            kind: ActionKind::Command {
                exe: "poetry",
                args: &["cache", "clear", "--all", ".", "-n"],
            },
            label: "poetry cache clear --all . -n",
            description: "Clears Poetry package caches via the official command.",
            requires_network: false,
            impact: "Subsequent Poetry installs may re-download packages.",
        }],
    },
    ProviderDef {
        id: "cargo",
        name: "Cargo",
        version_exe: "cargo",
        read_only: false,
        opt_in_only: false,
        note: Some(
            "Downloaded .crate archives, extracted registry sources, and git checkouts/DB cache. config.toml, credentials, and installed binaries are preserved.",
        ),
        actions: &[ActionDef {
            id: "cargo.cache.recycle",
            kind: ActionKind::SafeCacheRecycle {
                blocked_processes: &["cargo", "rustc", "rust-analyzer"],
            },
            label: "Clean Cargo registry & git cache",
            description: "Moves Cargo downloaded crate archives, extracted sources, and git cache to Recycle Bin.",
            requires_network: true,
            impact: "Crates will re-download on next build; installed cargo binaries and config are untouched.",
        }],
    },
    ProviderDef {
        id: "gradle",
        name: "Gradle",
        version_exe: "gradle",
        read_only: false,
        opt_in_only: false,
        note: Some(
            "Gradle dependency and wrapper cache. gradle.properties and init scripts are preserved.",
        ),
        actions: &[ActionDef {
            id: "gradle.cache.recycle",
            kind: ActionKind::SafeCacheRecycle {
                blocked_processes: &["gradle", "java"],
            },
            label: "Clean Gradle caches & wrapper dists",
            description: "Moves Gradle dependency caches and wrapper distributions to Recycle Bin.",
            requires_network: true,
            impact: "Dependencies and Gradle wrappers will re-download on next Android/Java build.",
        }],
    },
    ProviderDef {
        id: "maven",
        name: "Maven",
        version_exe: "mvn",
        read_only: false,
        opt_in_only: false,
        note: Some("Global .m2 local repository cache. settings.xml is preserved."),
        actions: &[ActionDef {
            id: "maven.repo.recycle",
            kind: ActionKind::SafeCacheRecycle {
                blocked_processes: &["mvn", "java"],
            },
            label: "Clean Maven .m2 repository",
            description: "Moves Maven global local repository cache to Recycle Bin.",
            requires_network: true,
            impact: "Artifacts will re-download from Maven Central on next build.",
        }],
    },
    ProviderDef {
        id: "composer",
        name: "Composer",
        version_exe: "composer",
        read_only: false,
        opt_in_only: false,
        note: None,
        actions: &[ActionDef {
            id: "composer.clear-cache",
            kind: ActionKind::Command {
                exe: "composer",
                args: &["clear-cache"],
            },
            label: "composer clear-cache",
            description: "Cleans Composer download and metadata cache via the official command.",
            requires_network: false,
            impact: "Subsequent dependency installs may re-download packages.",
        }],
    },
    ProviderDef {
        id: "conda",
        name: "Conda",
        version_exe: "conda",
        read_only: false,
        opt_in_only: false,
        note: Some(
            "Package tarballs and index cache are cleaned; existing environments are preserved.",
        ),
        actions: &[ActionDef {
            id: "conda.clean.all",
            kind: ActionKind::Command {
                exe: "conda",
                args: &["clean", "--all", "-y"],
            },
            label: "conda clean --all -y",
            description: "Cleans unused Conda package tarballs and temporary caches.",
            requires_network: false,
            impact: "Only package cache is cleaned; installed environments are unaffected.",
        }],
    },
    ProviderDef {
        id: "playwright",
        name: "Playwright",
        version_exe: "playwright",
        read_only: false,
        opt_in_only: false,
        note: Some(
            "Test browsers (Chromium, Firefox, WebKit) are removed; reinstall via npx playwright install.",
        ),
        actions: &[
            ActionDef {
                id: "playwright.uninstall.all",
                kind: ActionKind::Command {
                    exe: "npx",
                    args: &["--no-install", "playwright", "uninstall", "--all"],
                },
                label: "npx --no-install playwright uninstall --all",
                description: "Removes downloaded Playwright test browsers via the official command.",
                requires_network: false,
                impact: "Browser binaries are removed; re-downloaded when tests run.",
            },
            ActionDef {
                id: "playwright.cache.recycle",
                kind: ActionKind::SafeCacheRecycle {
                    blocked_processes: &[],
                },
                label: "Clean Playwright browser cache",
                description: "Moves ms-playwright browser binaries to Recycle Bin.",
                requires_network: true,
                impact: "Reinstall browsers via npx playwright install when needed.",
            },
        ],
    },
    ProviderDef {
        id: "cypress",
        name: "Cypress",
        version_exe: "cypress",
        read_only: false,
        opt_in_only: false,
        note: Some(
            "Cached Cypress runtime versions are cleaned; re-downloaded when tests run.",
        ),
        actions: &[
            ActionDef {
                id: "cypress.cache.clear",
                kind: ActionKind::Command {
                    exe: "npx",
                    args: &["--no-install", "cypress", "cache", "clear"],
                },
                label: "npx --no-install cypress cache clear",
                description: "Clears downloaded Cypress runtime versions via the official command.",
                requires_network: false,
                impact: "Cypress binaries are deleted; re-downloaded during subsequent test runs.",
            },
            ActionDef {
                id: "cypress.cache.recycle",
                kind: ActionKind::SafeCacheRecycle {
                    blocked_processes: &["cypress"],
                },
                label: "Clean Cypress binary cache",
                description: "Moves Cypress binary cache directory to Recycle Bin.",
                requires_network: true,
                impact: "Cypress runtimes will re-download on next test run.",
            },
        ],
    },
    ProviderDef {
        id: "vcpkg",
        name: "vcpkg",
        version_exe: "vcpkg",
        read_only: false,
        opt_in_only: false,
        note: Some(
            "vcpkg binary package archives cache. Recreated when packages are recompiled.",
        ),
        actions: &[ActionDef {
            id: "vcpkg.archives.recycle",
            kind: ActionKind::SafeCacheRecycle {
                blocked_processes: &["vcpkg"],
            },
            label: "Clean vcpkg binary archives",
            description: "Moves vcpkg binary cache archives to Recycle Bin.",
            requires_network: false,
            impact: "Cached vcpkg binary archives will be rebuilt if needed.",
        }],
    },
    ProviderDef {
        id: "huggingface",
        name: "Hugging Face",
        version_exe: "huggingface-cli",
        read_only: false,
        opt_in_only: true,
        note: Some(
            "Downloaded local AI model weights and tokenizer cache (skipped by `c all`; target explicitly). Re-fetched when model code runs.",
        ),
        actions: &[ActionDef {
            id: "huggingface.hub.recycle",
            kind: ActionKind::SafeCacheRecycle {
                blocked_processes: &["python", "python3"],
            },
            label: "Clean Hugging Face model hub cache",
            description: "Moves downloaded Hugging Face model weights and tokenizers to Recycle Bin.",
            requires_network: true,
            impact: "Large model weights will need to be re-downloaded when used again.",
        }],
    },
    ProviderDef {
        id: "ollama",
        name: "Ollama",
        version_exe: "ollama",
        read_only: false,
        opt_in_only: true,
        note: Some(
            "Local Ollama model weights (skipped by `c all`; target explicitly). Stop Ollama before cleaning; models can be re-pulled anytime.",
        ),
        actions: &[ActionDef {
            id: "ollama.models.recycle",
            kind: ActionKind::SafeCacheRecycle {
                blocked_processes: &["ollama", "ollama app", "ollama_app"],
            },
            label: "Clean Ollama cached models",
            description: "Moves local Ollama model weights to Recycle Bin (requires Ollama idle).",
            requires_network: true,
            impact: "Removed LLM weights must be re-pulled via `ollama pull` before next use.",
        }],
    },
    ProviderDef {
        id: "nuget",
        name: "NuGet / .NET",
        version_exe: "dotnet",
        read_only: false,
        opt_in_only: false,
        note: Some(
            "If global packages folder is cleared, projects will restore packages on next build.",
        ),
        actions: &[ActionDef {
            id: "dotnet.nuget.clear",
            kind: ActionKind::Command {
                exe: "dotnet",
                args: &["nuget", "locals", "all", "--clear"],
            },
            label: "dotnet nuget locals all --clear",
            description: "Clears NuGet http-cache and global packages cache via the official command.",
            requires_network: true,
            impact: "Subsequent builds may re-download packages.",
        }],
    },
    ProviderDef {
        id: "go",
        name: "Go",
        version_exe: "go",
        read_only: false,
        opt_in_only: false,
        note: None,
        actions: &[
            ActionDef {
                id: "go.clean.cache",
                kind: ActionKind::Command {
                    exe: "go",
                    args: &["clean", "-cache"],
                },
                label: "go clean -cache",
                description: "Cleans Go build cache via the official command.",
                requires_network: false,
                impact: "Next Go build recompiles packages locally without re-downloading modules.",
            },
            ActionDef {
                id: "go.clean.modcache",
                kind: ActionKind::Command {
                    exe: "go",
                    args: &["clean", "-modcache"],
                },
                label: "go clean -modcache",
                description: "Cleans Go module cache via the official command.",
                requires_network: true,
                impact: "Subsequent builds may re-download modules.",
            },
        ],
    },
    ProviderDef {
        id: "docker",
        name: "Docker",
        version_exe: "docker",
        read_only: false,
        opt_in_only: false,
        note: Some(
            "Official Docker prune cleans unused BuildKit cache, dangling images, or stopped containers. Running containers and named volumes are never touched.",
        ),
        actions: &[
            ActionDef {
                id: "docker.builder.prune",
                kind: ActionKind::Command {
                    exe: "docker",
                    args: &["builder", "prune", "-f"],
                },
                label: "docker builder prune -f",
                description: "Prunes unused Docker BuildKit build cache via the official command.",
                requires_network: false,
                impact: "Subsequent Docker image builds may rebuild uncached layers.",
            },
            ActionDef {
                id: "docker.image.prune",
                kind: ActionKind::Command {
                    exe: "docker",
                    args: &["image", "prune", "-f"],
                },
                label: "docker image prune -f",
                description: "Removes dangling (<none>) Docker images via the official command.",
                requires_network: false,
                impact: "Tagged images, containers, and volumes are preserved.",
            },
            ActionDef {
                id: "docker.container.prune",
                kind: ActionKind::Command {
                    exe: "docker",
                    args: &["container", "prune", "-f"],
                },
                label: "docker container prune -f",
                description: "Removes stopped Docker containers via the official command.",
                requires_network: false,
                impact: "Only exited containers are removed; running containers and volumes stay intact.",
            },
        ],
    },
    ProviderDef {
        id: "wsl",
        name: "WSL",
        version_exe: "wsl",
        read_only: true,
        opt_in_only: false,
        note: Some(
            "WSL virtual disk (ext4.vhdx) holds your Linux distribution filesystem. Detergo measures real VHDX files and never deletes them.",
        ),
        actions: &[],
    },
    ProviderDef {
        id: "pub",
        name: "Dart / Flutter (Pub)",
        version_exe: "dart",
        read_only: false,
        opt_in_only: false,
        note: None,
        actions: &[ActionDef {
            id: "dart.pub.cache.clean",
            kind: ActionKind::Command {
                exe: "dart",
                args: &["pub", "cache", "clean", "--force"],
            },
            label: "dart pub cache clean",
            description: "Cleans Dart and Flutter package cache via the official command.",
            requires_network: false,
            impact: "Subsequent build steps may re-download packages.",
        }],
    },
    ProviderDef {
        id: "electron",
        name: "Electron",
        version_exe: "electron",
        read_only: false,
        opt_in_only: false,
        note: Some(
            "Downloaded Electron binaries and runtime cache. Re-fetched when projects build.",
        ),
        actions: &[ActionDef {
            id: "electron.cache.recycle",
            kind: ActionKind::SafeCacheRecycle {
                blocked_processes: &[],
            },
            label: "Clean Electron binary cache",
            description: "Moves downloaded Electron binary archives to Recycle Bin.",
            requires_network: true,
            impact: "Electron release zip archives will re-download on next install.",
        }],
    },
    ProviderDef {
        id: "vscode",
        name: "VS Code",
        version_exe: "code",
        read_only: false,
        opt_in_only: false,
        note: Some(
            "VS Code Chromium/Electron caches and cached VSIX installers. Settings, keybindings, extensions, and workspace storage are preserved.",
        ),
        actions: &[ActionDef {
            id: "vscode.cache.recycle",
            kind: ActionKind::SafeCacheRecycle {
                blocked_processes: &["code", "code - insiders"],
            },
            label: "Clean VS Code caches",
            description: "Moves VS Code Cache, Code Cache, CachedData, GPUCache, and CachedExtensionVSIXs to Recycle Bin.",
            requires_network: false,
            impact: "VS Code rebuilds caches on next launch; settings and extensions remain untouched.",
        }],
    },
    ProviderDef {
        id: "jetbrains",
        name: "JetBrains IDEs",
        version_exe: "idea",
        read_only: false,
        opt_in_only: false,
        note: Some(
            "Per-IDE JetBrains cache and log folders only (Toolbox installations and IDE settings/plugins are never touched).",
        ),
        actions: &[ActionDef {
            id: "jetbrains.caches.recycle",
            kind: ActionKind::SafeCacheRecycle {
                blocked_processes: &[
                    "idea64",
                    "pycharm64",
                    "webstorm64",
                    "goland64",
                    "rider64",
                    "clion64",
                    "phpstorm64",
                    "rubymine64",
                    "rustrover64",
                    "datagrip64",
                    "studio64",
                ],
            },
            label: "Clean JetBrains IDE caches",
            description: "Moves audited JetBrains per-IDE caches and logs to Recycle Bin.",
            requires_network: false,
            impact: "IDEs will re-index projects on next launch; settings, plugins, and Toolbox apps stay intact.",
        }],
    },
    ProviderDef {
        id: "android",
        name: "Android SDK Cache",
        version_exe: "adb",
        read_only: false,
        opt_in_only: false,
        note: Some(
            "Android build-cache and download cache only. AVD images, SDK platforms, and debug.keystore are preserved.",
        ),
        actions: &[ActionDef {
            id: "android.cache.recycle",
            kind: ActionKind::SafeCacheRecycle {
                blocked_processes: &["studio64", "adb", "emulator", "gradle"],
            },
            label: "Clean Android build & download cache",
            description: "Moves ~/.android/cache and ~/.android/build-cache to Recycle Bin.",
            requires_network: false,
            impact: "Android build caches regenerate on next Gradle build; AVDs and keystores are preserved.",
        }],
    },
    ProviderDef {
        id: "homebrew",
        name: "Homebrew",
        version_exe: "brew",
        read_only: false,
        opt_in_only: false,
        note: Some(
            "Downloaded Homebrew bottle archives and stale formula caches (macOS/Linux).",
        ),
        actions: &[ActionDef {
            id: "homebrew.cleanup",
            kind: ActionKind::Command {
                exe: "brew",
                args: &["cleanup", "--prune=all"],
            },
            label: "brew cleanup --prune=all",
            description: "Removes outdated Homebrew downloads and caches via the official command.",
            requires_network: false,
            impact: "Installed formulae and casks stay intact; cached downloads are removed.",
        }],
    },
];

pub(super) fn provider_def(id: &str) -> Option<(usize, &'static ProviderDef)> {
    ACTIONS.iter().enumerate().find(|(_, p)| p.id == id)
}

fn env_dir(key: &str) -> Option<PathBuf> {
    std::env::var(key)
        .ok()
        .filter(|v| !v.trim().is_empty())
        .map(PathBuf::from)
}

fn user_home() -> PathBuf {
    env_dir("USERPROFILE")
        .or_else(|| env_dir("HOME"))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn local_cache_dir() -> PathBuf {
    #[cfg(windows)]
    {
        env_dir("LOCALAPPDATA").unwrap_or_else(|| user_home().join("AppData").join("Local"))
    }
    #[cfg(target_os = "macos")]
    {
        user_home().join("Library").join("Caches")
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        env_dir("XDG_CACHE_HOME").unwrap_or_else(|| user_home().join(".cache"))
    }
}

fn app_config_dir() -> PathBuf {
    #[cfg(windows)]
    {
        env_dir("APPDATA").unwrap_or_else(|| user_home().join("AppData").join("Roaming"))
    }
    #[cfg(target_os = "macos")]
    {
        user_home().join("Library").join("Application Support")
    }
    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        env_dir("XDG_CONFIG_HOME").unwrap_or_else(|| user_home().join(".config"))
    }
}

fn discover_jetbrains_cache_dirs(base: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(base) else {
        return out;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        // Never touch JetBrains Toolbox installations or shared runtimes.
        if name_str.eq_ignore_ascii_case("Toolbox")
            || name_str.eq_ignore_ascii_case("consentOptions")
            || name_str.eq_ignore_ascii_case("bl")
            || name_str.eq_ignore_ascii_case("crl")
        {
            continue;
        }
        let dir = entry.path();
        if !dir.is_dir() || crate::platform::is_reparse_point(&dir) {
            continue;
        }
        for sub in ["caches", "log", "tmp"] {
            let candidate = dir.join(sub);
            if candidate.is_dir() && !crate::platform::is_reparse_point(&candidate) {
                out.push(candidate);
            }
        }
    }
    out
}

/// Resolves the concrete cache paths for a provider across Windows, macOS, and
/// Linux, honoring standard tool environment variables and dynamic discovery.
pub(super) fn resolve_provider_paths(def: &ProviderDef) -> Vec<PathBuf> {
    let home = user_home();
    let local = local_cache_dir();
    let config = app_config_dir();

    match def.id {
        "npm" => {
            if let Some(p) = env_dir("NPM_CONFIG_CACHE").or_else(|| env_dir("npm_config_cache")) {
                return vec![p];
            }
            #[cfg(windows)]
            {
                vec![local.join("npm-cache")]
            }
            #[cfg(not(windows))]
            {
                vec![home.join(".npm")]
            }
        }
        "pnpm" => {
            if let Some(p) = env_dir("PNPM_STORE_DIR") {
                return vec![p];
            }
            #[cfg(windows)]
            {
                vec![local.join("pnpm").join("store")]
            }
            #[cfg(target_os = "macos")]
            {
                vec![home.join("Library").join("pnpm").join("store")]
            }
            #[cfg(all(not(windows), not(target_os = "macos")))]
            {
                let data =
                    env_dir("XDG_DATA_HOME").unwrap_or_else(|| home.join(".local").join("share"));
                vec![data.join("pnpm").join("store")]
            }
        }
        "yarn" => {
            if let Some(p) = env_dir("YARN_CACHE_FOLDER") {
                return vec![p];
            }
            #[cfg(windows)]
            {
                vec![local.join("Yarn").join("Cache")]
            }
            #[cfg(target_os = "macos")]
            {
                vec![local.join("Yarn")]
            }
            #[cfg(all(not(windows), not(target_os = "macos")))]
            {
                vec![local.join("yarn")]
            }
        }
        "bun" => {
            if let Some(p) = env_dir("BUN_INSTALL_CACHE_DIR") {
                return vec![p];
            }
            vec![home.join(".bun").join("install").join("cache")]
        }
        "pip" => {
            if let Some(p) = env_dir("PIP_CACHE_DIR") {
                return vec![p];
            }
            #[cfg(windows)]
            {
                vec![local.join("pip").join("Cache")]
            }
            #[cfg(not(windows))]
            {
                vec![local.join("pip")]
            }
        }
        "uv" => {
            if let Some(p) = env_dir("UV_CACHE_DIR") {
                return vec![p];
            }
            #[cfg(windows)]
            {
                vec![local.join("uv").join("cache")]
            }
            #[cfg(not(windows))]
            {
                vec![local.join("uv")]
            }
        }
        "poetry" => {
            if let Some(p) = env_dir("POETRY_CACHE_DIR") {
                return vec![p];
            }
            #[cfg(windows)]
            {
                vec![local.join("pypoetry").join("Cache")]
            }
            #[cfg(not(windows))]
            {
                vec![local.join("pypoetry")]
            }
        }
        "cargo" => {
            let cargo_home = env_dir("CARGO_HOME").unwrap_or_else(|| home.join(".cargo"));
            vec![
                cargo_home.join("registry").join("cache"),
                cargo_home.join("registry").join("src"),
                cargo_home.join("git").join("db"),
                cargo_home.join("git").join("checkouts"),
            ]
        }
        "gradle" => {
            let gradle_home = env_dir("GRADLE_USER_HOME").unwrap_or_else(|| home.join(".gradle"));
            vec![
                gradle_home.join("caches"),
                gradle_home.join("wrapper").join("dists"),
            ]
        }
        "maven" => vec![home.join(".m2").join("repository")],
        "composer" => {
            if let Some(p) = env_dir("COMPOSER_CACHE_DIR") {
                return vec![p];
            }
            #[cfg(windows)]
            {
                vec![
                    local.join("Composer").join("repo"),
                    config.join("Composer").join("cache"),
                ]
            }
            #[cfg(not(windows))]
            {
                vec![local.join("composer")]
            }
        }
        "conda" => {
            let mut paths = vec![
                home.join(".conda").join("pkgs"),
                home.join("miniconda3").join("pkgs"),
                home.join("anaconda3").join("pkgs"),
            ];
            if let Some(p) = env_dir("CONDA_PKGS_DIRS") {
                paths.insert(0, p);
            }
            paths
        }
        "playwright" => {
            if let Some(p) = env_dir("PLAYWRIGHT_BROWSERS_PATH") {
                return vec![p];
            }
            vec![local.join("ms-playwright")]
        }
        "cypress" => {
            if let Some(p) = env_dir("CYPRESS_CACHE_FOLDER") {
                return vec![p];
            }
            #[cfg(windows)]
            {
                vec![local.join("Cypress").join("Cache")]
            }
            #[cfg(not(windows))]
            {
                vec![local.join("Cypress")]
            }
        }
        "vcpkg" => {
            if let Some(p) = env_dir("VCPKG_DEFAULT_BINARY_CACHE") {
                return vec![p];
            }
            vec![local.join("vcpkg").join("archives")]
        }
        "huggingface" => {
            if let Some(p) = env_dir("HF_HUB_CACHE") {
                return vec![p];
            }
            if let Some(hf_home) = env_dir("HF_HOME") {
                return vec![hf_home.join("hub")];
            }
            vec![home.join(".cache").join("huggingface").join("hub")]
        }
        "ollama" => {
            if let Some(p) = env_dir("OLLAMA_MODELS") {
                return vec![p];
            }
            vec![home.join(".ollama").join("models")]
        }
        "nuget" => {
            if let Some(p) = env_dir("NUGET_PACKAGES") {
                return vec![p];
            }
            vec![home.join(".nuget").join("packages")]
        }
        "go" => {
            let mod_cache = env_dir("GOMODCACHE").unwrap_or_else(|| {
                env_dir("GOPATH")
                    .unwrap_or_else(|| home.join("go"))
                    .join("pkg")
                    .join("mod")
            });
            let build_cache = env_dir("GOCACHE").unwrap_or_else(|| local.join("go-build"));
            vec![mod_cache, build_cache]
        }
        "docker" => {
            #[cfg(windows)]
            {
                vec![
                    local
                        .join("Docker")
                        .join("wsl")
                        .join("disk")
                        .join("docker_data.vhdx"),
                    home.join(".docker"),
                ]
            }
            #[cfg(target_os = "macos")]
            {
                vec![
                    home.join("Library")
                        .join("Containers")
                        .join("com.docker.docker")
                        .join("Data")
                        .join("vms")
                        .join("0")
                        .join("data")
                        .join("Docker.raw"),
                    home.join(".docker"),
                ]
            }
            #[cfg(all(not(windows), not(target_os = "macos")))]
            {
                vec![PathBuf::from("/var/lib/docker"), home.join(".docker")]
            }
        }
        "wsl" => super::wsl::discover_wsl_vhdx_paths(),
        "pub" => {
            if let Some(p) = env_dir("PUB_CACHE") {
                return vec![p];
            }
            #[cfg(windows)]
            {
                vec![local.join("Pub").join("Cache")]
            }
            #[cfg(not(windows))]
            {
                vec![home.join(".pub-cache")]
            }
        }
        "electron" => {
            #[cfg(windows)]
            {
                vec![local.join("electron").join("Cache")]
            }
            #[cfg(not(windows))]
            {
                vec![local.join("electron")]
            }
        }
        "vscode" => {
            let code_root = config.join("Code");
            vec![
                code_root.join("Cache"),
                code_root.join("CachedData"),
                code_root.join("Code Cache"),
                code_root.join("GPUCache"),
                code_root.join("CachedExtensionVSIXs"),
            ]
        }
        "jetbrains" => discover_jetbrains_cache_dirs(&local.join("JetBrains")),
        "android" => {
            let android_home =
                env_dir("ANDROID_USER_HOME").unwrap_or_else(|| home.join(".android"));
            vec![android_home.join("cache"), android_home.join("build-cache")]
        }
        "homebrew" => {
            if let Some(p) = env_dir("HOMEBREW_CACHE") {
                return vec![p];
            }
            vec![local.join("Homebrew")]
        }
        _ => Vec::new(),
    }
}
