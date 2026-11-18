# Dev Cleaner / Node Cleaner — Kalıcı Düzeltme Planı (2026-11-13)

Kaynak: `docs/audit/2026-11-13-tam-kod-denetimi.md` (4 Yüksek, 10 Orta, 15 Düşük).
Kural: Geçici gizleme yok. Her bulgu kök nedeninde düzeltilecek; davranış değişiklikleri
regresyon testiyle kilitlenecek. Plan tamamlanana ve tüm kapılar yeşil olana kadar
çalışma durmayacak.

## Araştırma özeti (internet)

| Konu | Kaynak | Uygulanacak ders |
|---|---|---|
| Tauri v2 single-instance | `tauri-plugin-single-instance` v2 kaynak kodu (mutex + gizli mesaj penceresi) | Tek örnek kilidi süreç ölürken OS tarafından bırakılır. Canlı GUI — tepside gizli olsa bile — `{identifier}-sic` mesaj penceresine sahiptir. Bu yüzden "pencere yok"u süreç adıyla birleştirip `TerminateProcess` çağırmak yanlıştır; CLI/MCP süreçleri hiçbir zaman plugin'i başlatmaz. |
| Windows `IFileOperation` | Microsoft Learn `SetOperationFlags` / `IFileOperation` | `FOFX_RECYCLEONDELETE` geri dönüşümü garanti eder; `PerformOperations` dönüşü ile dosya sisteminin güncellenmesi arasında kısa bir gecikme olabilir. Doğrulama bütçesi büyük ağaçlar için 3 sn'ye çıkarılmalı, başarısız kilitli dosyalarda toplu bekleme yapılmamalı. |
| CLI/MCP tarama | Proje içi `run_scan` akışı + Tauri/Komut satırı iş parçacığı modeli | Tarama ve ölçüm tek yerde (`run_scan`) kalmalı. CLI/MCP senkron olduğu için `run_scan_blocking` yardımcısı ile aynı yol kullanılmalı; ayrı `DiscoveryEngine` çağrısı kopyalanmamalı. |
| Windows `cmd /C` | Microsoft `cmd.exe` quoting kuralları | Yol/argümanlar `raw_arg` ile açıkça tırnaklanmalı; `Program Files` gibi boşluklu yollar aksi halde komutu böler. |
| Explorer `/select` | `explorer.exe` komut satırı ayrıştırması | Virgül içeren yollar `/select,"<path>"` biçiminde tek tırnaklı argüman olarak geçirilmeli; `Command::arg` otomatik tırnaklaması bu sözdizimine uymaz. |

## A. Yüksek önem

| # | Dosya | Kalıcı düzeltme | Regresyon kanıtı |
|---|---|---|---|
| H1 | `src-tauri/src/main.rs`, `platform/windows/instance_guard.rs`, `platform/mod.rs` | `preflight_cleanup_zombies()` çağrısı ve süreç öldüren fonksiyon tamamen kaldırılır. CLI/MCP yolu hiçbir süreci öldürmez. Tek örnek davranışı `tauri-plugin-single-instance`'a bırakılır; tepsideki GUI `show_main_window` ile öne gelir. | Kod aramasında `TerminateProcess`/`preflight_cleanup_zombies` kalmaz; `cargo test` + manuel CLI/GUI senaryosu. |
| H2 | `src-tauri/src/mcp/mod.rs` | `devcleaner_clean_cache` yalnızca `allow_destructive` iken listelenir; çalıştırma için `confirm:true` + `--allow-destructive` + `settings.mcp_allow_destructive` zorunlu. Aksi halde hiçbir preview/execute yapılmaz. | MCP birim testleri: bayraksız liste, onaysız çağrı, ayar kapalıyken engel. |
| H3 | `scanner/mod.rs`, `cli/mod.rs`, `mcp/mod.rs` | `run_scan_blocking(request, catalog, settings, policy)` eklenir; CLI `scan` ve MCP `scan_workspace`/preview bu yolu kullanır. `scope` uygulanır; `GlobalCaches` açık hata verir. MCP çıktısında ölçülmemiş hedef `null`/`measured:false` olarak gösterilir, `0 B` denmez. | CLI `--min-size`/`--auto-clean` entegrasyon testi; MCP `scan_workspace` boyut testi; `scope=agents` testi. |
| H4 | `safety/path_guard.rs` (+ `providers/mod.rs`) | `validate_protected_paths` içine `is_within(&protected_key, key)` ters yön kontrolü eklenir. Tarama tarafında da hedefin altındaki korumalı yol `protected` sayılır. | Birim testi: korumalı alt klasör içeren hedef reddedilir. |

## B. Orta önem

| # | Dosya | Kalıcı düzeltme | Regresyon kanıtı |
|---|---|---|---|
| M1 | `scanner/mod.rs`, `providers/mod.rs` | Ölçüm sonrası `limits.min_size_bytes` altındaki proje hedefleri `BELOW_MIN_SIZE` uyarısıyla `blocked` + `selectable=false` yapılır. Böylece tablo, Overview ve sağlayıcı toplamları aynı kümeyi sayar. | `below_min_size_is_blocked` birim testi. |
| M2 | `features/agents/AgentsView.tsx` | Kart istatistiği `protected \|\| safetyClass === "keep" \|\| !selectable` kuralını kullanır. | Frontend testi (kart toplamı = üst toplam). |
| M3 | `features/docs/DocsView.tsx` | `DocsContentTr` import edilir; `isTr` iken Türkçe gövde, değilse İngilizce gövde + İngilizce uyarısı gösterilir. | Typecheck + görünür akış testi. |
| M4 | `stores/scan-store.ts` | `resetScan` `previousSummary/previousCleanableBytes/previousItemCount` alanlarını sıfırlar. | Store birim testi. |
| M5 | `cli/mod.rs` | `run_caches_cli` başarı bilgisi döndürür; `handle_cli` 0/2 üretir. `run_scan_cli` temizlik hatalarında `RecycleBinFailed` döndürür (exit 2). | CLI exit-code testi. |
| M6 | `mcp/mod.rs`, `cli/mod.rs` | Recycle modunda `moved_bytes` raporlanır; `reclaimed_bytes` yalnızca kalıcı silmede dolar. MCP/CLI çıktılarına `moved_bytes`/`moved_human` eklenir. | MCP/CLI çıktı testi. |
| M7 | `scanner/mod.rs` + `stores/scan-store.ts` | Hata durumunda `logical/allocated/estimated` `None` bırakılır (0 yazılmaz); UI `applyUpdate` hata durumunda `null` kullanır. | Rust + frontend testi. |
| M8 | `cleanup/recycle_bin.rs` | Doğrulama bütçesi 20×50 ms → 60×50 ms (3 sn). | Birim testi/belge. |
| M9 | `cleanup/official_actions.rs` | Sürüm sorguları paralel ve toplam 2 sn bütçeli çalışır; her komut 1,5 sn timeout. `list_cache_providers` artık sağlayıcı sayısı kadar sıralı beklemez. | `probe_versions_is_bounded` testi. |
| M10 | `cli/mod.rs` (H3 ile) | `--scope caches` `run_scan` üzerinden `PlatformUnsupported` alır; CLI açık hata + exit 1 döndürür, "0 target" demez. | CLI testi. |

## C. Düşük önem

| # | Dosya | Kalıcı düzeltme |
|---|---|---|
| L1 | `stores/cache-store.ts` | Metadata birleşiminde `totalBytes` yalnızca var olan yolların ölçümlerinden yeniden hesaplanır; `startMeasure` süren ölçümü iptal edip yeniden başlatır (sessiz atlama yok). |
| L2 | `stores/scan-store.ts`, `OverviewView.tsx` | `clearPersistedLastScan` sonrası `persistedRevision` artırılır; Overview bu revizyonu izleyip `hasLastSnapshot`'ı yeniler. |
| L3 | `components/primitives/Checkbox.tsx` | `ref` ile `input.indeterminate` ve `aria-checked="mixed"` uygulanır. |
| L4 | `components/primitives/NumberField.tsx` | `aria-valuenow` boş/geçersiz taslakta `value`, geçerli taslakta sayısal değeri kullanır (0 dahil). |
| L5 | `commands/webhook_commands.rs` | Bilinmeyen olay `false` (fail-closed) olur; `scan`/`clean` ve geriye dönük `scan_completed`/`cleanup_completed` adları eşlenir. |
| L6 | `cli/mod.rs` | `caches --clean` `--dry-run` destekler; `all` için `--yes` zorunludur, aksi halde hiçbir şey silinmez ve exit 3 döner. |
| L7 | `cli/mod.rs` | CLI webhook olay adları `scan`/`clean` olur (backend ile aynı). |
| L8 | `commands/history_commands.rs` | `clear_cleanup_history` yalnızca temizlik kayıtlarını siler (`clear_cleanups`). |
| L9 | `commands/scan_commands.rs` | Explorer `/select,"<path>"` `raw_arg` ile geçirilir. |
| L10 | `mcp/mod.rs` | `scans` haritası TTL ile budanır; geçersiz `scan_id` sessizce yeniden taranmaz, açık hata döner. |
| L11 | `scanner/mod.rs` | Snapshot yazım hatası `HISTORY_WRITE_FAILED` uyarısı olarak yayınlanır. |
| L12 | `stores/preferences-store.ts` | Geçersiz kayıtlı webhook yüklenirken `ui.settings.webhookUrlEmpty` uyarısı gösterilir; değer yine kalıcılaştırılmaz. |
| L13 | `commands/settings_commands.rs`, `src/lib/tauri/scanner-api.ts` | `save_app_settings` normalize edilmiş `AppSettings` döndürür; TS imzası `Promise<AppSettings>` olur. |
| L14 | `cleanup/official_actions.rs` | `.cmd/.bat` çağrısı `raw_arg` ile tırnaklanmış exe + argümanlar kullanır. |
| L15 | `release_output/` | Kod düzeltmesi değil; düzeltmeler sonrası yeni sürüm artefaktının yeniden üretilmesi gerektiği rapora ve kullanıcıya bildirilir. |

## D. Doğrulama kapıları (her turda)

1. `npm run typecheck` → 0 hata.
2. `npm test` → tüm testler + yeni regresyon testleri.
3. `cargo test --manifest-path src-tauri/Cargo.toml` → tüm birim + entegrasyon testleri.
4. `npm run check:i18n` → anahtar kaybı yok.
5. `npm run check:audit` → denetim invariant'ları.
6. `npm run build` → üretim derlemesi.
7. Kod araması: her bulgu için düzeltmenin varlığı (H1 öldürme kodu yok, H2 kapılar var, H3 ortak tarama yolu, H4 ters yön, ...).

## E. Uygulama sonucu ve doğrulama (2026-11-13)

Planın 29 maddesinin tamamı uygulandı. Aşağıdaki kapılar yeşil geçti:

| Kapı | Sonuç |
|---|---|
| `npm run typecheck` | 0 hata |
| `npm test` | 14 dosya, **142 test** geçti (3 yeni regresyon testi) |
| `cargo test --manifest-path src-tauri/Cargo.toml` | **140 birim** + 8 MCP entegrasyon testi geçti |
| `npm run check:i18n` | 98.858 string / 502 dosya temiz |
| `npm run check:audit` | 5 kural, ihlal yok |
| `npm run check:contrast` | 4 tema, tüm eşikler geçti |
| `npm run build` | Üretim derlemesi başarılı |

### Bulgu → kanıt eşlemesi

| # | Kodda doğrulanan sonuç |
|---|---|
| H1 | `src-tauri/src` içinde `TerminateProcess`, `preflight_cleanup_zombies` ve `process_has_window` **hiç yok**; `main.rs` yalnızca panic hook + CLI/GUI dağıtımı yapıyor. |
| H2 | `devcleaner_clean_cache` yalnızca `allow_destructive` iken araç listesinde; çalıştırma `confirm:true` + bayrak + `settings.mcp_allow_destructive` üçlüsünü istiyor. Test: `clean_cache_requires_confirm_and_flag`, `clean_cache_requires_destructive_flag_before_provider_lookup`. |
| H3 | Tek tarama yolu `scanner::run_scan_blocking`; CLI `scan` ve MCP `scan_workspace`/preview bunu kullanıyor. Ölçülmemiş hedef `bytes: null`, `measured: false` dönüyor. |
| H4 | `path_guard.rs:232` ve `providers/mod.rs` her iki yönü de kontrol ediyor. Testler: `protected_descendant_blocks_parent_deletion`, `sibling_protected_path_does_not_block`. |
| M1 | `scanner/mod.rs` ölçüm sonrası eşik altı projeleri `BELOW_MIN_SIZE` ile blokluyor. |
| M2 | `AgentsView.tsx:196` kart kuralı `protected \|\| keep \|\| !selectable`. |
| M3 | `DocsView.tsx` `DocsContentTr` bileşenini Türkçe seçiliyken render ediyor; İngilizce uyarısı yalnızca diğer dillerde. |
| M4 | `resetScan` `previousSummary/previousCleanableBytes/previousItemCount` alanlarını sıfırlıyor; test `clears the previous-scan comparison on reset`. |
| M5 | `run_caches_cli` `Result` döndürüyor; `handle_cli` 2/3/4 üretiyor; `run_scan_cli` kısmi temizlikte `RecycleBinFailed` (exit 2). |
| M6 | CLI/MCP çıktısında `moved_bytes`/`moved_human`; Recycle modunda `cleaned_bytes = report.moved_bytes`. |
| M7 | Backend ölçüm hatasında `None` + `NOT_MEASURED`; `applyUpdate` hata durumunda `null`. Test: `keeps unreadable measurements null instead of zero`. |
| M8 | `recycle_bin.rs` doğrulama bütçesi 60 × 50 ms = 3 sn. |
| M9 | `probe_versions` tüm sürüm sorgularını paralel, toplam `VERSION_BUDGET` = 2 sn içinde yapıyor. |
| M10 | `--scope caches` artık `run_scan_blocking` üzerinden açık `PlatformUnsupported` hatası + exit 1; "0 target" denmiyor. |
| L1 | `cache-store` toplamı `cachePaths` üzerinden yeniden hesaplıyor ve süren ölçümü iptal edip yeniden başlatıyor. |
| L2 | `persistedRevision` senkron artıyor; `OverviewView` bunu izliyor. Test: `bumps the persisted revision when the snapshot is cleared`. |
| L3 | `Checkbox` `ref.indeterminate` + `aria-checked="mixed"`. |
| L4 | `ariaValueNow` 0 dahil geçerli taslağı okuyor. |
| L5 | Bilinmeyen webhook olayı fail-closed; `scan_completed`/`cleanup_completed` geriye dönük eşlendi. |
| L6 | `caches --clean all` için `--yes` (veya `--dry-run`) zorunlu; `allow_cache_cleanup` kapalıysa engelleniyor. |
| L7 | CLI webhook olayları `scan`/`clean`. |
| L8 | `clear_cleanup_history` → `clear_cleanups`. |
| L9 | Explorer `/select,"<path>"` `raw_arg` ile tek argüman. |
| L10 | `scans` TTL ile budanıyor; bilinmeyen `scan_id` `PlanInvalid` döndürüyor. |
| L11 | Snapshot yazım hatası `HISTORY_WRITE_FAILED` uyarısı. |
| L12 | Geçersiz kayıtlı webhook yüklenirken kullanıcıya uyarı gösteriliyor. |
| L13 | `save_app_settings` normalize edilmiş `AppSettings` döndürüyor; TS imzası `Promise<AppSettings>`. |
| L14 | `.cmd/.bat` çağrısı `quote_cmd_arg` + `raw_arg` ile tırnaklanıyor. |
| L15 | **Kod düzeltmesi değil:** `release_output/BUILD_INFO.json` hâlâ `239d168` / `dirty:false`. Bu düzeltmelerin paketlenmesi için yeni release derlemesi gerekir. |

> Not: `release_output/` altındaki mevcut artefaktlar bu turdaki düzeltmeleri
> **içermiyor**. Yeni sürüm yayınlanmadan önce paketleme hattının yeniden
> çalıştırılması şart.
