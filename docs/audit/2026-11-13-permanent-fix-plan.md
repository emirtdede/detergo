# Node Cleaner — Kalıcı Düzeltme Planı (2026-11-13)

Bu plan, 2026-11-12 tarihli uç-kullanıcı denetim raporundaki 24 bulgunun tamamını
kapatır. Her madde: kök neden → uygulanacak değişiklik → doğrulama.

Kurallar:

- Davranış değişiklikleri geriye dönük uyumlu olacak (snapshot/ayar şemaları
  `serde(default)` ile okunur, şema sürümü gereksiz yere artırılmayacak).
- Yeni çeviri anahtarı eklenmeyecek; mevcut `ui.*` anahtarları kullanılacak
  (73 dil kapsama kapısı bozulmayacak).
- Her düzeltme için birim testi eklenecek veya mevcut test güncellenecek.
- Doğrulama: `npm run typecheck`, `npm test`, `cargo test`, `npm run build`.

## A. Frontend — durum ve yarış koşulları

| # | Bulgu | Dosya | Düzeltme |
|---|-------|-------|----------|
| 1 | Plan diyaloğu dil/`pendingIds` değişiminde sıfırlanıyor | `src/features/cleanup/CleanupPlanDialog.tsx` | Yükleme efektinin bağımlılığı `load` yerine kararlı bir anahtar (`scanId` + sıralı id listesi + mod) olacak; `load` bir ref üzerinden çağrılacak. Dil değişimi planı yeniden çekmeyecek. |
| 2 | Webhook URL'si her tuş vuruşunda kaydediliyor | `src/features/settings/SettingsView.tsx` | Yerel `webhookDraft` state; kaydetme `onBlur`/Enter'da. `http`/`https` + host doğrulaması; geçersizse kaydetme ve `ui.settings.webhookUrlEmpty` uyarısı. |
| 7 | Açılışta `lastScanPath` ile snapshot geri yükleme yarışı | `src/app/App.tsx` | İki efekt tek sıralı boot efektine birleştirilecek: önce ayarlar, sonra son tarama. Snapshot varsa geri yükleme kazanır; yoksa `lastScanPath` yazılır. |
| 8 | Agents taramasında `currentRootPath` alakasız proje yolu | `src/features/scan/useScanController.ts` | Kök yalnızca `project` kapsamı için çözülecek; `agents`/`allDrives` için boş. |
| 13 | `cancelScan` bayat `isScanning` kapatması | `src/features/scan/useScanController.ts` | Durum çağrı anında store'dan okunacak. |
| 14 | Yeniden tarama kapsamı görünümle uyuşmuyor | `src/features/results/SelectionActionBar.tsx` | `StaleScanBanner` ile aynı kural: agents görünümünde `agents`, aksi halde store kapsamı. |

## B. Frontend — seçim ve sayı tutarlılığı

| # | Bulgu | Dosya | Düzeltme |
|---|-------|-------|----------|
| 3 | Hayalet seçimler toplama/plana sızıyor, `prune` çağrılmıyor | `src/features/results/SelectionActionBar.tsx`, `src/stores/scan-store.ts`, `src/stores/selection-store.ts` | Aksiyon çubuğu yalnızca var olan + seçilebilir + silinmemiş id'leri kullanacak. Tarama store'u, öğe kümesini değiştiren her mutasyondan sonra `prune` çağıracak. |
| 4 | Tablo mantıksal, aksiyon çubuğu geri kazanılabilir boyut gösteriyor | `src/features/items/ItemTable.tsx` | Tablo sütunu `estimatedReclaimBytes` gösterecek; başlık `ui.table.reclaim`, ipucu `ui.table.reclaimHint`. Sıralama da aynı alana geçecek. |
| 25 | "Filtreleri temizle" `minSizeBytes`'i sıfırlamıyor | `src/features/items/ItemTable.tsx` | Temizleme `minSizeBytes`'i 0 yapıp kalıcılaştıracak; boş durum koşulu bu filtreyi de kapsayacak. |
| 10 | Zaman aşımında ölçülmemiş satırlar seçilebilir görünüyor | `src/features/items/ItemTable.tsx`, `src/features/results/SelectionActionBar.tsx` | `logicalBytes === null` olan satırlar seçilemez; "Ölçülmedi" durumu gösterilir. Toplu seçim ve plan listesi de bunları dışlar. |

## C. Frontend — gizlilik

| # | Bulgu | Dosya | Düzeltme |
|---|-------|-------|----------|
| 5 | `maskPaths` açıkken `title` ipuçları ham yolu sızdırıyor | `src/features/items/ItemTable.tsx`, `src/features/overview/OverviewView.tsx`, `src/features/history/HistoryView.tsx` | Tüm `title` değerleri `maskPaths` ise maskeli yolu kullanacak. |

## D. Frontend — kalıcılık ve doğrulama

| # | Bulgu | Dosya | Düzeltme |
|---|-------|-------|----------|
| 11 | Geri yüklenen tarama uyarıları kayboluyor | `src/stores/scan-store.ts`, `src/types/index.ts`, `src-tauri/src/last_scan.rs` | Snapshot'a `warnings` alanı eklenecek (`serde(default)`, şema uyumlu). `toSnapshot` yazar, `restoreScan` okur. |
| 12 | İptalde önceki özet siliniyor | `src/stores/scan-store.ts` | `cancelScanState` özet yoksa mevcut özeti koruyacak. |
| 19 | Ayar birleştirme doğrulaması yok | `src/stores/preferences-store.ts` | Bildirim kanalları beyaz listeye, `webhookUrl` şema doğrulamasına, `webhookOn*` boolean'a, kısayollar string'e, `agentPolicy` boolean'lara normalize edilecek. |
| 18 | `min_size_bytes` üst sınırı yok | `src-tauri/src/settings/model.rs` | `0..=1 GiB` aralığına kenetlenecek. |
| 15/2 | Webhook URL'si backend'de de doğrulanmalı | `src-tauri/src/settings/model.rs` | `normalize` içinde yalnızca `http`/`https` + host kabul edilecek; geçersizse `None`. |

## E. Frontend — kullanıcıya görünür hatalar

| # | Bulgu | Dosya | Düzeltme |
|---|-------|-------|----------|
| 16 | Resmî komut hatasında önizleme diyaloğu boşalıyor | `src/features/caches/CachesView.tsx` | Hata durumunda `preview` korunacak; token tüketildiği için çalıştırma devre dışı bırakılacak, hata diyaloğun içinde görünür kalacak. |
| 2b | Kısayol kaydedici çeviri bağımlılıkları eksik | `src/features/settings/SettingsView.tsx` | Efekt bağımlılıklarına `ui` ve `shortcutDefs` eklenecek. |
| 6 | Salt-okunur cache'ler "ölçülmedi" kalıyor, sebep yok | `src-tauri/src/cleanup/official_actions.rs`, `src/types/index.ts`, `src/features/caches/CachesView.tsx` | `CachePathInfo.unmeasuredReason` eklenecek (`read_only`, `timeout`, `error`). UI sebebi mevcut `ui.caches.readOnly` / `ui.caches.notMeasured` metinleriyle gösterecek. |
| 24 | Bütçeyle kesilen ölçümde `delta_bytes` yanıltıcı | `src-tauri/src/cleanup/official_actions.rs` | Önizleme ve sonrası ölçümlerin kesilip kesilmediği kaydedilecek; kesildiyse sonuç notunda açıkça belirtilecek. |

## F. Backend — tarama doğruluğu

| # | Bulgu | Dosya | Düzeltme |
|---|-------|-------|----------|
| 9 | `GlobalCaches` sessizce boş sonuç döndürüyor | `src-tauri/src/scanner/mod.rs`, `src-tauri/src/cli/mod.rs`, `src-tauri/src/mcp/mod.rs` | Ölü dal kaldırılacak; kapsam açık bir "desteklenmiyor" hatası döndürecek. CLI/MCP eşlemesi aynı mesajı üretecek. |
| 21 | Sağlayıcı "kullanımda" durumu ilk köke göre önbellekleniyor | `src-tauri/src/providers/mod.rs` | Önbellek `(provider, path)` anahtarına geçecek. |
| 22 | Ölçülemeyen agent hedefleri 0 B ve seçilebilir | `src-tauri/src/providers/mod.rs` | Ölçüm yoksa `logical/allocated/estimated = None`, `selectable = false`, durum `blocked`. |
| 23 | `nearest_active` haritası budanmıyor | `src-tauri/src/scanner/discovery.rs` | DFS sırasında geçerli dizinin atası olmayan kayıtlar budanacak. |
| 17 | `consume_plan` oturumdan önce planı tüketiyor | `src-tauri/src/commands/deletion_commands.rs`, `src-tauri/src/scanner/session.rs` | Oturum önce doğrulanacak; plan ancak oturum geçerliyse tüketilecek (`peek_plan` + `consume_plan`). |

## G. Doğrulama matrisi

1. `npm run typecheck` — 0 hata.
2. `npm test` — mevcut 122 test + yeni regresyon testleri yeşil.
3. `cargo test --manifest-path src-tauri/Cargo.toml` — birim testleri yeşil.
4. `npm run check:i18n` — yeni anahtar eklenmediği için kapsama korunur.
5. `npm run build` — üretim derlemesi başarılı.
6. Kod içinde denetim raporundaki her bulgu için düzeltmenin varlığı `grep` ile doğrulanır.

## H. Uygulama ve doğrulama sonucu (2026-11-13)

Tüm maddeler uygulandı. Doğrulama kapıları:

| Kapı | Sonuç |
|------|-------|
| `npm run typecheck` | ✅ 0 hata |
| `npm test` | ✅ 14 dosya / **128 test** (6 yeni regresyon testi) |
| `cargo test --manifest-path src-tauri/Cargo.toml` | ✅ **131 test** + entegrasyon testleri (0 hata) |
| `npm run check:i18n` | ✅ 97.203 anahtar, eksik yok; 73 dil korunuyor |
| `npm run build` | ✅ `tsc && vite build` başarılı |

Eklenen regresyon testleri:

- `src/test/fixes.test.ts`: snapshot uyarı geri yükleme, özetsiz iptalde önceki
  özetin korunması, silinen hedefin seçimden budanması, ölçülmemiş satırın toplu
  seçim dışında kalması, webhook URL doğrulaması, bozuk ayarların normalizasyonu.
- `src-tauri/src/settings/tests.rs`: `min_size_bytes` üst sınırı, geçerli/geçersiz
  webhook URL'sinin kalıcılık sınırında doğrulanması.
- `src-tauri/src/cleanup/official_actions.rs`: `unmeasuredReason` alanının
  camelCase serileştirilmesi.

Not: `GlobalCaches` kapsamı CLI/MCP tarafında ayrıştırılmaya devam eder (eski
komut dosyaları kırılmasın) ancak tarayıcı artık sessiz boş sonuç yerine açık
`PlatformUnsupported` hatası döndürür.

