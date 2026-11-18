# Node Cleaner — Uç Kullanıcı Denetim Raporu

Tarih: 2026-11-13
Kapsam: Masaüstü uygulamasının günlük kullanım akışları (tarama, sonuçlar,
temizlik, geçmiş, ayarlar, ajan araçları, bildirimler).
Yöntem: Kod okuma + gerçek kullanıcı akışı simülasyonu. Bu turda kod
değiştirilmedi; bulgular yalnızca kaydedildi.

Bu raporun düzeltme planı: `docs/audit/2026-11-13-end-user-fixes-plan.md`.

## Orta önem (4)

### M1 — Ölçülemeyen ajan hedefi "0 B" görünüyor
Ajan taramasında `logical_bytes == None` olan hedefler `Measured` olayına `0`
olarak yazılıyordu. Sonuç: okunamayan bir önbellek boş klasör gibi görünüyor,
sağlayıcı toplamları yanlış hesaplanıyor ve kullanıcı olmayan bir kazanç
görüyordu.

### M2 — Plan önizlemesi sırasında "Cancel Run" etkisiz
`CleanupPlanDialog` önizleme hazırlığı için de `busy` bayrağını kullanıyordu.
Bu sırada "çalıştırmayı iptal et" düğmesi var olmayan bir temizliği iptal
etmeye çalışıyor, diyalog kapanmıyor ve geç gelen önizleme yanıtı yeni
seçimin üzerine yazabiliyordu.

### M3 — Minimum öğe boyutu sınırı backend ile uyuşmuyor
Arayüz 1 GiB'a kadar değer kabul ediyor, backend `min_size_bytes` değerini
1 GiB'ta kırpıyor; ancak `save_app_settings` yalnızca `Ok(())` döndüğü için
kırpılmış değer ekrana geri gelmiyordu. Kullanıcı kaydettiğini sandığı
değerden farklı bir filtreyle tarama yapıyordu.

### M4 — Geçmişten geri yükleme yanlış görünüme ve bayat düğmeye gidiyor
Geri yükleme her zaman Projeler görünümüne yönlendiriyordu; ajan kapsamlı bir
anlık görüntü burada boş görünüyordu. Ayrıca kayıtlı anlık görüntü yokken de
"Son Taramayı Geri Yükle" düğmesi gösteriliyor, tıklanınca hata veriyordu.

## Düşük önem (8)

### L1 — Konum değişimi yanlış metin kullanıyor
Konum değiştirme diyaloğu "Çalışma Alanını Sıfırla" başlığını ve sıfırlama
düğme metnini kullanıyordu.

### L2 — Konum değişimi kalıcı anlık görüntüyü bırakıyor
`resetScan()` diske yazılmış son taramayı silmiyordu; yeni konum seçildikten
sonra eski klasör yeniden başlatmada geri geliyordu.

### L3 — Uyarı sayısı "N hedef" olarak gösteriliyor
Tarama uyarıları bandı, uyarı sayısını hedef sayısı biçiminde gösteriyordu.

### L4 — Kısayol kaydında erken başarı ve yakalanmamış promise
Kısayol güncellemesi yazma tamamlanmadan "güncellendi" bildirimi gösteriyor,
başarısız yazmada kullanıcı kalıcı olmayan bir ayarla kalıyordu.

### L5 — Ajan listesinde bayat `loading` kontrolü
`loading` closure üzerinden okunduğu için art arda yenilemeler koruma
kontrolünü atlayabiliyor, geç gelen yanıt yeni listeyi ezebiliyordu.

### L6 — `??` zinciri son tarama yolunu engelliyor
Boş dize (`""`) nullish sayılmadığından `lastScanPath` yedeği devreye
girmiyor, kullanıcı her seferinde klasör seçmek zorunda kalıyordu.

### L7 — Temizlik sonrası özet eski kalıyor
`markDeleted`/`removeItems` yalnızca öğeleri güncelliyor, `summary` toplamları
ve sağlayıcı toplamları temizlik öncesi değerleri göstermeye devam ediyordu.

### L8 — Seçim sayacı iki yerde farklı
Tablo `selectedIds.size` değerini, aksiyon çubuğu ise filtrelenmiş etkin
hedef sayısını gösteriyordu; iki sayı aynı seçim için farklı olabiliyordu.

## Ek sağlamlaştırma (3)

- **E1** — Disk doluluk bildirimi bekleme süresi yalnızca bellekte tutuluyordu;
  yeniden başlatma aynı uyarıyı hemen tekrar gösteriyordu.
- **E2** — `open_url` yalnızca protokol ön ekine bakıyordu; boş host, ters
  bölü ve adressiz `mailto:` kabul ediliyordu.
- **E3** — Bu rapor eksikti; düzeltme planı var olmayan bir dosyaya atıfta
  bulunuyordu.

## Kapanış ölçütü

Her bulgu kök nedeninde düzeltilecek, mümkün olan her madde regresyon testiyle
kilitlenecek ve `docs/audit/2026-11-13-end-user-fixes-plan.md` içindeki
doğrulama kapıları çalıştırılacaktır.
