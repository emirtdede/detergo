use std::fs::{self, File};
use std::io::{self, Cursor, Read, Seek, SeekFrom, Write};
use std::path::{Component, Path};

use zip::ZipArchive;

/// 24-byte SFX overlay footer appended after the compressed payload ZIP:
/// `[magic: 8 bytes "DTGSFX01"][zip_offset: u64 LE][zip_len: u64 LE]`
pub const SFX_MAGIC: &[u8; 8] = b"DTGSFX01";
pub const SFX_FOOTER_LEN: u64 = 24;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SfxLayout {
    pub zip_offset: u64,
    pub zip_len: u64,
}

/// Inspects an executable for a `DTGSFX01` self-extracting ZIP overlay.
pub fn inspect_sfx(exe_path: &Path) -> io::Result<Option<SfxLayout>> {
    let mut file = File::open(exe_path)?;
    let total_len = file.metadata()?.len();
    if total_len < SFX_FOOTER_LEN {
        return Ok(None);
    }
    file.seek(SeekFrom::End(-(SFX_FOOTER_LEN as i64)))?;
    let mut footer = [0u8; 24];
    file.read_exact(&mut footer)?;
    if &footer[0..8] != SFX_MAGIC {
        return Ok(None);
    }
    let zip_offset = u64::from_le_bytes(footer[8..16].try_into().unwrap());
    let zip_len = u64::from_le_bytes(footer[16..24].try_into().unwrap());
    if zip_offset == 0
        || zip_len == 0
        || zip_offset
            .checked_add(zip_len)
            .and_then(|end| end.checked_add(SFX_FOOTER_LEN))
            != Some(total_len)
    {
        return Ok(None);
    }
    Ok(Some(SfxLayout {
        zip_offset,
        zip_len,
    }))
}

/// Extracts the embedded ZIP payload into `target_dir`, calling `on_file(done, total)`
/// after each extracted file. Refuses any archive entry with path traversal.
pub fn extract_payload<F>(exe_path: &Path, target_dir: &Path, mut on_file: F) -> Result<(), String>
where
    F: FnMut(usize, usize),
{
    let layout = inspect_sfx(exe_path)
        .map_err(|e| format!("Failed to inspect installer package: {e}"))?
        .ok_or_else(|| "Installer payload is missing from this executable.".to_string())?;

    let mut file =
        File::open(exe_path).map_err(|e| format!("Could not open installer binary: {e}"))?;
    file.seek(SeekFrom::Start(layout.zip_offset))
        .map_err(|e| format!("Could not seek to payload: {e}"))?;

    let mut payload_bytes = vec![0u8; layout.zip_len as usize];
    file.read_exact(&mut payload_bytes)
        .map_err(|e| format!("Could not read embedded payload: {e}"))?;

    let mut archive = ZipArchive::new(Cursor::new(payload_bytes))
        .map_err(|e| format!("Embedded payload archive is corrupt: {e}"))?;

    fs::create_dir_all(target_dir).map_err(|e| format!("Could not create install folder: {e}"))?;

    let total = archive.len().max(1);
    for idx in 0..archive.len() {
        let mut entry = archive
            .by_index(idx)
            .map_err(|e| format!("Could not read payload entry: {e}"))?;
        let rel = entry
            .enclosed_name()
            .ok_or_else(|| "Payload contains an unsafe path entry.".to_string())?;
        if rel.components().any(|c| {
            matches!(
                c,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        }) {
            return Err("Payload contains a disallowed path segment.".to_string());
        }
        let dest = target_dir.join(rel);
        if entry.is_dir() {
            fs::create_dir_all(&dest)
                .map_err(|e| format!("Could not create directory {}: {e}", dest.display()))?;
        } else {
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(|e| {
                    format!("Could not prepare directory {}: {e}", parent.display())
                })?;
            }
            let mut out = File::create(&dest)
                .map_err(|e| format!("Could not write {}: {e}", dest.display()))?;
            io::copy(&mut entry, &mut out)
                .map_err(|e| format!("Could not extract {}: {e}", dest.display()))?;
            out.flush()
                .map_err(|e| format!("Could not flush {}: {e}", dest.display()))?;
        }
        on_file(idx + 1, total);
    }
    Ok(())
}

/// Copies the stripped setup stub (bytes `0..zip_offset`, without the embedded
/// ZIP payload) to `<target_dir>\uninstall.exe` so the uninstaller is compact
/// and carries the exact 15-frame brand ICO.
pub fn write_uninstaller_stub(exe_path: &Path, dest_uninstaller: &Path) -> Result<(), String> {
    let stub_len = match inspect_sfx(exe_path)
        .map_err(|e| format!("Could not inspect installer stub: {e}"))?
    {
        Some(layout) => layout.zip_offset,
        None => fs::metadata(exe_path)
            .map_err(|e| format!("Could not stat installer binary: {e}"))?
            .len(),
    };

    let mut src =
        File::open(exe_path).map_err(|e| format!("Could not open installer binary: {e}"))?;
    let mut dst = File::create(dest_uninstaller)
        .map_err(|e| format!("Could not create uninstall.exe: {e}"))?;

    let mut limited = std::io::Read::by_ref(&mut src).take(stub_len);
    io::copy(&mut limited, &mut dst)
        .map_err(|e| format!("Could not copy uninstaller stub: {e}"))?;
    dst.flush()
        .map_err(|e| format!("Could not flush uninstall.exe: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn build_fake_sfx(stub: &[u8], files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut zip_buf = Vec::new();
        {
            let mut writer = ZipWriter::new(Cursor::new(&mut zip_buf));
            let opts = SimpleFileOptions::default();
            for (name, data) in files {
                writer.start_file(*name, opts).unwrap();
                writer.write_all(data).unwrap();
            }
            writer.finish().unwrap();
        }
        let mut out = Vec::new();
        out.extend_from_slice(stub);
        let zip_offset = stub.len() as u64;
        let zip_len = zip_buf.len() as u64;
        out.extend_from_slice(&zip_buf);
        out.extend_from_slice(SFX_MAGIC);
        out.extend_from_slice(&zip_offset.to_le_bytes());
        out.extend_from_slice(&zip_len.to_le_bytes());
        out
    }

    #[test]
    fn inspects_extracts_and_strips_uninstaller_stub() {
        let dir = tempfile::tempdir().unwrap();
        let fake_exe = dir.path().join("Detergo-Setup.exe");
        let stub = b"MZ-FAKE-PE-STUB-BYTES";
        let sfx = build_fake_sfx(
            stub,
            &[
                ("detergo.exe", b"BINARY-MAIN"),
                ("detergo.com", b"BINARY-CLI"),
                ("app.ico", b"ICON-BYTES"),
            ],
        );
        fs::write(&fake_exe, &sfx).unwrap();

        let layout = inspect_sfx(&fake_exe).unwrap().expect("layout");
        assert_eq!(layout.zip_offset, stub.len() as u64);

        let install_dir = dir.path().join("installed");
        let mut count = 0usize;
        extract_payload(&fake_exe, &install_dir, |done, _total| count = done).unwrap();
        assert_eq!(count, 3);
        assert_eq!(
            fs::read(install_dir.join("detergo.exe")).unwrap(),
            b"BINARY-MAIN"
        );
        assert_eq!(
            fs::read(install_dir.join("detergo.com")).unwrap(),
            b"BINARY-CLI"
        );

        let uninst = install_dir.join("uninstall.exe");
        write_uninstaller_stub(&fake_exe, &uninst).unwrap();
        assert_eq!(fs::read(&uninst).unwrap(), stub);
    }
}
