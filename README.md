<div align="center">

# 🧹 Node Cleaner — Hızlı & Güvenli node_modules Temizleme Aracı

</div>

---

<div align="center">

[![](https://img.shields.io/badge/Language-English-blue?style=for-the-badge&logo=google-translate)](#english-version)
&nbsp;&nbsp;&nbsp;&nbsp;
[![](https://img.shields.io/badge/Dil-T%C3%BCrk%C3%A7e-red?style=for-the-badge&logo=google-translate)](#turkish-version)

</div>

---

<div align="center">

![Tauri](https://img.shields.io/badge/Tauri-2.2+-24C8D8?style=for-the-badge&logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-2021-DEA584?style=for-the-badge&logo=rust&logoColor=black)
![React](https://img.shields.io/badge/React-19.0-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6.2-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Zustand](https://img.shields.io/badge/Zustand-5.0-4338CA?style=for-the-badge)
![TanStack Virtual](https://img.shields.io/badge/TanStack-Virtual_3-FF4154?style=for-the-badge)
![Windows](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6?style=for-the-badge&logo=windows&logoColor=white)
![License](https://img.shields.io/badge/License-Proprietary-yellow?style=for-the-badge)

</div>

---

## ⚠️ Release status (2.0.0)

This repository contains Node Cleaner 2.0: a catalog-driven, multi-ecosystem
developer-artifact and AI-agent storage cleaner. The destructive path is
Rust-backed and guarded by automated tests, and the previously pending verification
work has been executed (real Recycle Bin round-trip, 10k/50k/1M-entry/300k-recording
benchmarks, crash-during-delete, offline/no-telemetry, installer round-trips).

**Public production is GO for the current packages**, which were built from a
clean tree: `release_output/BUILD_INFO.json` reports `"dirty": false` and a commit
equal to `HEAD`, and the running binary reports the same commit via
`get_build_info`. That manifest is the authoritative hash/commit record for a
download. Two non-code gaps remain documented: the Windows 10 clean-install smoke
test and the OneDrive cloud-only placeholder. See:

- `docs/README.md` — documentation index and reading order
- `docs/release/RELEASE_CHECKLIST.md` — gates and remaining items
- `docs/release/BUILD_PROVENANCE.md` — how a binary is tied to a commit
- `docs/security/FINAL_SECURITY_AUDIT.md` — executed evidence
- `docs/release/TEST_MATRIX.md` — test results
- `docs/MASTER_SPEC.md` — normative 2.0 specification

The text below is partly written for the earlier `node_modules`-only product.
Where it conflicts with `docs/MASTER_SPEC.md`, the specification wins.

---

<a id="english-version"></a>
# English Version

<div align="center">
  <img src="assets/brand/app-icon.svg" alt="Node Cleaner Logo" width="130" height="130" />
  <h3>Node Cleaner — High-Performance Disk Space Reclaimer & node_modules Cleaner</h3>
  <p><em>Ultra-Fast Discovery, Monorepo Hierarchy Grouping & Safe Deletion for JavaScript & TypeScript Workspaces</em></p>
  <p><strong>Developed & Published by <a href="https://vellium.dev">Vellium</a></strong></p>
</div>

<br>

## 💻 Project Overview

**Node Cleaner** is a Windows desktop application built with **Tauri 2 (Rust)** and **React 19 (TypeScript)**. Version 2.0 discovers reproducible developer artifacts across JavaScript, Python, Rust, .NET, Java/Kotlin, Go, PHP, Dart and other ecosystems, analyses AI coding-agent storage (Codex, Claude Code, Antigravity) without reading file contents, and safely cleans selected targets. Every scan, measurement, classification and deletion runs in the Rust backend; the frontend only presents and selects backend-owned target IDs.

Traditional filesystem scanners freeze system I/O by recursing deep into nested dependency subfolders. **Node Cleaner** solves this with an **Optimized Pruning Directory Traversal Engine**: as soon as a `node_modules` directory is discovered, deep recursive traversal is bypassed, and size calculation is offloaded to asynchronous worker pools.

With strict **Multi-Layer Safety Verification (`SEC-DEL`)**, protected system folders (like `C:\Windows`, `Program Files`, and user profile roots) cannot be selected or deleted. Node Cleaner supports both reversible **Windows Recycle Bin** soft deletion (`IFileOperation` / `SHFileOperationW`) and lightning-fast **Permanent** deletion with interactive confirmations.

Node Cleaner operates **100% locally** with zero telemetry, zero analytics, and zero external network dependencies.

---

## 🚀 Key Features

- **⚡ Blazing-Fast Discovery Engine**: Traverses massive disk trees with millisecond response times, instantly skipping nested sub-directory recursion inside `node_modules` to find hundreds of projects without UI stutter.
- **🛡️ Multi-Layer Safety Guard (`SEC-DEL`)**: Hardened path boundary checks prevent deletion of Windows system directories, user root folders, non-`node_modules` targets, or drive roots (`C:\`).
- **📦 Monorepo & Workspace Hierarchy Detection**: Intelligently groups nested package folders under their respective monorepo root workspaces (`pnpm-workspace`, `Turbo`, `Lerna`, `Nx`, `Yarn Workspaces`, `Bun`).
- **🎛️ Two-Stage Safe Deletion**:
  - **Recycle Bin (Reversible)**: Native Win32 Shell API integration (`IFileOperation`) allowing instant recovery from Windows Recycle Bin.
  - **Permanent Deletion**: Asynchronous high-throughput directory purge with double confirmation dialogs.
- **📊 60 FPS Virtualized Grid**: TanStack Virtualizer powers buttery-smooth 60 FPS scrolling and rendering even across 10,000+ discovered project entries with zero DOM overhead.
- **🌐 Localization (i18n)**: The legacy header uses a 75-locale dictionary with instant in-app switching. The 2.0 screens (Overview, Projects, AI Tools, Tool Caches, History, Settings) are localized in **English and Turkish only**; full 75-locale coverage for these screens is not claimed.
- **🎨 Modern Dark-Transparent Glassmorphism UI**: Custom frameless window styling with curated dark aesthetic design tokens, smooth animations, and responsive layouts.
- **🔍 Real-Time Search & Sorting**: Filter projects by name, filesystem path, or package manager (`npm`, `pnpm`, `yarn`, `bun`), and sort by largest disk size or oldest modified date.
- **🔒 100% Offline & Private**: Zero telemetry, zero analytics, zero external network requests.

---

## 🛠️ Tech Stack

<div align="center">

![Tauri](https://img.shields.io/badge/Tauri_2.2-24C8D8?style=for-the-badge&logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust_2021-DEA584?style=for-the-badge&logo=rust&logoColor=black)
![React](https://img.shields.io/badge/React_18-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript_5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite_6.2-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Zustand](https://img.shields.io/badge/Zustand_5-443E3B?style=for-the-badge)
![TanStack Virtual](https://img.shields.io/badge/TanStack_Virtual_3-FF4154?style=for-the-badge)

</div>

### Backend & Core Engine (Rust)
- **Tauri 2.2**: Native Windows runtime integration, frameless window styling, and secure IPC bridge
- **WalkDir 2.5**: Optimized directory traversal with custom pruning logic
- **Trash 5.2**: Native Windows Recycle Bin COM integration
- **Tokio 1.49**: Asynchronous multi-threaded background disk scanning and task management
- **Windows API (`windows-rs` 0.58)**: Native Win32 Shell (`IFileOperation`), UI, and COM subsystem bindings
- **Single Instance Plugin**: `tauri-plugin-single-instance` for single-process mutex enforcement

### Frontend & User Interface (React & TypeScript)
- **React 19 & TypeScript 5.7**: Component-driven reactive user interface with strict typing
- **TanStack React Virtual 3.13**: Window-level DOM virtualization for high-density tabular data
- **Zustand 5.0**: Reactive state management (`useScannerStore`, `useSettingsStore`)
- **Lucide React**: Clean, modern SVG icon set
- **Custom CSS Design Tokens**: Zero-framework vanilla CSS with CSS variables, HSL color system, glassmorphism, and responsive layouts

---

## 📁 Project Structure

```tree
Node-Cleaner/
├── assets/                         # Vector brand assets & master logo
│   └── brand/                      # app-icon.svg, logo-master.svg
├── docs/                           # All project documentation (see docs/README.md)
│   ├── README.md                   # Documentation index & reading order
│   ├── MASTER_SPEC.md              # Normative 2.0 specification
│   ├── architecture/               # ARCHITECTURE, CLEANUP_CATALOG, AGENT_PROVIDERS
│   ├── security/                   # SECURITY_MODEL, FINAL_SECURITY_AUDIT
│   ├── release/                    # TEST_MATRIX, RELEASE_CHECKLIST, release report
│   ├── audit/                      # Pre-change baseline audit & test results
│   └── archive/                    # Historical plans and research (not current truth)
├── public/                         # Public static web assets
│   └── vellium.svg                 # Publisher logo
├── release_output/                 # Production builds (git-ignored, regenerated)
│   ├── Node-Cleaner-2.0.0-x64-Setup.exe   # NSIS Setup Installer
│   ├── Node-Cleaner-2.0.0-x64.msi         # MSI Enterprise Installer
│   ├── Node-Cleaner-2.0.0-Portable.exe    # Standalone Portable Binary
│   ├── BUILD_INFO.json                    # Commit, dirty flag and per-artifact hashes
│   ├── SHA256SUMS.txt                     # Cryptographic SHA-256 checksums
│   └── verify-checksums.bat               # 1-Click SHA-256 verification tool
├── scripts/                        # Automated build & verification tools
│   ├── build-release.js            # Release builder (provenance gate -> Build -> Package -> Hash)
│   ├── check-version.js            # Cross-file version consistency validator
│   ├── verify-ipc.mjs              # CSP + IPC + build-provenance probe on the packaged app
│   ├── verify-offline.ps1          # No-telemetry / no-secret-persistence check
│   ├── verify-recycle-bin.ps1      # Real Recycle Bin round-trip
│   ├── verify-installer.ps1        # NSIS/MSI install -> launch -> uninstall
│   └── verify-checksums.bat        # Windows batch checksum verifier
├── src/                            # Frontend application source (React 19 + TS)
│   ├── app/                        # App shell & layout orchestration
│   ├── components/                 # UI primitives, layout, brand and error boundary
│   ├── features/                   # Domain modules
│   │   ├── agents/                 # AI agent storage view
│   │   ├── caches/                 # Global cache / official tool actions
│   │   ├── cleanup/                # Cleanup plan & result dialogs
│   │   ├── history/                # Deletion history and official-action audit
│   │   ├── items/                  # Virtualized item table & project view
│   │   ├── overview/               # Summary / dashboard view
│   │   ├── results/                # Selection action bar
│   │   ├── scan/                   # Scan header, quick locations, controller
│   │   ├── settings/               # Backend-owned settings editor
│   │   └── shell/                  # Navigation rail
│   ├── lib/                        # Tauri IPC client, formatters, i18n, UI text
│   ├── locales/                    # 75-locale legacy dictionary (2.0 screens: EN/TR)
│   ├── stores/                     # Zustand stores (scan, selection, prefs, ui, app)
│   ├── styles/                     # Design tokens & global CSS
│   ├── test/                       # Vitest suites
│   ├── types/                      # Shared IPC DTOs
│   ├── App.tsx                     # Main layout & orchestrator
│   └── main.tsx                    # React DOM entry point
├── src-tauri/                      # Rust backend & platform engine
│   ├── assets/targets.toml         # Embedded 56-rule cleanup catalog
│   ├── icons/                      # App icons (ICO, ICNS, PNGs, StoreLogo, Splash)
│   ├── nsis/                       # NSIS installer bitmaps & hooks
│   ├── src/
│   │   ├── audit/                  # Cleanup history & official-action JSONL audit
│   │   ├── catalog/                # Rule model, matcher, project resolver
│   │   ├── cleanup/                # Planner, coordinator, Recycle Bin, permanent, actions
│   │   ├── commands/               # Tauri IPC command handlers
│   │   ├── error/                  # Domain error types
│   │   ├── platform/               # Win32 file identity, locking, known folders
│   │   ├── providers/              # Agent specs, root locator, growth analysis
│   │   ├── safety/                 # Path, process, Git and evidence guards
│   │   ├── scanner/                # Discovery, measurement, limits, sessions
│   │   ├── settings/               # Settings model & atomic persistence
│   │   ├── lib.rs                  # Plugin registry & command router
│   │   └── main.rs                 # Native entry point
│   ├── Cargo.toml                  # Rust dependencies & package configuration
│   └── tauri.conf.json             # Tauri window, security (CSP) & bundle metadata
├── build-release.bat               # One-click Windows release wrapper
├── package.json                    # Node dependencies & npm scripts
├── tsconfig.json                   # TypeScript compiler configuration
├── vite.config.ts                  # Vite build & bundler configuration
└── README.md                       # Project overview & quick start
```

---

## ⚙️ Scanning & Safe Deletion Architecture

```mermaid
flowchart TD
    subgraph Frontend["Frontend UI (React 19 & Virtualizer)"]
        UI_Scan["Directory Picker / Scan Trigger"]
        UI_Table["TanStack Virtualized Grid (60 FPS)"]
        UI_Action["Action Bar: Recycle Bin / Delete"]
    end

    subgraph Backend["Rust Core Engine"]
        SCANNER["Parallel Tree Traversal (WalkDir)"]
        PRUNE{"Is node_modules?"}
        CALC["Async Size Computation Pool"]
        SEC_DEL{"SEC-DEL Verification"}
        TRASH["Win32 Shell IFileOperation (Recycle Bin)"]
        PURGE["std::fs::remove_dir_all (Permanent)"]
    end

    UI_Scan -->|IPC Invoke| SCANNER
    SCANNER --> PRUNE
    PRUNE -->|Yes: Prune Recursion| CALC
    PRUNE -->|No: Traverse Subtree| SCANNER
    CALC -->|Streaming Events| UI_Table
    UI_Action -->|Selected Paths| SEC_DEL
    SEC_DEL -->|Safe: Soft Delete| TRASH
    SEC_DEL -->|Safe: Hard Delete| PURGE
    SEC_DEL -->|Forbidden: System Path| UI_Action
```

### Safety & Deletion Specifications

| Feature | Mechanism | Description |
| :--- | :--- | :--- |
| **Directory Pruning** | `walkdir::IntoIter::filter_entry` | Skips deep traversal inside `node_modules`, saving millions of redundant I/O calls |
| **Path Guard (`SEC-DEL`)** | Strict Canonical Verification | Blocks deletion if path is root (`C:\`), Windows OS folder, Program Files, or non-`node_modules` |
| **Recycle Bin Deletion** | Win32 `IFileOperation` | Safely moves folders to Windows Recycle Bin with full restoration support |
| **Permanent Deletion** | Asynchronous Rayon Pool | High-throughput direct disk unlinking for massive multi-gigabyte dependency trees |

---

## ⚙️ Installation & Usage

### Prerequisites
- **Node.js**: Version 18.0.0 or higher
- **Rust & Cargo**: Version 1.75.0 or higher
- **Windows**: Windows 10 (1809+) or Windows 11 (64-bit x64)
- **WebView2**: Included by default in Windows 10/11

### Step-by-Step Developer Setup

1. **Clone the Repository:**
   ```bash
   git clone https://github.com/emirtdede/Node-Cleaner.git
   cd Node-Cleaner
   ```

2. **Install Node Dependencies:**
   ```bash
   npm install
   ```

3. **Run Automated Test Suites:**
   ```bash
   # Run Frontend Unit & Virtualization Tests (Vitest)
   npm test

   # Run Rust Backend & Safety Tests (Cargo)
   cd src-tauri
   cargo test
   cd ..
   ```

4. **Start Local Development Mode:**
   ```bash
   npm run tauri dev
   ```

5. **Build Production Release Artifacts:**
   ```bash
   # Automated release pipeline (Version Check -> Tauri Build -> Package -> SHA-256)
   npm run build:release
   ```

---

## 📦 Pre-Compiled Distribution Packages

Ready-to-use production packages are generated into the `release_output/` directory (git-ignored; run `npm run build:release`):

- **NSIS Setup Installer**: `Node-Cleaner-1.0.0-x64-Setup.exe` *(Full installer with desktop/start menu shortcuts)*
- **MSI Enterprise Installer**: `Node-Cleaner-1.0.0-x64.msi` *(Enterprise & GPO silent deployment)*
- **Standalone Portable**: `Node-Cleaner-1.0.0-Portable.exe` *(Zero installation, run standalone from USB or any folder)*
- **Integrity Verification**: `verify-checksums.bat` & `SHA256SUMS.txt`

---

## ⚖️ License

Distributed under the **Proprietary License**. Copyright &copy; 2026 Vellium. All rights reserved.

**Official Website**: [Vellium.dev](https://vellium.dev) &bull; **Publisher**: Vellium

---

<br>

---

<a id="turkish-version"></a>
# Türkçe Versiyon

<div align="center">
  <img src="assets/brand/app-icon.svg" alt="Node Cleaner Logo" width="130" height="130" />
  <h3>Node Cleaner — Yüksek Performanslı Disk Alanı Açma ve node_modules Temizleme Aracı</h3>
  <p><em>JavaScript ve TypeScript Projeleri İçin Ultra Hızlı Tarama, Monorepo Hiyerarşi Gruplama ve Güvenli Silme</em></p>
  <p><strong>Geliştirici ve Yayıncı: <a href="https://vellium.dev">Vellium</a></strong></p>
</div>

<br>

## 💻 Project Overview (Proje Genel Bakışı)

**Node Cleaner**, **Tauri 2 (Rust)** ve **React 19 (TypeScript)** ile geliştirilmiş bir Windows masaüstü uygulamasıdır. 2.0 sürümü JavaScript, Python, Rust, .NET, Java/Kotlin, Go, PHP, Dart ve diğer ekosistemlerdeki yeniden üretilebilir geliştirici artıklarını bulur; Codex, Claude Code ve Antigravity gibi AI kodlama ajanlarının depolamasını dosya içeriğini okumadan analiz eder ve seçilen hedefleri güvenle temizler. Tarama, ölçüm, sınıflandırma ve silme tamamen Rust arka ucunda çalışır; ön yüz yalnızca arka ucun ürettiği hedef kimliklerini gösterir ve seçer.

Geleneksel dosya tarayıcıları iç içe geçmiş bağımlılık ağaçlarında takılarak sistemi kilitler. **Node Cleaner**, geliştirdiği **Budamalı Dizin Tarama Motoru** ile `node_modules` klasörüne ulaştığı anda derin özyinelemeli taramayı durdurarak boyutu arka plan iş parçacığı havuzlarına devreder ve yüzlerce projeyi saniyeler içinde listeler.

Gelişmiş **Çok Katmanlı Güvenlik Mekanizması (`SEC-DEL`)** sayesinde Windows sistem dizinleri (`C:\Windows`, `Program Files` vb.) ve kullanıcı ana klasörleri kesinlikle silinemez. Node Cleaner hem geri alınabilir **Windows Çöp Kutusu** (`IFileOperation`) hem de kalıcı silme seçeneklerini çift onaylı koruma ile sunar.

Uygulama **%100 yerel ve çevrimdışı** çalışır; hiçbir harici sunucuya bağlanmaz, telemetri veya analitik verisi toplamaz.

---

## 🚀 Key Features (Önemli Özellikler)

- **⚡ Işık Hızında Tarama Motoru**: Milyonlarca dosya içeren disk ağaçlarını tararken `node_modules` alt dizinlerine gereksiz girmeyerek taramayı budar ve sistemi dondurmadan yüzlerce projeyi saniyeler içinde bulur.
- **🛡️ Çok Katmanlı Güvenlik Kalkanı (`SEC-DEL`)**: Windows sistem kökü (`C:\`), `Windows`, `Program Files`, kullanıcı profil dizinleri veya `node_modules` dışındaki klasörlerin yanlışlıkla silinmesini kesin olarak engeller.
- **📦 Monorepo ve Çalışma Alanı Gruplama**: İç içe geçmiş paketleri bağlı oldukları monorepo kök dizini altında akıllıca gruplar (`pnpm-workspace`, `Turbo`, `Lerna`, `Nx`, `Yarn Workspaces`, `Bun`).
- **🎛️ İki Aşamalı Güvenli Silme**:
  - **Çöp Kutusu (Geri Alınabilir)**: Yerel Win32 Shell API (`IFileOperation`) entegrasyonu ile klasörleri Windows Çöp Kutusu'na taşır.
  - **Kalıcı Silme**: Asenkron yüksek hızlı doğrudan disk temizliği (çift onaylı modal ile).
- **📊 60 FPS Sanallaştırılmış Liste**: TanStack Virtualizer mimarisi ile 10.000+ proje listelense bile DOM şişmesi yaşanmaz, 60 FPS akıcı kaydırma sağlanır.
- **🌐 Yerelleştirme (i18n)**: Eski başlık alanı 75 dilli sözlüğü kullanır ve dil anında değiştirilebilir. 2.0 ekranları (Genel Bakış, Projeler, AI Araçları, Araç Önbellekleri, Geçmiş, Ayarlar) yalnızca **İngilizce ve Türkçe** olarak yerelleştirilmiştir; bu ekranlar için 75 dilde tam kapsam iddia edilmemektedir.
- **🎨 Modern Karanlık Cam Efektli (Glassmorphism) Arayüz**: Özel çerçevesiz pencere tasarımı, estetik karanlık renk paleti ve akıcı mikro animasyonlar.
- **🔍 Gerçek Zamanlı Arama ve Sıralama**: Proje adı veya dosya yoluna göre anında filtreleme; en büyük boyuta veya en eski değiştirilme tarihine göre sıralama.
- **🔒 Tamamen Çevrimdışı ve Gizli**: Sıfır telemetri, sıfır analiz, sıfır dış ağ bağlantısı.

---

## 🛠️ Tech Stack (Teknoloji Yığını)

<div align="center">

![Tauri](https://img.shields.io/badge/Tauri_2.2-24C8D8?style=for-the-badge&logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust_2021-DEA584?style=for-the-badge&logo=rust&logoColor=black)
![React](https://img.shields.io/badge/React_18-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript_5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite_6.2-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Zustand](https://img.shields.io/badge/Zustand_5-443E3B?style=for-the-badge)
![TanStack Virtual](https://img.shields.io/badge/TanStack_Virtual_3-FF4154?style=for-the-badge)

</div>

### Arka Uç ve Çekirdek Motor (Rust)
- **Tauri 2.2**: Windows yerel platform entegrasyonu, çerçevesiz pencere yönetimi ve güvenli IPC köprüsü
- **WalkDir 2.5**: Özel budama mantığına sahip yüksek hızlı dosya sistemi tarayıcısı
- **Trash 5.2**: Windows Çöp Kutusu COM alt sistemi entegrasyonu
- **Tokio 1.49**: Asenkron çok iş parçacıklı arka plan disk tarama ve görev yönetimi
- **Windows API (`windows-rs` 0.58)**: Win32 Shell (`IFileOperation`), UI ve COM sistem bağlayıcıları
- **Tekil Süreç Eklentisi**: `tauri-plugin-single-instance` ile tekil process kilidi

### Ön Yüz ve Kullanıcı Arayüzü (React & TypeScript)
- **React 19 & TypeScript 5.7**: Bileşen odaklı, tip güvenli reaktif kullanıcı arayüzü
- **TanStack React Virtual 3.13**: Yüksek yoğunluklu veriler için pencereleme ve DOM sanallaştırma motoru
- **Zustand 5.0**: Reaktif durum yönetimi (`useScannerStore`, `useSettingsStore`)
- **Lucide React**: Tutarlı ve modern SVG ikon seti
- **Özel CSS Tasarım Sistemi**: CSS Değişkenleri, HSL renk sistemi, cam efektleri ve akıcı mikro animasyonlar

---

## 📁 Project Structure (Proje Klasör Yapısı)

```tree
Node-Cleaner/
├── assets/                         # Vektörel marka varlıkları ve master logo
│   └── brand/                      # app-icon.svg, logo-master.svg
├── docs/                           # Tüm proje dokümantasyonu (bkz. docs/README.md)
│   ├── README.md                   # Doküman indeksi ve okuma sırası
│   ├── MASTER_SPEC.md              # Normatif 2.0 spesifikasyonu
│   ├── architecture/               # ARCHITECTURE, CLEANUP_CATALOG, AGENT_PROVIDERS
│   ├── security/                   # SECURITY_MODEL, FINAL_SECURITY_AUDIT
│   ├── release/                    # TEST_MATRIX, RELEASE_CHECKLIST, release raporu
│   ├── audit/                      # Değişiklik öncesi baseline denetimi ve test sonuçları
│   └── archive/                    # Tarihsel plan ve araştırmalar (güncel doğru değil)
├── public/                         # Genel statik web varlıkları
│   └── vellium.svg                 # Yayıncı logosu
├── release_output/                 # Üretim paketleri (git-ignored, yeniden üretilir)
│   ├── Node-Cleaner-2.0.0-x64-Setup.exe   # NSIS Kurulum Sihirbazı
│   ├── Node-Cleaner-2.0.0-x64.msi         # MSI Kurumsal Kurulum Paketi
│   ├── Node-Cleaner-2.0.0-Portable.exe    # Taşınabilir Tekil Exe
│   ├── BUILD_INFO.json                    # Commit, dirty bayrağı ve artefakt hash'leri
│   ├── SHA256SUMS.txt                     # Kriptografik SHA-256 sağlama özetleri
│   └── verify-checksums.bat               # Tek tıkla hash doğrulama aracı
├── scripts/                        # Otomatik derleme ve doğrulama scriptleri
│   ├── build-release.js            # Release derleyici (köken kapısı -> Derleme -> Paket -> Hash)
│   ├── check-version.js            # Sürüm tutarlılık kontrol scripti
│   ├── verify-ipc.mjs              # Paketlenmiş uygulamada CSP + IPC + derleme kökeni kontrolü
│   ├── verify-offline.ps1          # Telemetri yok / sır sızıntısı yok kontrolü
│   ├── verify-recycle-bin.ps1      # Gerçek Geri Dönüşüm Kutusu gidiş-dönüşü
│   ├── verify-installer.ps1        # NSIS/MSI kur -> çalıştır -> kaldır
│   └── verify-checksums.bat        # Windows batch checksum doğrulayıcı
├── src/                            # Ön yüz kaynak kodları (React 19 + TypeScript)
│   ├── app/                        # Uygulama kabuğu ve düzen orkestrasyonu
│   ├── components/                 # UI bileşenleri, layout, marka ve hata sınırı
│   ├── features/                   # Özellik modülleri
│   │   ├── agents/                 # AI ajan depolama görünümü
│   │   ├── caches/                 # Global önbellek / resmi araç işlemleri
│   │   ├── cleanup/                # Temizlik planı ve sonuç diyalogları
│   │   ├── history/                # Silme geçmişi ve resmi işlem denetimi
│   │   ├── items/                  # Sanallaştırılmış öğe tablosu ve proje görünümü
│   │   ├── overview/               # Özet / kontrol paneli görünümü
│   │   ├── results/                # Seçim işlem çubuğu
│   │   ├── scan/                   # Tarama başlığı, hızlı konumlar, denetleyici
│   │   ├── settings/               # Arka uç sahipli ayar editörü
│   │   └── shell/                  # Navigasyon rayı
│   ├── lib/                        # Tauri IPC istemcisi, biçimlendiriciler, i18n, UI metinleri
│   ├── locales/                    # 75 dilli eski sözlük (2.0 ekranları: EN/TR)
│   ├── stores/                     # Zustand depoları (scan, selection, prefs, ui, app)
│   ├── styles/                     # Tasarım token'ları ve global CSS
│   ├── test/                       # Vitest test paketleri
│   ├── types/                      # Paylaşılan IPC DTO'ları
│   ├── App.tsx                     # Ana arayüz düzeni ve orkestrasyon
│   └── main.tsx                    # React DOM giriş noktası
├── src-tauri/                      # Rust arka uç ve platform çekirdeği
│   ├── assets/targets.toml         # Gömülü 56 kurallı temizlik kataloğu
│   ├── icons/                      # Uygulama ikonları (ICO, ICNS, PNG'ler, StoreLogo, Splash)
│   ├── nsis/                       # NSIS kurulum görselleri ve hook'ları
│   ├── src/
│   │   ├── audit/                  # Temizlik geçmişi ve resmi işlem JSONL denetimi
│   │   ├── catalog/                # Kural modeli, eşleştirici, proje çözümleyici
│   │   ├── cleanup/                # Planlayıcı, koordinatör, Çöp Kutusu, kalıcı silme
│   │   ├── commands/               # Tauri IPC komut işleyicileri
│   │   ├── error/                  # Domain hata tipleri
│   │   ├── platform/               # Win32 dosya kimliği, kilitleme, bilinen klasörler
│   │   ├── providers/              # Ajan tanımları, kök bulucu, büyüme analizi
│   │   ├── safety/                 # Yol, süreç, Git ve kanıt koruyucuları
│   │   ├── scanner/                # Keşif, ölçüm, limitler, oturumlar
│   │   ├── settings/               # Ayar modeli ve atomik kalıcılık
│   │   ├── lib.rs                  # Eklenti kaydı ve komut yönlendirici
│   │   └── main.rs                 # Yerel yürütülebilir dosya giriş noktası
│   ├── Cargo.toml                  # Rust bağımlılıkları ve paket yapılandırması
│   └── tauri.conf.json             # Tauri pencere, güvenlik (CSP) ve bundle ayarları
├── build-release.bat               # Tek tıkla Windows release sarmalayıcısı
├── package.json                    # Node bağımlılıkları ve npm scriptleri
├── tsconfig.json                   # TypeScript derleyici yapılandırması
├── vite.config.ts                  # Vite derleyici yapılandırması
└── README.md                       # Proje genel bakış ve hızlı başlangıç
```

---

## ⚙️ Mimari ve Güvenlik Mekanizması

| Özellik | Kullanılan Mekanizma | Açıklama |
| :--- | :--- | :--- |
| **Dizin Budama (Pruning)** | `walkdir::IntoIter::filter_entry` | `node_modules` içine derinlemesine girilmesini engelleyerek milyonlarca gereksiz I/O çağrısını önler |
| **Yol Güvenliği (`SEC-DEL`)** | Kanonik Yol Doğrulaması | Sürücü kökü (`C:\`), Windows dizini, Program Files ve `node_modules` harici yolların silinmesini engeller |
| **Çöp Kutusu ile Silme** | Win32 `IFileOperation` | Klasörleri güvenle Windows Çöp Kutusu'na taşır, gerektiğinde geri kurtarılabilmesini sağlar |
| **Kalıcı Silme** | Asenkron Rayon / Tokio Havuzu | Gigabaytlarca veriyi arka planda yüksek I/O verimiyle doğrudan diskten siler |

---

## ⚙️ Installation & Usage (Kurulum ve Kullanım)

### Gereksinimler
- **Node.js**: Sürüm 18.0.0 veya üzeri
- **Rust & Cargo**: Sürüm 1.75.0 veya üzeri
- **İşletim Sistemi**: Windows 10 (1809+) veya Windows 11 (64-bit x64)
- **WebView2 Çalışma Zamanı**: Windows 10 ve 11'de varsayılan olarak yerleşiktir

### Adım Adım Geliştirici Kurulumu

1. **Depoyu Klonlayın:**
   ```bash
   git clone https://github.com/emirtdede/Node-Cleaner.git
   cd Node-Cleaner
   ```

2. **Node Bağımlılıklarını Yükleyin:**
   ```bash
   npm install
   ```

3. **Otomatik Testleri Çalıştırın:**
   ```bash
   # Frontend Birim ve Sanallaştırma Testlerini Çalıştırın (Vitest)
   npm test

   # Rust Arka Uç ve Güvenlik Testlerini Çalıştırın (Cargo)
   cd src-tauri
   cargo test
   cd ..
   ```

4. **Geliştirici Modunda Başlatın:**
   ```bash
   npm run tauri dev
   ```

5. **Production Release Paketlerini Derleyin:**
   ```bash
   # Otomatik derleme scripti (Sürüm Kontrolü -> Tauri Derleme -> Paketleme -> SHA-256)
   npm run build:release
   ```

---

## 📦 Dağıtım Paketleri

Hazır derlenmiş resmi release paketleri `release_output/` klasörüne üretilir (git-ignored; `npm run build:release`):

- **NSIS Kurulum Sihirbazı**: `Node-Cleaner-1.0.0-x64-Setup.exe` *(Masaüstü ve başlat menüsü kısayolları ile)*
- **MSI Kurumsal Installer**: `Node-Cleaner-1.0.0-x64.msi` *(Sessiz kurulum ve GPO dağıtımına uygun)*
- **Standalone Taşınabilir Sürüm**: `Node-Cleaner-1.0.0-Portable.exe` *(Kurulumsuz, doğrudan çalışır)*
- **Bütünlük Doğrulama**: `verify-checksums.bat` ve `SHA256SUMS.txt`

---

## ⚖️ License (Lisans)

Bu proje **Ticari / Özel (Proprietary)** lisans ile korunmaktadır. Telif Hakkı &copy; 2026 Vellium. Tüm hakları saklıdır.

**Resmi Web Sitesi**: [Vellium.dev](https://vellium.dev) &bull; **Yayıncı**: Vellium
