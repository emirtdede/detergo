# Dev Cleaner — 2026-11-14 Uç Kullanıcı Bulgularının Kalıcı Düzeltme Planı

Kaynak: 2026-11-14 tarihli tam kod denetimi (11 bulgu: 1 Yüksek, 9 Orta/Düşük).
Kural: Geçici gizleme veya yalnızca UI yaması yok; her bulgu kök nedeninde
kapatılacak ve mümkün olan her madde regresyon testiyle kilitlenecek.

## A. Araştırma özeti

| Konu | İncelenen kaynak | Uygulanacak ders |
|---|---|---|
| Dinamik satır yüksekliği | TanStack Virtual resmî API dokümanı (`Virtualizer`, `measureElement`) — https://tanstack.com/virtual/latest/docs/api/virtualizer | Sanal listede sabit `height` + tahmini `estimateSize` yeterli değil. Her satıra `data-index` ve `ref={virtualizer.measureElement}` bağlanmalı; satır CSS'i `min-height` kullanmalı. Tahmin, dinamik ölçümde üst sınır olarak kalmalı. |
| Tauri olay sözleşmesi | Tauri v2 "Calling the Frontend from Rust" — https://v2.tauri.app/develop/calling-frontend/ | Kanal mesajları `serde` etiketli enum ile serileşir; frontend birebir aynı `type` alanını bekler. Kısmi tarama için ayrı `partial` olayı eklemek, `cancelled` olayını kötüye kullanmaktan daha doğrudur. |
| Geri Dönüşüm Kutusu semantiği | Microsoft Learn `IFileOperation::SetOperationFlags` / `FOFX_RECYCLEONDELETE` — https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ifileoperation-setoperationflags | Geri dönüşümüne gönderme kalıcı silme değildir; `moved` ile `reclaimed` ayrı raporlanmalı, "geri kazanılan alan" ancak kalıcı silmede gösterilmeli. |
| Windows yol güvenliği | Proje içi `normalize_key` + bileşen bazlı `is_within`; Microsoft yol biçimleri | Derinlik sayısı tek başına güvenlik ölçütü değildir. Sürücü kökü, sistem dizinleri, kullanıcı profili ve doğrudan `Users` altı korunmalı; `D:\node_modules` gibi meşru hedefler engellenmemeli. |
| Zustand kısmi güncelleme | Zustand `set` birleştirme davranışı; proje içi `loadPreferences` | Sunucudan dönen tam ayar nesnesiyle tüm state'i ezmek, bekleyen kullanıcı düzenlemelerini kaybettirir. Sağlayıcı işlemleri yalnızca sağlayıcı dilimini birleştirmeli. |

## B. Bulgu → kalıcı düzeltme

| # | Önem | Bulgu | Dosya | Kalıcı düzeltme | Regresyon kanıtı |
|---|---|---|---|---|---|
| F1 | Yüksek | Zaman aşımı/aday limiti "completed" görünüyor | `scanner/mod.rs`, `scanner/models.rs`, `types/index.ts`, `useScanController.ts`, `scan-store.ts` | `ScanEvent::Partial` eklenir; terminal olay `stopReason == cancelled` → `Cancelled`, `summary.partial` → `Partial`, aksi halde `Completed` olur. Frontend `partial` olayını `partialScanState` ile işler; `completeScan` de savunmacı olarak `summary.partial` görürse `partial` yazar. | Rust `terminal_event` birim testi (timeout, aday limiti, derinlik, iptal); frontend `completeScan` testi. |
| F2 | Orta | Sanal tablo satırları üst üste biniyor | `ItemTable.tsx`, `items.css` | `data-index` + `ref={rowVirtualizer.measureElement}`; sabit `height: 56px` yerine `min-height: 56px`. | Kod doğrulaması + typecheck; satır ölçümü ResizeObserver ile dinamik. |
| F3 | Orta | `D:\node_modules` path guard tarafından reddediliyor | `safety/path_guard.rs` | Keyfi `< 3` derinlik kuralı kaldırılır. Sürücü kökü, sistem dizinleri, `Users` doğrudan çocuğu, profil kökü ve profil doğrudan çocukları korunmaya devam eder. | `shallow_ordinary_path_is_allowed`, `drive_root_child_node_modules_is_allowed`, `users_root_child_is_blocked` testleri. |
| F4 | Orta | "Toplam temizlenen" değeri geri dönüşüm taşımalarını geri kazanılmış gibi sunuyor | `OverviewView.tsx`, `HistoryView.tsx`, yeni `cleanup-totals` yardımcısı | `moved` ve `reclaimed` ayrı tutulur. "Toplam temizlenen" = taşınan (yoksa eski kayıtlar için kalıcı); kalıcı kazanım ayrıca alt bilgi/ipucu olarak gösterilir. `Math.max` kaldırılır. | `lifetimeCleanedBytes` birim testi: yalnızca geri dönüşümde taşınan, yalnızca kalıcıda kalıcı; ikisinde taşınan. |
| F5 | Orta | Min-size altı engelli öğeler tablodan tamamen gizleniyor | `ItemTable.tsx` | Frontend `minSizeBytes` filtresi kaldırılır; backend'in `BLOCKED` + `BELOW_MIN_SIZE` işaretlediği satırlar tabloda soluk/engelli olarak görünür. | Kod doğrulaması; `filtered` yalnızca arama/güvenlik/proje/kategori filtrelerini uygular. |
| F6 | Orta | Önizleme etkisi ve ölçüm hatası çevrilmiyor | `official_actions.rs`, `types/index.ts`, `CachesView.tsx`, mock | Backend önizlemeye `measurementTruncated` bayrağı ekler. UI, `preview.warning` ham metni yerine sağlayıcı/aksiyon bilgisinden `localizeActionDescription` ile etki metnini kurar; kesik ölçümü `notMeasured` ile belirtir. `measureError` zaten `describeError` ile yerelleştirilir, başlıkla birlikte gösterilir. | `preview` tipi + typecheck; i18n kapısı. |
| F7 | Orta | `loadPreferences` bekleyen düzenlemeleri eziyor | `preferences-store.ts`, `AgentsView.tsx` | Yeni `applyProviderSettings(settings)` yalnızca `customAgentProviders` ve `hiddenBuiltinProviders` alanlarını günceller; AgentsView sağlayıcı ekleme/çıkarma/gizleme sonrası bunu kullanır. | Store testi: ilgisiz kirli alan korunur, sağlayıcı listesi güncellenir. |
| F8 | Düşük/Orta | Konum değişimi kalıcı snapshot'ı siliyor | `ScanHeader.tsx` | `applyLocation` yalnızca oturum state'ini sıfırlar (`resetScan()`); kalıcı "son tarama" snapshot'ı kullanıcı açıkça sıfırlamadıkça korunur. Diyalog metni artık gerçek davranışla uyumludur ("yalnızca bellekteki görünüm"). | Kod doğrulaması; `resetScan` çağrısında `clearPersisted` yok. |
| F9 | Düşük | Dağılım çubuğu %100'ü aşabiliyor | `OverviewView.tsx`, yeni `distribution.ts` | Her segmente minimum %2 verildikten sonra toplam normalize edilir; genişlikler toplamı tam %100 olur. | `normalizeDistributionWidths` birim testi. |
| F10 | Düşük | Ajan taraması `excludedNames` ayarını yok sayıyor | `providers/mod.rs`, `scanner/mod.rs` | `scan_agents` dışlama listesini alır; ajan hedefleri ve kullanıcı tanımlı kökler, yol bileşeni dışlama adıyla eşleşiyorsa atlanır. | Rust birim testi: dışlanan bileşenli hedef üretilmez. |
| F11 | Düşük | `recently_modified` 200 girdide kesiliyor | `providers/root_locator.rs` | Sabit 200 girdi sınırı kaldırılır; `max_depth(3)` yürüyüşü tamamlanır, böylece 200'den sonraki güncel dosya da bulunur. | Rust testi: 250 eski dosya + sonradan güncellenen dosya `true` döner. |

## C. Uygulama sırası

1. Backend olay modeli (F1) ve frontend olay eşlemesi.
2. Path guard (F3), ajan dışlamaları (F10), `recently_modified` (F11).
3. Frontend tablo (F2, F5), KPI/dağılım (F4, F9), önizleme (F6).
4. Ayar birleştirme (F7) ve konum davranışı (F8).
5. Regresyon testleri + tüm doğrulama kapıları.

## D. Doğrulama kapıları

1. `npm run typecheck` → 0 hata.
2. `npm test` → mevcut testler + yeni regresyon testleri yeşil.
3. `cargo test --manifest-path src-tauri/Cargo.toml` → tüm birim/entegrasyon testleri yeşil.
4. `npm run check:i18n` → anahtar kaybı yok.
5. `npm run check:audit` → denetim invariant'ları.
6. `npm run build` → üretim derlemesi başarılı.
7. Her bulgu için kodda düzeltmenin varlığı `grep` ile doğrulanır.

## E. Uygulama sonucu ve doğrulama (2026-11-14)

Tüm bulgular (F1–F11) kök nedeninde kapatıldı ve plan tamamlandıktan sonra
doğrulama kapıları yeniden çalıştırıldı.

### Eklenen / güncellenen regresyon testleri

- Rust: `scanner::tests::terminal_event_distinguishes_partial_from_cancelled_and_completed` (F1)
- Rust: `safety::path_guard::tests::{shallow_ordinary_path_is_allowed, drive_root_child_node_modules_is_allowed, users_root_child_is_blocked, drive_root_recycle_bin_child_is_blocked}` (F3)
- Rust: `providers::tests::{agent_exclusion_matches_relative_components_only, custom_root_exclusion_ignores_drive_prefix}` (F10)
- Rust: `providers::tests::{recently_modified_finds_file_after_two_hundred_entries, recently_modified_returns_false_for_an_old_tree}` (F11)
- Frontend: `src/test/fixes.test.ts` — `completeScan` kısmi özet yönlendirmesi (F1) ve `applyProviderSettings` dilim birleştirme (F7)
- Frontend: `src/test/cleanup-totals.test.ts` — `lifetimeCleanedBytes` (F4) ve `normalizeDistributionWidths` (F9)

### Kapı sonuçları

| Kapı | Sonuç |
|---|---|
| `npm run typecheck` | Temiz (0 hata) |
| `npm test` | 15 dosya, 153 test geçti |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 148 birim testi + tüm entegrasyon testleri geçti |
| `npm run check:i18n` | 98.858 string / 502 dosya temiz, kapsama ve çevrilmemiş denetimleri geçti |
| `npm run check:audit` | 5 kural, ihlal yok |
| `npm run build` | Üretim derlemesi başarılı |

Not: Rust araç zinciri kabuk PATH'inde değildi; testler
`C:\Program Files\Rust stable MSVC 1.100\bin` yolu eklenerek çalıştırıldı.
F11 regresyon testi için `filetime` yalnızca `dev-dependencies` altına eklendi.

