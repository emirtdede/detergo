# Üretim Kapısı — 2.2.1

Bu belge, `docs/audit/REMEDIATION_PLAN_TR.md` §9'daki 18 maddelik kapının kaydıdır.
`build:release` yalnızca **18 maddenin tamamı PASS** olduğunda yayınlanabilir.

**Mevcut durum:** **18/18 PASS.**
Kod kapıları (1–14) otomatiktir; operasyonel kapılar (15–18) 2.2.1'de betiklere
bağlanmıştır, yani artık "elle imzalanacak belge" değil, çalıştırılabilir kanıttır.

| # | Kapı | Durum | Kanıt |
|---|---|---|---|
| 1 | `npm run typecheck` → exit 0 | **PASS** | `tsc --noEmit` exit 0 |
| 2 | `npm test` → tümü yeşil, 0 atlanmış | **PASS** | 11 dosya / 90 test geçti, atlanan yok |
| 3 | `cargo test` → tümü yeşil | **PASS** | 127 lib + 8 `mcp_flow` + 6 `webhook` + 12 path guard + diğer entegrasyon dosyaları; 0 failed |
| 4 | `cargo clippy --all-targets -- -D warnings` | **PASS** | 0 uyarı |
| 5 | `cargo fmt --check` | **PASS** | exit 0 |
| 6 | `npm run build` | **PASS** | Vite derlemesi başarılı |
| 7 | `npm run check-version` → 2.2.1, üç dosya | **PASS** | `package.json`, `Cargo.toml`, `tauri.conf.json` = 2.2.1 |
| 8 | `node scripts/check-audit-invariants.mjs` → 0 ihlal | **PASS** | 5 kural, ihlal yok |
| 9 | `npm run check:i18n` → 0 eksik anahtar | **PASS** | 3 denetim: script, coverage, untranslated |
| 10 | MCP entegrasyon paketi → 12/12 | **PASS** | `mcp_flow` 8 + `mcp::tests` 6 |
| 11 | Webhook entegrasyon paketi → 6/6 | **PASS** | `tests/webhook.rs` 6/6 |
| 12 | Path güvenlik matrisi → 12/12 | **PASS** | `safety::path_guard` 12/12 — bkz. `SECURITY_MATRIX_2.2.1_TR.md` |
| 13 | 50k öğe arama ölçümü → baseline'dan yavaş değil | **PASS** | < 250 ms eşiği — bkz. `PERFORMANCE_2.2.1_TR.md` |
| 14 | `dist/` boyutu → baseline'dan büyük değil | **PASS** | 9,59 MB (−46,2 kB) — concept chunk üretimde yok |
| 15 | Smoke (webhook, bildirim, iptal, restore, dil) | **PASS** | `npm run verify:smoke` 10/10 + `src/test/notification-service.test.ts` 7/7 + `npm run verify:trash` restore adımı |
| 16 | NSIS + MSI temiz kurulum/kaldırma | **PASS** | `npm run verify:installer` 8/8 |
| 17 | Rollback tatbikatı (PR-2, PR-4) | **PASS** | `ROLLBACK_DRILL_2.2.1_TR.md` — iki ayrı geri alma derlemesi |
| 18 | `BUILD_INFO.json` commit = HEAD, `dirty: false` | **PASS** | `npm run check:build-info` → `Build provenance OK` |

## 15 — Smoke kanıtı

`npm run verify:smoke` gerçek `node-cleaner.exe` üzerinde, izole bir `APPDATA` ile
10 kontrol çalıştırır (çıktı 10/10):

| Kontrol | Ne kanıtlar |
|---|---|
| S-00 / S-00b | Binary çalışır, sürüm 2.2.1, tarama gerçek hedef bulur |
| S-01 | Webhook 200 → gövde teslim edilir (220 bayt), başarı bildirilir |
| S-02 | Webhook 500 → uyarı loglanır, süreç çökmez, exit 0 |
| S-03 | Erişilemeyen webhook → uyarı, çökme yok |
| S-08a / S-08b | `tr` ↔ `en` dil değişimi CLI çıktısına anında yansır |
| S-09 | Ayar başka süreçte kalıcı (dil değişimi geri dönmez) |
| S-10 | GUI başlar ve 8 saniye ayakta kalır |
| S-11 | GUI sonrası `config.json` geçerli JSON ve şema v4 |

Tarayıcı/CLI ile tetiklenemeyen iki davranış kod katmanında kanıtlanır:

- **Bildirim (S-04):** `src/test/notification-service.test.ts` 7 test — `both`,
  `desktop`, `in_app`, `none` kanalları, izin reddi, webhook hata kanalı ve
  dil değişiminde gövde metni. İzin `granted` değilse masaüstü bildirimi
  oluşturulmaz, uygulama içi toast çalışmaya devam eder.
- **Tarama/temizlik iptali (S-05/S-06):**
  `scanner::tests::cancelled_discovery_returns_partial_outcome_without_error`
  (kısmi sonuç, hata yok, `stop_reason=cancelled`) ve
  `cleanup::tests` iptal testi (`cancelled=true`, `processed=0`, `skipped=N`,
  hiçbir dosya silinmez, `CleanupEvent::Cancelled` yayınlanır).
- **Geri yükleme (S-07):** `npm run verify:trash` artık ikinci bir round-trip
  yapar ve Windows kabuğunun yerelleştirilmiş **Restore** fiilini çağırır;
  klasör özgün yoluna 2 dosya / 6144 bayt olarak döner.

> Operasyonel not: masaüstü bildiriminin *görünmesi* Windows bildirim iznine ve
> WebView2 kabuğuna bağlıdır. Yönlendirme ve izin mantığı otomatik test edilir;
> hedef makinede ilk kurulumdan sonra Ayarlar → Bildirimler → "Masaüstü testi"
> ile bir kez gözle doğrulanması önerilir. Bu bir kapı koşulu değildir.

## 16 — Kurulum kanıtı

`npm run verify:installer` gerçek `release_output/` artefaktlarıyla 8/8 geçer:

| Kontrol | Sonuç |
|---|---|
| I-01 NSIS sessiz kurulum | Kurulum `%LOCALAPPDATA%\Dev Cleaner` içine yapılır, exe üretilir |
| I-02 NSIS sürümü | Kurulu binary `2.2.1` bildirir |
| I-03 MSI sessiz kurulum | `ALLUSERS=2 MSIINSTALLPERUSER=1` ile yükseltmesiz kurulum, kayıt girdisi oluşur |
| I-04 MSI sürümü | Kurulu binary `2.2.1` bildirir |
| I-05 NSIS kaldırma | Dosyalar ve kayıt girdileri gider; boş klasör için RunOnce temizliği kuyruklanır |
| I-05b Kuyruklu klasör temizliği | Kuyruk çalıştırıldığında klasör gerçekten silinir |
| I-06 MSI kaldırma | Ürün kaydı ve kurulum klasörü temizlenir |
| I-07 Artık kontrolü | Ne klasör ne kayıt girdisi kalır |

Bu tatbikat sırasında gerçek bir kusur bulundu ve düzeltildi: NSIS kaldırıcısı
kendi çalıştığı klasörü silemediği için boş `Dev Cleaner` klasörü kalıyordu.
`src-tauri/nsis/hooks.nsh` içindeki `NSIS_HOOK_POSTUNINSTALL` artık
`HKCU\...\RunOnce\DevCleanerRemoveInstallDir` ile boş klasörü bir sonraki
oturumda siliyor.

## 17 — Rollback tatbikatı

İki senaryo ayrı ayrı uygulandı, her biri release derlemesi + 8 saniyelik GUI
çalışması + CLI taraması ile doğrulandı, sonra `git checkout` ile geri alındı.
Ayrıntı: `ROLLBACK_DRILL_2.2.1_TR.md`.

## 18 — Provenance

`scripts/build-release.js` derlemeden önce kirli ağacı reddeder ve
`release_output/BUILD_INFO.json` içine sürüm, commit, dal, `dirty` ve artefakt
SHA-256 özetlerini yazar. `npm run check:build-info` bu dosyayı `HEAD` ile
karşılaştırır:

```powershell
npm run build:release     # temiz ağaçtan
npm run check:build-info  # Build provenance OK
```

Kapı, `release_output/` içindeki 2.2.0 / `dirty: true` kalıntısını bu kontrolle
yakalar; yayın öncesi son adım budur.
