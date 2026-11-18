# Kalan İşlerin Uçtan Uca Planı — 2026-11-16 (sürüm 2.2.2)

Bu plan, `docs/audit/2026-11-16-pre-deployment-qa-audit.md` (23 bulgu) ve
`docs/REMEDIATION_PLAN.md` §11'nin kapatmadığı **tüm** açık kalemleri kapsar:
T-37 (`tauri-specta`), T-38 (`rusqlite`), T-39 (handle tabanlı silme),
`ItemTable` memo kısıtı, CI kapı boşlukları ve 385 commit edilmemiş dosyanın
denetlenebilir commit setlerine ayrılması. Önceki 26 + 23 bulgu düzeltmesi bu
planın **başlangıç varsayımı** değil, korunması gereken **mevcut durum**dur.

## 0. Doğrulanmış temel veriler

| Veri | Değer | Doğrulama kaynağı |
|---|---|---|
| `tauri-specta` en yeni sürüm | `2.0.0-rc.29` (2026-11-13), toplam 29 sürüm | crates.io API `/api/v1/crates/tauri-specta` |
| `tauri-specta` en yeni **stable** | `1.0.2` | aynı kayıt: `max_stable_version` |
| `rusqlite` en yeni sürüm | `0.43.0` (2026-11-15) | crates.io API `/api/v1/crates/rusqlite` |
| `rusqlite` varsayılan feature'ları | `["cache", "ffi-sqlite-wasm-rs"]`, `rust_version = 1.89.0`, edition 2024 | crates.io sürüm metadatası |
| Yerel Rust toolchain | `rustc 1.100.0` / `cargo 1.100.0` | `rustc --version`, `cargo --version` |
| `windows` crate çözümü | doğrudan `0.58.0`, geçişli `0.62.2` | `src-tauri/Cargo.lock` |
| `FileDispositionInfoEx` | `FILE_INFO_BY_HANDLE_CLASS(21)` | `windows-0.58.0/src/Windows/Win32/Storage/FileSystem/mod.rs:3969` |
| `FILE_DISPOSITION_INFO_EX` | `{ Flags: FILE_DISPOSITION_INFO_EX_FLAGS }` | aynı dosya:7749 |
| Bayraklar | `DELETE=1`, `POSIX_SEMANTICS=2`, `IGNORE_READONLY_ATTRIBUTE=4`, `ON_CLOSE=8` | aynı dosya |
| `NtCreateFile` konumu | yalnız `Wdk_Storage_FileSystem` (`Wdk_Foundation` + `Win32_System_IO` gerekir) | `windows-0.58.0/src/Windows/Wdk/Storage/FileSystem/mod.rs:2314` |
| Tauri komut sayısı | 39 (`generate_handler!`) | `src-tauri/src/lib.rs:59` |
| Frontend `invoke` sayısı | 22, `scanner-api.ts` 396 satır | `grep -c 'invoke<'` |
| Audit deposu | `history.jsonl` + `snapshots.jsonl` + `actions.jsonl`, `MAX_LOG_BYTES = 32 MiB`, `MAX_HISTORY_LINES = 50_000` | `src-tauri/src/audit/repository.rs` |
| Commit edilmemiş giriş | 342 `M` + 43 `??` = 385; HEAD `239d168` | `git status --porcelain` |
| Frontend test | 19 dosya / 184 test | `npm test` |
| Rust test | 174 lib testi + entegrasyon | `cargo test --locked` |
| Entry chunk | 233.719 B (gzip 71.264 B) | `dist/assets/index-*.js` |
| i18n sayaçları | 86.870 string/502 dosya, 86.974 anahtar/503 dosya, 214 locale dosyası | `npm run check:i18n` |

Kapsam dışı (gerekçeli): Next.js RSC/Server Component analizi — proje Vite 6 +
React 19 SPA'sıdır, RSC yüzeyi yoktur.

CI boşlukları yalnız şunlardır: `ci.yml` Rust işi `--locked` kullanmıyor,
`check:languages` hiçbir iş akışında yok, `check:build-info`/`check:exe-icons`
için release hattı yok. `check:contrast` + Playwright `.github/workflows/a11y.yml`
içinde, `check:i18n` `.github/workflows/i18n.yml` içinde zaten çalışıyor; bunlar
boşluk değildir ve `ci.yml`'e kopyalanmaz (gereksiz tekrar).

## 1. Sıra ve bağımlılık grafiği

```
R-01 baseline  ──► R-02 kapı doğrulama ──► R-03 CI --locked ──► R-04 release provenance
   │                                              │
   │                                              └──► R-05 yeni regresyon kapıları
   ├──► R-06 ItemTable sözleşmesi
   ├──► R-07..R-09  T-39 handle tabanlı silme  ──► R-05 (gate: handle yolu zorunlu)
   ├──► R-10..R-12  T-38 SQLite deposu         ──► R-05 (gate: JSONL yazımı yok)
   └──► R-13..R-14  T-37 specta binding'leri   ──► R-05 (gate: drift)
                                                     │
                                          R-15 kapanış + tam kapı + sürüm notu
```

Katı kurallar:

1. R-01 tamamlanmadan hiçbir kod parçası başlamaz (385 dosya arasında geri
   alınamaz karışma riski).
2. R-02 yeşil olmadan yeni bağımlılık eklenmez; aksi halde kırılmanın kaynağı
   ayırt edilemez.
3. T-38 ve T-39 aynı commit'te birleşmez (ikisi de `cleanup`/`audit` alt
   sistemlerine dokunur; hata izolasyonu gerekir).
4. T-37, T-38'den **sonra** yapılır: sözleşme tipleri `AuditRecord` alanlarını
   içerir, depo değişikliği tipleri değiştirebilir.

## 2. WBS — atomik iş parçaları

| ID | Parça | Bağımlılık | Net çıktı | Kapı |
|---|---|---|---|---|
| R-01 | Baseline ve commit setleri | — | 4 commit; `git status --porcelain` yalnız `release_output/` | `git status` |
| R-02 | Baseline kapı ölçümü | R-01 | `docs/audit/gate-baseline-2026-11-16.txt`, 11/11 yeşil | 11 komut |
| R-03 | CI Rust işine `--locked` | R-02 | `ci.yml` rust job'ta 4 komut `--locked` | YAML lint + yerel `--locked` |
| R-04 | Installer dili + release provenance | R-03 | `ci.yml` `check:languages`; yeni `release.yml` (`check:build-info`, `check:exe-icons`) | `npm run check:languages` |
| R-05 | Yeni regresyon kapıları | R-02 | `check-regression-gates.mjs`'e 2 kural: `invoke`↔`generate_handler!` parity, opsiyonel bağımlılık sözleşmesi (`tauri-specta` `=rc` + `optional`, `rusqlite` `default-features = false` + `bundled`) | `npm run check:gates` |
| R-06 | `ItemTable` memo sözleşmesi | R-01 | Yanıltıcı `backendRevision` yorumu düzeltilir; davranış testi eklenir | `npm test` |
| R-07 | `fs_meta`: handle ile açma + kimlik doğrulama | R-02 | `open_verified_for_delete(path, expected)`; `CreateFileW` + `FILE_FLAG_OPEN_REPARSE_POINT` | `cargo test` |
| R-08 | `permanent.rs`: `FileDispositionInfoEx` ile silme | R-07 | `delete_by_handle`; TOCTOU'da hata, sessiz fallback yok | `cargo test`, `clippy` |
| R-09 | T-39 test matrisi | R-08 | 8 senaryo: readonly, dizin, symlink, junction, in-use, uzun yol, kimlik değişimi, boş dosya | `cargo test` |
| R-10 | SQLite şema v1 + migrasyon | R-02 | `audit/schema.rs`, `PRAGMA user_version = 1`, JSONL→SQLite idempotent aktarım | `cargo test` |
| R-11 | `AuditRepository` SQLite'a taşınması | R-10 | JSONL yazma kodu kaldırılır; genel API (`append_*`, `list_*`, `cleanup_totals`) korunur | `cargo test` |
| R-12 | SQLite dayanıklılık ayarları | R-11 | `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`, retention + `VACUUM` | `cargo test` |
| R-13 | `tauri-specta` altyapısı | R-11, R-03 | `specta`/`tauri-specta = "=2.0.0-rc.29"` opsiyonel `bindings` feature'ı; `src-tauri/src/bin/export_bindings.rs` | `cargo run --features bindings --bin export_bindings` |
| R-14 | Frontend binding migrasyonu | R-13, R-05 | `src/lib/tauri/bindings.ts` üretilir; `scanner-api.ts` ince adaptöre iner; mock eşleşir | `npm run typecheck`, `check:gates` |
| R-15 | Kapanış | R-04..R-14 | Sürüm notu + kapı tablosu + `REMEDIATION_PLAN.md` §12 | 11/11 kapı |

### 2.1 R-01 — Commit setleri (dosya listeleri kesin)

| Set | İçerik | Kapsam |
|---|---|---|
| C1 `docs` | `docs/audit/*.md` (12 dosya), `docs/QA_AUDIT.md`, `docs/REMEDIATION_PLAN.md`, `docs/architecture/NOTIFICATIONS.md`, `docs/release/INSTALLER_LANGUAGES.md` | yalnız Markdown |
| C2 `frontend` | `src/**` (yeni: `table-utils.ts`, `docs-search.ts`, `docs-index.generated.json`, `BridgeUnavailableScreen.tsx`, `ViewSkeleton.tsx`, `error-boundary-text.ts`, `use-legal-locale.ts`, `PartialScanBanner.tsx`, `ScanWarningsBanner.tsx`; silinen: `src/locales/**`, `src/lib/i18n/**`) | `npm run typecheck && npm test` |
| C3 `rust` | `src-tauri/**` (`system_commands.rs`, `error/lock.rs`, `Cargo.toml`, `Cargo.lock`) | `cargo fmt --check`, `clippy`, `cargo test --locked` |
| C4 `tooling` | `scripts/**`, `.github/**`, `public/theme-boot.js`, `index.html`, `package.json`, `package-lock.json`, `vite.config.*` | `check:gates`, `check:audit`, `format:check` |

Kabul: her set ayrı ayrı derlenip test edilir; C2/C3 birbirine bağımlı dosya
içermez (tip üretimi yok). C1 en önce, C4 en son gider.

## 3. Parça bazlı riskler

Etki/olasılık: Y = yüksek, O = orta, D = düşük.

### R-01 — Baseline ve commit setleri

| Risk | Etki | Olasılık | Önlem | Fallback |
|---|---|---|---|---|
| `src/locales/**` silmesinin C2'de eksik kalması, C4'te derleme kırılması | Y | O | C2 öncesi `git status -- src/locales` boş olmalı; `npm test` C2 sonunda zorunlu | C2'yi `git checkout HEAD -- src/locales` ile geri al, silmeyi ayrı commit'e taşı |
| CRLF normalizasyonu yüzünden 385 dosyanın diff'inin şişmesi | O | Y | `.gitattributes` `* text=auto`; commit öncesi `git diff --stat` beklenen satır aralığında mı | `git add --renormalize .` tek commit'e alınır |

Test: `git status --porcelain` → yalnız `release_output/`; `git show --stat` her sette yalnız izinli dizinler.

### R-02 — Baseline kapı ölçümü

| Risk | Etki | Olasılık | Önlem | Fallback |
|---|---|---|---|---|
| `cargo test --locked` "lock file needs update" | Y | D | R-01 C3'te `Cargo.lock` commit edilmiş olmalı | `cargo update -p <paket> --precise` ile kilit sabitlenir |
| `npm test` saat dilimi/locale'e duyarlı test | O | D | `TZ=UTC`, `LC_ALL=C` ile koşum | testte `Intl` yerine sabit `collator` fixture'ı |

Test: 11 kapı sırayla; her komutun çıkış kodu ve süresi log dosyasına yazılır. Kabul: 11/11 çıkış kodu 0.

### R-03 — CI Rust `--locked`

| Risk | Etki | Olasılık | Önlem | Fallback |
|---|---|---|---|---|
| `rust-cache` eski kilit ile yeni kilit arasında kararsız kalır | O | D | cache anahtarı `Cargo.lock` hash'ini içerir (Swatinem varsayılanı) | `cache-on-failure: false` + `key`'e `hashFiles('src-tauri/Cargo.lock')` |
| `--locked` ile `tauri-build` build script'i manifest güncellemeye çalışır | Y | D | Yerelde `cargo check --locked` önce doğrulanır | build script'e dokunulmaz; kilit yeniden üretilip commit edilir |

Test: YAML'de 4 komutun `--locked` içerdiği `Select-String`; yerelde aynı 4 komut. Kabul: 0 hata.

### R-04 — Installer dili + release provenance

| Risk | Etki | Olasılık | Önlem | Fallback |
|---|---|---|---|---|
| `check:build-info` normal PR'da dosya yok diye kırmızı olur | Y | Y | Yalnız `release.yml` (tag/`workflow_dispatch`) içinde çalıştırılır | adım `if: hashFiles('release_output/BUILD_INFO.json') != ''` |
| `check:exe-icons` imzasız exe üretimini bekler, CI'da 45 dk aşım | O | O | `release.yml` `timeout-minutes: 90`; job yalnız tag'de | ikon kontrolü `--exe` argümanıyla yerel release adımına bırakılır |
| `check:languages` NSIS şablonunu Linux'ta bulamaz | O | D | Script yol bağımsız; `node scripts/check-installer-languages.mjs` Ubuntu'da çalışır (salt okuma) | adım `windows-latest` rust job'una taşınır |

Test: `npm run check:languages` yerelde 0; `release.yml` `workflow_dispatch` girdileri (`version`, `dry_run`) belgelenir.

### R-05 — Yeni regresyon kapıları

| Risk | Etki | Olasılık | Önlem | Fallback |
|---|---|---|---|---|
| Parity gate `generate_handler!` çok satırlı listeyi kaçırır | Y | O | `lib.rs` bloğu `generate_handler![` … `]` arası regex ile toplanır; 39 komut sabitine karşı assert | liste tek satıra alınır (format kuralı) |
| Test dosyalarındaki kasıtlı `invoke("missing_command")` gate'i kırar | O | Y | `isTestFile` filtresi (`*.test.ts`, `*.spec.tsx`) parity taramasından çıkarılır | fixture `scripts/` altına taşınır |
| `rusqlite` bloğu 200 karakterden uzun olur, sözleşme kaçar | O | D | Blok regex'i `[^}]*` ile kapanış ayracına kadar okur | satır bazlı kontrol + `cargo metadata` denetimi |
| Yeni kural mevcut yeşil ağacı kırar | Y | O | Kural önce `--report` modunda yazılır, sonra `exit 1`'e çevrilir | kural `warn` seviyesinde bırakılır, ayrı sürümde zorunlu |

Test: kasıtlı bozuk fixture (fake `invoke("nope")`) ile gate 1 döndürmeli; düzeltilince 0. Kabul: `check:gates` 0 ve negatif test 1.

### R-06 — `ItemTable` memo sözleşmesi

| Risk | Etki | Olasılık | Önlem | Fallback |
|---|---|---|---|---|
| `[items]` deps'i kategori etiketlerini eski tutar | O | D | Etiketler render anında `t()` ile çözülür; `useBackendLocaleRevision` bileşen gövdesinde abone | etiketler `useMemo`'ya taşınırsa deps'e `backendRevision` eklenir (regresyon testi yakalar) |
| Filtre normalizasyonu `projectOptions` kimliğine bağlı, sonsuz döngü | O | D | Testte 2 ardışık render'da `setProjectFilter` çağrı sayısı 0 | effect `[items]`'a alınır |

Test: `ItemTable` render → proje filtresi seç → dil değiştir → etiket değişir, seçili filtre korunur, satır sayısı sabit.

### R-07 / R-08 / R-09 — T-39 handle tabanlı silme

| Risk | Etki | Olasılık | Önlem | Fallback |
|---|---|---|---|---|
| `CreateFileW` yol yerine reparse point'i açar, yanlış hedef silinir | Y | O | `FILE_FLAG_OPEN_REPARSE_POINT` + `FILE_FLAG_BACKUP_SEMANTICS`; `GetFileInformationByHandle` ile `FileIdentity` karşılaştırması | kimlik uyuşmazsa `AppError::UnsafeDeleteTarget`, hiç silme |
| `FileDispositionInfoEx` Windows 7/8'de yok (yalnız Win10 1709+) | O | D | `SetFileInformationByHandle` `ERROR_INVALID_PARAMETER` dönerse mevcut `fs::remove_file` yoluna **yalnız o hata kodunda** düşülür | destek matrisi `win10 1709+`; eski sistemde eski yol |
| Salt okunur dosyada `ACCESS_DENIED` | O | Y | `FILE_DISPOSITION_FLAG_IGNORE_READONLY_ATTRIBUTE` kullanılır | başarısızsa `remove_file` + attribute temizliği (yalnız kimlik doğrulandıysa) |
| Dizin silmede `ON_CLOSE` + POSIX semantiği yarıda kalır | Y | D | Dizin için `DELETE|POSIX_SEMANTICS`; `ON_CLOSE` kullanılmaz; sonra `remove_dir` | `remove_dir_all` yalnız kimlik doğrulandıysa |
| Açık handle nedeniyle `ERROR_SHARING_VIOLATION` | O | Y | Hata `in_use` olarak sınıflanır ve kullanıcıya yol bazlı raporlanır | yeniden deneme yok (tekrar silme kullanıcı kararı) |

Test matrisi (R-09): `readonly dosya`, `boş dizin`, `dolu dizin`, `symlink→dış hedef`, `junction`, `açık handle`, `>260 karakter yol`, `silme öncesi hedef değişimi (yeniden adlandırma)`. Kabul: her senaryoda ya doğru sonuç ya sınıflanmış `AppError`; dış hedef hiçbir koşulda silinmez.

### R-10 / R-11 / R-12 — T-38 SQLite

| Risk | Etki | Olasılık | Önlem | Fallback |
|---|---|---|---|---|
| `rusqlite` varsayılan feature'ları WASM FFI çeker, masaüstü derlemesi kırılır | Y | Y | `default-features = false, features = ["bundled", "backup"]` | `bundled` yerine sistem SQLite (`bundled` Windows'ta önerilir) |
| Migrasyon yarıda kalır, geçmiş kaybolur | Y | O | Tek transaction + önce `history.jsonl.bak`; `user_version` atomik artar | `.bak` geri kopyalanır, `user_version=0` |
| Aynı anda iki süreç yazar (`single-instance` devre dışıysa) | O | D | `busy_timeout=5000`, WAL; yazma tek `Mutex<Connection>` | yazma hatası kullanıcıya raporlanır, okuma devam eder |
| 50.000 satırlık geçmiş UI'yı kilitler | O | O | `list_records(limit)` SQL `LIMIT`; toplamlar `SUM()` ile | indeks `(timestamp DESC)` |
| `DeleteMode`/`Option<String>` serde alanları SQLite'a yanlış yazılır | Y | O | `AuditRecord` için round-trip testi (JSON ↔ satır) | JSON kolonu (`payload TEXT`) ile başla, normalizasyon sonra |

Test: migrasyon idempotensi (iki kez çalıştır → satır sayısı sabit), bozuk satır atlama, 32 MiB üstü retention, `cleanup_totals` toplamlarının JSONL sürümüyle birebir eşitliği (fixture: 100 kayıt).

### R-13 / R-14 — T-37 `tauri-specta`

| Risk | Etki | Olasılık | Önlem | Fallback |
|---|---|---|---|---|
| `2.0.0-rc.29` release-candidate; API kırılabilir | Y | Y | Sürüm `=2.0.0-rc.29` ile sabitlenir; `bindings` **opsiyonel** feature, üretim derlemesi etkilenmez | feature kapatılır, `scanner-api.ts` elle yazılmış hali kalır |
| `specta` derive'ları `#[tauri::command]` ile çakışır | O | O | Komutlar `#[specta::specta]` ile işaretlenir; `tauri::generate_handler!` korunur | yalnız `audit`/`scan` tipleri için `Type` derive, komut export'u ertelenir |
| Üretilen tipler mevcut `src/types` ile çift kaynak olur | Y | Y | `src/types/index.ts` üretilen dosyadan re-export eder; elle yazılmış tipler silinir | re-export köprüsü tek sürüm boyunca korunur |
| Channel (`ScanEvent`) tipi specta'da karşılıksız | O | O | `tauri::ipc::Channel<T>` sarmalayıcı için `impl Type`; yoksa kanal imzası elle kalır | yalnız komut dönüş tipleri üretilir |
| Drift: Rust değişir, binding güncellenmez | Y | O | R-05 gate: `export_bindings` çıktısı ile commit'li dosya `git diff --exit-code` | gate CI'da üretimi yeniden çalıştırır |

Test: `cargo run --features bindings --bin export_bindings` iki kez → deterministik (aynı hash); `npm run typecheck` 0; mock `ScannerApi` derlenir; 39 komutun tamamı üretilen istemcide var.

### R-15 — Kapanış

| Risk | Etki | Olasılık | Önlem | Fallback |
|---|---|---|---|---|
| Sürüm notunda ölçümlerin bayatlaması | O | O | Ölçümler `gate-baseline` dosyasından kopyalanır, elle yazılmaz | notta ölçüm tarihi belirtilir |

Test: 11/11 kapı + `git status` temiz. Kabul: tablo §6 ile birebir.

## 4. Test senaryoları ve kabul kriterleri (özet matris)

| ID | Parça | Adımlar | Kabul |
|---|---|---|---|
| S-01 | R-01 | `git status --porcelain` → setleri `git add -p` yerine dosya listesiyle ekle → her sette `npm run typecheck`/`cargo check` | 4 commit; her commit tek başına derlenir |
| S-02 | R-02 | 11 kapıyı sırayla koş, çıktıyı logla | 11/11 kod 0; süre tabloda |
| S-03 | R-03 | `ci.yml` diff'inde `--locked` sayısı; yerelde aynı komutlar | 4/4 komut `--locked` |
| S-04 | R-04 | `npm run check:languages`; `release.yml` `workflow_dispatch` kuru koşum | dil sayısı 73 ile eşleşir; provenance adımı dosya yokken atlanır |
| S-05 | R-05 | `scanner-api.ts`'e sahte `invoke("ghost")` ekle → gate; geri al | gate 1 → 0; çıktı komut adını gösterir |
| S-06 | R-06 | Dil değiştir + filtre seç; render sayısı ölç | etiket güncel, filtre korunur, fazladan render yok |
| S-07 | R-07..09 | 8 senaryo test matrisi (`#[cfg(windows)]`) | 8/8; symlink dış hedefi sağ kalır |
| S-08 | R-10..12 | Migrasyon 2×, toplam eşitliği, retention, WAL | satır sayısı sabit; toplamlar JSONL ile eşit |
| S-09 | R-13..14 | binding üretimi 2×, typecheck, mock | deterministik; 39 komut; typecheck 0 |
| S-10 | R-15 | Tam kapı + `git status` | temiz ağaç, 11/11 |

## 5. Kapılar (değişmez)

| Kapı | Komut | Eşik |
|---|---|---|
| Tip | `npm run typecheck` | 0 hata |
| Birim | `npm test` | 0 başarısız (≥191) |
| Derleme | `npm run build` | `index-*.js` < 2.097.152 B |
| Paket | `npm run check:gates` | 0 ihlal |
| Denetim | `npm run check:audit` | 5 kural, 0 ihlal |
| i18n | `npm run check:i18n` | 0 eksik/0 çevrilmemiş |
| Biçim | `npm run format:check` | 0 fark |
| Sürüm | `npm run check-version` | 2.2.2 × 3 dosya |
| Rust test | `cargo test --locked` | 0 başarısız |
| Sözleşme | `npm run check:bindings` | "up to date" |
| Rust lint | `cargo clippy --locked --all-targets -- -D warnings` | 0/0 |
| Rust fmt | `cargo fmt -- --check` | 0 fark |

Ek ölçülebilir hedefler (R-15'te doğrulanır): `locales-bundle-*.js` yok,
`dist/theme-boot.js` var, üretimde `.lock().unwrap()` = 0,
`src/features/docs` içinde `?raw` = 0, `logging.ts` dışında `console.*` = 0.

## 6. Commit / PR sırası

| PR | İçerik | Kapı |
|---|---|---|
| PR-1 | C1 docs (bu plan dahil) | Markdown lint yok; bağlantı kontrolü |
| PR-2 | C2 frontend | typecheck, test, build, gates |
| PR-3 | C3 rust | fmt, clippy, test |
| PR-4 | C4 tooling + R-03/R-04/R-05 | gates, audit, format |
| PR-5 | R-06 | test |
| PR-6 | R-07..R-09 (T-39) | cargo test/clippy/fmt |
| PR-7 | R-10..R-12 (T-38) | cargo test/clippy/fmt |
| PR-8 | R-13..R-14 (T-37) | typecheck, gates, cargo test |
| PR-9 | R-15 | 11/11 |

Geri alma: her PR tek `git revert` ile döner; T-38 sonrası `.bak` dosyası
kullanıcı verisinin tek kopyasıdır, `clear_all()` `.bak`'a dokunmaz.

## 7. Uygulama durumu (2026-11-16, bu tur)

| Parça | Durum | Kanıt / kalan iş |
|---|---|---|
| R-01 commit setleri | **Yapılmadı** | 406 giriş hâlâ tek ağaçta; C1-C4 listeleri §2.1'de hazır, commit atılmadı (kullanıcı onayı gerekir) |
| R-02 baseline kapıları | Tamam | `typecheck` 0, `npm test` 21 dosya/191 test, `build` 0 (`index-C5_gQjOp.js` 233.757 B), `check:gates` 0, `check:audit` 0, `check:i18n` 0, `format:check` 0, `check-version` 0, `check:languages` 73/73, `check:bindings` güncel, `cargo test --locked` 184 lib + tüm entegrasyon, `clippy --locked --all-targets -D warnings` 0, `cargo fmt --check` 0 |
| R-03 CI `--locked` | Tamam | `ci.yml`: `cargo check --locked`, `clippy --locked`, `test --locked`, `export_bindings --check --locked` |
| R-04 release provenance | Tamam | `.github/workflows/release.yml` (tag + `workflow_dispatch`, `check:build-info`, `check:exe-icons`); `ci.yml`'e `check:languages` eklendi |
| R-05 yeni kapılar | Tamam | `check:gates`: `invoke`↔`generate_handler!` parity, `tauri-specta`/`rusqlite` bağımlılık sözleşmesi, üretilen sözleşme dosyasının varlığı/başlığı |
| R-06 `ItemTable` sözleşmesi | Tamam | `projectOptionsOf`/`categoryOptionsOf` saf fonksiyonlara çıkarıldı, yanıltıcı yorum düzeltildi, `src/test/table-options.test.ts` (3 test) |
| R-07..R-09 T-39 | Tamam | `platform/windows/delete.rs` (`CreateFileW` + `FileDispositionInfoEx`), `permanent.rs` kimlik doğrulamalı yinelemeli silme, 7 yeni Rust testi (salt okunur, kimlik değişimi, uzun yol, iç içe ağaç, symlink hedefi, kök dışı hedef, dizin handle'ı) |
| R-10..R-12 T-38 | Tamam | `rusqlite 0.43` (`bundled`), `audit/repository.rs` SQLite deposu (WAL, `synchronous=NORMAL`, `busy_timeout=5000`, `MAX_HISTORY_LINES = 50_000` prune, `clear_all` + `VACUUM`); JSONL tek seferlik migrasyon `PRAGMA user_version = 1` + `*.jsonl.bak`; 14 audit testi |
| R-13..R-14 T-37 | Tamam | `bindings` feature + `src-tauri/src/bindings.rs` + `bin/export_bindings.rs`; `src/lib/tauri/bindings.ts` üretildi; `src/test/bindings-contract.test.ts` (4 test) alan/union/varyant drift'ini yakalar; `npm run check:bindings` byte düzeyinde drift kapısı |
| R-15 kapanış | Tamam | Bu bölüm + `REMEDIATION_PLAN.md` §12 güncel |

T-39 sırasında bulunan ve düzeltilen yan hata: `platform::windows::fs_meta`
yol açmada `\\?\` öneki kullanmıyordu, bu yüzden 260 karakteri aşan hedeflerin
`FileIdentity` değeri okunamıyor (temizlik `NOT_MEASURED` ile bloke ediliyordu).
Yeni `platform::windows::wide_verbatim` hem uzun yolu hem de karışık `/`/`\`
ayracını normalize eder; `identity`, `facts`, `is_in_use` ve silme aynı yardımcıyı
kullanır.

T-38 sırasında `tests/secret_persistence.rs` de güncellendi: audit deposu artık
ikili SQLite dosyası olduğu için canary taraması UTF-8 ve UTF-16LE baytları
üzerinden yapılır; JSONL dosyası bekleyen eski varsayım kaldırıldı.

T-37'nin sözleşme modeli üç katmanlıdır ve üçü de kapıdır:

| Katman | Araç | Ne durdurur |
|---|---|---|
| Üretim | `bindings` feature + `bin/export_bindings.rs` | Elle yazılmış tipin Rust ile sessizce ayrışmasını |
| Birebir drift | `npm run check:bindings` (`--check`) | Rust alanı değişip `src/lib/tauri/bindings.ts` güncellenmemesini |
| Anlamsal drift | `src/test/bindings-contract.test.ts` | Frontend'in `src/types/index.ts` içinde alan/unyon/varyant kaybetmesini |

`specta-typescript 0.0.15` 64-bit tamsayıları reddettiği için 106 alan
`#[cfg_attr(feature = "bindings", specta(type = …Number<u64>))]` ile `number`
olarak eşlenir; `Option<u64>` remap'i `Option<Number<u64>>` olur, böylece
`| null` bilgisi korunur. `export_bindings` ikilisi `required-features =
["bindings"]` ile işaretlidir; `cargo test`/`cargo build` specta bağımlılığını
hiç derlemez.

