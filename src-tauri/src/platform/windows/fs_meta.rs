//! Low-level Windows metadata used by measurement and safety checks.
//!
//! All functions are best-effort: a `None`/empty result means "could not be
//! determined" and callers must degrade conservatively instead of assuming a
//! successful measurement.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct FileIdentity {
    pub volume_serial: u64,
    pub file_index: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileFacts {
    pub allocated_bytes: u64,
    pub logical_bytes: u64,
    pub link_count: u32,
    pub identity: FileIdentity,
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, GetLastError, ERROR_SUCCESS, HANDLE};
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, GetCompressedFileSizeW, GetDriveTypeW, GetFileInformationByHandle,
        BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_COMPRESSED, FILE_ATTRIBUTE_REPARSE_POINT,
        FILE_ATTRIBUTE_SPARSE_FILE, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
        FILE_SHARE_DELETE, FILE_SHARE_MODE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };

    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn open_for_query(path: &Path) -> Option<HANDLE> {
        // Long paths need the verbatim prefix; measured targets can exceed
        // MAX_PATH even though the drive-root probe above must not use one.
        // Never follow reparse points when capturing file identity/facts.
        let w = super::super::wide_verbatim(path);
        unsafe {
            CreateFileW(
                PCWSTR(w.as_ptr()),
                0,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                None,
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
                None,
            )
            .ok()
        }
    }

    fn compressed_size(path: &Path) -> Option<u64> {
        let w = super::super::wide_verbatim(path);
        let mut high: u32 = 0;
        unsafe {
            let low = GetCompressedFileSizeW(PCWSTR(w.as_ptr()), Some(&mut high));
            if low == u32::MAX && GetLastError() != ERROR_SUCCESS {
                None
            } else {
                Some(((high as u64) << 32) | low as u64)
            }
        }
    }

    pub fn facts(path: &Path) -> Option<FileFacts> {
        let handle = open_for_query(path)?;
        unsafe {
            let mut info = BY_HANDLE_FILE_INFORMATION::default();
            let ok = GetFileInformationByHandle(handle, &mut info).is_ok();
            let _ = CloseHandle(handle);
            if !ok {
                return None;
            }
            let identity = FileIdentity {
                volume_serial: info.dwVolumeSerialNumber as u64,
                file_index: ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64,
            };
            let logical = ((info.nFileSizeHigh as u64) << 32) | info.nFileSizeLow as u64;
            // Only query `GetCompressedFileSizeW` when NTFS attributes indicate
            // compression, sparseness, or a transparent reparse point (WOF / Dedup).
            // Regular files skip a second kernel path lookup per file.
            let needs_compressed_query = (info.dwFileAttributes
                & (FILE_ATTRIBUTE_COMPRESSED.0
                    | FILE_ATTRIBUTE_SPARSE_FILE.0
                    | FILE_ATTRIBUTE_REPARSE_POINT.0))
                != 0;
            let allocated_bytes = if needs_compressed_query {
                compressed_size(path).unwrap_or(logical)
            } else {
                logical
            };
            Some(FileFacts {
                allocated_bytes,
                logical_bytes: logical,
                link_count: info.nNumberOfLinks.max(1),
                identity,
            })
        }
    }

    pub fn identity(path: &Path) -> Option<FileIdentity> {
        facts(path).map(|f| f.identity)
    }

    /// Reparse tags that transparently store or compress files in-place on the
    /// same volume without redirecting traversal to another directory tree.
    ///
    /// - `IO_REPARSE_TAG_WOF` (0x80000017): Windows Overlay Filter (CompactOS).
    /// - `IO_REPARSE_TAG_DEDUP` (0x80000013): NTFS Data Deduplication.
    /// - `IO_REPARSE_TAG_CLOUD*` (0x9000_X01A): Cloud Files (OneDrive / iCloud)
    ///   when hydrated locally (offline/recall attributes are checked separately).
    pub(crate) fn is_transparent_reparse_tag(tag: u32) -> bool {
        const IO_REPARSE_TAG_DEDUP: u32 = 0x8000_0013;
        const IO_REPARSE_TAG_WOF: u32 = 0x8000_0017;
        const IO_REPARSE_TAG_CLOUD_MASK: u32 = 0xFFFF_0FFF;
        const IO_REPARSE_TAG_CLOUD_BASE: u32 = 0x9000_001A;

        tag == IO_REPARSE_TAG_WOF
            || tag == IO_REPARSE_TAG_DEDUP
            || (tag & IO_REPARSE_TAG_CLOUD_MASK) == IO_REPARSE_TAG_CLOUD_BASE
    }

    fn is_bare_drive_root(path: &Path) -> bool {
        let s = path.to_string_lossy();
        let stripped = s.strip_prefix(r"\\?\").unwrap_or(&s);
        let bytes = stripped.as_bytes();
        (bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':')
            || (bytes.len() == 3
                && bytes[0].is_ascii_alphabetic()
                && bytes[1] == b':'
                && (bytes[2] == b'\\' || bytes[2] == b'/'))
    }

    /// Reads the NTFS reparse tag via `FindFirstFileW` (using a `\\?\` verbatim
    /// path so paths longer than `MAX_PATH` succeed).
    fn query_reparse_tag(path: &Path) -> Option<u32> {
        use windows::Win32::Storage::FileSystem::{FindClose, FindFirstFileW, WIN32_FIND_DATAW};

        let mut wide_path = super::super::wide_verbatim(path);
        // `FindFirstFileW` rejects a trailing backslash on non-root directories.
        while wide_path.len() > 2 && wide_path[wide_path.len() - 2] == '\\' as u16 {
            wide_path.remove(wide_path.len() - 2);
        }
        let mut data = WIN32_FIND_DATAW::default();
        let handle = unsafe { FindFirstFileW(PCWSTR(wide_path.as_ptr()), &mut data) }.ok()?;
        let _ = unsafe { FindClose(handle) };
        Some(data.dwReserved0)
    }

    /// True when `path` is a redirecting reparse point (symlink, junction,
    /// volume mount point, app execution alias, unknown reparse tag) or an
    /// unhydrated cloud placeholder that would download data on read.
    ///
    /// Uses `\\?\` verbatim paths so directories deeper than 260 characters are
    /// inspected accurately instead of failing closed as fake symlinks, and
    /// allows transparent local storage tags (CompactOS WOF, hydrated OneDrive,
    /// NTFS dedup) so normal user projects are never silently skipped.
    pub fn is_reparse_point(path: &Path) -> bool {
        use windows::Win32::Storage::FileSystem::{
            GetFileAttributesW, FILE_ATTRIBUTE_OFFLINE, FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS,
            FILE_ATTRIBUTE_RECALL_ON_OPEN, INVALID_FILE_ATTRIBUTES,
        };

        if is_bare_drive_root(path) {
            return false;
        }

        let wide_path = super::super::wide_verbatim(path);
        let attrs = unsafe { GetFileAttributesW(PCWSTR(wide_path.as_ptr())) };
        if attrs == INVALID_FILE_ATTRIBUTES {
            // Fall back once to `symlink_metadata` (e.g. relative paths in unit
            // tests before canonicalisation). Fail closed if still unreadable.
            use std::os::windows::fs::MetadataExt;
            let Ok(meta) = std::fs::symlink_metadata(path) else {
                return true;
            };
            if meta.file_type().is_symlink() {
                return true;
            }
            let fallback_attrs = meta.file_attributes();
            let cloud_stub = FILE_ATTRIBUTE_OFFLINE.0
                | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS.0
                | FILE_ATTRIBUTE_RECALL_ON_OPEN.0;
            if fallback_attrs & cloud_stub != 0 {
                return true;
            }
            if fallback_attrs & FILE_ATTRIBUTE_REPARSE_POINT.0 == 0 {
                return false;
            }
            return !query_reparse_tag(path).is_some_and(is_transparent_reparse_tag);
        }

        let cloud_stub = FILE_ATTRIBUTE_OFFLINE.0
            | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS.0
            | FILE_ATTRIBUTE_RECALL_ON_OPEN.0;
        if attrs & cloud_stub != 0 {
            return true;
        }
        if attrs & FILE_ATTRIBUTE_REPARSE_POINT.0 == 0 {
            return false;
        }

        // Inspect the actual reparse tag: symlinks (0xA000000C), directory
        // junctions / mount points (0xA0000003), app execution aliases and any
        // unrecognized tag fail closed as `true`.
        !query_reparse_tag(path).is_some_and(is_transparent_reparse_tag)
    }

    pub fn is_remote_path(path: &Path) -> bool {
        let s = path.to_string_lossy();
        let stripped = s.strip_prefix(r"\\?\").unwrap_or(&s);
        if stripped.starts_with(r"\\") {
            return true;
        }
        let Some(first) = stripped.chars().next() else {
            return true;
        };
        if !first.is_ascii_alphabetic() {
            return true;
        }
        let root = format!("{}:\\", first);
        let w = wide(Path::new(&root));
        let drive_type = unsafe { GetDriveTypeW(PCWSTR(w.as_ptr())) };
        // DRIVE_REMOTE == 4, DRIVE_NO_ROOT_DIR == 1
        drive_type == 4 || drive_type == 1
    }

    /// Probes whether a single file or directory handle is locked by another
    /// process using `DELETE` access with `FILE_SHARE_MODE(0)`.
    ///
    /// Unlike `dwDesiredAccess = 0` (which only queries metadata and bypasses
    /// Win32 sharing checks), requesting `DELETE` forces NTFS to enforce active
    /// sharing modes - catching exclusive locks and processes holding open
    /// handles without `FILE_SHARE_DELETE`, while still succeeding on unlocked
    /// read-only files.
    fn probe_handle_in_use(path: &Path) -> Option<bool> {
        use windows::Win32::Storage::FileSystem::{DELETE, FILE_FLAG_OPEN_REPARSE_POINT};

        let w = super::super::wide_verbatim(path);
        unsafe {
            match CreateFileW(
                PCWSTR(w.as_ptr()),
                DELETE.0,
                FILE_SHARE_MODE(0),
                None,
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
                None,
            ) {
                Ok(h) => {
                    let _ = CloseHandle(h);
                    Some(false)
                }
                Err(err) => {
                    let code = err.code().0 as u32 & 0xFFFF;
                    match code {
                        // ERROR_SHARING_VIOLATION / ERROR_LOCK_VIOLATION
                        32 | 33 => Some(true),
                        // ERROR_FILE_NOT_FOUND / ERROR_PATH_NOT_FOUND
                        2 | 3 => Some(false),
                        // Anything else (notably ACCESS_DENIED) is unknown and
                        // must block deletion rather than allow it.
                        _ => None,
                    }
                }
            }
        }
    }

    #[inline]
    fn is_priority_lock_candidate(name: &std::ffi::OsStr) -> bool {
        let s = name.to_string_lossy();
        let lower = s.to_ascii_lowercase();
        matches!(
            Path::new(&lower).extension().and_then(|e| e.to_str()),
            Some(
                "exe"
                    | "dll"
                    | "node"
                    | "pyd"
                    | "so"
                    | "dylib"
                    | "pdb"
                    | "db"
                    | "sqlite"
                    | "sqlite3"
                    | "wal"
                    | "shm"
                    | "lock"
                    | "pid"
            )
        ) || lower.ends_with(".cargo-lock")
            || lower.ends_with(".db-wal")
            || lower.ends_with(".db-shm")
    }

    /// `Some(true)` means a process holds the target (or an active child file
    /// inside a directory) with an incompatible sharing mode, `Some(false)`
    /// means no lock was observed, and `None` means the state could not be
    /// determined (access denied, unsupported volume, …).
    pub fn is_in_use(path: &Path) -> Option<bool> {
        match probe_handle_in_use(path) {
            Some(true) => return Some(true),
            None => return None,
            Some(false) => {}
        }

        let Ok(meta) = std::fs::symlink_metadata(path) else {
            return Some(false);
        };
        if !meta.is_dir() {
            return Some(false);
        }

        // Fast O(1) process image check against the 2-second cached process
        // table: if any running process executable lives inside `path` (e.g.
        // `target\debug\app.exe` or `node_modules\esbuild\esbuild.exe`), the
        // directory is guaranteed to be in active use.
        if super::has_running_process_under(path) {
            return Some(true);
        }

        // For directories, NTFS lets us open the directory itself even when a
        // process holds an open file inside it. Probe lock-prone binary,
        // native-addon, and database/lock files first in every directory so an
        // active `.exe`, `.dll`, `.node`, or `.db-wal` is never hidden behind
        // dozens of unlocked `.js` or `.d.ts` source files.
        const MAX_PRIORITY_PROBES: usize = 96;
        const MAX_ORDINARY_PROBES: usize = 32;
        const MAX_PROBE_DEPTH: u8 = 4;
        const MAX_QUEUED_DIRS: usize = 48;
        let mut priority_probed = 0usize;
        let mut ordinary_probed = 0usize;
        let mut queue: std::collections::VecDeque<(PathBuf, u8)> =
            std::collections::VecDeque::from([(path.to_path_buf(), 0)]);
        while let Some((dir, depth)) = queue.pop_front() {
            let Ok(entries) = super::super::fast_walk::read_dir_fast(&dir) else {
                return None;
            };
            let mut ordinary_files: Vec<PathBuf> = Vec::new();
            for entry in entries {
                if entry.is_redirecting_reparse {
                    continue;
                }
                let child = dir.join(&entry.name);
                if entry.is_dir {
                    if depth < MAX_PROBE_DEPTH && queue.len() < MAX_QUEUED_DIRS {
                        queue.push_back((child, depth + 1));
                    }
                    continue;
                }
                if is_priority_lock_candidate(&entry.name) {
                    if priority_probed < MAX_PRIORITY_PROBES {
                        priority_probed += 1;
                        match probe_handle_in_use(&child) {
                            Some(true) => return Some(true),
                            None => return None,
                            Some(false) => {}
                        }
                    }
                } else if ordinary_probed + ordinary_files.len() < MAX_ORDINARY_PROBES {
                    ordinary_files.push(child);
                }
            }
            for child in ordinary_files {
                if ordinary_probed >= MAX_ORDINARY_PROBES {
                    break;
                }
                ordinary_probed += 1;
                match probe_handle_in_use(&child) {
                    Some(true) => return Some(true),
                    None => return None,
                    Some(false) => {}
                }
            }
            if priority_probed >= MAX_PRIORITY_PROBES && ordinary_probed >= MAX_ORDINARY_PROBES {
                return Some(false);
            }
        }
        Some(false)
    }

    pub fn volume_free_bytes(path: &Path) -> Option<u64> {
        use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let mut free: u64 = 0;
        let w = super::super::wide_verbatim(path);
        let ok = unsafe { GetDiskFreeSpaceExW(PCWSTR(w.as_ptr()), Some(&mut free), None, None) };
        if ok.is_ok() {
            return Some(free);
        }
        let fallback = wide(path);
        let ok =
            unsafe { GetDiskFreeSpaceExW(PCWSTR(fallback.as_ptr()), Some(&mut free), None, None) };
        if ok.is_ok() {
            Some(free)
        } else {
            None
        }
    }

    /// Free and total bytes for the volume that hosts `path`.
    pub fn volume_space(path: &Path) -> Option<(u64, u64)> {
        use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let mut free: u64 = 0;
        let mut total: u64 = 0;
        let w = super::super::wide_verbatim(path);
        let ok = unsafe {
            GetDiskFreeSpaceExW(PCWSTR(w.as_ptr()), Some(&mut free), Some(&mut total), None)
        };
        if ok.is_ok() && total > 0 {
            return Some((free, total));
        }
        let fallback = wide(path);
        let ok = unsafe {
            GetDiskFreeSpaceExW(
                PCWSTR(fallback.as_ptr()),
                Some(&mut free),
                Some(&mut total),
                None,
            )
        };
        if ok.is_ok() && total > 0 {
            Some((free, total))
        } else {
            None
        }
    }
}

#[cfg(not(windows))]
mod win {
    use super::*;
    use std::os::unix::fs::MetadataExt;

    pub fn facts(path: &Path) -> Option<FileFacts> {
        let meta = std::fs::symlink_metadata(path).ok()?;
        let logical = meta.len();
        let allocated = meta.blocks().saturating_mul(512);
        Some(FileFacts {
            allocated_bytes: if allocated > 0 || logical == 0 {
                allocated
            } else {
                logical
            },
            logical_bytes: logical,
            link_count: meta.nlink().min(u32::MAX as u64).max(1) as u32,
            identity: FileIdentity {
                volume_serial: meta.dev(),
                file_index: meta.ino(),
            },
        })
    }

    pub fn identity(path: &Path) -> Option<FileIdentity> {
        facts(path).map(|f| f.identity)
    }

    pub fn is_reparse_point(path: &Path) -> bool {
        std::fs::symlink_metadata(path)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(true)
    }

    pub fn is_remote_path(path: &Path) -> bool {
        let s = path.to_string_lossy();
        s.starts_with("//")
            || s.starts_with("/Volumes/smb")
            || s.starts_with("/net/")
            || s.contains("/gvfs/")
    }

    pub fn is_in_use(path: &Path) -> Option<bool> {
        // POSIX allows unlinking open files safely; return `Some(false)` when
        // the path is stat-able and `None` on permission errors.
        match std::fs::symlink_metadata(path) {
            Ok(_) => Some(false),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Some(false),
            Err(_) => None,
        }
    }

    pub fn volume_free_bytes(path: &Path) -> Option<u64> {
        volume_space(path).map(|(free, _)| free)
    }

    pub fn volume_space(path: &Path) -> Option<(u64, u64)> {
        // Portable POSIX `df -kP` returns 1024-byte blocks (total, used, avail)
        // on both Linux and macOS without requiring an extra `libc` dependency.
        let out = std::process::Command::new("df")
            .args(["-kP", "--"])
            .arg(path)
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let stdout = String::from_utf8_lossy(&out.stdout);
        let data_line = stdout.lines().nth(1)?;
        let cols: Vec<&str> = data_line.split_whitespace().collect();
        if cols.len() < 4 {
            return None;
        }
        let total_kib = cols[1].parse::<u64>().ok()?;
        let avail_kib = cols[3].parse::<u64>().ok()?;
        if total_kib == 0 {
            return None;
        }
        Some((
            avail_kib.saturating_mul(1024),
            total_kib.saturating_mul(1024),
        ))
    }
}

#[cfg(windows)]
pub(crate) use win::is_transparent_reparse_tag;

pub use win::{
    facts, identity, is_in_use, is_remote_path, is_reparse_point, volume_free_bytes, volume_space,
};

use std::sync::Mutex;
use std::time::{Duration, Instant};

struct ProcessSnapshot {
    timestamp: Instant,
    entries: Vec<(String, Option<PathBuf>)>,
}

static PROCESS_CACHE: Mutex<Option<ProcessSnapshot>> = Mutex::new(None);
const PROCESS_CACHE_TTL: Duration = Duration::from_millis(2000);

pub fn invalidate_process_cache() {
    if let Ok(mut guard) = PROCESS_CACHE.lock() {
        *guard = None;
    }
}

fn fetch_running_processes_raw() -> Vec<(String, Option<PathBuf>)> {
    #[cfg(windows)]
    {
        use std::ffi::OsString;
        use std::os::windows::ffi::OsStringExt;
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        };
        use windows::Win32::System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
            PROCESS_QUERY_LIMITED_INFORMATION,
        };

        let mut out = Vec::new();
        unsafe {
            let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
                return out;
            };
            let mut entry = PROCESSENTRY32W {
                dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };

            // Reuse a single path buffer across all processes instead of
            // allocating 64 KiB per process inside the mutex.
            let mut buf = vec![0u16; 4096];

            if Process32FirstW(snapshot, &mut entry).is_ok() {
                loop {
                    let len = entry
                        .szExeFile
                        .iter()
                        .position(|&c| c == 0)
                        .unwrap_or(entry.szExeFile.len());
                    let exe = OsString::from_wide(&entry.szExeFile[..len])
                        .to_string_lossy()
                        .to_lowercase();
                    let stem = exe.strip_suffix(".exe").unwrap_or(&exe).to_string();

                    let mut full = None;
                    if let Ok(process) = OpenProcess(
                        PROCESS_QUERY_LIMITED_INFORMATION,
                        false,
                        entry.th32ProcessID,
                    ) {
                        let mut size = buf.len() as u32;
                        if QueryFullProcessImageNameW(
                            process,
                            PROCESS_NAME_WIN32,
                            windows::core::PWSTR(buf.as_mut_ptr()),
                            &mut size,
                        )
                        .is_ok()
                        {
                            full = Some(PathBuf::from(OsString::from_wide(&buf[..size as usize])));
                        }
                        let _ = CloseHandle(process);
                    }
                    out.push((stem, full));

                    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
                    if Process32NextW(snapshot, &mut entry).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snapshot);
        }
        out
    }
    #[cfg(target_os = "linux")]
    {
        let mut out = Vec::new();
        if let Ok(entries) = std::fs::read_dir("/proc") {
            for entry in entries.flatten() {
                let name = entry.file_name();
                if !name.to_string_lossy().chars().all(|c| c.is_ascii_digit()) {
                    continue;
                }
                let comm_path = entry.path().join("comm");
                if let Ok(comm) = std::fs::read_to_string(comm_path) {
                    let stem = comm.trim().to_lowercase();
                    if !stem.is_empty() {
                        let exe = std::fs::read_link(entry.path().join("exe")).ok();
                        out.push((stem, exe));
                    }
                }
            }
        }
        out
    }
    #[cfg(all(unix, not(target_os = "linux")))]
    {
        let mut out = Vec::new();
        if let Ok(output) = std::process::Command::new("ps")
            .args(["-axo", "comm="])
            .output()
        {
            if output.status.success() {
                let text = String::from_utf8_lossy(&output.stdout);
                for line in text.lines() {
                    let raw = line.trim();
                    if raw.is_empty() {
                        continue;
                    }
                    let path = PathBuf::from(raw);
                    let stem = path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_lowercase())
                        .unwrap_or_else(|| raw.to_lowercase());
                    out.push((stem, Some(path)));
                }
            }
        }
        out
    }
}

fn cached_processes() -> Vec<(String, Option<PathBuf>)> {
    let mut lock = PROCESS_CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(entry) = &*lock {
        if entry.timestamp.elapsed() < PROCESS_CACHE_TTL {
            return entry.entries.clone();
        }
    }
    let fresh = fetch_running_processes_raw();
    *lock = Some(ProcessSnapshot {
        timestamp: Instant::now(),
        entries: fresh.clone(),
    });
    fresh
}

/// True when any running process has its executable image located under `dir`.
#[cfg(windows)]
fn has_running_process_under(dir: &Path) -> bool {
    let dir_key = crate::safety::path_guard::normalize_key(dir);
    if dir_key.is_empty() {
        return false;
    }
    for (_, exe_path) in cached_processes() {
        let Some(exe) = exe_path else { continue };
        let exe_key = crate::safety::path_guard::normalize_key(&exe);
        if !exe_key.is_empty()
            && (exe_key == dir_key || crate::safety::path_guard::is_within(&exe_key, &dir_key))
        {
            return true;
        }
    }
    false
}

/// Enumerates running processes whose executable file name matches one of the
/// given names (case-insensitive, without `.exe`).
pub fn running_process_names(names: &[&str]) -> Vec<(String, Option<PathBuf>)> {
    let all_processes = cached_processes();

    all_processes
        .into_iter()
        .filter(|(stem, _)| {
            names.iter().any(|n| {
                let target = n.to_lowercase();
                stem == &target
                    || (stem.starts_with(&target)
                        && stem.as_bytes().get(target.len()).copied() == Some(b'-'))
            })
        })
        .collect()
}
