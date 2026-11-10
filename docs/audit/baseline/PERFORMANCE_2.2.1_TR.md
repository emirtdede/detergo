# Performans Doğrulaması — 2.2.1 (D4)

Ölçümler aynı makinede (Windows 11, Node 22, release Vite derlemesi) alınmıştır.
Amaç mutlak hız değil, denetimdeki P-5 bulgusunun kapandığını göstermektir.

## D4-01 — `dist/` boyut karşılaştırması

| Chunk | 2.2.0 (baseline) | 2.2.1 | Fark |
| --- | --- | --- | --- |
| `index-*.js` | 6.287,47 kB | 6.285,82 kB | −1,65 kB |
| `vendor-core-*.js` | 226,04 kB | 224,72 kB | −1,32 kB |
| `ConceptContainer-*.js` | 31,91 kB | **üretimde yok** | −31,91 kB |
| `ConceptContainer-*.css` | 11,32 kB | **üretimde yok** | −11,32 kB |
| `index-*.css` | 129,33 kB | 129,33 kB | 0 |
| `locales-bundle-*.js` | 3.366,83 kB | 3.366,83 kB | 0 |
| **Toplam (dist)** | ~9,63 MB | 9,59 MB | **−46,2 kB** |

Sonuç: C6-01/C6-02/C6-03 ile demo katmanı ve concept ekranları üretim
paketinden tamamen çıktı. Modül sayısı 2285 → 2278 düştü.

## D4-02 — 50.000 hedef arama + sıralama

`src/test/stress-virtualization.test.ts` içinde otomatik test:

- 50.000 `CleanupItem` üretimi, metin filtresi (`projectName` + `displayPath`)
  ve boyuta göre azalan sıralama.
- Ölçülen süre eşiği: **250 ms** (CI'da güvenli üst sınır).
- Ek olarak 1.000 hedef için filtre < 15 ms, sıralama < 10 ms, toplam < 5 ms,
  seçim kümesi < 5 ms eşikleri korunuyor.

Liste sanallaştırması `@tanstack/react-virtual` üzerinden yapılıyor; tablo
yalnızca görünür satırları render ediyor, bu nedenle 50k satır DOM'a yazılmıyor.

## D4-03 — Ayar yazma sayısı

`src/test/settings-write.test.ts` doğruluyor:

- 10 ardışık setter çağrısı **tek** `saveAppSettings` yazımına birleşiyor
  (250 ms debounce + seri yazma zinciri).
- Başarısız yazma zinciri bozmuyor; sonraki yazma başarılı oluyor ve hata toast'ı
  aynı burst içinde yalnızca bir kez gösteriliyor.

Önceki davranış: her setter ayrı yazma tetikliyordu (10 setter → 10 yazma).

## D4-04 — Geçmiş ekranı

`HistoryView` artık yalnızca aktif sekmeyi yüklüyor:

- `scans` sekmesi → yalnızca `localStorage` okuması (backend çağrısı yok).
- `cleanups` sekmesi → yalnızca `get_cleanup_history`.
- `actions` sekmesi → yalnızca `get_official_action_history`.

Önceden her ziyarette iki backend çağrısı paralel yapılıyordu; kullanıcı ilk
boyamada görmediği veriyi bekliyordu.
