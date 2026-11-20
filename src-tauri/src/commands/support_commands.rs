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
///
/// Offloaded to a blocking worker thread so reading and compressing multi-MB
/// logs never stalls the main window event loop.
#[tauri::command]
pub async fn create_support_bundle(
    request: SupportBundleRequest,
) -> Result<SupportBundle, AppError> {
    tokio::task::spawn_blocking(move || create_bundle_in(&bundle_dir(), request))
        .await
        .map_err(|err| AppError::Unknown(format!("Support bundle task failed: {err}")))?
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
pub async fn compose_support_mail(
    bundle_path: String,
    version: String,
) -> Result<SupportMailResult, AppError> {
    tokio::task::spawn_blocking(move || compose_support_mail_blocking(bundle_path, version))
        .await
        .map_err(|err| AppError::Unknown(format!("Support mail task failed: {err}")))?
}

fn compose_support_mail_blocking(
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

    let draft_ok = open_outlook_draft(&path, &subject, &body).unwrap_or(false)
        || open_thunderbird_draft(&path, &subject, &body).unwrap_or(false)
        || open_mapi_draft(&path, &subject, &body);
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

#[cfg(windows)]
fn has_registered_outlook_com() -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("reg.exe")
        .args(["query", r"HKCR\Outlook.Application\CLSID", "/ve"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn has_registered_outlook_com() -> bool {
    false
}

/// `true` only when Outlook created and displayed a draft within the timeout.
fn open_outlook_draft(path: &Path, subject: &str, body: &str) -> Result<bool, AppError> {
    if !cfg!(windows) || !has_registered_outlook_com() {
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
    let mut cmd = std::process::Command::new("powershell");
    cmd.args([
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
    .env("DC_SUPPORT_ZIP", path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = cmd
        .spawn()
        .map_err(|err| AppError::Unknown(err.to_string()))?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status.success()),
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Ok(false);
                }
                std::thread::sleep(std::time::Duration::from_millis(80));
            }
            Err(err) => return Err(AppError::Unknown(err.to_string())),
        }
    }
}

/// Opens a Thunderbird compose window with the support ZIP pre-attached when
/// Thunderbird is installed. Non-modal and never sends automatically.
fn open_thunderbird_draft(path: &Path, subject: &str, body: &str) -> Result<bool, AppError> {
    if !cfg!(windows) {
        return Ok(false);
    }
    let candidates = [
        std::env::var_os("ProgramFiles")
            .map(|root| PathBuf::from(root).join(r"Mozilla Thunderbird\thunderbird.exe")),
        std::env::var_os("ProgramFiles(x86)")
            .map(|root| PathBuf::from(root).join(r"Mozilla Thunderbird\thunderbird.exe")),
    ];
    let Some(exe) = candidates.into_iter().flatten().find(|p| p.is_file()) else {
        return Ok(false);
    };
    let clean = |s: &str| s.replace('\'', " ").replace('\r', "");
    let attachment = format!("file:///{}", path.to_string_lossy().replace('\\', "/"));
    let compose = format!(
        "to='{SUPPORT_EMAIL}',subject='{}',body='{}',attachment='{}'",
        clean(subject),
        clean(body).replace('\n', "%0A"),
        clean(&attachment)
    );
    Ok(std::process::Command::new(exe)
        .args(["-compose", &compose])
        .spawn()
        .is_ok())
}

/// Checks whether Windows has a registered MAPI desktop mail client before
/// invoking `MAPI32.DLL` so unconfigured systems never show a modal OS error.
#[cfg(windows)]
fn has_registered_mapi_client() -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    for key in [r"HKCU\SOFTWARE\Clients\Mail", r"HKLM\SOFTWARE\Clients\Mail"] {
        if let Ok(output) = std::process::Command::new("reg.exe")
            .args(["query", key, "/ve"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                for line in text.lines() {
                    if let Some((_, val)) = line.split_once("REG_SZ") {
                        let name = val.trim();
                        if !name.is_empty() && !name.eq_ignore_ascii_case("Hotmail") {
                            return true;
                        }
                    }
                }
            }
        }
    }
    false
}

/// Uses Windows Simple MAPI (`MAPISendMailW`) in modeless dialog mode so any
/// registered MAPI client can open a draft with the ZIP attached without
/// blocking the UI thread.
#[cfg(windows)]
fn open_mapi_draft(path: &Path, subject: &str, body: &str) -> bool {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::null_mut;

    if !has_registered_mapi_client() {
        return false;
    }

    #[repr(C)]
    struct MapiFileDescW {
        ul_reserved: u32,
        fl_flags: u32,
        n_position: u32,
        lpsz_path_name: *mut u16,
        lpsz_file_name: *mut u16,
        lp_file_type: *mut c_void,
    }

    #[repr(C)]
    struct MapiRecipDescW {
        ul_reserved: u32,
        ul_recip_class: u32,
        lpsz_name: *mut u16,
        lpsz_address: *mut u16,
        ul_eid_size: u32,
        lp_entry_id: *mut c_void,
    }

    #[repr(C)]
    struct MapiMessageW {
        ul_reserved: u32,
        lpsz_subject: *mut u16,
        lpsz_note_text: *mut u16,
        lpsz_message_type: *mut u16,
        lpsz_date_received: *mut u16,
        lpsz_conversation_id: *mut u16,
        fl_flags: u32,
        lp_originator: *mut MapiRecipDescW,
        n_recip_count: u32,
        lp_recips: *mut MapiRecipDescW,
        n_file_count: u32,
        lp_files: *mut MapiFileDescW,
    }

    type MapiSendMailWFn = unsafe extern "system" fn(
        lh_session: usize,
        ul_ui_param: usize,
        lp_message: *mut MapiMessageW,
        fl_flags: u32,
        ul_reserved: u32,
    ) -> u32;

    extern "system" {
        fn LoadLibraryW(lp_lib_file_name: *const u16) -> *mut c_void;
        fn GetProcAddress(h_module: *mut c_void, lp_proc_name: *const u8) -> *const c_void;
        fn FreeLibrary(h_lib_module: *mut c_void) -> i32;
    }

    fn wide_z(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    let dll_name = wide_z("MAPI32.DLL");
    let mut subject_w = wide_z(subject);
    let mut body_w = wide_z(body);
    let mut to_name_w = wide_z(SUPPORT_EMAIL);
    let mut to_addr_w = wide_z(&format!("SMTP:{SUPPORT_EMAIL}"));
    let mut path_w: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut file_name_w = wide_z(
        &path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "dev-cleaner-support.zip".to_string()),
    );

    const MAPI_LOGON_UI: u32 = 0x0000_0001;
    const MAPI_DIALOG_MODELESS: u32 = 0x0000_0004;
    const MAPI_DIALOG: u32 = 0x0000_0008;
    const MAPI_TO: u32 = 1;
    const SUCCESS_SUCCESS: u32 = 0;

    // SAFETY: All wide string buffers live for the duration of `MAPISendMailW`
    // and the library handle is freed before returning.
    unsafe {
        let module = LoadLibraryW(dll_name.as_ptr());
        if module.is_null() {
            return false;
        }
        let proc = GetProcAddress(module, c"MAPISendMailW".as_ptr().cast::<u8>());
        if proc.is_null() {
            FreeLibrary(module);
            return false;
        }
        let send_mail: MapiSendMailWFn = std::mem::transmute(proc);

        let mut recip = MapiRecipDescW {
            ul_reserved: 0,
            ul_recip_class: MAPI_TO,
            lpsz_name: to_name_w.as_mut_ptr(),
            lpsz_address: to_addr_w.as_mut_ptr(),
            ul_eid_size: 0,
            lp_entry_id: null_mut(),
        };
        let mut file = MapiFileDescW {
            ul_reserved: 0,
            fl_flags: 0,
            n_position: u32::MAX,
            lpsz_path_name: path_w.as_mut_ptr(),
            lpsz_file_name: file_name_w.as_mut_ptr(),
            lp_file_type: null_mut(),
        };
        let mut message = MapiMessageW {
            ul_reserved: 0,
            lpsz_subject: subject_w.as_mut_ptr(),
            lpsz_note_text: body_w.as_mut_ptr(),
            lpsz_message_type: null_mut(),
            lpsz_date_received: null_mut(),
            lpsz_conversation_id: null_mut(),
            fl_flags: 0,
            lp_originator: null_mut(),
            n_recip_count: 1,
            lp_recips: &mut recip,
            n_file_count: 1,
            lp_files: &mut file,
        };

        let result = send_mail(
            0,
            0,
            &mut message,
            MAPI_LOGON_UI | MAPI_DIALOG | MAPI_DIALOG_MODELESS,
            0,
        );
        FreeLibrary(module);
        result == SUCCESS_SUCCESS
    }
}

#[cfg(not(windows))]
fn open_mapi_draft(_path: &Path, _subject: &str, _body: &str) -> bool {
    false
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
        let dir = tempfile::tempdir().expect("temp dir");
        let request = SupportBundleRequest {
            version: "1.0.0".into(),
            locale: "en".into(),
            generated_at: "2026-11-19T00:00:00Z".into(),
            error_log: "x".repeat(2 * 1024 * 1024 + 1),
            system_log: String::new(),
            settings_summary: "{}".into(),
            system_info: String::new(),
        };
        assert!(super::create_bundle_in(dir.path(), request).is_err());
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
