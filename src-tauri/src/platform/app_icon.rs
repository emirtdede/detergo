//! Dynamic theme-matched and custom-color Detergo application icon renderer and
//! native Windows shell updater.
//!
//! Renders the canonical Detergo squircle + `< / * >` mark directly in pure
//! Rust (zero external native dependencies, compiles cleanly on Windows, Linux,
//! and macOS) for any of the 16 built-in themes or an arbitrary user hex color.
//!
//! On Windows, applying an icon updates:
//!  1. The running main window + Taskbar button icon (`window.set_icon`).
//!  2. The System Tray icon (`main-tray`) at DPI-matched resolution.
//!  3. Existing Desktop, Start Menu, and Pinned Taskbar `.lnk` shortcuts plus
//!     the per-user Uninstall `DisplayIcon` registry value (skipped inside the
//!     MSIX Store sandbox where the package manifest owns static tiles), then
//!     notifies Explorer via `SHChangeNotify`.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::AppError;
use crate::settings::CustomThemeConfig;

/// Special selector that automatically mirrors the active UI theme (including
/// custom hex themes).
pub const APP_ICON_MATCH_THEME: &str = "match-theme";
/// Special selector that always renders using the user's custom color studio
/// palette (`CustomThemeConfig`).
pub const APP_ICON_CUSTOM: &str = "custom";

/// Every built-in theme id whose palette can be selected as a standalone icon.
pub const BUILTIN_ICON_IDS: &[&str] = &[
    "dark-black",
    "dark-gray",
    "dark-blue",
    "dark-purple",
    "dark-green",
    "dark-red",
    "dark-orange",
    "dark-yellow",
    "light-white",
    "light-gray",
    "light-blue",
    "light-purple",
    "light-green",
    "light-red",
    "light-orange",
    "light-yellow",
];

/// Summary returned to the frontend after applying an application icon.
#[cfg_attr(feature = "bindings", derive(specta::Type))]
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppIconApplyResult {
    pub resolved_id: String,
    pub window_updated: bool,
    pub tray_updated: bool,
    pub shortcuts_updated: u32,
    pub icon_path: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

impl Rgb {
    pub const fn new(r: u8, g: u8, b: u8) -> Self {
        Self { r, g, b }
    }

    pub fn from_hex(hex: &str) -> Option<Self> {
        let s = hex.trim().trim_start_matches('#');
        if s.len() == 3 && s.bytes().all(|b| b.is_ascii_hexdigit()) {
            let b = s.as_bytes();
            let nibble = |c: u8| -> u8 {
                let v = match c {
                    b'0'..=b'9' => c - b'0',
                    b'a'..=b'f' => c - b'a' + 10,
                    b'A'..=b'F' => c - b'A' + 10,
                    _ => 0,
                };
                (v << 4) | v
            };
            return Some(Self::new(nibble(b[0]), nibble(b[1]), nibble(b[2])));
        }
        if s.len() != 6 || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        let r = u8::from_str_radix(&s[0..2], 16).ok()?;
        let g = u8::from_str_radix(&s[2..4], 16).ok()?;
        let b = u8::from_str_radix(&s[4..6], 16).ok()?;
        Some(Self::new(r, g, b))
    }

    fn mix(self, other: Self, t: f32) -> Self {
        let t = t.clamp(0.0, 1.0);
        let lerp = |a: u8, b: u8| -> u8 {
            ((a as f32) * (1.0 - t) + (b as f32) * t)
                .round()
                .clamp(0.0, 255.0) as u8
        };
        Self::new(
            lerp(self.r, other.r),
            lerp(self.g, other.g),
            lerp(self.b, other.b),
        )
    }

    fn relative_luminance(self) -> f32 {
        fn lin(c: u8) -> f32 {
            let s = c as f32 / 255.0;
            if s <= 0.03928 {
                s / 12.92
            } else {
                ((s + 0.055) / 1.055).powf(2.4)
            }
        }
        0.2126 * lin(self.r) + 0.7152 * lin(self.g) + 0.0722 * lin(self.b)
    }

    fn contrast_ratio(self, other: Self) -> f32 {
        let l1 = self.relative_luminance();
        let l2 = other.relative_luminance();
        let (hi, lo) = if l1 >= l2 { (l1, l2) } else { (l2, l1) };
        (hi + 0.05) / (lo + 0.05)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IconPalette {
    pub bg_top: Rgb,
    pub bg_mid: Rgb,
    pub bg_bottom: Rgb,
    pub rim: Rgb,
    pub glyph: Rgb,
    pub is_light: bool,
}

/// Validates and normalizes an `app_icon` setting value.
pub fn normalize_app_icon(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed == APP_ICON_MATCH_THEME || trimmed == APP_ICON_CUSTOM {
        return trimmed.to_string();
    }
    if BUILTIN_ICON_IDS.contains(&trimmed) {
        return trimmed.to_string();
    }
    APP_ICON_MATCH_THEME.to_string()
}

/// Resolves `"match-theme"` into either `"custom"` or one of the 16 built-in
/// theme ids.
pub fn resolve_icon_id(icon_id: &str, active_theme: &str) -> String {
    let normalized = normalize_app_icon(icon_id);
    if normalized != APP_ICON_MATCH_THEME {
        return normalized;
    }
    if active_theme == APP_ICON_CUSTOM {
        return APP_ICON_CUSTOM.to_string();
    }
    if BUILTIN_ICON_IDS.contains(&active_theme) {
        return active_theme.to_string();
    }
    "dark-black".to_string()
}

/// Returns the icon color palette for a resolved icon id + custom theme config.
pub fn palette_for_icon(resolved_id: &str, custom_theme: &CustomThemeConfig) -> IconPalette {
    if resolved_id == APP_ICON_CUSTOM {
        return custom_palette(custom_theme);
    }

    match resolved_id {
        "dark-gray" => dark_palette(
            Rgb::new(0x28, 0x2a, 0x31),
            Rgb::new(0x16, 0x17, 0x1b),
            Rgb::new(0x0c, 0x0d, 0x10),
            Rgb::new(0xe4, 0xe4, 0xe7),
        ),
        "dark-blue" => dark_palette(
            Rgb::new(0x12, 0x20, 0x3b),
            Rgb::new(0x0a, 0x11, 0x20),
            Rgb::new(0x05, 0x09, 0x13),
            Rgb::new(0x38, 0xbd, 0xf8),
        ),
        "dark-purple" => dark_palette(
            Rgb::new(0x22, 0x13, 0x38),
            Rgb::new(0x12, 0x0a, 0x1e),
            Rgb::new(0x09, 0x05, 0x11),
            Rgb::new(0xc0, 0x84, 0xfc),
        ),
        "dark-green" => dark_palette(
            Rgb::new(0x0f, 0x29, 0x20),
            Rgb::new(0x08, 0x16, 0x11),
            Rgb::new(0x04, 0x0c, 0x09),
            Rgb::new(0x34, 0xd3, 0x99),
        ),
        "dark-red" => dark_palette(
            Rgb::new(0x2d, 0x11, 0x15),
            Rgb::new(0x18, 0x09, 0x0b),
            Rgb::new(0x0d, 0x04, 0x06),
            Rgb::new(0xf8, 0x71, 0x71),
        ),
        "dark-orange" => dark_palette(
            Rgb::new(0x2d, 0x1a, 0x0d),
            Rgb::new(0x18, 0x0e, 0x07),
            Rgb::new(0x0d, 0x07, 0x03),
            Rgb::new(0xfb, 0x92, 0x3c),
        ),
        "dark-yellow" => dark_palette(
            Rgb::new(0x2a, 0x23, 0x0d),
            Rgb::new(0x16, 0x13, 0x07),
            Rgb::new(0x0c, 0x0a, 0x03),
            Rgb::new(0xfa, 0xcc, 0x15),
        ),
        "light-white" => light_palette(
            Rgb::new(0xff, 0xff, 0xff),
            Rgb::new(0xf4, 0xf6, 0xf9),
            Rgb::new(0xe4, 0xe8, 0xf0),
            Rgb::new(0x18, 0x18, 0x1b),
        ),
        "light-gray" => light_palette(
            Rgb::new(0xf4, 0xf5, 0xf8),
            Rgb::new(0xe6, 0xe8, 0xed),
            Rgb::new(0xd4, 0xd8, 0xe1),
            Rgb::new(0x27, 0x27, 0x2a),
        ),
        "light-blue" => light_palette(
            Rgb::new(0xf5, 0xf9, 0xff),
            Rgb::new(0xe5, 0xf0, 0xff),
            Rgb::new(0xd0, 0xe4, 0xfc),
            Rgb::new(0x03, 0x69, 0xa1),
        ),
        "light-purple" => light_palette(
            Rgb::new(0xfc, 0xf7, 0xff),
            Rgb::new(0xf3, 0xe8, 0xff),
            Rgb::new(0xe4, 0xd4, 0xfa),
            Rgb::new(0x6d, 0x28, 0xd9),
        ),
        "light-green" => light_palette(
            Rgb::new(0xf4, 0xfd, 0xf7),
            Rgb::new(0xe2, 0xf9, 0xeb),
            Rgb::new(0xcb, 0xf2, 0xdc),
            Rgb::new(0x04, 0x78, 0x57),
        ),
        "light-red" => light_palette(
            Rgb::new(0xff, 0xf5, 0xf6),
            Rgb::new(0xff, 0xe4, 0xe8),
            Rgb::new(0xfd, 0xcf, 0xd7),
            Rgb::new(0xbe, 0x12, 0x3c),
        ),
        "light-orange" => light_palette(
            Rgb::new(0xff, 0xf9, 0xf2),
            Rgb::new(0xff, 0xed, 0xd9),
            Rgb::new(0xfd, 0xdd, 0xba),
            Rgb::new(0xc2, 0x41, 0x0c),
        ),
        "light-yellow" => light_palette(
            Rgb::new(0xff, 0xfd, 0xee),
            Rgb::new(0xfe, 0xf6, 0xc8),
            Rgb::new(0xfa, 0xe9, 0x9c),
            Rgb::new(0xa1, 0x62, 0x07),
        ),
        // Canonical default (`dark-black`) matches `assets/brand/detergo-icon.svg`.
        _ => dark_palette(
            Rgb::new(0x20, 0x20, 0x26),
            Rgb::new(0x0e, 0x0e, 0x12),
            Rgb::new(0x05, 0x05, 0x07),
            Rgb::new(0xff, 0xff, 0xff),
        ),
    }
}

fn dark_palette(bg_top: Rgb, bg_mid: Rgb, bg_bottom: Rgb, glyph: Rgb) -> IconPalette {
    IconPalette {
        bg_top,
        bg_mid,
        bg_bottom,
        rim: glyph.mix(Rgb::new(0xff, 0xff, 0xff), 0.55),
        glyph,
        is_light: false,
    }
}

fn light_palette(bg_top: Rgb, bg_mid: Rgb, bg_bottom: Rgb, glyph: Rgb) -> IconPalette {
    IconPalette {
        bg_top,
        bg_mid,
        bg_bottom,
        rim: glyph.mix(Rgb::new(0x0f, 0x17, 0x2a), 0.25),
        glyph,
        is_light: true,
    }
}

fn custom_palette(custom: &CustomThemeConfig) -> IconPalette {
    let accent = Rgb::from_hex(&custom.accent).unwrap_or(Rgb::new(0x3b, 0x82, 0xf6));
    let is_light = custom.base.eq_ignore_ascii_case("light");
    if is_light {
        let bg_top = Rgb::new(0xff, 0xff, 0xff).mix(accent, 0.05);
        let bg_mid = Rgb::new(0xf7, 0xf8, 0xfc).mix(accent, 0.11);
        let bg_bottom = Rgb::new(0xeb, 0xef, 0xf7).mix(accent, 0.18);
        let mut glyph = accent;
        let mut factor = 0.0f32;
        while glyph.contrast_ratio(bg_mid) < 4.5 && factor < 0.92 {
            factor += 0.12;
            glyph = accent.mix(Rgb::new(0x09, 0x0b, 0x12), factor);
        }
        light_palette(bg_top, bg_mid, bg_bottom, glyph)
    } else {
        let bg_top = Rgb::new(0x18, 0x19, 0x22).mix(accent, 0.18);
        let bg_mid = Rgb::new(0x0c, 0x0d, 0x14).mix(accent, 0.12);
        let bg_bottom = Rgb::new(0x05, 0x06, 0x0a).mix(accent, 0.08);
        let mut glyph = accent;
        let mut factor = 0.0f32;
        while glyph.contrast_ratio(bg_mid) < 4.5 && factor < 0.92 {
            factor += 0.12;
            glyph = accent.mix(Rgb::new(0xff, 0xff, 0xff), factor);
        }
        dark_palette(bg_top, bg_mid, bg_bottom, glyph)
    }
}

/// Evaluates the upper boundary `v(u)` of the canonical 4-point spark star
/// centered at `(283.4, 184.0)` in the first quadrant (`u, v in [0, 38]`).
///
/// Matches the exact cubic Bezier in `assets/brand/detergo-icon.svg`:
/// `P0=(0, 38), P1=(0, 10.2), P2=(10.2, 0), P3=(38, 0)`.
fn spark_curve_v(u: f32) -> f32 {
    if u >= 38.0 {
        return 0.0;
    }
    if u <= 0.0 {
        return 38.0;
    }
    // x(t) = 3(1-t)t^2 * 10.2 + t^3 * 38.0 is strictly increasing on [0, 1].
    let mut lo = 0.0f32;
    let mut hi = 1.0f32;
    for _ in 0..10 {
        let mid = 0.5 * (lo + hi);
        let mt = 1.0 - mid;
        let x = 3.0 * mt * mid * mid * 10.2 + mid * mid * mid * 38.0;
        if x < u {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let t = 0.5 * (lo + hi);
    let mt = 1.0 - t;
    mt * mt * mt * 38.0 + 3.0 * mt * mt * t * 10.2
}

fn sdf_rounded_rect(x: f32, y: f32, half_w: f32, half_h: f32, radius: f32) -> f32 {
    let qx = (x - 256.0).abs() - (half_w - radius);
    let qy = (y - 256.0).abs() - (half_h - radius);
    let outside = qx.max(0.0).hypot(qy.max(0.0));
    let inside = qx.max(qy).min(0.0);
    outside + inside - radius
}

fn dist_segment(px: f32, py: f32, ax: f32, ay: f32, bx: f32, by: f32) -> f32 {
    let vx = bx - ax;
    let vy = by - ay;
    let wx = px - ax;
    let wy = py - ay;
    let len_sq = vx * vx + vy * vy;
    let t = if len_sq > 0.0 {
        ((wx * vx + wy * vy) / len_sq).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let cx = ax + t * vx;
    let cy = ay + t * vy;
    (px - cx).hypot(py - cy)
}

fn point_in_glyph(x: f32, y: f32) -> bool {
    const HALF_STROKE: f32 = 17.0;
    // Left bracket `<`: (166,172) -> (86,256) -> (166,340)
    if dist_segment(x, y, 166.0, 172.0, 86.0, 256.0) <= HALF_STROKE {
        return true;
    }
    if dist_segment(x, y, 86.0, 256.0, 166.0, 340.0) <= HALF_STROKE {
        return true;
    }
    // Right bracket `>`: (346,172) -> (426,256) -> (346,340)
    if dist_segment(x, y, 346.0, 172.0, 426.0, 256.0) <= HALF_STROKE {
        return true;
    }
    if dist_segment(x, y, 426.0, 256.0, 346.0, 340.0) <= HALF_STROKE {
        return true;
    }
    // Slash `/`: (225.5, 336.1) -> (259.6, 246.5)
    if dist_segment(x, y, 225.5, 336.1, 259.6, 246.5) <= HALF_STROKE {
        return true;
    }
    // 4-point spark star centered at (283.4, 184.0)
    let u = (x - 283.4).abs();
    let v = (y - 184.0).abs();
    u < 38.0 && v < 38.0 && v <= spark_curve_v(u)
}

fn sample_icon_rgba(x: f32, y: f32, palette: &IconPalette, include_detail: bool) -> [f32; 4] {
    let d_bg = sdf_rounded_rect(x, y, 224.0, 224.0, 108.0);
    if d_bg > 0.0 {
        return [0.0, 0.0, 0.0, 0.0];
    }

    let t = ((y - 32.0) / 448.0).clamp(0.0, 1.0);
    let bg = if t < 0.45 {
        palette.bg_top.mix(palette.bg_mid, t / 0.45)
    } else {
        palette.bg_mid.mix(palette.bg_bottom, (t - 0.45) / 0.55)
    };

    let mut r = bg.r as f32 / 255.0;
    let mut g = bg.g as f32 / 255.0;
    let mut b = bg.b as f32 / 255.0;

    let blend_over = |r: &mut f32, g: &mut f32, b: &mut f32, fg: Rgb, alpha: f32| {
        let a = alpha.clamp(0.0, 1.0);
        *r = (fg.r as f32 / 255.0) * a + *r * (1.0 - a);
        *g = (fg.g as f32 / 255.0) * a + *g * (1.0 - a);
        *b = (fg.b as f32 / 255.0) * a + *b * (1.0 - a);
    };

    if include_detail {
        let d_rim = sdf_rounded_rect(x, y, 222.0, 222.0, 106.0).abs();
        if d_rim <= 2.5 {
            let rim_alpha = if palette.is_light {
                0.22 * (1.0 - t) + 0.10 * t
            } else if t < 0.35 {
                0.38 * (1.0 - t / 0.35) + 0.08 * (t / 0.35)
            } else {
                0.08 * (1.0 - (t - 0.35) / 0.65) + 0.03 * ((t - 0.35) / 0.65)
            };
            blend_over(&mut r, &mut g, &mut b, palette.rim, rim_alpha);
        }

        let d_track = sdf_rounded_rect(x, y, 200.0, 200.0, 86.0).abs();
        if d_track <= 1.2 {
            let track_alpha = if palette.is_light { 0.08 } else { 0.06 };
            blend_over(&mut r, &mut g, &mut b, palette.rim, track_alpha);
        }
    }

    if point_in_glyph(x, y) {
        r = palette.glyph.r as f32 / 255.0;
        g = palette.glyph.g as f32 / 255.0;
        b = palette.glyph.b as f32 / 255.0;
    }

    [r, g, b, 1.0]
}

/// Renders the Detergo icon as straight RGBA8 pixels of size `size x size`.
pub fn render_icon_rgba(size: u32, palette: &IconPalette) -> Vec<u8> {
    let include_detail = size >= 32;
    let ss: u32 = if size <= 64 { 4 } else { 2 };
    let ss_count = (ss * ss) as f32;
    let inv_size = 512.0 / size as f32;
    let step = 1.0 / ss as f32;
    let mut out = vec![0u8; (size * size * 4) as usize];

    for py in 0..size {
        for px in 0..size {
            let mut ar = 0.0f32;
            let mut ag = 0.0f32;
            let mut ab = 0.0f32;
            let mut aa = 0.0f32;
            for sy in 0..ss {
                let y = (py as f32 + (sy as f32 + 0.5) * step) * inv_size;
                for sx in 0..ss {
                    let x = (px as f32 + (sx as f32 + 0.5) * step) * inv_size;
                    let [r, g, b, a] = sample_icon_rgba(x, y, palette, include_detail);
                    ar += r * a;
                    ag += g * a;
                    ab += b * a;
                    aa += a;
                }
            }
            let alpha = aa / ss_count;
            let idx = ((py * size + px) * 4) as usize;
            if alpha > 0.0001 {
                out[idx] = ((ar / aa) * 255.0).round().clamp(0.0, 255.0) as u8;
                out[idx + 1] = ((ag / aa) * 255.0).round().clamp(0.0, 255.0) as u8;
                out[idx + 2] = ((ab / aa) * 255.0).round().clamp(0.0, 255.0) as u8;
                out[idx + 3] = (alpha * 255.0).round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    out
}

/// Encodes a 32-bit BGRA bottom-up DIB + 1-bpp AND mask for one ICO frame.
fn encode_ico_dib(size: u32, rgba: &[u8]) -> Vec<u8> {
    let pixel_bytes = (size * size * 4) as usize;
    let mask_stride = (size as usize).div_ceil(32) * 4;
    let mask_bytes = mask_stride * size as usize;
    let mut buf = Vec::with_capacity(40 + pixel_bytes + mask_bytes);

    // BITMAPINFOHEADER (40 bytes)
    buf.extend_from_slice(&40u32.to_le_bytes()); // biSize
    buf.extend_from_slice(&(size as i32).to_le_bytes()); // biWidth
    buf.extend_from_slice(&((size * 2) as i32).to_le_bytes()); // biHeight (XOR + AND)
    buf.extend_from_slice(&1u16.to_le_bytes()); // biPlanes
    buf.extend_from_slice(&32u16.to_le_bytes()); // biBitCount
    buf.extend_from_slice(&0u32.to_le_bytes()); // biCompression (BI_RGB)
    buf.extend_from_slice(&((pixel_bytes + mask_bytes) as u32).to_le_bytes()); // biSizeImage
    buf.extend_from_slice(&0i32.to_le_bytes()); // biXPelsPerMeter
    buf.extend_from_slice(&0i32.to_le_bytes()); // biYPelsPerMeter
    buf.extend_from_slice(&0u32.to_le_bytes()); // biClrUsed
    buf.extend_from_slice(&0u32.to_le_bytes()); // biClrImportant

    // Bottom-up BGRA pixels
    for y in (0..size).rev() {
        for x in 0..size {
            let idx = ((y * size + x) * 4) as usize;
            buf.push(rgba[idx + 2]); // B
            buf.push(rgba[idx + 1]); // G
            buf.push(rgba[idx]); // R
            buf.push(rgba[idx + 3]); // A
        }
    }

    // Bottom-up 1-bpp AND mask (1 = transparent, 0 = opaque)
    for y in (0..size).rev() {
        let mut row = vec![0u8; mask_stride];
        for x in 0..size {
            let alpha = rgba[((y * size + x) * 4 + 3) as usize];
            if alpha < 128 {
                row[(x / 8) as usize] |= 1u8 << (7 - (x % 8));
            }
        }
        buf.extend_from_slice(&row);
    }

    buf
}

/// Builds a multi-resolution Windows `.ico` file covering Taskbar, Desktop,
/// Start Menu, and High-DPI Explorer sizes.
pub fn encode_multi_frame_ico(palette: &IconPalette) -> Vec<u8> {
    const SIZES: &[u32] = &[16, 20, 24, 28, 32, 40, 48, 64, 128, 256];
    let frames: Vec<(u32, Vec<u8>)> = SIZES
        .iter()
        .map(|&size| {
            let rgba = render_icon_rgba(size, palette);
            (size, encode_ico_dib(size, &rgba))
        })
        .collect();

    let count = frames.len() as u16;
    let header_len = 6 + frames.len() * 16;
    let total_len: usize = header_len + frames.iter().map(|(_, d)| d.len()).sum::<usize>();
    let mut out = Vec::with_capacity(total_len);

    // ICONDIR header
    out.extend_from_slice(&0u16.to_le_bytes()); // reserved
    out.extend_from_slice(&1u16.to_le_bytes()); // type = ICO
    out.extend_from_slice(&count.to_le_bytes());

    let mut offset = header_len as u32;
    for (size, data) in &frames {
        let dim = if *size >= 256 { 0u8 } else { *size as u8 };
        out.push(dim); // bWidth
        out.push(dim); // bHeight
        out.push(0); // bColorCount
        out.push(0); // bReserved
        out.extend_from_slice(&1u16.to_le_bytes()); // wPlanes
        out.extend_from_slice(&32u16.to_le_bytes()); // wBitCount
        out.extend_from_slice(&(data.len() as u32).to_le_bytes()); // dwBytesInRes
        out.extend_from_slice(&offset.to_le_bytes()); // dwImageOffset
        offset = offset.saturating_add(data.len() as u32);
    }
    for (_, data) in frames {
        out.extend_from_slice(&data);
    }
    out
}

fn icon_file_slug(resolved_id: &str, custom_theme: &CustomThemeConfig) -> String {
    if resolved_id == APP_ICON_CUSTOM {
        let hex: String = custom_theme
            .accent
            .chars()
            .filter(|c| c.is_ascii_hexdigit())
            .map(|c| c.to_ascii_lowercase())
            .collect();
        let base = if custom_theme.base.eq_ignore_ascii_case("light") {
            "light"
        } else {
            "dark"
        };
        format!("detergo-custom-{base}-{hex}.ico")
    } else {
        format!("detergo-{resolved_id}.ico")
    }
}

fn write_active_ico_file(
    resolved_id: &str,
    custom_theme: &CustomThemeConfig,
    palette: &IconPalette,
) -> Result<PathBuf, AppError> {
    let base = std::env::var("APPDATA")
        .map(PathBuf::from)
        .or_else(|_| {
            std::env::var("USERPROFILE")
                .or_else(|_| std::env::var("HOME"))
                .map(|p| PathBuf::from(p).join(".config"))
        })
        .unwrap_or_else(|_| std::env::temp_dir());
    let icons_dir = crate::platform::resolve_app_dir(&base).join("icons");
    std::fs::create_dir_all(&icons_dir).map_err(|err| {
        AppError::Unknown(format!("Could not create app icon cache directory: {err}"))
    })?;

    let file_name = icon_file_slug(resolved_id, custom_theme);
    let target = icons_dir.join(&file_name);
    let temp = icons_dir.join(format!("{file_name}.tmp"));
    let ico_bytes = encode_multi_frame_ico(palette);
    std::fs::write(&temp, &ico_bytes)
        .map_err(|err| AppError::Unknown(format!("Could not write app icon file: {err}")))?;
    crate::platform::atomic_replace_file(&temp, &target)
        .map_err(|err| AppError::Unknown(format!("Could not activate app icon file: {err}")))?;

    #[cfg(not(windows))]
    {
        let png_target = target.with_extension("png");
        let png_rgba = render_icon_rgba(256, palette);
        let png_bytes = encode_png_rgba(256, &png_rgba);
        let _ = std::fs::write(&png_target, &png_bytes);
    }

    // Prune older generated icons so Explorer uses the fresh filename while
    // keeping %APPDATA%\detergo\icons clean.
    if let Ok(entries) = std::fs::read_dir(&icons_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path != target
                && path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("detergo-") && n.ends_with(".ico"))
            {
                let _ = std::fs::remove_file(path);
            }
        }
    }

    Ok(target)
}

#[cfg(windows)]
fn update_windows_shortcuts_and_shell(ico_path: &Path) -> u32 {
    use std::ffi::c_void;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use windows::core::{Interface, PCWSTR, PWSTR};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, IPersistFile,
        CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM,
    };
    use windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE, REG_SZ,
    };
    use windows::Win32::UI::Shell::{
        FOLDERID_Desktop, FOLDERID_Programs, IShellLinkW, SHChangeNotify, SHGetKnownFolderPath,
        ShellLink, KF_FLAG_DEFAULT, SHCNE_ASSOCCHANGED, SHCNE_UPDATEITEM, SHCNF_FLUSH, SHCNF_PATHW,
    };

    fn wide_z(path: &Path) -> Vec<u16> {
        path.as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    fn known_folder(id: &windows::core::GUID) -> Option<PathBuf> {
        unsafe {
            let raw: PWSTR = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).ok()?;
            if raw.0.is_null() {
                return None;
            }
            let mut len = 0usize;
            while *raw.0.add(len) != 0 {
                len += 1;
            }
            let slice = std::slice::from_raw_parts(raw.0, len);
            let path = PathBuf::from(std::ffi::OsString::from_wide(slice));
            CoTaskMemFree(Some(raw.0 as *const c_void));
            Some(path)
        }
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(desktop) = known_folder(&FOLDERID_Desktop) {
        candidates.push(desktop.join("Detergo.lnk"));
    }
    if let Some(programs) = known_folder(&FOLDERID_Programs) {
        candidates.push(programs.join("Detergo.lnk"));
        candidates.push(programs.join("Detergo").join("Detergo.lnk"));
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        candidates.push(
            PathBuf::from(appdata)
                .join("Microsoft")
                .join("Internet Explorer")
                .join("Quick Launch")
                .join("User Pinned")
                .join("TaskBar")
                .join("Detergo.lnk"),
        );
    }

    let existing: Vec<PathBuf> = candidates.into_iter().filter(|p| p.is_file()).collect();
    let ico_wide = wide_z(ico_path);
    let mut updated = 0u32;

    unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let must_uninit = hr.is_ok();

        for lnk in &existing {
            let Ok(link): Result<IShellLinkW, _> =
                CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
            else {
                continue;
            };
            let Ok(persist): Result<IPersistFile, _> = link.cast() else {
                continue;
            };
            let lnk_wide = wide_z(lnk);
            // STGM_READWRITE = 0x0000_0002
            if persist
                .Load(PCWSTR(lnk_wide.as_ptr()), STGM(0x0000_0002))
                .is_err()
            {
                continue;
            }
            if link.SetIconLocation(PCWSTR(ico_wide.as_ptr()), 0).is_err() {
                continue;
            }
            if persist.Save(PCWSTR(lnk_wide.as_ptr()), true).is_ok() {
                updated += 1;
                SHChangeNotify(
                    SHCNE_UPDATEITEM,
                    SHCNF_PATHW | SHCNF_FLUSH,
                    Some(lnk_wide.as_ptr() as *const c_void),
                    None,
                );
            }
        }

        if must_uninit {
            CoUninitialize();
        }

        // Update Uninstall DisplayIcon when installed via per-user NSIS.
        let subkey: Vec<u16> = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Detergo"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let value_name: Vec<u16> = "DisplayIcon"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let mut hkey = HKEY::default();
        if RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey.as_ptr()),
            0,
            KEY_SET_VALUE,
            &mut hkey,
        )
        .is_ok()
        {
            let value_str = format!("\"{}\"", ico_path.to_string_lossy());
            let value_w: Vec<u16> = value_str.encode_utf16().chain(std::iter::once(0)).collect();
            let bytes =
                std::slice::from_raw_parts(value_w.as_ptr() as *const u8, value_w.len() * 2);
            let _ = RegSetValueExW(hkey, PCWSTR(value_name.as_ptr()), 0, REG_SZ, Some(bytes));
            let _ = RegCloseKey(hkey);
        }

        SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_FLUSH, None, None);
    }

    updated
}

#[cfg(not(windows))]
fn encode_png_rgba(size: u32, rgba: &[u8]) -> Vec<u8> {
    fn crc32(bytes: &[u8]) -> u32 {
        let mut crc = 0xFFFF_FFFFu32;
        for &b in bytes {
            crc ^= u32::from(b);
            for _ in 0..8 {
                let mask = (crc & 1).wrapping_neg();
                crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
            }
        }
        !crc
    }

    fn adler32(bytes: &[u8]) -> u32 {
        let mut a = 1u32;
        let mut b = 0u32;
        for &byte in bytes {
            a = (a + u32::from(byte)) % 65_521;
            b = (b + a) % 65_521;
        }
        (b << 16) | a
    }

    fn push_chunk(out: &mut Vec<u8>, tag: &[u8; 4], data: &[u8]) {
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        let start = out.len();
        out.extend_from_slice(tag);
        out.extend_from_slice(data);
        let crc = crc32(&out[start..]);
        out.extend_from_slice(&crc.to_be_bytes());
    }

    let row_len = (size as usize) * 4;
    let mut raw = Vec::with_capacity((row_len + 1) * (size as usize));
    for y in 0..(size as usize) {
        raw.push(0); // filter type 0 (None)
        let start = y * row_len;
        raw.extend_from_slice(&rgba[start..start + row_len]);
    }

    // Stored zlib stream (RFC 1950 + RFC 1951 non-compressed blocks)
    let mut zlib = Vec::with_capacity(raw.len() + (raw.len() / 65_535 + 1) * 5 + 6);
    zlib.push(0x78);
    zlib.push(0x01);
    let chunks: Vec<&[u8]> = raw.chunks(65_535).collect();
    for (idx, chunk) in chunks.iter().enumerate() {
        let is_last = idx + 1 == chunks.len();
        zlib.push(if is_last { 0x01 } else { 0x00 });
        let len = chunk.len() as u16;
        zlib.extend_from_slice(&len.to_le_bytes());
        zlib.extend_from_slice(&(!len).to_le_bytes());
        zlib.extend_from_slice(chunk);
    }
    zlib.extend_from_slice(&adler32(&raw).to_be_bytes());

    let mut png = Vec::with_capacity(64 + zlib.len());
    png.extend_from_slice(b"\x89PNG\r\n\x1a\n");
    let mut ihdr = [0u8; 13];
    ihdr[0..4].copy_from_slice(&size.to_be_bytes());
    ihdr[4..8].copy_from_slice(&size.to_be_bytes());
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // color type RGBA
    push_chunk(&mut png, b"IHDR", &ihdr);
    push_chunk(&mut png, b"IDAT", &zlib);
    push_chunk(&mut png, b"IEND", &[]);
    png
}

#[cfg(not(windows))]
fn update_windows_shortcuts_and_shell(ico_path: &Path) -> u32 {
    // On Linux / FreeDesktop environments, write a companion 256x256 PNG next to
    // the ICO and update the user's `~/.local/share/applications/detergo.desktop`
    // Icon= entry when present so application launchers reflect the chosen icon.
    let png_path = ico_path.with_extension("png");
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return 0;
    };
    let desktop_entry = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".local").join("share"))
        .join("applications")
        .join("detergo.desktop");
    if !desktop_entry.is_file() || !png_path.is_file() {
        return 0;
    }
    let Ok(contents) = std::fs::read_to_string(&desktop_entry) else {
        return 0;
    };
    let mut replaced = false;
    let updated: Vec<String> = contents
        .lines()
        .map(|line| {
            if line.starts_with("Icon=") {
                replaced = true;
                format!("Icon={}", png_path.to_string_lossy())
            } else {
                line.to_string()
            }
        })
        .collect();
    if replaced && std::fs::write(&desktop_entry, updated.join("\n") + "\n").is_ok() {
        1
    } else {
        0
    }
}

fn target_tray_size(app: &tauri::AppHandle) -> u32 {
    let scale = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| monitor.scale_factor())
        .unwrap_or(1.0);
    let target = (16.0 * scale).round() as u32;
    [16u32, 20, 24, 28, 32, 36, 40, 48]
        .into_iter()
        .find(|candidate| *candidate >= target)
        .unwrap_or(48)
}

/// Applies the requested Detergo application icon to the main window / taskbar,
/// system tray, and (outside MSIX) Windows shortcuts.
pub fn apply_app_icon_native(
    app: &tauri::AppHandle,
    icon_id: &str,
    active_theme: &str,
    custom_theme: &CustomThemeConfig,
) -> Result<AppIconApplyResult, AppError> {
    use tauri::Manager;

    let resolved_id = resolve_icon_id(icon_id, active_theme);
    let palette = palette_for_icon(&resolved_id, custom_theme);

    let win_rgba = render_icon_rgba(64, &palette);
    let mut window_updated = false;
    if let Some(window) = app.get_webview_window("main") {
        let img = tauri::image::Image::new_owned(win_rgba, 64, 64);
        window_updated = window.set_icon(img).is_ok();
    }

    let tray_size = target_tray_size(app);
    let tray_rgba = render_icon_rgba(tray_size, &palette);
    let mut tray_updated = false;
    if let Some(tray) = app.tray_by_id("main-tray") {
        let img = tauri::image::Image::new_owned(tray_rgba, tray_size, tray_size);
        tray_updated = tray.set_icon(Some(img)).is_ok();
    }

    let channel = crate::updates::detect_install_channel();
    let (shortcuts_updated, icon_path) = if channel == crate::updates::InstallChannel::MsixStore {
        (0, None)
    } else {
        match write_active_ico_file(&resolved_id, custom_theme, &palette) {
            Ok(path) => {
                let count = update_windows_shortcuts_and_shell(&path);
                (count, Some(path.to_string_lossy().to_string()))
            }
            Err(err) => {
                crate::logging::warn("could not write active Detergo icon file", err);
                (0, None)
            }
        }
    };

    Ok(AppIconApplyResult {
        resolved_id,
        window_updated,
        tray_updated,
        shortcuts_updated,
        icon_path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_match_theme_and_validates_unknown_values() {
        assert_eq!(resolve_icon_id("match-theme", "dark-blue"), "dark-blue");
        assert_eq!(resolve_icon_id("match-theme", "custom"), "custom");
        assert_eq!(resolve_icon_id("match-theme", "invalid"), "dark-black");
        assert_eq!(resolve_icon_id("light-green", "dark-blue"), "light-green");
        assert_eq!(normalize_app_icon("not-an-icon"), APP_ICON_MATCH_THEME);
    }

    #[test]
    fn custom_palette_guarantees_wcag_aa_glyph_contrast() {
        for (base, hex) in [
            ("dark", "#0D1117"),
            ("dark", "#10B981"),
            ("dark", "#EC4899"),
            ("light", "#FEF08A"),
            ("light", "#10B981"),
            ("light", "#0284C7"),
        ] {
            let p = palette_for_icon(
                APP_ICON_CUSTOM,
                &CustomThemeConfig {
                    base: base.to_string(),
                    accent: hex.to_string(),
                },
            );
            assert!(
                p.glyph.contrast_ratio(p.bg_mid) >= 4.5,
                "low contrast for {base} {hex}: {}",
                p.glyph.contrast_ratio(p.bg_mid)
            );
        }
    }

    #[test]
    fn rendered_rgba_has_transparent_corners_and_opaque_center() {
        let palette = palette_for_icon("dark-blue", &CustomThemeConfig::default());
        let rgba = render_icon_rgba(32, &palette);
        assert_eq!(rgba.len(), 32 * 32 * 4);
        // Corner pixel (0, 0) lies outside the squircle -> transparent.
        assert_eq!(rgba[3], 0);
        // Center pixel (16, 16) lies inside the squircle -> opaque.
        let center_alpha = rgba[(16 * 32 + 16) * 4 + 3];
        assert_eq!(center_alpha, 255);
    }

    #[test]
    fn encodes_valid_10_frame_windows_ico() {
        let palette = palette_for_icon("light-purple", &CustomThemeConfig::default());
        let ico = encode_multi_frame_ico(&palette);
        assert!(ico.len() > 6 + 10 * 16);
        assert_eq!(&ico[0..6], &[0, 0, 1, 0, 10, 0]);
        // First entry is 16x16x32bpp
        assert_eq!(ico[6], 16);
        assert_eq!(ico[7], 16);
        assert_eq!(u16::from_le_bytes([ico[12], ico[13]]), 32);
        // Last entry is 256x256 (encoded as 0x00)
        let last = 6 + 9 * 16;
        assert_eq!(ico[last], 0);
        assert_eq!(ico[last + 1], 0);
    }
}
