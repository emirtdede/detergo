# Node Cleaner — Uç Kullanıcı Bulgularının Kalıcı Düzeltme Planı

Tarih: 2026-11-13
Kaynak: `docs/audit/2026-11-13-audit-report.md` (4 orta + 8 düşük bulgu).
Kural: Geçici gizleme yok; her bulgu kök nedeniyle birlikte kapatılacak ve
mümkün olan her madde regresyon testiyle kilitlenecek.

## Araştırma özeti

| Konu | Kaynak | Uygulanacak ders |
|---|---|---|
| Tauri komutlarından normalize edilmiş değer döndürme | Tauri v2 "Calling Rust from the Frontend" | `save_app_settings` yalnızca `Ok(())` döndürüyor; backend'in kırptığı değerler istemciye geri akmıyor. İstemci tarafında da aynı sınırlar uygulanacak (tek doğruluk kaynağı backend kuralları). |
| Zustand asenkron yarışlar / bayat closure | Zustand #784, React `useEffect` yarış rehberleri | Async sonrası store güncellemeleri `getState()` ve istek nesli ile doğrulanacak; `loading` gibi bayraklar closure yerine ref/store üzerinden okunacak. |
| React efekt yarışları | React resmî `useEffect` dokümanı, AbortController/ignore flag desenleri | Önizleme ve liste yüklemelerinde her istek için nesil sayacı; geç gelen yanıt state'e yazılmayacak. |
| Windows yol güvenliği | Rust `canonicalize` + `\\?\` davranışı, Microsoft path formatları | `normalize_key` + `is_within` mevcut ve doğru; ek değişiklik gerekmiyor. `open_url` için protokol + host doğrulaması sıkılaştırılacak. |
| Kalıcılık ve kullanıcı beklentisi | Ürün içi tutarlılık kuralları | "Başarı" bildirimi ancak yazma tamamlandıktan sonra gösterilecek; kalıcı anlık görüntü, görünür veriyle aynı anda temizlenecek. |

## A. Orta önem

| # | Bulgu | Dosya | Kalıcı düzeltme |
|---|---|---|---|
| M1 | Ajan taramasında ölçülemeyen hedef "0 B" görünüyor | `src-tauri/src/scanner/mod.rs`, `src/stores/scan-store.ts`, `ItemTable.tsx` | Ajan dalında `Measured` olayı yalnızca gerçekten ölçülmüş hedefler için üretilecek; `None` boyut `0`'a çevrilmeyecek. UI "Ölçülmedi" göstermeye devam edecek. |
| M2 | Plan önizlemesi sürerken "Cancel Run" etkisiz, diyalog kilitli | `CleanupPlanDialog.tsx` | `previewing` ve `busy` ayrılacak; önizleme sırasında "İptal" diyaloğu kapatacak ve geç gelen yanıt nesil sayacıyla yok sayılacak. Escape/arka plan yalnızca gerçek çalıştırma sırasında kilitli kalacak. |
| M3 | Minimum öğe boyutu üst sınırı backend ile uyuşmuyor | `SettingsView.tsx`, `preferences-store.ts`, `settings/model.rs` | UI üst sınırı 1024 MB (1 GiB) olacak; `toSettings` ve `loadPreferences` aynı aralıkları uygulayacak. Böylece ekran, disk ve tarama filtresi aynı değeri kullanacak. |
| M4 | Geçmişten geri yükleme her zaman Projeler'e gidiyor; düğme bayat | `HistoryView.tsx`, `OverviewView.tsx`, `scan-store.ts` | `restoreScan` başarı durumunu döndürecek. Geri yükleme sonrası görünüm snapshot kapsamına göre seçilecek (agents → Agents). Buton yalnızca gerçekten kayıtlı snapshot varsa gösterilecek. |

## B. Düşük önem

| # | Bulgu | Dosya | Kalıcı düzeltme |
|---|---|---|---|
| L1 | Konum değişimi "Çalışma Alanını Sıfırla" metnini kullanıyor | `ScanHeader.tsx` | Başlık `ui.header.changeLocation`, açıklama mevcut `ui.overview.resetConfirmDesc`, buton `ui.common.confirm` olacak. Yeni çeviri anahtarı eklenmeyecek. |
| L2 | Konum değişimi kalıcı snapshot'ı bırakıyor | `ScanHeader.tsx` | Onaylı konum değişimi `resetScan({ clearPersisted: true })` çağıracak; aynı konum seçilirse hiçbir şey silinmeyecek. |
| L3 | Uyarı sayısı "N hedef" olarak gösteriliyor | `ScanWarningsBanner.tsx` | Sayı, ayrıntı özetinde `(N)` olarak gösterilecek; yanlış "hedef" ifadesi kaldırılacak. |
| L4 | Kısayol kaydında erken başarı bildirimi + yakalanmamış promise | `SettingsView.tsx`, `preferences-store.ts` | `setShortcut`/`resetShortcuts` debounce'lu yazıcıya geçecek; UI yazma tamamlanınca başarı, hata durumunda hata gösterecek. |
| L5 | Ajan listesinde bayat `loading` kontrolü | `AgentsView.tsx` | `loadingRef` + istek nesli; efekt bağımlılığı `loadProviders` olacak, mükerrer istek engellenecek. |
| L6 | `??` zinciri `lastScanPath` yedeğini engelliyor | `useScanController.ts` | `rootOverride \|\| currentRootPath \|\| lastScanPath \|\| ""` kullanılacak. |
| L7 | Temizlik sonrası snapshot özeti eski kalıyor | `scan-store.ts` | `markDeleted`/`removeItems` sonrası özet (toplamlar + sağlayıcı toplamları) kalan öğelerden yeniden hesaplanacak. |
| L8 | Seçim sayacı iki yerde farklı | `ItemTable.tsx`, `SelectionActionBar.tsx`, `selection-helpers.ts` | Ortak `isEffectiveTarget` yardımcısı; tablo ve aksiyon çubuğu aynı kümeyi sayacak. |

## C. Ek sağlamlaştırma

| # | Bulgu | Dosya | Düzeltme |
|---|---|---|---|
| E1 | Disk doluluk cooldown'u yeniden başlatmada sıfırlanıyor | `lifecycle.ts` | Cooldown `localStorage`'a yazılacak; bozuk/erişilemez depoda sessizce belleğe düşülecek. |
| E2 | `open_url` yalnızca ön eke bakıyor | `scan_commands.rs` | `http(s)` için boş host/ters bölü reddi, `mailto` için adres doğrulaması; birim testleri eklenecek. |
| E3 | Denetim dokümanı var olmayan rapora atıfta bulunuyor | `docs/audit/*` | Eksik kaynak rapor oluşturulacak ve bu plana bağlanacak. |

## D. Doğrulama kapıları

1. `npm run typecheck` → 0 hata.
2. `npm test` → tüm testler + yeni regresyon testleri yeşil.
3. `cargo test --manifest-path src-tauri/Cargo.toml` → tüm testler yeşil.
4. `npm run check:i18n` → anahtar kaybı yok (yeni anahtar eklenmedi).
5. `npm run build` → üretim derlemesi başarılı.
6. Her bulgu için kod içinde düzeltmenin varlığı `grep` ile doğrulanacak.

## E. Uygulama sonucu (2026-11-13)

Tüm maddeler kök nedeninde kapatıldı; geçici gizleme veya yalnızca UI düzeltmesi
kullanılmadı.

| # | Uygulanan kalıcı düzeltme | Regresyon kilidi |
|---|---|---|
| M1 | `agent_measurement_updates` yalnızca `logical_bytes: Some(..)` olan hedefleri `Measured` olayına çeviriyor; boş parti gönderilmiyor. | `scanner::tests::agent_measurement_updates_skip_unmeasured_targets` |
| M2 | `previewing` / `busy` ayrıldı, `loadGenerationRef` ile geç yanıtlar düşürülüyor, Escape/arka plan yalnızca gerçek çalıştırmada kilitli. | Kod doğrulaması + tip denetimi |
| M3 | `SETTING_LIMITS` (`maxDepth`, `maxCandidates`, `timeoutMinutes`, `minSizeBytes`) hem `toSettings`/`loadPreferences` hem ayarlar ekranı tarafından kullanılıyor; min-size üst sınırı 1024 MB. | `fixes.test.ts` → "clamps numeric settings…" |
| M4 | `restoreScan` `boolean` döndürüyor; geçersiz şema yüklenmiyor; `viewForScanScope` ajan snapshot'ını Agents'a yönlendiriyor; iki ekrandaki geri yükleme düğmesi gerçek snapshot varlığına bağlandı. | `fixes.test.ts` → "restores only valid snapshots…" |
| L1 | Konum diyaloğu `ui.header.changeLocation`, `ui.overview.resetConfirmDesc`, `ui.common.confirm` kullanıyor. | Kod doğrulaması |
| L2 | Konum değişimi `resetScan({ clearPersisted: true })`; aynı konum yeniden seçilirse işlem yapılmıyor (`isSameLocation`). | Kod doğrulaması |
| L3 | Uyarı sayısı ayrıntı özetinde `(N)` olarak gösteriliyor; "hedef" ifadesi kaldırıldı. | Kod doğrulaması |
| L4 | `setShortcut`/`resetShortcuts` debounce'lu yazıcıyı kullanıyor; başarı bildirimi `persistSettings()` çözüldükten sonra, hata ayrı toast ile gösteriliyor. | Kod doğrulaması |
| L5 | `loadingRef` + nesil sayacı; efekt `loadProviders` bağımlılığına sahip ve unmount'ta nesil artırılıyor. | Kod doğrulaması |
| L6 | Kök çözümleme `rootOverride \|\| currentRootPath \|\| lastScanPath \|\| ""` oldu; boş dize artık yedeği engellemiyor. | Kod doğrulaması |
| L7 | `recomputeSummary` `markDeleted`/`removeItems` sonrası toplamları, hata/uyarı sayılarını ve sağlayıcı toplamlarını kalan öğelerden yeniden hesaplıyor. | `fixes.test.ts` → "recomputes summary totals…" |
| L8 | `isEffectiveTarget` + `effectiveSelectedIds` tek kaynak; tablo sayacı ve aksiyon çubuğu aynı kümeyi kullanıyor. | `fixes.test.ts` → "uses one effective-target predicate…" |
| E1 | Cooldown `window.localStorage`'a yazılıyor; bozuk/erişilemez depo belleğe düşüyor; `resetDiskPressureCooldown` anahtarı siliyor. | `fixes.test.ts` → "persists the disk-pressure cooldown…" |
| E2 | `validate_open_url`: boş host, ters bölü, kontrol karakteri, geçersiz IPv6 ve hatalı `mailto` reddediliyor. | `open_url_accepts_normal_web_and_mail_urls`, `open_url_rejects_empty_hosts_and_unsafe_forms` |
| E3 | `docs/audit/2026-11-13-audit-report.md` oluşturuldu ve bu plana bağlandı. | Dosya doğrulaması |

### Doğrulama kapılarının sonuçları

| Kapı | Sonuç |
|---|---|
| `npm run typecheck` | ✅ 0 hata |
| `npm test -- --run` | ✅ 14 dosya, 139 test |
| `cargo test --manifest-path src-tauri/Cargo.toml` | ✅ 137 birim + 18 entegrasyon testi (5'i ortam gerektiren ignored) |
| `npm run check:i18n` | ✅ 97.629 anahtar, eksik yok; yeni anahtar eklenmedi |
| `npm run build` | ✅ üretim derlemesi tamamlandı |
| Bulgu başına `grep` kanıtı | ✅ tüm maddeler için doğrulandı |
