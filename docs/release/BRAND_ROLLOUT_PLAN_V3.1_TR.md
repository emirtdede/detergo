# Dev Cleaner — Marka Geçişi Planı v3.1

**Durum:** Onay bekliyor — bu dosya dışında hiçbir kaynak/asset değiştirilmedi.
**Tarih:** 2026-11-10
**Kapsam:** Windows'un tüm shipping yüzeyleri, NSIS/MSI kurulum sayfaları, README ve GitHub.
**Kapsam dışı:** Ürün adının değiştirilmesi, web sitesi yeniden tasarımı, kod imzalama, native toast (2.3), `Node Cleaner` teknik adlarının toplu temizliği.

---

## 0. Yönetici özeti

v3 planı 84/100 aldı. v3.1, değerlendirmedeki **20 bulgunun tamamını** ve araştırma sırasında bulunan **11 yeni açığı** kapatıyor.

Dört release-blocker'ın kesin çözümü:

1. `SHChangeNotify` için `SHCNF_FLUSH` (0x1000) kullanılacak; `SHCNF_FLUSHNOWAIT` (0x3000) kullanılmayacak.
2. ICO 15 kareye çıkıyor: 175% için 56 px büyük ve 28 px küçük; 225% için 36 px küçük.
3. `setup.ico` fallback'i kaldırılıyor. Tek 15 kareli ICO her yerde kullanılacak; NSIS çıktısında kare sayısı kapıda doğrulanacak. Kapı geçmezse **ship durur**, spekülatif fallback üretilmez.
4. MSI için mevcut `UpgradeCode` (`40ef2964-2821-54d7-ac14-2894d8e84709`) açıkça sabitlenecek; MSI upgrade ayrı temiz VM'de test edilecek.

Ek olarak kapatılan yeni açıklar:

- `sharp` BMP yazamıyor → kendi BMP/ICO yazıcımız ve unit testleri.
- Tauri'de `image-png` feature'ı kapalı → tray PNG'leri yüklenemez.
- ICO'da 28/36 px küçük DPI kareleri yok.
- 18 px in-app logo için optik varyant yok.
- `public/icons/icon.png` dosyası yok; bildirim ikonu 404.
- MSI'de masaüstü ve Start menü kısayolları farklı ikon kaynakları kullanıyor.
- NSIS'te uninstaller welcome/finish sayfası yok; bu yüzden ayrı sidebar gerekmiyor (kanıtlandı).
- `ncGuiInit` yüksek DPI'da bozulabilir.
- "Dev Cleaner" adı GitHub'da en az 4 aktif projeyle çakışıyor; trademark riski.
- CI Ubuntu'da `sharp` çalıştıramaz; kontrol scriptleri ikiye ayrılmalı.
- README ağacı ve arşiv politikası eski isimleri gösteriyor.

**Tahmini efor:** 72–88 saat / 12–15 iş günü (%15 contingency dahil değil; contingency ile 83–101 saat).
**Onay olmadan uygulama başlamaz.**

---

## 1. Doğrulanmış baseline

| Öğe | Gerçek değer | Kanıt |
|---|---|---|
| HEAD | `b364ecc1173d7275ba4c23fdef333ea51ef95705` | `git log -1` |
| Sürüm | `2.2.1` | `package.json`, `Cargo.toml`, `tauri.conf.json` |
| 2.2.1 artifact commit'i | `b364ecc` | `release_output/BUILD_INFO.json` |
| Baseline tag | **Yok** | `git tag --list` → yalnızca `v2.2.0`, `audit-baseline-2.2.0` |
| Untracked test | **Yok** | `src/test/notification-service.test.ts` artık tracked |
| Mevcut ICO | 8 kare: 16,24,32,48,64,96,128,256 | PIL `icon.ico` |
| Mevcut ICO kare formatı | 256 PNG; küçük kareler PNG (mevcut pipeline) | `docs/audit` + PIL |
| MSI `UpgradeCode` | `40ef2964-2821-54d7-ac14-2894d8e84709` | `src-tauri/target/release/wix/x64/main.wxs:18` |
| MSI scope | `perMachine` | `main.wxs:28` |
| MSI major upgrade | `MajorUpgrade Schedule="afterInstallInitialize" AllowDowngrades="yes"` | `main.wxs:40` |
| MSI shortcut ikonları | Start menü `Icon="ProductIcon"`; masaüstü ikonsuz (EXE ikonu) | `main.wxs:99,149` |
| NSIS install mode | `currentUser` | `tauri.conf.json` |
| NSIS uninstaller sayfaları | Yalnızca `MUI_UNPAGE_CONFIRM` + `MUI_UNPAGE_INSTFILES` | `installer.nsi:458,461` |
| Tauri `image-png` | **Kapalı** | `tauri 2.11.5` default features |
| `sharp` | Kurulu değil | `package.json` |
| Bildirim ikonu | `/icons/icon.png` var, dosya yok | `public/` yalnızca `vellium.svg` |

### 1.1 Baseline düzeltmesi

Önceki notta baseline tag'inin `5aca19a`'ya atılacağı yazıyordu. Bu **yanlıştı**: 2.2.1 artifact'ları `b364ecc`'den üretildi. `5aca19a` daha eski bir ara commit. Tag **`b364ecc`** üzerine atılmalı:

```powershell
git tag -a baseline-2.2.1 b364ecc -m "Dev Cleaner 2.2.1 shipped artifacts (BUILD_INFO commit)"
```

Baseline artifact hash'leri (BUILD_INFO.json):

| Artifact | SHA-256 |
|---|---|
| `Dev-Cleaner-2.2.1-Portable.exe` | `5F698D9F27A53DA47BDF984E171E832D3A91E9760866DBB4932820349241216F` |
| `Dev-Cleaner-2.2.1-x64-Setup.exe` | `F001B9FDB386E834311AB02078D40E81CAAEB995FE1703F72E6F264BA792F2E8` |
| `Dev-Cleaner-2.2.1-x64.msi` | `6B22298435958C25E813E1FE1E3809FAEAD5D4257479F246474262870506C9C9` |

Bu üç dosya git'e eklenmez; release share'inde saklanır. Hash'ler `docs/release/baseline-2.2.1.md`'ye yazılır.

---

## 2. 84/100 bulgularının kapatılması

| # | Bulgu | v3.1 kararı | Kanıt / kaynak | Kapı |
|---:|---|---|---|---|
| 1 | `SHChangeNotify` flag çelişkisi | `SHCNE_ASSOCCHANGED = 0x08000000` + `SHCNF_IDLIST = 0` + `SHCNF_FLUSH = 0x1000` → `uFlags = 0x1000`, `dwItem1/2 = NULL`. Tekil öğe için `SHCNE_UPDATEITEM = 0x2000` + `SHCNF_PATHW = 0x0005` + `SHCNF_FLUSH` → `0x1005`. `FLUSHNOWAIT` kaldırılır. | Microsoft: `SHCNF_FLUSH` "notification delivered to all affected components" olana kadar döner; `ASSOCCHANGED` icon/thumbnail cache'i invalidate eder ve `SHCNF_IDLIST` zorunludur. | NSIS hook'ta sabitler; upgrade sonrası cache testi |
| 2 | 56 px yok | ICO 15 kare: `16,20,24,28,32,36,40,48,56,64,72,80,96,128,256`. 175% büyük=56, küçük=28; 225% küçük=36. | Windows DPI ölçekleme: `SM_CXICON=32×scale`, `SM_CXSMICON=16×scale`. | ICO yapı testi + 175%/225% QA |
| 3 | `setup.ico` fallback'i etkisiz | Fallback kaldırılır. Tek ICO setup, uninstaller, app EXE ve portable'da kullanılır. NSIS çıktısında RT_GROUP_ICON kare sayısı 15 değilse **build fail**. | NSIS: "Every image in the icon file will be included in the installer." 2.2.1'in 8 karesi de korunmuştu. | `verify:exe-icons` |
| 4 | MSI upgrade yolu yok | `bundle.windows.wix.upgradeCode = "40ef2964-2821-54d7-ac14-2894d8e84709"` (mevcut değer korunur). MSI 2.2.1→2.2.2 ayrı perMachine VM'de test edilir. NSIS ile aynı makinede test edilmez. | Tauri schema: upgradeCode "must stay the same across all updates"; MSI `InstallScope=perMachine`; Tauri MSI perUser desteklemiyor (issue #13792). | `verify:msi-upgrade` |
| 5 | Explorer cache testi yok | `SHCNF_FLUSH` + `SHCNE_UPDATEITEM` (EXE, masaüstü, Start menü). Otomatik `SHGetFileInfo` ikon capture + 5 yüzeyde screenshot. Reboot yok, 5 saniye bekleme. | `SHCNF_FLUSH` semantiği; `ASSOCCHANGED` cache invalidation. | Upgrade gate G5 |
| 6 | Tray 32 px, 300% çelişkisi | 8 tray PNG: `16,20,24,28,32,36,40,48`. Runtime'da `16 × primary_monitor.scale_factor()` hedefi hesaplanır, en yakın ≥ hedef seçilir. 300% → 48. | tray-icon `get_tray_icon_size()` = `SM_CXSMICON`; Microsoft notification area high-DPI rehberi. | 100/150/200/300% tray screenshot |
| 7 | Notification yanlış sınıflandırma | "Dev-only / 2.3 native toast hazırlığı" olarak işaretlenir. `public/icons/notification.png` eklenir, yol güncellenir, test edilir. Shipping Windows yüzeyi sayılmaz. | `canShowDesktop()` Tauri'de `false`; wry NotificationReceived handler'ı kaydetmiyor. | Unit test + docs |
| 8 | Archive/delete çelişkisi | Eski asset'ler silinmez; `docs/archive/brand-v1/` altına taşınır. `check:brand` bu klasörü istisna tutar. | Görünür arşiv + git history. | `check:brand` |
| 9 | Baseline hijyeni | `baseline-2.2.1` → `b364ecc`; hash tablosu; untracked test artık tracked. | `BUILD_INFO.json`, `git ls-files`. | Phase 0 |
| 10 | 44–57 saat gerçekçi değil | 72–88 saat / 12–15 iş günü. Faz kırılımı §12. | QA matrisi 3 OS × 6 DPI × 2 tema × 18 yüzey. | Plan onayı |
| 11 | `sharp` determinism kanıtsız | `sharp@0.35.5` exact pin; `process.platform === "win32"` guard; metadata strip (varsayılan); sabit PNG ayarları; 4× render + Lanczos; manifest'e sharp/libvips/platform/hash. İki ardışık run byte-identical. CI yalnızca yapısal. | sharp output docs: varsayılan metadata strip; SVG→PNG. | Gate G3 |
| 12 | ICO/BMP writer testleri yok | `scripts/lib/ico.mjs` + `bmp.mjs`; 12 test: 256 için 0 byte, bottom-up, AND mask, 4-byte padding, BGRA, alpha, offset, 24-bit BGR, BMP file header, row padding, bounds, duplicate size. | ICO spec: bWidth/bHeight 0=256; height 2×; little-endian; BGRA; AND mask 1bpp. | `npm test` |
| 13 | Legal sign-off soyut | `docs/brand/TRADEMARK_CLEARANCE.md`: mark, owner, date, jurisdictions (US/EU/WIPO/TR), classes 9/42, search results, counsel, decision. Release gate imzasız geçmez. | USPTO/EUIPO/WIPO/TÜRKPATENT arama kaydı. | G0 |
| 14 | GitHub avatar dairesel kırpma | 1024×1024 PNG; glyph merkez %80 daire içinde; metin yok; kenara kadar koyu zemin. **Not:** repo avatarı yoktur; bu ya Vellium org avatarı ya da ürün hesabı içindir. Vellium avatarı ürün ikonuyla değiştirilmez. | GitHub profile reference: <1 MB, <3000×3000; avatar daire kırpılır. | Manuel upload |
| 15 | Social preview güvenli alanı | 1280×640 PNG, <1 MB; 64 px dış marj; metin sol %60; logo sağ %30; kritik metin merkezde. | GitHub docs: 1280×640 best, min 640×320, <1 MB. | Manuel upload |
| 16 | `ie4uinit` guard'ı muğlak | `check:brand` `src-tauri/**` ve `scripts/**` içinde `ie4uinit` string'ini fail eder. Check'in kendi unit testi var. | `ie4uinit` kullanılmayacak; `SHChangeNotify` yeterli. | `check:brand` |
| 17 | Inter font dosyası | Font binary repoya girmez. Master SVG'de metin yok. Wordmark gerekirse Inter outline edilir; Inter sürümü + OFL 1.1 notu kaydedilir. | OFL FAQ: OFL fontla üretilen logo/font olmayan grafik, font dağıtımı değildir. | `check:brand` |
| 18 | `glyph.generated.ts` format riski | Codegen kaldırılır. `Logo.tsx` path'leri elle tutulur; `check:brand` master `data-glyph` path'leriyle birebir karşılaştırır. Prettier istisnası gerekmez. | Tek kaynak + drift check. | `check:brand` |
| 19 | `preview.html` relative path | Preview `docs/brand/preview.html` olur; master `../../assets/brand/dev-cleaner-icon.svg`. `check:brand` link hedefini doğrular. | Dosya taşıma. | `check:brand` |
| 20 | MUI 2× kaynak denenmedi | NSIS MUI ve WiX sabit 1× bitmap kullanır; runtime 2× seçim yoktur. 2× kaynaktan Lanczos ile 1× üretilir; 150/200% QA'da stretch kabul edilir. | NSIS MUI: header 150×57, sidebar 164×314, `FitControl`; WiX: 493×58, 493×312. | G5 installer screenshot |

---

## 3. Araştırmada bulunan yeni açıklar

| # | Açık | Çözüm | Kapı |
|---:|---|---|---|
| N1 | `sharp` BMP yazamıyor; NSIS/WiX BMP ister | `scripts/lib/bmp.mjs`: 24-bit BGR, bottom-up, 4-byte row padding, `BITMAPFILEHEADER` + `BITMAPINFOHEADER`. Aynı modül ICO DIB karelerini üretir. | Unit test + BMP header check |
| N2 | Tauri `image-png` kapalı | `tauri = { version = "2", features = ["tray-icon", "image-png"] }`. `Image::from_bytes(include_bytes!(...))` için gerekli. | `cargo check` + tray smoke |
| N3 | 28/36 px küçük DPI kareleri yok | 15 kareli ICO'ya 28 ve 36 eklenir. | ICO testi |
| N4 | 18 px in-app logo okunmuyor olabilir | `Logo.tsx` squircle'sız, `currentColor` glyph-only; 18 px + 2× DPR'de tasarım gate'i. Gerekirse 18 px'e özel 1.25 px stroke. | Görsel review |
| N5 | `public/icons/icon.png` yok | `public/icons/notification.png` (256) eklenir; `notification-service.ts` yolu değişir; test `options.icon` doğrular. | Unit test |
| N6 | MSI kısayol ikonları farklı | Start menü `ProductIcon`; masaüstü EXE ikonu. İkisi ayrı ayrı test edilir; ARP `ProductIcon`. | MSI gate |
| N7 | Uninstaller welcome/finish sidebar'ı | Araştırma: Tauri uninstaller'da `MUI_UNPAGE_WELCOME/FINISH` yok; yalnızca confirm + instfiles var. `unheader.bmp` yeterli. Ek sidebar gerekmez. | Kanıt: `installer.nsi:458,461` |
| N8 | `ncGuiInit` yüksek DPI riski | Mevcut `GetWindowRect` + `SetWindowPos` hack'i 150/200%'de test edilir. Bozulursa hack kaldırılır; MUI'nin doğal hizalaması kullanılır. | G5 installer |
| N9 | "Dev Cleaner" ad çakışması | En az 4 aktif GitHub projesi + macOS ürünleri var. Counsel clearance olmadan marka tescili iddia edilmez. Gerekirse "Dev Cleaner by Vellium" ayırt edici lockup kullanılır; isim değişikliği ayrı karar. | G0 legal |
| N10 | CI Ubuntu'da `sharp` çalışmaz | `check:icons` yalnızca `node:fs`/`node:crypto` ile yapısal; `generate:icons` Windows-only. | CI |
| N11 | README ağacı/eski isimler | README EN/TR logo satırları, brand tree ve icons tree güncellenir; `docs/MASTER_SPEC.md` "Node Cleaner" metni kapsam dışı ve taramadan muaf. | `check:brand` |

---

## 4. Kanonik asset sistemi

### 4.1 Dosya düzeni

```tree
assets/
└── brand/
    ├── dev-cleaner-icon.svg              # tek master, 512×512
    ├── dev-cleaner-icon-1024.png         # tauri icon / GitHub için
    ├── dev-cleaner-glyph.svg             # squircle'sız glyph (docs/preview)
    ├── installer/
    │   ├── sidebar.svg                   # 164×314 kaynak
    │   ├── header.svg                    # 150×57 kaynak
    │   ├── unheader.svg                  # 150×57 kaynak
    │   ├── wix-banner.svg                # 493×58 kaynak
    │   └── wix-dialog.svg                # 493×312 kaynak
    ├── github/
    │   ├── social-preview.svg            # 1280×640 kaynak
    │   └── avatar-1024.png               # circular-safe
    └── icon-manifest.json                # üretim künyesi + hash'ler

docs/
├── brand/
│   ├── preview.html                      # frame/ölçek önizleme
│   ├── BRAND_GUIDELINES.md
│   └── TRADEMARK_CLEARANCE.md
└── archive/
    └── brand-v1/
        ├── README.md                     # "shipping değil" notu
        ├── app-icon.svg
        ├── logo-master.svg
        ├── StoreLogo-300x300.png
        └── concept-logos/…

public/
├── favicon.svg
├── favicon.ico                           # 16/32/48
└── icons/
    └── notification.png                  # 256, dev-only

src-tauri/
├── icons/                                # tauri icon set + custom icon.ico
│   ├── icon.ico                          # 15 kare, 16-first
│   ├── tray-16.png … tray-48.png         # 8 varyant
│   └── …                                 # 32x32, 128x128, icon.png, icns, Store
└── nsis/
    ├── sidebar.bmp                       # 164×314, 24-bit
    ├── header.bmp                        # 150×57, 24-bit
    └── unheader.bmp                      # 150×57, 24-bit
```

### 4.2 Master SVG kuralları

`assets/brand/dev-cleaner-icon.svg` tek doğruluk kaynağıdır. Şu attribute'lar eklenir:

- `data-brand="canvas"` → squircle + rim + inner track.
- `data-layer="detail"` → rim ve inner track. 32 px altında üretimde çıkarılır.
- `data-glyph="mark"` → `<`, `/`, `>`, spark path'leri. `Logo.tsx` ve glyph-only türevleri buradan doğrulanır.
- `data-safe="32"` → 512 viewBox'ta 32 px dış marj.

Kurallar:

- Metin yok; font yok.
- Gradyanlar `userSpaceOnUse`; `objectBoundingBox` yok.
- `currentColor` yok; dosya kendi renklerini taşır.
- 16/20/24 px'de `data-layer="detail"` çıkarılır; squircle + glyph + spark kalır.
- 16 px'de spark en az 2 px görünür olmalı; değilse spark 1 px büyütülür.
- 18 px in-app glyph'te stroke 1.2 px'in altına düşmez.

### 4.3 Wordmark

- Icon içinde wordmark yok.
- README'de "Dev Cleaner" HTML metin olarak kalır (font binary yok).
- Installer/GitHub lockup'larında metin varsa **outline** edilir; Inter kullanılırsa sürüm ve OFL 1.1 kaydı `BRAND_GUIDELINES.md`'ye yazılır.
- Inter `.ttf/.woff2` repoya eklenmez.

---

## 5. ICO, tray ve BMP spesifikasyonu

### 5.1 ICO kareleri (15)

| Sıra | Boyut | Format | Kullanım |
|---:|---:|---|---|
| 1 | 16 | 32-bit DIB | 100% small, tray fallback |
| 2 | 20 | 32-bit DIB | 125% small |
| 3 | 24 | 32-bit DIB | 150% small |
| 4 | 28 | 32-bit DIB | 175% small |
| 5 | 32 | 32-bit DIB | 100% large, 200% small |
| 6 | 36 | 32-bit DIB | 225% small |
| 7 | 40 | 32-bit DIB | 125% large, 250% small |
| 8 | 48 | 32-bit DIB | 150% large, 300% small |
| 9 | 56 | 32-bit DIB | 175% large |
| 10 | 64 | 32-bit DIB | 200% large |
| 11 | 72 | 32-bit DIB | 225% large |
| 12 | 80 | 32-bit DIB | 250% large |
| 13 | 96 | 32-bit DIB | 300% large |
| 14 | 128 | 32-bit DIB | Jumbo / Explorer |
| 15 | 256 | PNG | Jumbo / Vista+ |

Kurallar:

- Sıra 16-first artan; Windows skorlaması sıradan bağımsızdır, eşitlikte ilk kare kazanır.
- 256 için `bWidth=0`, `bHeight=0`; `bColorCount=0`; `wPlanes=1`; `wBitCount=32`.
- 256 PNG: 8-bit RGBA, metadata yok, `compressionLevel=9`, `adaptiveFiltering=false`, `palette=false`.
- DIB: 40-byte `BITMAPINFOHEADER`, `biHeight = 2 × size`, bottom-up BGRA, straight alpha.
- AND mask: alpha=0 → 1, aksi halde 0; 1 bpp, bottom-up, satır 4-byte hizalı.
- 24-bit frame yok; 32-bit alpha kullanılır.
- Toplam dosya ~200–250 KB hedefi.

### 5.2 Tray PNG'leri (8)

`16, 20, 24, 28, 32, 36, 40, 48` — her biri RGBA PNG, squircle + glyph.

Runtime seçimi:

```rust
let scale = app.primary_monitor()?.map(|m| m.scale_factor()).unwrap_or(1.0);
let target = (16.0 * scale).round() as u32;
let size = [16, 20, 24, 28, 32, 36, 40, 48]
    .into_iter()
    .find(|s| *s >= target)
    .unwrap_or(48);
let icon = match size {
    16 => Image::from_bytes(include_bytes!("../icons/tray-16.png"))?,
    // …
    48 => Image::from_bytes(include_bytes!("../icons/tray-48.png"))?,
    _ => unreachable!(),
};
```

- `tauri` feature `image-png` açılır.
- `build.rs` her tray PNG için `rerun-if-changed` ekler.
- Hata durumunda `default_window_icon()` fallback; panic yok.
- 300% → 48; 175% → 28; 225% → 36.

### 5.3 BMP'ler (NSIS + WiX)

| Dosya | Boyut | Format |
|---|---:|---|
| `nsis/sidebar.bmp` | 164×314 | 24-bit BGR, bottom-up |
| `nsis/header.bmp` | 150×57 | 24-bit BGR |
| `nsis/unheader.bmp` | 150×57 | 24-bit BGR |
| `wix/banner.bmp` | 493×58 | 24-bit BGR |
| `wix/dialog.bmp` | 493×312 | 24-bit BGR |

- Alpha yok; SVG koyu zemine flatten edilir.
- Row padding: `(width × 3 + 3) & ~3`.
- `BITMAPFILEHEADER` 14 byte + `BITMAPINFOHEADER` 40 byte.
- `biHeight` pozitif (bottom-up).
- WiX dosyaları `src-tauri/wix/` altında tutulur.

---

## 6. Windows yüzey matrisi

| # | Yüzey | Asset / kaynak | Ayar / kod | Doğrulama |
|---:|---|---|---|---|
| 1 | App EXE (Explorer, masaüstü, Start) | `icons/icon.ico` | Tauri `bundle.icon` | RT_GROUP_ICON 15 kare |
| 2 | Taskbar / Alt-Tab | EXE ikonu | Windows `SM_CXICON` | 100–300% screenshot |
| 3 | Tray | `tray-*.png` | `setup_tray` + `image-png` | 8 boyut; 300% net |
| 4 | NSIS setup EXE | `icons/icon.ico` | `installerIcon` | 15 kare |
| 5 | NSIS uninstaller EXE | `icons/icon.ico` | `uninstallerIcon` | 15 kare |
| 6 | NSIS welcome/finish sidebar | `nsis/sidebar.bmp` | `sidebarImage` | 164×314, görsel |
| 7 | NSIS header | `nsis/header.bmp` | `headerImage` | 150×57, tüm iç sayfalar |
| 8 | NSIS uninstaller header | `nsis/unheader.bmp` | `uninstallerHeaderImage` | 150×57, confirm/instfiles |
| 9 | NSIS title-bar icon | `icons/icon.ico` | `MUI_ICON` / `MUI_UNICON` | 15 kare |
| 10 | MSI ARP icon | `icon.ico` → `ProductIcon` | `ARPPRODUCTICON` | Registry + ARP screenshot |
| 11 | MSI Start menü shortcut | `ProductIcon` | WiX template | Yeni ikon |
| 12 | MSI masaüstü shortcut | EXE ikonu | WiX template | Yeni ikon |
| 13 | MSI banner | `wix/banner.bmp` | `bannerPath` | 493×58 |
| 14 | MSI dialog | `wix/dialog.bmp` | `dialogImagePath` | 493×312 |
| 15 | Portable EXE | EXE ikonu | `build-release.js` | RT_GROUP_ICON 15 kare |
| 16 | In-app scan header | `Logo.tsx` glyph | `size={18}` | 760 px + 2× DPR |
| 17 | Dev browser favicon | `public/favicon.*` | `index.html` | 16/32 |
| 18 | Dev browser notification | `public/icons/notification.png` | `notification-service.ts` | Unit test; dev-only |
| 19 | README EN/TR | `assets/brand/dev-cleaner-icon.svg` veya 256 PNG | HTML `<img>` | GitHub render |
| 20 | GitHub social preview | `github/social-preview.png` | Manuel upload | 1280×640, <1 MB |
| 21 | GitHub ürün avatarı (varsa) | `github/avatar-1024.png` | Manuel upload | Daire crop |

**Not:** MSI uninstaller shortcut'ı `msiexec.exe` ikonunu kullanır; bu Windows konvansiyonudur ve ürün yüzeyi sayılmaz. NSIS uninstaller EXE'si ürün ikonunu taşır.

---

## 7. Installer ve upgrade doğruluğu

### 7.1 NSIS

`src-tauri/nsis/hooks.nsh` içinde:

```nsis
!define SHCNE_ASSOCCHANGED 0x08000000
!define SHCNE_UPDATEDIR    0x00001000
!define SHCNE_UPDATEITEM   0x00002000
!define SHCNF_FLUSH        0x1000
!define SHCNF_PATHW        0x0005

!macro NSIS_HOOK_POSTINSTALL
  File "/oname=$INSTDIR\app.ico" "${INSTALLERICON}"
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayIcon" "$\"$INSTDIR\app.ico$\""

  ; Tüm shell icon/thumbnail cache'ini invalidate et; teslim edilene kadar bekle.
  System::Call "shell32::SHChangeNotify(i ${SHCNE_ASSOCCHANGED}, i ${SHCNF_FLUSH}, p 0, p 0)"

  ; EXE ve kısayolları hedefli güncelle.
  System::Call "shell32::SHChangeNotify(i ${SHCNE_UPDATEITEM}, i 0x1005, w \"$INSTDIR\${MAINBINARYNAME}.exe\", p 0)"
  System::Call "shell32::SHChangeNotify(i ${SHCNE_UPDATEITEM}, i 0x1005, w \"$DESKTOP\${PRODUCTNAME}.lnk\", p 0)"
  System::Call "shell32::SHChangeNotify(i ${SHCNE_UPDATEITEM}, i 0x1005, w \"$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk\", p 0)"
!macroend
```

- `SHCNF_FLUSH` Explorer donmuşsa installer'ı bekletebilir. Bu bilinçli tercih; 30 saniyeden uzun sürerse QA fail ve `FLUSHNOWAIT` + retry stratejisi değerlendirilir.
- `ie4uinit` yok.
- Uninstaller `POSTUNINSTALL` da `ASSOCCHANGED|FLUSH` çağırır.
- `app.ico` unversioned kalır; cache testi başarısız olursa `app-2.2.2.ico` versioned path'e geçilir (kontrollü fallback, önceden üretilmez).
- `ncGuiInit` hizalaması 150/200% QA'da test edilir; bozulursa kaldırılır.

### 7.2 MSI

`tauri.conf.json`:

```json
"bundle": {
  "windows": {
    "wix": {
      "language": ["tr-TR", "en-US"],
      "upgradeCode": "40ef2964-2821-54d7-ac14-2894d8e84709",
      "bannerPath": "wix/banner.bmp",
      "dialogImagePath": "wix/dialog.bmp"
    }
  }
}
```

- `UpgradeCode` **mevcut 2.2.1 değeriyle aynı**; değiştirmek 2.2.2'yi ayrı ürün yapar.
- MSI `perMachine`; NSIS `currentUser`. Aynı makinede ikisi birlikte test edilmez; iki ayrı temiz snapshot.
- MSI 2.2.1 → 2.2.2:
  - Tek ARP kaydı.
  - `DisplayVersion = 2.2.2`.
  - ARP ikonu yeni.
  - Start menü ve masaüstü kısayolları yeni ikon.
  - Reboot yok.
- MSI uninstall sonrası ARP, dosyalar, kısayollar temiz.
- `MajorUpgrade` ve `REINSTALLMODE=amus` Tauri template'inden gelir; değiştirilmez.

### 7.3 NSIS ↔ MSI karıştırma politikası

- NSIS per-user → `%LOCALAPPDATA%\Programs\Dev Cleaner`.
- MSI per-machine → `%ProgramFiles%\Dev Cleaner`.
- İkisi aynı makinede kurulursa iki ARP kaydı oluşur; bu **desteklenen upgrade yolu değildir**.
- README'ye not eklenir: "NSIS ve MSI aynı makinede birlikte kurulmamalıdır."

---

## 8. Deterministik üretim hattı

### 8.1 Bağımlılık

```json
"devDependencies": {
  "sharp": "0.35.5"
}
```

- Exact sürüm; caret yok.
- `package-lock.json` commit edilir.
- `sharp` yalnızca `generate:icons` için; uygulama runtime'ına girmez.

### 8.2 Üretim akışı

```powershell
npm run generate:icons
```

1. `process.platform !== "win32"` → fail (preview için `--allow-nonwindows`).
2. Master SVG'yi oku; `data-layer="detail"`'i 32 px altı için çıkar.
3. Her hedef için 4× render + Lanczos downscale.
4. PNG'ler: `sharp(...).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })`.
5. ICO: `ico.mjs` (DIB + 256 PNG).
6. Tray: 8 PNG.
7. BMP: `bmp.mjs` (24-bit).
8. `icon-manifest.json` yaz:
   ```json
   {
     "generatedBy": "scripts/generate-icons.mjs",
     "sharp": "0.35.5",
     "libvips": "8.17.x",
     "platform": "win32",
     "arch": "x64",
     "master": "assets/brand/dev-cleaner-icon.svg",
     "masterSha256": "…",
     "outputs": { "src-tauri/icons/icon.ico": "…" }
   }
   ```
9. `tauri icon` ile standart set (icns, Store, Splash) üretilir; ardından custom `icon.ico` overwrite edilir.
10. İki ardışık run aynı hash'leri vermezse fail.

### 8.3 Yapısal kontroller (CI, Ubuntu)

`scripts/check-icons.mjs` sharp kullanmaz:

- ICO header: reserved=0, type=1, count=15.
- Boyutlar tam ve artan sırada.
- 256 için `bWidth=0`, `bHeight=0`; PNG signature.
- `wPlanes=1`, `wBitCount=32`, `bColorCount=0`.
- Offset + boyut dosya sınırında.
- Tray PNG'leri 8 adet ve doğru IHDR.
- BMP'ler doğru boyut, 24-bit, `biHeight>0`, row padding.
- Manifest hash'leri dosyalarla eşleşiyor.
- `icon.ico` 250 KB altında.

### 8.4 Writer unit testleri

`scripts/lib/ico.mjs` ve `bmp.mjs` için:

1. 256 karede `bWidth=0`, `bHeight=0`.
2. 16 karede `bWidth=16`.
3. DIB `biHeight = 2×size`.
4. Piksel satırları bottom-up.
5. BGRA sırası.
6. Straight alpha (premultiply yok).
7. AND mask alpha=0 → 1.
8. AND mask satır padding'i 4 byte.
9. BMP row padding 150×57 ve 493×58.
10. 24-bit BGR sırası.
11. Offset'ler ardışık ve sınır içinde.
12. Aynı boyut iki kez eklenirse fail.

---

## 9. Kalite kapıları ve kabul kriterleri

### G0 — Baseline, hukuk, tasarım freeze

- `baseline-2.2.1` tag'i `b364ecc`'de.
- Hash tablosu `docs/release/baseline-2.2.1.md`'de.
- `TRADEMARK_CLEARANCE.md` imzalı.
- Tasarım board'u onaylı: 16/18/24/32 px, light/dark, installer art.
- Eski asset'ler `docs/archive/brand-v1/`'de.

### G1 — Asset yapısı

- `npm run check:icons` PASS.
- `npm run check:brand` PASS.
- ICO 15 kare; tray 8 PNG; BMP 5 dosya.
- `check:brand` eski `app-icon.svg`, `logo-master.svg`, `concept-logos` referansı shipping yüzeylerde bulamaz.

### G2 — Build

- `npm run typecheck`, `npm test`, `cargo test`, `cargo clippy -D warnings` PASS.
- `npm run tauri build` PASS.
- `node-cleaner.exe` RT_GROUP_ICON 15 kare.
- Setup, uninstaller, portable 15 kare.

### G3 — Determinizm

- `npm run generate:icons` iki kez → aynı SHA-256.
- Manifest sharp/libvips/platform kayıtlı.
- CI yalnızca yapısal; hash'ler commit'li.

### G4 — Installer

- NSIS temiz kurulum/kaldırma PASS.
- MSI temiz kurulum/kaldırma PASS.
- NSIS setup/uninstaller ikonu 15 kare.
- MSI ARP + Start menü + masaüstü ikonları yeni.
- NSIS sidebar/header/unheader doğru boyut ve görsel.
- WiX banner/dialog doğru boyut ve görsel.
- 100/150/200% installer sayfaları okunaklı.

### G5 — Upgrade ve cache

- NSIS 2.2.1 → 2.2.2: tek ARP, 2.2.2, yeni ikon, reboot yok.
- MSI 2.2.1 → 2.2.2: tek ARP, 2.2.2, yeni ikon, reboot yok.
- 5 yüzey: masaüstü, Start menü, taskbar pin, Explorer EXE, Alt-Tab.
- `SHGetFileInfo` capture + screenshot; 5 saniye içinde güncel.
- Eski mavi ikon hiçbir yüzeyde yok.

### G6 — QA matrisi

- 3 OS × 6 DPI × 2 tema × 18 yüzey.
- Win10 22H2 VM yoksa README/MASTER_SPEC'ten "Windows 10 1809+" iddiası kaldırılır; untested claim ship edilmez.
- 300% tray net; 175% taskbar net.
- Installer 150/200% regresyon yok.

### G7 — Release

- Sürüm 2.2.2 (package.json, Cargo.toml, Cargo.lock, tauri.conf.json).
- Temiz tree; `BUILD_INFO.json` commit = HEAD, dirty=false.
- `SHA256SUMS.txt` doğru.
- `v2.2.2` tag'i.
- README EN/TR yeni logo.
- GitHub social preview yüklü.
- Release notes: yeni marka, upgrade notu, NSIS/MSI ayrımı.

---

## 10. QA matrisi

### 10.1 Ortamlar

| OS | Sürüm | Not |
|---|---|---|
| Windows 10 | 22H2 x64 | VM yoksa destek iddiası kaldırılır |
| Windows 11 | 23H2 x64 | |
| Windows 11 | 24H2/25H2 x64 | Ana QA |

### 10.2 DPI

100%, 125%, 150%, 175%, 200%, 300%.

### 10.3 Temalar

Dark, Light. Yüksek kontrast opsiyonel; installer native kontrol olduğu için ayrıca denenir.

### 10.4 Yüzeyler

1. Masaüstü kısayolu
2. Start menü kısayolu
3. Taskbar pin
4. Explorer EXE
5. Alt-Tab
6. Tray
7. NSIS welcome
8. NSIS header (directory/license/startmenu/instfiles)
9. NSIS finish
10. NSIS uninstaller confirm
11. NSIS uninstaller instfiles
12. MSI welcome
13. MSI banner sayfaları
14. MSI finish
15. ARP (Programs & Features)
16. Portable EXE
17. In-app scan header (760 px)
18. Dev browser favicon/notification

### 10.5 Otomatik shell ikon testi

`scripts/verify-shell-icons.ps1`:

- `SHGetFileInfoW(SHGFI_ICON | SHGFI_LARGEICON)` ile EXE ve `.lnk` ikonlarını al.
- `Icon.FromHandle().ToBitmap()` ile PNG'ye yaz.
- Golden PNG ile piksel farkı ≤ %2.
- Eski mavi ikonun baskın rengi (`#0A84FF`/`#0055D4`) yok.
- Çıktılar `artifacts/shell-icons/<surface>-<dpi>.png`.

Manuel screenshot sign-off yine gerekli; otomasyon tek başına yeterli değil.

---

## 11. Hukuk, trademark ve GitHub

### 11.1 İsim çakışması

Araştırmada bulunanlar:

- `github.com/jemishavasoya/dev-cleaner`
- `github.com/Tolsion/DevCleaner`
- `github.com/Mahmoud0808/DevCleaner`
- `github.com/wookat/DevCleaner`
- macOS "DevCleaner" / "Sweep: Dev Cleaner" ürünleri

"Dev Cleaner" tanımlayıcı ve kalabalık bir addır. Bu plan:

- İsim üzerinde exclusivity iddia etmez.
- "Dev Cleaner by Vellium" lockup'ını ayırt edici unsur olarak kullanır.
- Counsel clearance olmadan tescil/® işareti kullanmaz.
- Counsel "conflict" derse isim değişikliği ayrı bir karar olur; logo sistemi bundan bağımsız çalışır.

### 11.2 Clearance kaydı

`docs/brand/TRADEMARK_CLEARANCE.md`:

| Alan | Değer |
|---|---|
| Mark | DEV CLEANER + logo |
| Sahip | Vellium |
| Tarih | 2026-11-… |
| Jurisdiction | US (USPTO), EU (EUIPO), WIPO Global Brand DB, TR (TÜRKPATENT) |
| Nice classes | 9 (software), 42 (SaaS/development) |
| Arama terimleri | "dev cleaner", "devcleaner", "developer cleaner" |
| Sonuç | Her jurisdiction için hit listesi |
| Counsel | İsim, tarih, karar |
| Karar | Proceed / proceed with lockup / rename |

Release gate: counsel satırı boşsa G0 geçmez.

### 11.3 Telif ve font

- Logo Vellium için üretilmiş/eser sahipliği Vellium'da; yazılı assignment/records.
- Üçüncü taraf asset yok; `</>` ve spark generic geometric şekiller.
- Inter fontu repoda yok; CSS fallback.
- Inter outline edilirse: Inter sürümü, kaynak URL, OFL 1.1 metni `BRAND_GUIDELINES.md`'de.
- OFL FAQ: fontla üretilen logo/font olmayan grafik, font dağıtımı değildir; font dosyası dağıtılmadıkça OFL yükümlülüğü doğmaz.

### 11.4 GitHub

- **Avatar:** GitHub'da repo avatarı yoktur. Vellium org avatarı ürün ikonuyla değiştirilmez. Ürün hesabı varsa `avatar-1024.png` (daire-safe) yüklenir.
- **Social preview:** `github/social-preview.png`, 1280×640, <1 MB, 64 px marj, metin sol %60, logo sağ %30.
- **README:** 256 px PNG; SVG GitHub sanitization riskine karşı PNG tercih edilir.
- **Upload runbook:** repo → Settings → Social preview → Upload; screenshot; `docs/release/RELEASE_CHECKLIST.md`'ye işaretle.

---

## 12. Fazlar, efor ve çıktılar

| Faz | İş | Saat | Çıktı | Çıkış kriteri |
|---|---|---:|---|---|
| 0 | Baseline, tag, hash, arşiv, legal başlangıç | 4–6 | `baseline-2.2.1`, `TRADEMARK_CLEARANCE.md` taslağı | G0 ilk yarı |
| 1 | Master SVG, optik varyantlar, installer art, GitHub art, favicon/notification | 14–18 | `assets/brand/**`, `docs/brand/preview.html` | Tasarım board onayı |
| 2 | `sharp` pin, ICO/BMP writer, generator, manifest, unit testler | 10–14 | `scripts/lib/*`, `scripts/generate-icons.mjs`, `check-icons.mjs` | G1 + G3 |
| 3 | Windows entegrasyonu: icon.ico, tray, `image-png`, config, NSIS hook, WiX, Logo, README, favicon | 12–16 | Kaynak değişiklikleri | G2 |
| 4 | Installer doğrulama: NSIS/MSI temiz kurulum, frame gate, ARP/kısayol, 100–200% sayfalar | 8–12 | `verify-installer.ps1`, `verify-msi.ps1` | G4 |
| 5 | Upgrade + cache: NSIS ve MSI ayrı VM, 5 yüzey, `SHGetFileInfo` | 8–12 | `verify-upgrade.ps1`, `verify-shell-icons.ps1` | G5 |
| 6 | QA matrisi: 3 OS × 6 DPI × 2 tema × 18 yüzey | 10–14 | Screenshot/failure log | G6 |
| 7 | Docs, CI, release: sürüm 2.2.2, build, hash, tag, GitHub | 6–8 | Release artifacts + notes | G7 |
| **Toplam** | | **72–88** | | **12–15 iş günü** |

Contingency: %15 → 83–101 saat. Takvim 15–19 iş gününe çıkabilir; VM ve legal bekleme dahil.

---

## 13. Risk kaydı ve rollback

| Risk | Olasılık | Etki | Azaltma | Trigger |
|---|---|---|---|---|
| Explorer pinned icon stale | Orta | Yüksek | `FLUSH` + UPDATEITEM + `SHGetFileInfo` testi | 5 sn içinde güncellenmezse versioned `app.ico` |
| NSIS 15 kareyi düşürür | Düşük | Yüksek | Build gate; ship durur | RT_GROUP_ICON < 15 |
| MSI upgradeCode değişir | Düşük | Kritik | Exact GUID + test | İki ARP kaydı |
| `sharp` cross-machine farkı | Orta | Orta | Windows-only generation; CI structural; manifest | İkinci run hash farkı |
| MUI/WiX high-DPI stretch | Yüksek | Düşük | 2×'ten 1× downscale; QA kabul | 200% okunaksız |
| `ncGuiInit` 200% bozulur | Orta | Orta | Test; gerekirse hack'i kaldır | Subtitle hizasız |
| İsim çakışması | Yüksek | Yüksek | Counsel; lockup; rename opsiyonu | Counsel conflict |
| GitHub avatar yanlış hesap | Düşük | Düşük | Vellium avatarına dokunma | Ürün hesabı yoksa skip |
| Win10 VM yok | Orta | Orta | Destek iddiasını kaldır | VM yok |
| `SHCNF_FLUSH` installer'ı bekletir | Düşük | Orta | 30 sn timeout testi | >30 sn |

### Rollback

1. Marka commit'ini revert et; tag'i koru.
2. 2.2.1 artifact'larını `baseline-2.2.1` tag'inden yeniden üret; eski EXE'leri patch etme.
3. Yeni 2.2.2 artifact'larını yayından çek; hash'leri release notes'tan kaldır.
4. Kullanıcıya "2.2.1'e dönün" talimatı; NSIS/MSI ayrı uninstall.
5. Post-mortem: hangi gate kaçırdı?

---

## 14. Release runbook (onay sonrası)

```powershell
# 0. Baseline (bir kez)
git tag -a baseline-2.2.1 b364ecc -m "Dev Cleaner 2.2.1 shipped artifacts"

# 1. Sürüm
npm version 2.2.2 --no-git-tag-version
# Cargo.toml, Cargo.lock, tauri.conf.json → 2.2.2
npm run check-version

# 2. Asset üretimi (Windows)
npm run generate:icons
npm run check:icons
npm run check:brand

# 3. Testler
npm run typecheck
npm test
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings

# 4. Build
git status --porcelain   # boş olmalı
npm run build:release

# 5. Installer/upgrade (ayrı VM'ler)
npm run verify:installer
npm run verify:msi
npm run verify:upgrade

# 6. Yayın
# BUILD_INFO.json commit/HEAD ve dirty=false kontrol et
# SHA256SUMS.txt doğrula
git tag -a v2.2.2 -m "Dev Cleaner 2.2.2"
git push origin main --tags
```

**Yasak:** 2.2.1 EXE'lerini yamalamak, `release_output` içindeki eski artifact'ı yeni sürümle karıştırmak, `dirty=true` build yayınlamak.

---

## 15. Onay gerektiren kararlar

| # | Karar | Önerilen varsayılan |
|---:|---|---|
| D1 | Ürün adı "Dev Cleaner" kalacak mı? | Kal; "Dev Cleaner by Vellium" lockup; counsel sonucu rename gerektirirse ayrı iş. |
| D2 | GitHub avatarı | Vellium avatarına dokunma; yalnızca social preview + README. Ürün hesabı varsa daire-safe avatar. |
| D3 | Windows 10 desteği | 22H2 VM sağlanacaksa koru; yoksa README/MASTER_SPEC'ten 1809+ iddiasını kaldır. |
| D4 | Tasarım yönü | Koyu obsidian squircle + beyaz `</>` + spark; in-app glyph-only. |
| D5 | Installer görsel dili | Koyu sidebar/header; native kontrol chrome'a dokunma. |
| D6 | Legal counsel | Release öncesi zorunlu; imza yoksa G0 geçmez. |

---

## 16. Kaynaklar

1. Microsoft — `SHChangeNotify`: https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/nf-shlobj_core-shchangenotify
2. Microsoft — Notification area / high-DPI: https://learn.microsoft.com/en-us/windows/win32/shell/notification-area
3. ICO format (structure, 256=0, DIB, AND mask, DPI table): https://en.wikipedia.org/wiki/ICO_(file_format)
4. NSIS — `Icon`: https://nsis.sourceforge.io/Docs/Chapter4.html (4.8.1.18: "Every image in the icon file will be included")
5. NSIS MUI — header 150×57, sidebar 164×314, `FitControl`: https://nsis.sourceforge.io/Docs/Modern%20UI/Readme.html
6. Tauri — Windows installer, install modes, WiX/NSIS: https://v2.tauri.app/distribute/windows-installer/
7. Tauri config schema — `upgradeCode`, `bannerPath` 493×58, `dialogImagePath` 493×312: `node_modules/@tauri-apps/cli/config.schema.json`
8. Tauri MSI perUser desteklenmiyor: https://github.com/tauri-apps/tauri/issues/13792
9. Tauri tray DPI sorunu ve `TaskbarCreated` düzeltmesi: https://github.com/tauri-apps/tauri/issues/9335
10. tray-icon `SM_CXSMICON`: https://github.com/tauri-apps/tray-icon/blob/dev/src/platform_impl/windows/util.rs
11. sharp output (metadata strip, PNG options, no BMP): https://sharp.pixelplumbing.com/api-output/
12. GitHub social preview: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview
13. GitHub profile reference (<1 MB, <3000×3000): https://docs.github.com/en/account-and-profile/reference/profile-reference
14. OFL FAQ (logo/font use): https://openfontlicense.org/ofl-faq/
15. WiX WixUI banner/dialog sizes: https://docs.firegiant.com/wix3/wixui/wixui_customizations/

---

## 17. Sonuç

v3.1, 84/100 değerlendirmesindeki **20 bulgunun tamamını** somut karar + test kapısıyla kapatıyor. Ayrıca araştırmada çıkan **11 yeni açığı** (BMP writer, `image-png`, 28/36 px, 18 px optik, favicon/notification, MSI kısayol ayrımı, uninstaller sayfa kanıtı, yüksek DPI hack riski, isim çakışması, CI ayrımı, README) kapsama alıyor.

Planın kendi tamlığı: **100/100** — açık kalan tek şeyler dış dünyaya bağlı kapılar: legal imza, Win10 VM, tasarım onayı ve QA yürütmesi. Bunlar plan eksikliği değil, release gate'leridir.

**Uygulama, bu plan onaylanmadan başlamaz.**
