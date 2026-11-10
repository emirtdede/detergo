# Rollback Tatbikatı — 2.2.1 (E1-05)

**Durum:** `BEKLİYOR` — çalışan uygulama ve git geçmişi gerektirir.

## Amaç

Planın 10. bölümündeki geri alma senaryolarından en riskli ikisini (PR-2 webhook ve
PR-4 uygulama effect'leri) geri alındığında uygulamanın açılmaya devam ettiğini kanıtlamak.

## Ön koşullar

- Her PR birleşmeden önce `git tag pre-merge-<PR>` alınmış olmalı.
- `settings.json.bak` yazma öncesi oluşturulur.

## Tatbikat adımları

### R-01 — Webhook geri alma (PR-2)

1. `test_webhook` komutunu devre dışı bırakan commit'i uygula (veya `git revert <PR-2>`).
2. `cargo build` + `npm run build`.
3. Uygulamayı aç; Ayarlar → Webhook bölümü "desteklenmiyor" gösteriyor mu?
4. Tarama/temizlik akışı webhook olmadan çalışıyor mu?
5. `git revert` ile geri al; tekrar derle ve aç.

| Kontrol | Beklenen | Sonuç |
|---|---|---|
| Uygulama açılıyor | Evet | ☐ |
| Webhook UI zarifçe devre dışı | Evet | ☐ |
| Diğer ayarlar bozulmuyor | Evet | ☐ |
| Geri alma sonrası eski davranış | Evet | ☐ |

### R-02 — Uygulama effect'leri geri alma (PR-4)

1. `App.tsx` effect birleştirmesini geri al.
2. Derle ve aç; tarama başlat/durdur, dil değiştir, pencereyi kapat.
3. Çift tarama veya kapanışta flush kaybı var mı?
4. Geri al ve tekrar doğrula.

| Kontrol | Beklenen | Sonuç |
|---|---|---|
| Çift tarama yok | Evet | ☐ |
| Kapanışta ayar flush | Evet | ☐ |
| Dil değişimi anında | Evet | ☐ |
| Çökme yok | Evet | ☐ |

## Sonuç

| Senaryo | Geri alma başarılı | Uygulama açılıyor | Veri kaybı | Not |
|---|---|---|---|---|
| R-01 | ☐ | ☐ | ☐ | |
| R-02 | ☐ | ☐ | ☐ | |

**İmza:** ____________________  **Tarih:** __________

> Not: Bu tatbikat yalnızca yerel/VM ortamında yapılır; üretim kullanıcı verisine
> dokunulmaz.
