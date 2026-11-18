# Node Cleaner — Ek 3 UI/UX Bulgularının Kalıcı Düzeltme Planı

Kaynak: 2026-11-14 tarihli **Ek 3** denetimi (U1–U14).
Kural: Geçici gizleme, metni görmezden gelme veya yalnızca kozmetik yama yok.
Her bulgu kök nedeninde kapatılacak; davranış değişiklikleri regresyon testiyle
kilitlenecek. U15 diye bir madde yoktur; numaralar kaynak raporla birebir aynıdır.

## A. İnternet araştırması ve uygulanacak dersler

| Konu | İncelenen kaynak | Uygulanacak ders |
|---|---|---|
| Yerel ayara duyarlı sıralama | MDN `Intl.Collator` — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Collator | Dilin kendi sıralama düzenini kullanmak için `Intl.Collator(locale, { numeric: true, sensitivity: "base" })` oluşturulup tek bir `compare` fonksiyonu paylaşılmalı. `localeCompare` her karşılaştırmada yeniden çözümlenir; tablo sıralamasında Collator örneği memoize edilmeli. |
| Türkçe büyük/küçük harf katlaması | MDN `String.prototype.toLocaleLowerCase` — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/toLocaleLowerCase | `İ` karakteri `tr` yerelinde `i` olur; `en-US` yerelinde `i` + birleşik nokta üretir. Arama indeksi `toLocaleLowerCase(locale)` ile kurulmalı, ardından `NFKD` + birleşik işaret temizliği uygulanmalı. |
| Modal klavye sahipliği | W3C WAI-ARIA APG "Dialog (Modal)" — https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/ ; MDN `aria-modal` — https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-modal | Modal açıkken odak dışarı çıkamaz. Global kısayollar `aria-modal="true"` bir katman varken hiç çalışmamalı; yalnızca Tab/Escape tuzağı yeterli değildir. |
| Aynı sekmede geçmiş değişikliğini duyurma | MDN `Window: storage event` — https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event | `storage` olayı değişikliği yapan pencerede tetiklenmez. Bu yüzden `localStorage` yazan yardımcı, aynı sekmedeki dinleyiciler için açık bir `CustomEvent` de yaymalı; çapraz pencere için `storage` dinleyicisi ayrıca tutulmalı. |
| Belge içi arama | Proje içi `DocsContentEn/Tr` + `docs-locales` sözleşmesi | Arama yalnızca başlık/anahtar kelimeyle sınırlı kalmamalı. Gövde metni, JSX kaynağından türetilmiş bir indekse alınmalı; yerelleştirilmiş sözlük varsa çevrilmiş karşılıklar da indekslenmeli. |
| Erişilebilir KPI ve liste sayaçları | Proje içi ortak `nc-kpi-card` / `EmptyState` / `details` desenleri | Sayaç ile gösterilen liste aynı kümeyi anlatmalı. Kırpma yapılacaksa "+N" göstergesi zorunlu; alternatif olarak tüm liste kaydırılabilir bir `details` içinde gösterilmeli. |

## B. Bulgu → kalıcı düzeltme

| # | Önem | Bulgu | Dosya | Kalıcı düzeltme | Regresyon kanıtı |
|---|---|---|---|---|---|
| U1 | Orta | "N Actions Ready" kullanılamayan aksiyonları sayıyor | `CachesView.tsx` | `actionsCount` yalnızca `action.available === true` olanları sayar; KPI metni ile düğme durumu aynı yüklemi kullanır. | Kod doğrulaması + typecheck. |
| U2 | Orta | Ctrl+F modal açıkken arkadaki aramaya odaklanıyor | `SearchField.tsx` | Kısayol dinleyicisi `aria-modal="true"` bir katman veya `activeModal` varken çıkar; ayrıca `event.defaultPrevented` ise karışmaz. | Unit test: modal varken `document.activeElement` değişmez. |
| U3 | Orta | History açıkken biten tarama listeyi/restore'u güncellemiyor | `scan-history.ts`, `HistoryView.tsx` | `appendScanHistory`/`clearScanHistory` aynı sekme için `CustomEvent` yayar; HistoryView bu olayı, `storage` olayını ve `lastSavedAt`/`persistedRevision` değişimini dinleyerek listeyi ve snapshot varlığını tazeler. | Unit test: append/clear olayı yayılır; store revizyonu değişince snapshot yeniden okunur. |
| U4 | Düşük | Konum değiştirme onayı "Reset Workspace" metnini kullanıyor | `ScanHeader.tsx`, `en.ts`, `tr.ts`, yerel sözlükler | Yeni `header.changeLocationConfirmDesc` anahtarı eklenir; metin yalnızca görünür tarama sonuçlarının ve seçimin sıfırlanacağını, kayıtlı geçmişin/snapshot'ın korunacağını söyler. | i18n kapsama + kullanım grep'i. |
| U5 | Düşük | Arama yerelleştirilmiş kategori etiketini bulamıyor | `ItemTable.tsx`, yeni `table-utils.ts` | Arama indeksine `localizeCategory(item.category, language)` ve görünen güvenlik sınıfı etiketi eklenir. | Unit test: `tr` dilinde "önbellek" öğeyi bulur. |
| U6 | Düşük | Türkçe büyük/küçük harf katlaması yok | `table-utils.ts` | Ortak `normalizeSearchText` yardımcısı `toLocaleLowerCase(locale)` + `NFKD` + birleşik işaret temizliği yapar. | Unit test: "istanbul" ↔ "İstanbul", "I"/"ı" davranışı. |
| U7 | Düşük | Sıralama yerel ayara/harf büyüklüğüne duyarsız | `ItemTable.tsx`, `table-utils.ts` | Metin alanları memoize edilmiş `Intl.Collator` ile karşılaştırılır; kategori görünen (yerelleştirilmiş) etikete göre sıralanır; eşitlikte ada göre kararlı bağlayıcı uygulanır. | Unit test: `tr` sıralamasında Ç/İ/Ş ve "Zebra"/"apple" sırası. |
| U8 | Düşük | "N cleanups" resmî CLI aksiyonlarını da sayıyor | `OverviewView.tsx` | Ömür boyu temizlik sayısı yalnızca `totals.runs`; `actionRuns` yalnızca "Operations" gibi genel sayaçlarda kalır. | Kod doğrulaması. |
| U9 | Düşük | "3 Scan History" dilbilgisi; "Last operation" iki kez | `HistoryView.tsx` | Tarama sayısı `"Tarama Geçmişi: 3"` biçiminde etiket + sayı olarak gösterilir. Son işlem kartının alt satırı, en son kaydın türünü (temizlik/komut/tarama) gösterir. | Unit test: `latestActivityKind` seçimi. |
| U10 | Düşük | Uyarı banner'ı 12 der, 6 satır gösterir | `ScanWarningsBanner.tsx`, `stale-scan.css` | Kırpma kaldırılır; tüm uyarılar kaydırılabilir `details` listesinde gösterilir. Sayaç ile liste aynı kümeyi anlatır. | Kod doğrulaması. |
| U11 | Düşük | About'ta iki kart "Customer Support" | `AboutView.tsx`, `en.ts`, `tr.ts`, yerel sözlükler | Yeni `about.contactBilling` anahtarı eklenir; faturalama kartı kendi başlığını kullanır. | i18n kapsama + kullanım grep'i. |
| U12 | Düşük | Bozuk katalog hatası ham İngilizce | `SettingsView.tsx` | Özet satırı yerelleştirilmiş "Kural Kataloğu / Something went wrong" olur; ham teknik ayrıntı `translateBackendText` ile çevrilip katlanabilir `details` içinde gösterilir. | Kod doğrulaması. |
| U13 | Düşük | Docs araması gövdeyi taramıyor | `DocsView.tsx`, yeni `docs-search.ts` | Başlık/anahtar kelimelere ek olarak, `DocsContentEn/Tr` kaynağından türetilen ve yerel sözlükle zenginleştirilen gövde indeksi taranır. İndeks ilk aramada tembel yüklenir. | Unit test: gövdede geçen bir terim ilgili konuyu döndürür. |
| U14 | Düşük | Filtre boşken başlık ve açıklama aynı cümle | `ItemTable.tsx` | Filtre kaynaklı boş durumda başlık `noResults` kalır, açıklama tekrarı kaldırılır; temizleme düğmesi eylem olarak kalır. | Kod doğrulaması. |

## C. Uygulama sırası

1. Ortak arama/sıralama yardımcısı (`search.ts`, `table-utils.ts`) ve ItemTable (U5–U7, U14).
2. KPI ve metin düzeltmeleri (U1, U8, U9, U11).
3. Modal klavye sahipliği (U2) ve History canlılığı (U3).
4. Konum metni (U4), katalog hatası (U12), uyarı listesi (U10), Docs gövde araması (U13).
5. Yerel sözlüklerin senkronizasyonu, regresyon testleri ve tüm doğrulama kapıları.

## D. Doğrulama kapıları

1. `npm run typecheck` → 0 hata.
2. `npm test` → mevcut testler + yeni regresyon testleri yeşil.
3. `npm run check:i18n` → kapsama, script ve çevrilmemiş değer denetimleri temiz.
4. `npm run check:audit` → denetim invariant'ları.
5. `npm run build` → üretim derlemesi başarılı.
6. `cargo test --manifest-path src-tauri/Cargo.toml` → backend değişmediyse de tam kapı olarak çalıştırılır.
7. Her U maddesi için düzeltmenin kodda varlığı `grep` ile doğrulanır ve sonuçlar bu belgeye işlenir.

## E. Uygulama sonucu ve doğrulama

Tüm maddeler kapatıldı. Not: önceki rapordaki **eski proje filtresi** maddesi
yanlış pozitif olarak reddedilmiş ve bu kapsama alınmamıştır. Ek 3'ün U5 maddesi
bundan farklıdır ("arama yerelleştirilmiş kategori etiketini bulamıyor") ve
aşağıda kapatılmıştır.

| # | Durum | Uygulanan değişiklik | Kanıt |
|---|---|---|---|
| U1 | Kapandı | `CachesView.cacheTotals.actionsCount` yalnızca `action.available === true` olanları sayıyor. | `CachesView.tsx:213`; typecheck. |
| U2 | Kapandı | `shouldHandleSearchShortcut` eklendi: `aria-modal="true"` katmanı veya `defaultPrevented` varken kısayol çalışmıyor; modal içindeki arama alanı erişilebilir kalıyor. | `SearchField.tsx`; `ek3-fixes.test.ts` (3 test). |
| U3 | Kapandı | `scan-history.ts` aynı sekme için `dev_cleaner:scan-history-changed` olayı yayıyor; `HistoryView` bu olayı, `storage` olayını ve `lastSavedAt`/`persistedRevision` değişimini dinleyip listeyi ve snapshot varlığını tazeliyor. | `scan-history.ts:28-36`, `HistoryView.tsx:88-110`; `ek3-fixes.test.ts`. |
| U4 | Kapandı | `header.changeLocationConfirmDesc` eklendi; dialog artık "Reset Workspace" metnini değil, konum değişikliğinin neyi sıfırlayıp neyi koruduğunu söylüyor. | `ScanHeader.tsx:536`; en/tr + 71 yerel sözlük. |
| U5 | Kapandı | Arama indeksi `localizeCategory` ve görünen etiketleri içeriyor (`table-utils.ts`). | `table-utils.ts:6-22`; `ek3-fixes.test.ts` "önbellek" haystack testi. |
| U6 | Kapandı | `normalizeSearchText` `toLocaleLowerCase` + `NFKD` + birleşik işaret temizliği yapıyor. | `search.ts`; `ek3-fixes.test.ts` (İ/ı, Ö, ğ). |
| U7 | Kapandı | Sıralama memoize `Intl.Collator` ile; kategori görünen etikete göre; eşitlikte kimlik bağlayıcısı. | `table-utils.ts:36-72`; `ek3-fixes.test.ts` (3 test). |
| U8 | Kapandı | Ömür boyu temizlik sayısı `totals.runs`; `actionRuns` bu karta eklenmiyor. | `OverviewView.tsx:113-116`. |
| U9 | Kapandı | Tarama sayısı `Tarama Geçmişi: N` biçiminde; "Son işlem" kartının alt satırı en yeni kaydın türünü gösteriyor, kendi başlığını tekrarlamıyor. | `HistoryView.tsx:210-233`, `:373-389`. |
| U10 | Kapandı | `slice(0, 6)` kaldırıldı; tüm uyarılar kaydırılabilir `details` listesinde (`max-height: 180px`). | `ScanWarningsBanner.tsx`, `stale-scan.css`. |
| U11 | Kapandı | `about.contactBilling` eklendi; faturalama kartı "Customer Support" yerine kendi başlığını kullanıyor. | `AboutView.tsx:386`; en/tr + 71 yerel sözlük. |
| U12 | Kapandı | Katalog hatası yerelleştirilmiş özet + `translateBackendText` ile çevrilmiş ham ayrıntı olarak katlanabilir `details` içinde. | `SettingsView.tsx:352-364`. |
| U13 | Kapandı | `docs-search.ts` JSX kaynağından konu bazlı gövde indeksi kuruyor, `docs-locales` ile zenginleştiriyor; ilk aramada tembel yükleniyor ve yerel başına memoize. | `docs-search.ts`; `DocsView.tsx:90-103`; `ek3-fixes.test.ts` (3 test). |
| U14 | Kapandı | Filtre kaynaklı boş durumda yinelenen açıklama kaldırıldı; başlık tek anlatım, temizleme düğmesi eylem olarak duruyor. | `ItemTable.tsx:251-269`. |

### Doğrulama kapıları (çalıştırıldı)

1. `npm run typecheck` → **0 hata**.
2. `npm test` → **16 dosya, 169 test geçti** (13'ü yeni Ek 3 regresyon testi).
3. `npm run check:i18n` → script denetimi 99.000 dize/502 dosya, kapsama 97.771 anahtar/503 sözlük, çevrilmemiş değer denetimi temiz.
4. `npm run check:audit` → 5 kural, ihlal yok.
5. `npm run build` → üretim derlemesi başarılı.
6. `cargo test --manifest-path src-tauri/Cargo.toml` → 154 birim testi + entegrasyon testleri geçti (yalnızca açıkça `ignored` işaretli benchmark/recycle-bin testleri atlandı).
