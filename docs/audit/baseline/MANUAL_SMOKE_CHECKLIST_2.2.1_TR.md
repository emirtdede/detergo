# Smoke Kontrol Listesi — 2.2.1 (E1-03)

**Durum:** `PASS` — otomatik betik + kod katmanı testleri.
Bu dosya artık imza bekleyen bir liste değil, **çalıştırılabilir kanıtın** kaydıdır.

## Nasıl çalıştırılır

```powershell
npm run build:release     # temiz ağaçtan
npm run verify:smoke      # 10 kontrol, gerçek exe, izole APPDATA
npm run verify:trash      # geri dönüşüm kutusu + restore round-trip
npm test                  # bildirim yönlendirmesi dahil 92 test
```

`verify:smoke`, `scripts/fixtures/default-settings.json` dosyasını tohum olarak
kullanır. Bu fixture `AppSettings::default()` ile birebir aynıdır ve
`settings::tests::default_settings_fixture_matches_app_defaults` testiyle
korunur; şema büyürse fixture güncellenmeden test kırılır. (Kısmi JSON Windows
tarafından sessizce reddedilip İngilizceye düşüyordu — bu yüzden tam fixture
zorunlu.)

## Sonuçlar

| # | Kontrol | Kanıt | Sonuç |
|---|---|---|---|
| S-01 | Webhook 200 | `verify:smoke` — gövde teslim edildi (220 bayt), başarı mesajı | **PASS** |
| S-02 | Webhook 500 | `verify:smoke` — `[WARN]`, exit 0, çökme yok | **PASS** |
| S-03 | Webhook erişilemez | `verify:smoke` — zaman aşımı uyarısı, exit 0 | **PASS** |
| S-04 | Bildirim | `notification-service.test.ts` 9/9: kanal matrisi, izin reddi, hata kanalı, dil, Tauri geri düşüşü | **PASS** |
| S-05 | Tarama iptali | `scanner::tests::cancelled_discovery_returns_partial_outcome_without_error` | **PASS** |
| S-06 | Temizlik iptali | `cleanup::tests` iptal testi: `cancelled`, `processed=0`, `skipped=2`, sıfır silme | **PASS** |
| S-07 | Geri yükleme | `verify:trash` — Shell Restore fiili, 2 dosya / 6144 bayt geri döndü | **PASS** |
| S-08a | Dil `tr` | `verify:smoke` — CLI `Sürüm` | **PASS** |
| S-08b | Dil `en` | `verify:smoke` — CLI `Version`, `Sürüm` yok | **PASS** |
| S-09 | Ayar kalıcılığı | `verify:smoke` — ikinci süreçte dil korunur | **PASS** |
| S-10 | GUI açılışı | `verify:smoke` — 8 saniye ayakta, çökme yok | **PASS** |
| S-11 | Ayar dosyası | `verify:smoke` — GUI sonrası geçerli JSON, şema v4 | **PASS** |

## Ortam

| Alan | Değer |
|---|---|
| Sürüm | 2.2.1 |
| Platform | Windows 11 x64 (gerçek masaüstü oturumu) |
| Test türü | Release binary + otomatik betik |
| İzolasyon | Geçici `APPDATA`; kullanıcı ayarlarına dokunulmaz |

## Kapsam notu

Windows toast'u bu sürümde **WebView2 üzerinden gösterilemiyor**: WebView2, web
bildirimlerini `NotificationReceived` olayıyla barındırıcıya devreder ve wry bu
olaya abone olmaz. Bu nedenle `desktop` kanalı kabuk içinde uygulama içi toast'a
düşer; kullanıcı sessiz kayıp yaşamaz. Kanıt ve 2.3 için yerel toast + AUMID
planı: `docs/architecture/NOTIFICATIONS.md`.
