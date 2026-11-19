//! Local support bundle and mail-draft commands.
//!
//! The privacy model forbids background uploads, so support starts with the
//! user: this module writes one ZIP next to their other downloads and then asks
//! the installed mail client to show a draft with that ZIP attached. Nothing is
//! transmitted here; the user still presses Send in their own mail app.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::error::AppError;

/// Recipient chosen by Vellium for product support.
pub const SUPPORT_EMAIL: &str = "support@vellium.dev";

/// A bundle is text only. The limit stops a runaway frontend from filling the
/// disk or producing a mail attachment no client will accept.
const MAX_FIELD_BYTES: usize = 2 * 1024 * 1024;

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportBundleRequest {
    pub version: String,
    pub locale: String,
    pub generated_at: String,
    pub error_log: String,
    pub system_log: String,
    pub settings_summary: String,
    pub system_info: String,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportBundle {
    pub path: String,
    pub file_name: String,
    /// Bundle size in bytes; a support ZIP is a few MiB, so u32 is ample and
    /// keeps the generated TypeScript contract free of BigInt.
    pub bytes: u32,
    pub created_at: String,
}

#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportMailResult {
    /// `draft` when a mail client accepted the attachment, `mailto` when only a
    /// plain draft could be opened, `failed` when neither worked.
    pub mode: String,
    pub path: String,
    pub message: String,
}

fn check_field(label: &str, value: &str) -> Result<(), AppError> {
    if value.len() > MAX_FIELD_BYTES {
        return Err(AppError::InvalidPath(format!(
            "{label} is too large for a support bundle."
        )));
    }
    Ok(())
}

/// Picks a writable destination, preferring the user's Downloads folder.
fn bundle_dir() -> PathBuf {
    if let Ok(profile) = std::env::var("USERPROFILE") {
        let downloads = Path::new(&profile).join("Downloads");
        if downloads.is_dir() {
            return downloads;
        }
    }
    std::env::var("APPDATA")
        .map(|appdata| Path::new(&appdata).join("dev-cleaner").join("support"))
        .unwrap_or_else(|_| std::env::temp_dir().join("dev-cleaner-support"))
}

fn unique_path(dir: &Path, stamp: &str) -> PathBuf {
    let base = dir.join(format!("dev-cleaner-support-{stamp}.zip"));
    if !base.exists() {
        return base;
    }
    for index in 2..1000 {
        let candidate = dir.join(format!("dev-cleaner-support-{stamp}-{index}.zip"));
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!(
        "dev-cleaner-support-{stamp}-{}.zip",
        std::process::id()
    ))
}

fn append_backend_log<W: Write + std::io::Seek>(
    zip: &mut ZipWriter<W>,
    name: &str,
    path: &Path,
) -> Result<bool, AppError> {
    let Ok(metadata) = fs::metadata(path) else {
        return Ok(false);
    };
    if !metadata.is_file() {
        return Ok(false);
    }
    let bytes = fs::read(path).map_err(|err| AppError::Unknown(err.to_string()))?;
    // The logger rotates at 4 MiB; never read beyond that even if a user
    // replaced the file.
    let bytes = if bytes.len() > 4 * 1024 * 1024 {
        bytes[bytes.len() - 4 * 1024 * 1024..].to_vec()
    } else {
        bytes
    };
    zip.start_file(name, SimpleFileOptions::default())
        .map_err(|err| AppError::Unknown(err.to_string()))?;
    zip.write_all(&bytes)
        .map_err(|err| AppError::Unknown(err.to_string()))?;
    Ok(true)
}

/// Builds the ZIP entirely on this device and returns its path.
#[tauri::command]
pub fn create_support_bundle(request: SupportBundleRequest) -> Result<SupportBundle, AppError> {
    create_bundle_in(&bundle_dir(), request)
}

fn create_bundle_in(dir: &Path, request: SupportBundleRequest) -> Result<SupportBundle, AppError> {
    check_field("errorLog", &request.error_log)?;
    check_field("systemLog", &request.system_log)?;
    check_field("settingsSummary", &request.settings_summary)?;
    check_field("systemInfo", &request.system_info)?;

    fs::create_dir_all(dir).map_err(|err| AppError::Unknown(err.to_string()))?;

    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let path = unique_path(dir, &stamp);
    let file = fs::File::create(&path).map_err(|err| AppError::Unknown(err.to_string()))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    let report = format!(
        "Dev Cleaner support bundle\n\
         ==========================\n\
         Version:    {}\n\
         Generated:  {}\n\
         Locale:     {}\n\
         OS:         {}\n\
         Arch:       {}\n\n\
         This bundle was written by the user from Settings > Diagnostics.\n\
         It contains the in-app error log, recent system messages, the backend\n\
         log (paths already masked) and a settings summary. It has not been\n\
         uploaded anywhere.\n",
        request.version,
        request.generated_at,
        request.locale,
        std::env::consts::OS,
        std::env::consts::ARCH,
    );
    zip.start_file("report.txt", options)
        .map_err(|err| AppError::Unknown(err.to_string()))?;
    zip.write_all(report.as_bytes())
        .map_err(|err| AppError::Unknown(err.to_string()))?;

    for (name, body) in [
        ("error-log.txt", request.error_log.as_str()),
        ("system-log.txt", request.system_log.as_str()),
        ("settings-summary.json", request.settings_summary.as_str()),
        ("system-info.txt", request.system_info.as_str()),
    ] {
        zip.start_file(name, options)
            .map_err(|err| AppError::Unknown(err.to_string()))?;
        zip.write_all(body.as_bytes())
            .map_err(|err| AppError::Unknown(err.to_string()))?;
    }

    if let Ok(appdata) = std::env::var("APPDATA") {
        let log_dir = Path::new(&appdata).join("dev-cleaner");
        let _ = append_backend_log(
            &mut zip,
            "backend-log.txt",
            &log_dir.join("dev-cleaner.log"),
        )?;
        let _ = append_backend_log(
            &mut zip,
            "backend-log.1.txt",
            &log_dir.join("dev-cleaner.log.1"),
        )?;
    }

    zip.finish()
        .map_err(|err| AppError::Unknown(err.to_string()))?;

    let bytes = fs::metadata(&path)
        .map(|meta| meta.len().min(u32::MAX as u64) as u32)
        .unwrap_or(0);

    Ok(SupportBundle {
        path: path.to_string_lossy().to_string(),
        file_name: path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "dev-cleaner-support.zip".to_string()),
        bytes,
        created_at: chrono::Local::now().to_rfc3339(),
    })
}

/// Opens a ready mail draft with the bundle attached when the installed client
/// supports it. Falls back to a `mailto:` draft plus Explorer, never to a silent
/// send.
#[tauri::command]
pub fn compose_support_mail(
    bundle_path: String,
    version: String,
) -> Result<SupportMailResult, AppError> {
    let path = PathBuf::from(&bundle_path);
    let valid = path.is_file()
        && path
            .extension()
            .map(|ext| ext.eq_ignore_ascii_case("zip"))
            .unwrap_or(false)
        && path
            .file_name()
            .map(|name| name.to_string_lossy().starts_with("dev-cleaner-support-"))
            .unwrap_or(false);
    if !valid {
        return Err(AppError::InvalidPath(
            "Support bundle is missing or was not created by Dev Cleaner.".to_string(),
        ));
    }

    let safe_version: String = version
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-' || *c == '+')
        .collect();
    let subject = format!("Dev Cleaner support bundle ({safe_version})");
    let body = format!(
        "Hello Vellium support,\n\n\
         I am sending the Dev Cleaner diagnostics bundle created from Settings > Diagnostics.\n\n\
         Version: {safe_version}\n\
         Bundle:  {}\n\n\
         The ZIP contains the in-app error log, recent system messages, the backend log and a settings summary. Paths and webhook credentials are masked.\n\n\
         What I was doing when the problem appeared:\n\n\n",
        path.file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default()
    );

    let draft_ok = open_outlook_draft(&path, &subject, &body).unwrap_or(false);
    if draft_ok {
        return Ok(SupportMailResult {
            mode: "draft".to_string(),
            path: bundle_path,
            message: "Mail draft opened with the bundle attached.".to_string(),
        });
    }

    let mailto = format!(
        "mailto:{SUPPORT_EMAIL}?subject={}&body={}",
        urlencode(&subject),
        urlencode(&body)
    );
    let opened = crate::commands::scan_commands::open_url(mailto).is_ok();
    let _ = crate::commands::scan_commands::open_path_in_explorer(bundle_path.clone());

    Ok(SupportMailResult {
        mode: if opened { "mailto" } else { "failed" }.to_string(),
        path: bundle_path,
        message: if opened {
            "Opened a plain mail draft; attach the bundle shown in Explorer.".to_string()
        } else {
            "No mail client could be opened. The bundle is ready in Explorer.".to_string()
        },
    })
}

/// `true` only when Outlook created and displayed a draft.
fn open_outlook_draft(path: &Path, subject: &str, body: &str) -> Result<bool, AppError> {
    if !cfg!(windows) {
        return Ok(false);
    }
    let script = r#"
$ErrorActionPreference = 'Stop'
try {
  $outlook = New-Object -ComObject Outlook.Application
  $mail = $outlook.CreateItem(0)
  $mail.To = $env:DC_SUPPORT_TO
  $mail.Subject = $env:DC_SUPPORT_SUBJECT
  $mail.Body = $env:DC_SUPPORT_BODY
  [void]$mail.Attachments.Add($env:DC_SUPPORT_ZIP)
  $mail.Display()
  exit 0
} catch {
  exit 2
}
"#;
    let status = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            script,
        ])
        .env("DC_SUPPORT_TO", SUPPORT_EMAIL)
        .env("DC_SUPPORT_SUBJECT", subject)
        .env("DC_SUPPORT_BODY", body)
        .env("DC_SUPPORT_ZIP", path)
        .status()
        .map_err(|err| AppError::Unknown(err.to_string()))?;
    Ok(status.success())
}

/// Minimal percent-encoding for a `mailto:` query value.
fn urlencode(value: &str) -> String {
    let mut out = String::with_capacity(value.len() * 3);
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{urlencode, SupportBundleRequest};
    use std::fs;
    use std::io::Read;

    #[test]
    fn urlencode_keeps_only_unreserved_characters() {
        assert_eq!(urlencode("a b&c"), "a%20b%26c");
        assert_eq!(urlencode("safe-_.~"), "safe-_.~");
    }

    #[test]
    fn bundle_rejects_oversized_fields() {
        let request = SupportBundleRequest {
            version: "1.0.0".into(),
            locale: "en".into(),
            generated_at: "2026-11-19T00:00:00Z".into(),
            error_log: "x".repeat(2 * 1024 * 1024 + 1),
            system_log: String::new(),
            settings_summary: "{}".into(),
            system_info: String::new(),
        };
        assert!(super::create_support_bundle(request).is_err());
    }

    #[test]
    fn bundle_writes_a_readable_zip() {
        let dir = tempfile::tempdir().expect("temp dir");
        let request = SupportBundleRequest {
            version: "1.0.0".into(),
            locale: "tr".into(),
            generated_at: "2026-11-19T00:00:00Z".into(),
            error_log: "[2026-11-19T00:00:00Z] (window) boom".into(),
            system_log: "[2026-11-19T00:00:00Z] (warn) careful".into(),
            settings_summary: "{\"theme\":\"dark-black\"}".into(),
            system_info: "windows x86_64".into(),
        };
        let bundle = super::create_bundle_in(dir.path(), request).expect("bundle");
        assert!(bundle.bytes > 0);
        assert!(bundle.file_name.starts_with("dev-cleaner-support-"));

        let file = fs::File::open(&bundle.path).expect("open bundle");
        let mut archive = zip::ZipArchive::new(file).expect("zip");
        let mut report = String::new();
        archive
            .by_name("report.txt")
            .expect("report")
            .read_to_string(&mut report)
            .expect("read report");
        assert!(report.contains("Version:    1.0.0"));
        assert!(archive.by_name("error-log.txt").is_ok());

        drop(archive);
        let _ = fs::remove_file(&bundle.path);
    }
}
