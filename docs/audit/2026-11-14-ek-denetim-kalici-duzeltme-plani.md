# Dev Cleaner — 2026-11-14 Ek Denetim Kalıcı Düzeltme Planı

Kaynak: 2026-11-14 tarihli ikinci tam kod denetimi (13 bulgu: 6 P1, 7 P2).
Önceki `2026-11-14-kalici-duzeltme-plani.md` (F1–F11) tamamlanmıştı; bu plan
onun üzerine gelen ek denetim bulgularını kapatır.

Kural: Geçici gizleme veya yalnızca UI yaması yok. Her bulgu kök nedeninde
kapatılacak, mümkün olan her madde regresyon testiyle kilitlenecek ve plan
tamamlandıktan sonra tüm doğrulama kapıları yeniden çalıştırılacak.

## A. Araştırma özeti

| Konu | İncelenen kaynak | Uygulanacak ders |
|---|---|---|
| SSRF ve DNS rebinding | OWASP SSRF Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html | Loopback, RFC1918, link-local, CGNAT, multicast, unspecified ve IPv6 ULA/link-local adresleri reddedilmeli. Hostname çözümlemesi ile bağlantı arasındaki DNS değişimi `reqwest::ClientBuilder::resolve` ile IP sabitleyerek kapatılmalı; redirect zaten kapalı kalmalı. |
| Modal dialog erişilebilirliği | WAI-ARIA APG Dialog (Modal) Pattern — https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/ | Modal açıkken arka plan inert olmalı; global klavye kısayolları modalın altındaki görünümü değiştirmemeli. `activeModal` yalnızca bazı diyaloglarda set edildiği için sayaç tabanlı bir dialog derinliği gerekir. |
| MCP araç hataları | MCP specification 2025-06-18, Server/Tools — https://modelcontextprotocol.io/specification/2025-06-18/server/tools | Araç yürütmesi başarısızsa `result.isError: true` dönmeli. Kısmi başarı "success" olarak raporlanamaz; `status` alanı `success | partial | failed | cancelled` olarak türetilmeli. |
| Tauri kapatma akışı | Tauri v2 Window Customization / `CloseRequested` — https://v2.tauri.app/learn/window-customization/ | `api.prevent_close()` tek başına yeterli değildir; hatırlanan "quit" ve tepsi menüsü de aynı korumalı akışa girmeli. Aktif temizlik varsa önce iptal edilip bitmesi beklenmeli, sonra `app.exit(0)` çağrılmalı. |

## B. Bulgu → kalıcı düzeltme

| # | Önem | Bulgu | Dosya | Kalıcı düzeltme | Regresyon kanıtı |
|---|---|---|---|---|---|
| B1 | P1 | İç içe hedefler frontend KPI/summary/dağılım/topItems toplamlarında çift sayılıyor; backend `own_bytes` mantığı yok | `src/lib/item-totals.ts` (yeni), `src/stores/scan-store.ts`, `src/features/items/ProjectsView.tsx`, `src/features/overview/OverviewView.tsx` | Backend `scanner/mod.rs::own_bytes` ile birebir aynı `ownBytesById` yardımcısı yazılır. Ebeveynin kendi baytlarından doğrudan çocuklarının logical/allocated/estimated baytları düşülür. `cleanableBytes`, `recomputeSummary`, proje KPI'ları, Overview toplamları, dağılım ve topItems bu haritayı kullanır. | `src/test/item-totals.test.ts`: ebeveyn 1000 + çocuk 400 → toplam 1000, çocuk kendi 400'ünü korur; `scan-store` summary testi. |
| B2 | P1 | Başarıyla silinen ebeveynin torun satırları tabloda/seçimde kalıyor; backend oturumu da torunları bırakıyor. Ayrıca `plan.rs` engelli ebeveyni "kapsayan" sayıp uygun çocuğu `COVERED_BY_PARENT` yapıyor | `src/stores/scan-store.ts`, `src-tauri/src/scanner/session.rs`, `src-tauri/src/commands/deletion_commands.rs`, `src-tauri/src/cleanup/plan.rs` | `markDeleted`/`removeItems` `parentItemId` zinciriyle tüm torunları işaretler. Rust `ScanSession::apply_successful_deletions` yol tabanlı torun temizliği yapar; `deletion_commands` bunu çağırır. Plan kapsama kontrolü yalnızca gerçekten eligible ebeveynler üzerinden yapılır. | Frontend: ebeveyn silinince torun `deleted` olur (`item-totals.test.ts`); Rust: `parent_deletion_removes_descendant_targets_and_items`, `blocked_parent_does_not_cover_an_eligible_child`. |
| B3 | P1 | Webhook URL yalnızca şema kontrolünden geçiyor; loopback/özel ağ/link-local hedefler ve DNS rebinding engellenmiyor | `src-tauri/src/commands/webhook_commands.rs`, `src/lib/validation/webhook-url.ts`, `src-tauri/tests/webhook.rs` | Ortak `is_disallowed_ip` politikası (IPv4 loopback/private/link-local/CGNAT/multicast/unspecified/broadcast; IPv6 loopback/ULA/link-local/multicast/IPv4-mapped) eklenir. Async ve blocking yollarda DNS çözümlemesi yapılır, tüm adresler doğrulanır ve `ClientBuilder::resolve` ile IP sabitlenir. Frontend aynı kuralı literal IP/localhost için uygular. | Rust: `rejects_loopback_and_private_targets`, `classifies_forbidden_ip_ranges`; frontend: `isValidWebhookUrl` private literal testleri. |
| B4 | P1 | Hatırlanan "quit" ve tepsi menüsü aktif temizliği ortasında süreci sonlandırıyor | `src/features/shell/CloseGuardDialog.tsx`, `src/lib/quit-guard.ts`, `src-tauri/src/commands/window_commands.rs`, `src-tauri/src/lib.rs` | Tepsi "quit" de `close-requested` yayar. `quit_app` aktif `cleanup_token` varsa tokenı iptal eder ve `execute_cleanup` slotu boşalana kadar (en fazla 30 sn) bekler, sonra çıkar. Frontend hatırlanan quit sırasında `markCancelling` çağırır. | `src/test/quit-guard.test.ts`: iptal çağrısı çıkıştan önce, hata olsa bile çıkış; Rust `cancel_running_cleanup_*` testleri. |
| B5 | P1 | MCP `devcleaner_execute_cleanup` hata/kısmi/iptal durumlarında bile `"status": "success"` dönüyor | `src-tauri/src/mcp/mod.rs` | `status`; `cancelled` → `cancelled`, `error_count == 0` → `success`, `success_count > 0` → `partial`, aksi halde `failed` olur. `error_count` ve `cancelled` alanları payload'a eklenir. | `cleanup_status_never_calls_a_failed_run_success` dört terminal durumu doğrular. |
| B6 | P1 | MCP `tools/call` yanıtı `isError` içermiyor; ajan hataları başarı sanıyor | `src-tauri/src/mcp/mod.rs`, `src-tauri/tests/mcp_flow.rs` | `ToolCallOutput { text, is_error }` yapısına geçilir. Tüm araçlar blocked/error durumunda `is_error: true` üretir; `tools/call` sonucuna `isError` eklenir. | `mcp_flow.rs`: bilinmeyen araç, eksik parametre ve başarılı çağrı `isError` kontrolü. |
| B7 | P2 | `formatBytes` yuvarlama sonrası birim taşıyor: `1048575` → `"1,024.0 KB"` | `src/lib/formatters.ts` | Yuvarlanmış değer 1024'e ulaşırsa bir üst birime yükseltilir; son birimde taşma yapılmaz. | `fixes.test.ts`: `1048575` → `1.00 MB`, `1073741823` → `1.00 GB`, negatif varyant. |
| B8 | P2 | CLI sürüm başlığı çeviri anahtarı `v2.2.0` içeriyor; sürüm değişince 72 locale kaydı eski kalıyor | `src-tauri/src/cli/mod.rs`, `src-tauri/assets/cli-locales.json` | Başlık anahtarı sürümden bağımsız hale getirilir; sürüm `env!("CARGO_PKG_VERSION")` ile kodda eklenir. 72 locale kaydındaki anahtar ve değerler `(v…)` sonekinden arındırılır. | `rg "v2\.2\.0" src-tauri/assets/cli-locales.json` → 0; `cargo test` CLI testleri. |
| B9 | P2 | CLI `--scope caches` kabul ediliyor ama tarayıcı her zaman `PlatformUnsupported` döndürüyor; MCP şeması ve dokümanlar da aynı geçersiz değeri öneriyor | `src-tauri/src/cli/mod.rs`, `src-tauri/src/mcp/mod.rs`, `src/features/docs/DocsView.tsx`, `DocsContentEn.tsx`, `DocsContentTr.tsx` | `caches` kapsamı CLI/MCP ayrıştırıcılarından ve MCP şemasından kaldırılır; hata mesajı `caches` komutuna yönlendirir. Doküman üreticisi ve `--scope` tablosu güncellenir. | CLI `scope_aliases` testi `caches` reddini doğrular. |
| B10 | P2 | Global klavye kısayolları yalnızca `activeModal` doluysa engelleniyor; Settings/reset gibi diğer Dialog kullanımlarında arka plan geziniyor | `src/stores/ui-store.ts`, `src/components/primitives/Dialog.tsx`, `src/app/App.tsx` | `ui-store` içine `dialogDepth` + `pushDialog/popDialog` eklenir. `Dialog` açıkken sayaç artar, kapanınca azalır. `App` kısayol dinleyicisi `dialogDepth > 0 || activeModal !== null` iken çıkar. | `fixes.test.ts`: sayaç ve `isGlobalShortcutBlocked` testi. |
| B11 | P2 | Ayar dosyası açılamıyor/okunamıyorsa sessizce varsayılana dönülüyor; kullanıcı uyarı görmüyor | `src-tauri/src/settings/repository.rs`, `src-tauri/src/settings/tests.rs` | Açma/okuma hatasında da `recovered_from_corrupt = true` işaretlenir; mevcut frontend uyarı banner'ı tetiklenir. | Rust: `unreadable_settings_file_flags_recovery` (geçersiz UTF-8 dosyası). |
| B12 | P2 | Kalıcı silme onay metni tıklanamıyor; yalnızca küçük kutu etkileşimli | `src/components/primitives/Checkbox.tsx`, `src/components/primitives/primitives.css`, `src/features/cleanup/CleanupPlanDialog.tsx` | `Checkbox` primitifine `label` prop'u eklenir; metin kutunun `<label>` kapsamına girer ve tıklama toggle eder. | Typecheck + kod incelemesi; `aria-label` kaldırılmadan erişilebilir ad korunur. |
| B13 | P2 | Dokümanlar `devcleaner_clean_safe` aracını "Geri Dönüşüm Kutusuna taşır" diye anlatıyor, 6 otonom araç sayısı yanlış ve `caches --clean all` için `--yes` yok | `src/features/docs/DocsContentEn.tsx`, `src/features/docs/DocsContentTr.tsx`, `src/features/docs/DocsView.tsx`, `src/features/docs/docs-locales/*.json` | `clean_safe` deprecated önizleme takma adı olarak anlatılır; araç sayısı gerçek şema (6 temel + 2 yıkıcı) ile eşlenir; `caches` bölümüne `--yes` ve `--dry-run` eklenir. Ölü çeviri anahtarları 71 sözlükten silinir. | `rg` ile eski metinlerin kalmadığı doğrulanır; i18n kapıları. |

## C. Uygulama sırası

1. Ortak frontend bayt yardımcısı (B1) ve tüketicileri.
2. Hayalet satır zinciri: frontend torun işaretleme, Rust oturum temizliği, plan kapsama (B2).
3. Webhook SSRF politikası ve testleri (B3).
4. Kapatma koruması: frontend hatırlanan quit + Rust `quit_app` beklemesi + tepsi yönlendirmesi (B4).
5. MCP `ToolCallOutput`, `status` ve `isError` (B5, B6).
6. `formatBytes` taşması (B7).
7. CLI sürüm anahtarı + 72 locale dönüşümü (B8) ve `--scope caches` kaldırma (B9).
8. Modal sayaç/kısayol (B10), ayar okuma bayrağı (B11), Checkbox etiketi (B12).
9. Doküman düzeltmeleri (B13).
10. Tüm doğrulama kapıları.

## D. Doğrulama kapıları

1. `npm run typecheck` → 0 hata.
2. `npm test -- --run` → mevcut testler + yeni regresyon testleri yeşil.
3. `npm run check-version` → sürüm tutarlı.
4. `npm run check:i18n` → betik, kapsama ve çevrilmemiş değer kapıları temiz.
5. `npm run check:i18n:coverage` → eksik anahtar yok.
6. `npm run check:audit` → denetim invariant'ları ihlal edilmiyor.
7. `cargo test --manifest-path src-tauri/Cargo.toml` → tüm birim/entegrasyon testleri yeşil.
8. Her bulgu için düzeltmenin kodda varlığı `rg` ile doğrulanır.

## E. Uygulama sonucu ve doğrulama

B1–B13 maddelerinin tamamı kodda kapatıldı. 2026-11-14 tarihli son doğrulama
turunda çalıştırılan kapılar:

| # | Kapı / komut | Sonuç |
|---|---|---|
| 1 | `npm run typecheck` | 0 hata |
| 2 | `npm test -- --run` | 18 test dosyası, 178 test geçti; 0 başarısız |
| 3 | `cargo test --manifest-path src-tauri/Cargo.toml --no-fail-fast` | 167 birim + 20 entegrasyon testi geçti; 0 başarısız; 5 benchmark/Recycle Bin testi bilinçli `ignored` |
| 4 | `npm run check-version` | package.json, tauri.conf.json ve Cargo.toml = `2.2.2` |
| 5 | `npm run check:i18n` | 98.788 string / 502 dosya betik ve mojibake temiz; 97.559 anahtar / 503 sözlük kapsamı tam; 538 UI + 173 doküman/legal değeri allowlist içinde |
| 6 | `npm run check:i18n:coverage` | 97.559 anahtar / 503 sözlük; eksik anahtar yok |
| 7 | `npm run check:audit` | 5 denetim invariant'ı, ihlal yok |
| 8 | `rg "v2\.2\.0" src-tauri/assets/cli-locales.json` | 0 eşleşme (sürüm başlıktan ayrıldı) |
| 9 | `rg` eski doküman metinleri (`6 autonomous`, `Safely dispatches confirmed`, `Target group to scan…`) | 0 eşleşme; `--scope caches` yalnızca `caches` komutuna yönlendiren hata mesajında geçiyor |

Ek olarak ilk turda eksik kalan B3 frontend ayağı tamamlandı:
`src/lib/validation/webhook-url.ts` artık `localhost`, `.local/.internal/.home.arpa`,
IPv4 loopback/private/link-local/CGNAT/multicast/dokümantasyon ve IPv6
loopback/ULA/link-local/multicast/IPv4-mapped/6to4/Teredo literallerini
reddediyor; `fixes.test.ts` bu listeyi ve kamuya açık adreslerin kabulünü
doğruluyor. B13 kapsamında ayrıca 71 doküman sözlüğünden 284 ölü çeviri
anahtar/değer çifti kaldırıldı; i18n kapsam kapısı yeniden yeşil.

Böylece denetimdeki 13 bulgunun tamamı kalıcı kod ve regresyon testleriyle
kapatıldı; bilinen açık bulgu kalmadı.

