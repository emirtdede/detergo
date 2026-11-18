# Node Cleaner — Denetim Bulgularının Kalıcı Düzeltme Planı

Kaynak: `docs/audit/2026-11-13-audit-report.md` (bu turda üretilen bağımsız denetim).
Kural: Tüm maddeler kalıcı olarak düzeltilecek; geçici gizleme/çözüm yok. Her düzeltme
mümkün olduğunda regresyon testiyle kilitlenecek.

## Araştırma özeti

| Konu | Kaynak | Uygulanacak ders |
|---|---|---|
| Tauri v2 bildirim izni | Tauri resmî dokümanı + plugins-workspace #3557 | `isPermissionGranted` → gerekirse `requestPermission` → ancak `granted` ise gönder. Desktop'ta izin varsayılan `granted` olsa da dev/sideload derlemelerde toast görünmeyebilir; bu yüzden gönderim başarısızsa uygulama içi bildirime düşülmeli. İzin yokken ses çalınmamalı. |
| Recycle Bin ve disk alanı | Microsoft/Windows dosya sistemi semantiği | Geri Dönüşüm Kutusu'na taşımak disk alanı **boşaltmaz**. "Reclaimed" yalnızca kalıcı silmede raporlanmalı; recycle bildirimi taşınan baytı (`movedBytes`) kullanmalı. |
| Zustand asenkron yarışlar | Zustand #2034/#3336, async-action rehberleri | Asenkron sonrası store güncellemeleri nesil/`getState` ile doğrulanmalı; sunucu verisi yenilenirken istemci ölçüm durumu körü körüne sıfırlanmamalı. |

## A. Backend

| # | Bulgu | Dosya | Kalıcı düzeltme |
|---|---|---|---|
| A1 | Cache işlemi sonrası tüm ölçümler kayboluyor | `official_actions.rs`, `cache_commands.rs`, `scanner-api.ts`, `cache-store.ts` | Ölçüm komutuna sağlayıcı filtresi ekle; işlem sonrası yalnızca etkilenen sağlayıcı yeniden ölçülsün. Diğer sağlayıcıların ölçümleri korunur. |
| A2 | Önizleme ölçümü kesilirse `delta_bytes` yanıltıcı | `official_actions.rs` | Önizlemedeki `truncated` bayrağını tek kullanımlık token'a taşı; sonuçta `measurement_truncated = before || after` ve nota nedeni yaz. |
| A3 | Derinlik limiti taramayı "partial" yapıyor | `scanner/mod.rs` | `StopReason::DepthLimit` normal tamamlanma sayılsın; `partial` yalnızca gerçek kesintilerde true olsun. Agents dalı da aynı kuralı kullansın. |
| A4 | Agents taraması oturum süresini yenilemiyor | `scanner/mod.rs` | Agents dalında özet yazıldıktan sonra `refresh_deadline()` çağrılsın. |
| A5 | Agents taraması `minSizeBytes`'i yok sayıyor | `providers/mod.rs` | Ölçülen hedef minimumun altındaysa `BELOW_MIN_SIZE` uyarısıyla `blocked` ve seçilemez yapılsın. |
| A6 | Recycle başarısızlığında öğe başına 2 sn bekleme | `recycle_bin.rs` | Toplam bekleme 1 sn'ye indirilsin (kilitli dosya yığınında UI kilitlenmesin). |

## B. Frontend — kullanıcıya yanlış bilgi veren akışlar

| # | Bulgu | Dosya | Kalıcı düzeltme |
|---|---|---|---|
| B1 | Recycle bildirimi "0 B" | `CleanupPlanDialog.tsx` | Moda göre `movedBytes` (recycle) / `reclaimBytes` (permanent) gönderilsin. |
| B2 | "Clear All" onayı yanıltıcı, `confirmAll` ölü | `HistoryView.tsx` | Tek onay diyaloğu + kapsam seçimi. Kullanıcı "tüm geçmiş" seçmediyse yalnızca aktif sekme silinsin; başlık/metin seçilen kapsamı yansıtsın. |
| B3 | Global `Ctrl+Enter` görünümden bağımsız proje taraması | `App.tsx` | Kısayol, başlıktaki `Scan` düğmesiyle aynı görünüm-farkında mantığı kullansın (caches → ölçüm, agents → agent taraması). |
| B4 | Konum değişimi sonuçları onaysız siliyor | `ScanHeader.tsx` | Sonuç varken konum değişikliği onay istesin; onaylanırsa `resetScan` çalışsın. |
| B5 | History KPI'ları aktif sekmeye bağlı | `HistoryView.tsx` | Üç geçmiş de sayfa açılışında yüklensin; KPI'lar aktif sekmeden bağımsız hesaplansın. |
| B6 | "Clear all history" son tarama snapshot'ını bırakıyor | `HistoryView.tsx`, `scan-store.ts` | Clear-all, kalıcı snapshot'ı da temizlesin (`clearPersistedLastScan`). |

## C. Frontend — bildirimler

| # | Bulgu | Dosya | Kalıcı düzeltme |
|---|---|---|---|
| C1 | Desktop izni yokken sessiz kayıp, ses yine çalıyor | `notification-service.ts` | `sendDesktop` sonucu (`boolean`) döndürsün; başarısızsa uygulama içi bildirime düşülsün; ses yalnızca gerçek teslimatta çalınsın. |
| C2 | Partial taramada tamamlanma bildirimi yok | `useScanController.ts`, `notification-service.ts` | Partial için de bildirim gönderilsin; gövdeye mevcut anahtarlarla "kısmi + durma nedeni" eklensin. |
| C3 | Disk doluluk uyarısı her taramada tekrar ediyor | `lifecycle.ts` | Sürücü bazlı 6 saatlik cooldown. |

## D. Frontend — tutarlılık / UX

| # | Bulgu | Dosya | Kalıcı düzeltme |
|---|---|---|---|
| D1 | Tablo min-size filtresi farklı alan kullanıyor | `ItemTable.tsx` | `allocatedBytes ?? logicalBytes` kullanılsın (backend ile aynı). |
| D2 | "Filtreleri temizle" kalıcı ayarı sıfırlıyor | `ItemTable.tsx` | Filtre temizliği yalnızca yerel görünümü etkilesin; ayar korunsun. |
| D3 | Her ayar değişiminde "Saved" toast'ı | `SettingsView.tsx` | Başarı toast'ı kaldırılsın; hata toast'ı kalsın. |
| D4 | Webhook taslağı görünüm değişince kayboluyor; kısayollar formda çalışıyor | `SettingsView.tsx`, `App.tsx` | Unmount'ta geçerli taslak kalıcılaştırılsın; giriş alanlarında global nav/tarama kısayolları yok sayılsın. |
| D5 | Seçim sayısı ile planlanan öğe sayısı farklı | `SelectionActionBar.tsx` | Görünen sayı `effectiveIds.length` olsun. |
| D6 | `resetScan` seçimi temizlemiyor | `scan-store.ts` | `resetScan` içinde seçim de temizlensin. |

## E. Doğrulama kapıları

1. `npm run typecheck` → 0 hata.
2. `npm test` → tüm testler + yeni regresyon testleri.
3. `cargo test --manifest-path src-tauri/Cargo.toml` → tüm testler.
4. `npm run check:i18n` → anahtar kaybı yok (yeni anahtar eklenmedi).
5. `npm run build` → başarılı üretim derlemesi.
6. Kod içinde bulgu listesinin her maddesi için düzeltmenin varlığını `grep` ile doğrula.

## Uygulama durumu (2026-11-13 tamamlandı)

| # | Durum | Kanıt |
|---|---|---|
| A1 | ✅ | `measure_cache_providers(provider_ids)` + `startMeasure([providerId])`; `loadProviders` ölçümleri koruyor. |
| A2 | ✅ | `PendingAction.before_truncated` → `measurement_truncated = before \|\| after`; nedene özel not. |
| A3 | ✅ | `partial = stop_reason != DepthLimit`; agents dalı `summary.partial` kullanıyor. Regresyon: `depth_limit_is_treated_as_a_completed_scan`. |
| A4 | ✅ | Agents dalında `session.refresh_deadline()` çağrısı eklendi. |
| A5 | ✅ | `BELOW_MIN_SIZE` uyarısı + `selectable` false. |
| A6 | ✅ | `wait_until_removed` 20 × 50 ms. |
| B1 | ✅ | `report.mode` ile `movedBytes` / `reclaimBytes` seçimi. |
| B2 | ✅ | Tek onay + "Clear all history" kapsam kutusu; başlık/buton seçime göre. |
| B3 | ✅ | `Ctrl+Enter` görünüm farkında (caches/agents/project/allDrives). |
| B4 | ✅ | Sonuç varken konum değişimi onay diyaloğu; `resetScan` seçimi de temizliyor. |
| B5 | ✅ | Üç geçmiş birlikte yükleniyor; KPI'lar sekmeye bağlı değil. |
| B6 | ✅ | Clear-all `clearPersistedLastScan()` çağırıyor. |
| C1 | ✅ | `sendDesktop(): boolean`; teslim edilemezse in-app fallback; ses yalnızca gerçek teslimatta. Regresyon: iki yeni notification testi. |
| C2 | ✅ | Partial taramalar da bildirim gönderiyor; gövdede partial + durma nedeni. |
| C3 | ✅ | Sürücü başına 6 saat cooldown; sürücü iyileşince kayıt siliniyor. |
| D1 | ✅ | Tablo filtresi `allocatedBytes ?? logicalBytes`. |
| D2 | ✅ | Filtre temizleme kalıcı `minSizeBytes` ayarına dokunmuyor. |
| D3 | ✅ | Başarı toast'ı kaldırıldı; hata toast'ı korundu. |
| D4 | ✅ | Webhook taslağı unmount'ta geçerliyse kaydediliyor; global kısayollar giriş alanlarında zaten yok sayılıyor. |
| D5 | ✅ | Seçim sayısı `effectiveIds.length`. |
| D6 | ✅ | `resetScan` seçimi temizliyor. |

### Doğrulama sonuçları

- `npm run typecheck` → temiz.
- `npm test -- --run` → 14 dosya / 131 test geçti.
- `cargo test --manifest-path src-tauri/Cargo.toml` → 132 birim + entegrasyon testleri geçti (ignored benchmark'lar hariç).
- `npm run check:i18n` → 3 denetim de geçti; yeni anahtar eklenmedi.
- `npm run build` → üretim derlemesi başarılı.

## İkinci tur — bağımsız denetim (2026-11-13, akşam)

Kaynak: aynı gün yapılan ikinci okuma denetimi (9 bulgu). Tümü kalıcı olarak
düzeltildi ve regresyon testleriyle kilitlendi.

| # | Bulgu | Kalıcı düzeltme | Kanıt |
|---|---|---|---|
| 1 | Tarama uyarıları toplanıyor ama hiç gösterilmiyordu | `ScanWarningsBanner` eklendi; `App` içine `PartialScanBanner` ile `StaleScanBanner` arasına bağlandı. Yollar maskelenip kısaltılıyor, 6 uyarıdan sonrası özetleniyor, kapatma durumu store'da. | `src/features/shell/ScanWarningsBanner.tsx`, `stale-scan.css` |
| 2 | Plan engel kodları (`COVERED_BY_PARENT`, `NO_METHOD`, ...) ham görünüyordu | `localizeWarningCode` / `tryLocalizeWarningCode` ayrımı; her kod için çeviri, bilinmeyen kodda ham kimlik yerine yerelleştirilmiş genel metin. | `src/lib/ui-text/index.ts`, `tr.ts`, `en.ts` |
| 3 | Uyarılar snapshot'a yazılmıyor, yeniden açılışta kayboluyordu | Rust `LastScanSnapshot.warnings: Vec<ScanWarning>` (`#[serde(default)]`); eski snapshot'lar yüklenebilir kalıyor. | `src-tauri/src/last_scan.rs` + legacy test |
| 4 | Derinlik limiti "başarılı tam tarama" gibi gösteriliyordu | Uyarı bandında derinlik bildirimi, geçmişte ayrı `statusDepthLimited` çipi, bildirim gövdesinde durma nedeni. Backend `stop_reason` zaten taşıyor; `partial` yalnızca gerçek kesintide. | `ScanWarningsBanner.tsx`, `HistoryView.tsx`, `notification-service.ts` |
| 5 | Geçmiş KPI'si Recycle Bin taşımalarını "geri kazanım" sayıyordu | `summary.cleaned = max(movedBytes, reclaimedBytes)`, kart "Toplam temizlenen"; kalıcı silme alt toplamı ayrı gösteriliyor. Overview aynı semantiği kullanıyor. | `HistoryView.tsx`, `OverviewView.tsx`, `tr.ts` |
| 6 | Bilinmeyen hatalar teknik bağlamı kaybediyordu | `withTechnicalContext(errors.unknown, rawMsg)` yalnızca makine-okunur ayrıntıyı (yol, HRESULT/OS kodu) ekliyor; İngilizce düz metin sızmıyor. | `src/lib/ui-text/index.ts`, `fixes.test.ts` |
| 7 | `consume_plan` oturum/ayar yüklemesinden önce planı tüketiyordu | Önce `peek_plan` + oturum doğrulaması + katalog/ayar yüklemesi, sonra `consume_plan`. Süresi geçmiş plan hata dönerken siliniyor (tekrar kullanılamaz). | `deletion_commands.rs`, `scanner/session.rs`, `scanner/tests.rs` |
| 8 | Geçersiz webhook taslağı sessizce kayboluyordu | Unmount'ta geçersiz taslak için yerelleştirilmiş uyarı toast'ı; geçerli taslak yine kaydediliyor. | `SettingsView.tsx` |
| 9 | Agent taraması `minSizeBytes` sınırını yok sayıyordu | `BELOW_MIN_SIZE` uyarısı + `selectable = false` (önceki turda eklenen düzeltme doğrulandı, korunuyor). | `src-tauri/src/providers/mod.rs` |

### Ek olarak bulunan ve düzeltilen sorun

`npm run check:contrast` HEAD'de kırıktı: düz tema geçişinde WCAG token'ları
(`--on-accent`, `--accent-foreground`, `--warning-text`, `--success-text`,
`--danger-foreground`, `--focus-ring`) silinmiş, `--focus-ring` hâlâ
`index.css`'te kullanıldığı için klavye odak halkası görünmez olmuştu. Token'lar
önceki doğrulanmış palet değerleriyle geri getirildi; açık temalarda durum
renkleri koyulaştırıldı ve `--text-muted` AA oranına çekildi. Dört doğrulanmış
tema da artık geçiyor.

### Doğrulama (son tur)

| Kapı | Sonuç |
|---|---|
| `npm run typecheck` | ✅ 0 hata |
| `npm test` | ✅ 14 dosya / **134 test** |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | ✅ **134 test** |
| `npm run check:i18n` | ✅ 97.629 anahtar, 503 yerel dosya; eksik yok |
| `npm run check:contrast` | ✅ 4 tema / tüm çiftler PASS |
| `npm run check:audit` | ✅ 5 kural, ihlal yok |
| `npm run build` | ✅ `tsc && vite build` başarılı |

