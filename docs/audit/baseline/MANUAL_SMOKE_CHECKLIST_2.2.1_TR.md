# Manuel Smoke Kontrol Listesi — 2.2.1 (E1-03)

**Durum:** `BEKLİYOR` — gerçek Windows masaüstü oturumu gerektirir.
Bu dosya imzalanmadan üretim kapısının 15. maddesi kapatılamaz.

## Ortam

| Alan | Değer |
|---|---|
| Sürüm | 2.2.1 |
| Windows | _(doldurulacak)_ |
| Kurulum türü | NSIS / MSI |
| Test tarihi | _(doldurulacak)_ |
| Test eden | _(doldurulacak)_ |

## Kontroller

Her satır `GEÇTİ` / `KALDI` olarak işaretlenir; kalan varsa hata kaydı ve commit eklenir.

| # | Kontrol | Adım | Beklenen | Sonuç | Not |
|---|---|---|---|---|---|
| S-01 | Webhook 200 | Ayarlar → Webhook → yerel test sunucusu (`http://127.0.0.1:PORT/hook`) → Test | "Bağlantı başarılı", 2xx | ☐ | |
| S-02 | Webhook 500 | Aynı sunucu 500 döndürecek şekilde ayarlanır → Test | Net hata, toast, çökme yok | ☐ | |
| S-03 | Webhook erişilemez | Kapalı port (`http://127.0.0.1:1/hook`) → Test | Zaman aşımı/bağlantı hatası mesajı | ☐ | |
| S-04 | Bildirim | Tarama bitirilir | Windows bildirimi görünür, tıklanınca uygulama öne gelir | ☐ | |
| S-05 | Tarama iptali | Tarama sırasında İptal | Tarama durur, arayüz tutarlı kalır, audit'e `stopped_early` yazılır | ☐ | |
| S-06 | Temizlik iptali | Temizlik sırasında İptal | Kalan hedefler atlanır, silinenler raporlanır | ☐ | |
| S-07 | Geri yükleme | Geri dönüşüm kutusuna taşınmış hedefi geri yükle | Dosya eski konumuna döner, toast başarılı | ☐ | |
| S-08 | Dil değişimi | Ayarlar → Dil → Türkçe → İngilizce → yeniden başlat | Tüm görünür metinler değişir; eksik anahtar/İngilizce sızıntısı yok | ☐ | |
| S-09 | Ayar kalıcılığı | Dil + webhook + `mcpAllowDestructive` değiştir → kapat/aç | Değerler korunur, migrasyon v4 hatasız | ☐ | |
| S-10 | Kapanış flush | Ayar değiştir → hemen pencereyi kapat → aç | Son değişiklik kaydedilmiş | ☐ | |

## İmza

| Rol | Ad | Tarih | İmza |
|---|---|---|---|
| Test eden | | | |
| Onaylayan | | | |

> Not: S-04 Windows bildirim iznine, S-07 geri dönüşüm kutusu erişimine bağlıdır. İzin
> reddedilirse sonuç `KALDI` değil `ATLANDI` olarak işaretlenir ve nedeni yazılır.
