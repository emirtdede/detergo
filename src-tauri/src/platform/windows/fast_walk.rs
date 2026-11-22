//! High-throughput Windows directory enumeration and size measurement.
//!
//! Standard `WalkDir` + per-file `CreateFileW` opens a kernel handle on every
//! file in a tree, triggering antivirus minifilters hundreds of thousands of
//! times inside `node_modules` or build outputs.
//!
//! This module uses two documented Win32 batch APIs already covered by
//! `Win32_Storage_FileSystem`:
//!
//! 1. `GetFileInformationByHandleEx(FileIdBothDirectoryInfo)` for size
//!    measurement: returns `EndOfFile`, `AllocationSize`, `FileAttributes`,
//!    `EaSize` (reparse tag), and 64-bit NTFS `FileId` for hundreds of entries
//!    in a single syscall - zero per-file `CreateFileW` opens while preserving
//!    exact hardlink deduplication.
//! 2. `FindFirstFileExW(FindExInfoBasic, FIND_FIRST_EX_LARGE_FETCH)` for
//!    parallel discovery: reads directory entries in large kernel batches with
//!    attributes, reparse tag (`dwReserved0`), and `ftLastWriteTime` already
//!    populated - zero extra `metadata()` or `GetFileAttributesW` calls.

#[cfg(windows)]
mod imp {
    use std::collections::HashSet;
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
    use std::sync::Mutex;
    use std::time::Instant;

    use crossbeam_channel as channel;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, GetLastError, ERROR_NO_MORE_FILES, HANDLE};
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FileIdBothDirectoryInfo, FindClose, FindExInfoBasic, FindExSearchNameMatch,
        FindFirstFileExW, FindNextFileW, GetCompressedFileSizeW, GetFileInformationByHandleEx,
        FILE_ATTRIBUTE_COMPRESSED, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_OFFLINE,
        FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS, FILE_ATTRIBUTE_RECALL_ON_OPEN,
        FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_SPARSE_FILE, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_ID_BOTH_DIR_INFO, FILE_LIST_DIRECTORY,
        FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
        FIND_FIRST_EX_LARGE_FETCH, OPEN_EXISTING, WIN32_FIND_DATAW,
    };

    use crate::platform::windows::fs_meta::is_transparent_reparse_tag;
    use crate::scanner::cancellation::CancellationToken;
    use crate::scanner::measurement::{PathSize, SessionHardlinkTracker};

    const DIR_BUFFER_BYTES: usize = 64 * 1024;
    const FILE_ID_SHARDS: usize = 16;

    /// Windows FILETIME epoch offset (1601-01-01 to 1970-01-01) in 100ns ticks.
    const WINDOWS_TO_UNIX_EPOCH_TICKS: u64 = 116_444_736_000_000_000;

    /// Lightweight directory entry returned by `read_dir_fast`.
    #[derive(Debug, Clone)]
    pub struct FastDirEntry {
        pub name: OsString,
        pub is_dir: bool,
        pub is_file: bool,
        pub is_redirecting_reparse: bool,
        pub modified_ms: Option<i64>,
    }

    pub enum FastMeasureError {
        CancelledOrExpired,
        Unsupported,
    }

    struct DirHandle(HANDLE);

    impl Drop for DirHandle {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }

    #[inline]
    fn is_cloud_stub(attrs: u32) -> bool {
        let mask = FILE_ATTRIBUTE_OFFLINE.0
            | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS.0
            | FILE_ATTRIBUTE_RECALL_ON_OPEN.0;
        (attrs & mask) != 0
    }

    #[inline]
    fn is_redirecting_reparse_attrs(attrs: u32, reparse_tag: u32) -> bool {
        if is_cloud_stub(attrs) {
            return true;
        }
        if (attrs & FILE_ATTRIBUTE_REPARSE_POINT.0) == 0 {
            return false;
        }
        !is_transparent_reparse_tag(reparse_tag)
    }

    #[inline]
    fn filetime_to_unix_ms(low: u32, high: u32) -> Option<i64> {
        let ticks = ((high as u64) << 32) | (low as u64);
        if ticks < WINDOWS_TO_UNIX_EPOCH_TICKS {
            return None;
        }
        let ms = (ticks - WINDOWS_TO_UNIX_EPOCH_TICKS) / 10_000;
        i64::try_from(ms).ok()
    }

    fn compressed_size_verbatim(path: &Path) -> Option<u64> {
        let w = super::super::wide_verbatim(path);
        let mut high: u32 = 0;
        unsafe {
            let low = GetCompressedFileSizeW(PCWSTR(w.as_ptr()), Some(&mut high));
            if low == u32::MAX && GetLastError().0 != 0 {
                None
            } else {
                Some(((high as u64) << 32) | (low as u64))
            }
        }
    }

    fn open_dir_for_list(path: &Path) -> Result<DirHandle, u32> {
        let wide = super::super::wide_verbatim(path);
        unsafe {
            CreateFileW(
                PCWSTR(wide.as_ptr()),
                FILE_LIST_DIRECTORY.0 | FILE_READ_ATTRIBUTES.0,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                None,
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
                None,
            )
        }
        .map(DirHandle)
        .map_err(|e| e.code().0 as u32 & 0xFFFF)
    }

    #[inline]
    fn is_dot_entry(units: &[u16]) -> bool {
        (units.len() == 1 && units[0] == b'.' as u16)
            || (units.len() == 2 && units[0] == b'.' as u16 && units[1] == b'.' as u16)
    }

    fn past_deadline(deadline: Option<Instant>) -> bool {
        deadline.map(|d| Instant::now() >= d).unwrap_or(false)
    }

    /// Reads one directory's immediate entries using `FindFirstFileExW` with
    /// `FindExInfoBasic` and `FIND_FIRST_EX_LARGE_FETCH`.
    pub fn read_dir_fast(dir: &Path) -> std::io::Result<Vec<FastDirEntry>> {
        let mut pattern = super::super::wide_verbatim(dir);
        // Strip trailing NUL.
        if pattern.last() == Some(&0) {
            pattern.pop();
        }
        // Ensure a single trailing backslash before `*`.
        if pattern.last() != Some(&('\\' as u16)) {
            pattern.push('\\' as u16);
        }
        pattern.push('*' as u16);
        pattern.push(0);

        let mut data = WIN32_FIND_DATAW::default();
        let handle = unsafe {
            FindFirstFileExW(
                PCWSTR(pattern.as_ptr()),
                FindExInfoBasic,
                &mut data as *mut _ as *mut core::ffi::c_void,
                FindExSearchNameMatch,
                None,
                FIND_FIRST_EX_LARGE_FETCH,
            )
        }
        .map_err(|err| {
            let code = err.code().0 as u32 & 0xFFFF;
            std::io::Error::from_raw_os_error(code as i32)
        })?;

        struct FindGuard(HANDLE);
        impl Drop for FindGuard {
            fn drop(&mut self) {
                unsafe {
                    let _ = FindClose(self.0);
                }
            }
        }
        let guard = FindGuard(handle);
        let mut entries = Vec::with_capacity(64);

        loop {
            let name_len = data
                .cFileName
                .iter()
                .position(|&u| u == 0)
                .unwrap_or(data.cFileName.len());
            let name_units = &data.cFileName[..name_len];
            if !is_dot_entry(name_units) {
                let attrs = data.dwFileAttributes;
                let is_dir = (attrs & FILE_ATTRIBUTE_DIRECTORY.0) != 0;
                let is_redirecting_reparse = is_redirecting_reparse_attrs(attrs, data.dwReserved0);
                let modified_ms = filetime_to_unix_ms(
                    data.ftLastWriteTime.dwLowDateTime,
                    data.ftLastWriteTime.dwHighDateTime,
                );
                entries.push(FastDirEntry {
                    name: OsString::from_wide(name_units),
                    is_dir,
                    is_file: !is_dir,
                    is_redirecting_reparse,
                    modified_ms,
                });
            }

            if unsafe { FindNextFileW(guard.0, &mut data) }.is_err() {
                break;
            }
        }

        Ok(entries)
    }

    struct MeasureShared {
        logical: AtomicU64,
        allocated: AtomicU64,
        files: AtomicU64,
        dedup: AtomicU64,
        all_known: AtomicBool,
        aborted: AtomicBool,
        seen_shards: [Mutex<HashSet<u64>>; FILE_ID_SHARDS],
    }

    impl MeasureShared {
        fn new() -> Self {
            Self {
                logical: AtomicU64::new(0),
                allocated: AtomicU64::new(0),
                files: AtomicU64::new(0),
                dedup: AtomicU64::new(0),
                all_known: AtomicBool::new(true),
                aborted: AtomicBool::new(false),
                seen_shards: std::array::from_fn(|_| Mutex::new(HashSet::new())),
            }
        }

        #[inline]
        fn mark_seen(&self, file_id: u64) -> bool {
            if file_id == 0 {
                return true;
            }
            let shard = ((file_id.wrapping_mul(0x9E37_79B9_7F4A_7C15)) >> 60) as usize
                & (FILE_ID_SHARDS - 1);
            let mut set = self.seen_shards[shard]
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            set.insert(file_id)
        }
    }

    /// Scans one directory handle using `FileIdBothDirectoryInfo`, accumulating
    /// file sizes into `shared` and pushing non-reparse subdirectories into
    /// `subdirs`.
    #[allow(clippy::too_many_arguments)]
    fn scan_one_dir(
        dir: &Path,
        buf: &mut [u64],
        token: &CancellationToken,
        deadline: Option<Instant>,
        shared: &MeasureShared,
        session_tracker: Option<(&SessionHardlinkTracker, u64)>,
        subdirs: &mut Vec<PathBuf>,
        is_root: bool,
    ) -> Result<(), FastMeasureError> {
        if token.is_cancelled() || past_deadline(deadline) {
            shared.aborted.store(true, Ordering::Relaxed);
            return Err(FastMeasureError::CancelledOrExpired);
        }

        let handle = match open_dir_for_list(dir) {
            Ok(h) => h,
            Err(code) => {
                // `ERROR_INVALID_FUNCTION`, `ERROR_NOT_SUPPORTED`, `ERROR_INVALID_PARAMETER`
                if is_root && matches!(code, 1 | 50 | 87) {
                    return Err(FastMeasureError::Unsupported);
                }
                // Unreadable child directory: mark measurement partial and continue.
                shared.all_known.store(false, Ordering::Relaxed);
                return Ok(());
            }
        };

        let mut local_logical: u64 = 0;
        let mut local_allocated: u64 = 0;
        let mut local_files: u64 = 0;
        let mut local_dedup: u64 = 0;
        let mut batch_count: u32 = 0;

        let buf_bytes = std::mem::size_of_val(buf) as u32;
        let buf_ptr = buf.as_mut_ptr() as *mut core::ffi::c_void;

        loop {
            if token.is_cancelled() || past_deadline(deadline) {
                shared.aborted.store(true, Ordering::Relaxed);
                return Err(FastMeasureError::CancelledOrExpired);
            }

            let res = unsafe {
                GetFileInformationByHandleEx(handle.0, FileIdBothDirectoryInfo, buf_ptr, buf_bytes)
            };

            if let Err(err) = res {
                let code = err.code().0 as u32 & 0xFFFF;
                if code == ERROR_NO_MORE_FILES.0 {
                    break;
                }
                if is_root && batch_count == 0 && matches!(code, 1 | 50 | 87) {
                    return Err(FastMeasureError::Unsupported);
                }
                shared.all_known.store(false, Ordering::Relaxed);
                break;
            }
            batch_count += 1;

            let base = buf.as_ptr() as *const u8;
            let mut offset: usize = 0;
            let total_bytes = buf_bytes as usize;
            let header_min = std::mem::offset_of!(FILE_ID_BOTH_DIR_INFO, FileName);

            loop {
                // On x64, `FILE_ID_BOTH_DIR_INFO` has 6 bytes of tail alignment
                // padding (`size_of == 112`, `offset_of(FileName) == 104`). The
                // final entry in a 64 KiB buffer for a 1-3 char name (`a`, `js`,
                // `src`) only occupies 106-110 bytes, so check against
                // `header_min + 2` and copy into a zeroed stack struct when near
                // the buffer tail to avoid both dropping entries and OOB reads.
                if offset + header_min + 2 > total_bytes {
                    break;
                }
                let info: FILE_ID_BOTH_DIR_INFO =
                    if offset + std::mem::size_of::<FILE_ID_BOTH_DIR_INFO>() <= total_bytes {
                        let info_ptr = unsafe { base.add(offset) as *const FILE_ID_BOTH_DIR_INFO };
                        unsafe { std::ptr::read_unaligned(info_ptr) }
                    } else {
                        let mut tmp = std::mem::MaybeUninit::<FILE_ID_BOTH_DIR_INFO>::zeroed();
                        let avail = total_bytes - offset;
                        unsafe {
                            std::ptr::copy_nonoverlapping(
                                base.add(offset),
                                tmp.as_mut_ptr() as *mut u8,
                                avail,
                            );
                            tmp.assume_init()
                        }
                    };

                let name_bytes = info.FileNameLength as usize;
                let name_offset = offset + header_min;
                if name_bytes >= 2 && name_offset + name_bytes <= total_bytes {
                    let units_len = name_bytes / 2;
                    let name_ptr = unsafe { base.add(name_offset) as *const u16 };
                    let mut name_stack = [0u16; 260];
                    let name_vec;
                    let units: &[u16] = if units_len <= name_stack.len() {
                        for (i, slot) in name_stack.iter_mut().take(units_len).enumerate() {
                            *slot = unsafe { std::ptr::read_unaligned(name_ptr.add(i)) };
                        }
                        &name_stack[..units_len]
                    } else {
                        let mut v = Vec::with_capacity(units_len);
                        for i in 0..units_len {
                            v.push(unsafe { std::ptr::read_unaligned(name_ptr.add(i)) });
                        }
                        name_vec = v;
                        &name_vec
                    };

                    if !is_dot_entry(units) {
                        let attrs = info.FileAttributes;
                        // When FILE_ATTRIBUTE_REPARSE_POINT is set, Windows places
                        // the reparse tag in EaSize.
                        if !is_redirecting_reparse_attrs(attrs, info.EaSize) {
                            if (attrs & FILE_ATTRIBUTE_DIRECTORY.0) != 0 {
                                subdirs.push(dir.join(OsString::from_wide(units)));
                            } else {
                                local_files += 1;
                                let logical = info.EndOfFile.max(0) as u64;
                                local_logical = local_logical.saturating_add(logical);

                                // NTFS `AllocationSize` reflects actual cluster
                                // allocation on disk (rounded to cluster size) and
                                // returns 0 for tiny MFT-resident files (<~700 B).
                                // For resident files with non-zero payload we keep
                                // `logical` so tiny files aren't reported as 0 B.
                                let raw_alloc = info.AllocationSize.max(0) as u64;
                                let fallback_alloc =
                                    if raw_alloc > 0 { raw_alloc } else { logical };
                                // Only invoke `GetCompressedFileSizeW` for transparent
                                // reparse points (WOF/CompactOS/Dedup) or > 4 KiB
                                // compressed/sparse files whose directory entry still
                                // reports the uncompressed size (`raw_alloc >= logical`).
                                // Files <= 4 KiB occupy at most 1 NTFS cluster and cannot
                                // compress smaller than 1 cluster, avoiding hundreds of
                                // thousands of redundant path syscalls on compressed drives.
                                let needs_compressed = (attrs & FILE_ATTRIBUTE_REPARSE_POINT.0)
                                    != 0
                                    || ((attrs
                                        & (FILE_ATTRIBUTE_COMPRESSED.0
                                            | FILE_ATTRIBUTE_SPARSE_FILE.0))
                                        != 0
                                        && logical > 4096
                                        && raw_alloc >= logical);
                                let alloc = if needs_compressed {
                                    let child_path = dir.join(OsString::from_wide(units));
                                    compressed_size_verbatim(&child_path).unwrap_or(fallback_alloc)
                                } else {
                                    fallback_alloc
                                };

                                let file_id = info.FileId as u64;
                                let first_in_target = shared.mark_seen(file_id);
                                let first_in_session = first_in_target
                                    && session_tracker
                                        .map(|(tracker, group_id)| tracker.claim(file_id, group_id))
                                        .unwrap_or(true);
                                if !first_in_session {
                                    local_dedup = local_dedup.saturating_add(alloc);
                                } else {
                                    local_allocated = local_allocated.saturating_add(alloc);
                                }
                            }
                        }
                    }
                }

                if info.NextEntryOffset == 0 {
                    break;
                }
                offset = offset.saturating_add(info.NextEntryOffset as usize);
                if offset >= total_bytes {
                    break;
                }
            }
        }

        shared.logical.fetch_add(local_logical, Ordering::Relaxed);
        shared
            .allocated
            .fetch_add(local_allocated, Ordering::Relaxed);
        shared.files.fetch_add(local_files, Ordering::Relaxed);
        shared.dedup.fetch_add(local_dedup, Ordering::Relaxed);
        Ok(())
    }

    /// Measures `root` using `FileIdBothDirectoryInfo` batches.
    ///
    /// When `max_workers > 1` and the root contains multiple subdirectories,
    /// subdirectories are distributed across a bounded worker pool. Small or
    /// flat trees stay inline with zero thread-spawn overhead.
    pub fn measure_dir_fast(
        root: &Path,
        token: &CancellationToken,
        deadline: Option<Instant>,
        max_workers: usize,
    ) -> Result<PathSize, FastMeasureError> {
        measure_dir_fast_with_tracker(root, token, deadline, max_workers, None)
    }

    pub fn measure_dir_fast_with_tracker(
        root: &Path,
        token: &CancellationToken,
        deadline: Option<Instant>,
        max_workers: usize,
        session_tracker: Option<(&SessionHardlinkTracker, u64)>,
    ) -> Result<PathSize, FastMeasureError> {
        let shared = MeasureShared::new();
        let mut root_buf = vec![0u64; DIR_BUFFER_BYTES / 8];
        let mut initial_subdirs = Vec::new();

        scan_one_dir(
            root,
            &mut root_buf,
            token,
            deadline,
            &shared,
            session_tracker,
            &mut initial_subdirs,
            true,
        )?;

        if initial_subdirs.is_empty() || max_workers <= 1 {
            let mut stack = initial_subdirs;
            while let Some(dir) = stack.pop() {
                scan_one_dir(
                    &dir,
                    &mut root_buf,
                    token,
                    deadline,
                    &shared,
                    session_tracker,
                    &mut stack,
                    false,
                )?;
            }
        } else {
            let worker_count = max_workers.min(initial_subdirs.len().max(2)).min(8);
            let (tx, rx) = channel::unbounded::<PathBuf>();
            let in_flight = AtomicUsize::new(initial_subdirs.len());
            for sub in initial_subdirs {
                let _ = tx.send(sub);
            }

            std::thread::scope(|scope| {
                for _ in 0..worker_count {
                    let tx = tx.clone();
                    let rx = rx.clone();
                    let shared = &shared;
                    let in_flight = &in_flight;
                    scope.spawn(move || {
                        let mut buf = vec![0u64; DIR_BUFFER_BYTES / 8];
                        let mut local_subs = Vec::with_capacity(32);
                        loop {
                            if shared.aborted.load(Ordering::Relaxed)
                                || token.is_cancelled()
                                || past_deadline(deadline)
                            {
                                shared.aborted.store(true, Ordering::Relaxed);
                                return;
                            }
                            match rx.recv_timeout(std::time::Duration::from_millis(2)) {
                                Ok(dir) => {
                                    local_subs.clear();
                                    let _ = scan_one_dir(
                                        &dir,
                                        &mut buf,
                                        token,
                                        deadline,
                                        shared,
                                        session_tracker,
                                        &mut local_subs,
                                        false,
                                    );
                                    if !local_subs.is_empty() {
                                        in_flight.fetch_add(local_subs.len(), Ordering::AcqRel);
                                        for sub in local_subs.drain(..) {
                                            let _ = tx.send(sub);
                                        }
                                    }
                                    if in_flight.fetch_sub(1, Ordering::AcqRel) == 1 {
                                        return;
                                    }
                                }
                                Err(channel::RecvTimeoutError::Timeout) => {
                                    if in_flight.load(Ordering::Acquire) == 0 {
                                        return;
                                    }
                                }
                                Err(channel::RecvTimeoutError::Disconnected) => return,
                            }
                        }
                    });
                }
            });
        }

        if shared.aborted.load(Ordering::Relaxed) || token.is_cancelled() || past_deadline(deadline)
        {
            return Err(FastMeasureError::CancelledOrExpired);
        }

        let allocated = shared.allocated.load(Ordering::Relaxed);
        Ok(PathSize {
            logical_bytes: shared.logical.load(Ordering::Relaxed),
            allocated_bytes: if shared.all_known.load(Ordering::Relaxed) {
                Some(allocated)
            } else {
                None
            },
            file_count: shared.files.load(Ordering::Relaxed),
            hardlink_dedup_bytes: shared.dedup.load(Ordering::Relaxed),
        })
    }
}

#[cfg(windows)]
pub use imp::{
    measure_dir_fast, measure_dir_fast_with_tracker, read_dir_fast, FastDirEntry, FastMeasureError,
};
