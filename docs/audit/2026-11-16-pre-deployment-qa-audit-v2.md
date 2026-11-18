# Dev Cleaner — Üretim Öncesi QA ve Mimari Denetim Raporu (v2, Nihai)

**Uygulama:** Dev Cleaner by Vellium
**Sürüm:** 2.2.2
**Denetim tarihi:** 16 Kasım 2026
**Kapsam:** `src/` (React 19 arayüzü, Zustand 5 store'ları, Tauri köprüsü, i18n, docs/legal katmanı) ve `src-tauri/src/` (tarama, temizlik, güvenlik, ayarlar, CLI, MCP, platform).
**Kapsam dışı:** Yapılandırma dosyaları (`vite.config.ts`, `tauri.conf.json`, `tsconfig*.json`, CI tanımları) — talep doğrultusunda atlandı.
**Eski rapor:** `docs/audit/2026-11-16-pre-deployment-qa-audit.md` (23 bulgu; tamamı bu turda yeniden doğrulandı).

> **Mimari not:** Bu proje **Next.js değildir**. Yığın **Vite 6 + React 19 + TypeScript + Zustand 5 + Tauri 2 (Rust)** üzerinedir. Bu nedenle **RSC / Server Component / Client Component sınırı analizi uygulanamaz**. Onun yerine **WebView (frontend) ↔ Tauri IPC ↔ Rust çekirdeği** sınırı, paket boyutu, reaktivite grafiği ve dosya sistemi yetkileri denetlenmiştir.

---

## 0. Yönetici Özeti

Bu turda önceki raporun 23 bulgusu tek tek yeniden doğrulandı, T-37 (specta sözleşmesi), T-38 (SQLite audit deposu) ve T-39 (handle tabanlı silme) kapanışları denetlendi ve kaynak ağacı baştan sona yeniden tarandı.

| Önem | Adet | Durum | Başlık |
|---|---|---|---|
| 🔴 Kritik | 0 | — | **Sorun bulunmadı** |
| 🟠 Yüksek | 0 | — | **Sorun bulunmadı** |
| 🟡 Orta | 1 | Düzeltildi | Docs arama kutusuna her tuş vuruşunda 800+ düğümlük makale gövdesinin yeniden render edilmesi |
| 🔵 Düşük | 1 | Düzeltildi | `localizeAppError` içinde dört adet `as any` daraltması |

**Üretim kararı:** **GO.** 13 kapının tamamı yeşil, ölçülebilir hedeflerin tamamı sağlanıyor (§9). Yeni kritik/yüksek bulgu yok.

**Bu turda değişen dosyalar:**

- `src/features/docs/DocsView.tsx` — gövde bileşenleri `React.memo` ile sarıldı, `copyToClipboard` `useCallback`, `contentProps` `useMemo` yapıldı.
- `src/lib/ui-text/index.ts` — `localizeAppError` içindeki `as any` okumaları tek bir `{ code?: unknown; message?: unknown }` daraltmasına indirildi.

---

## 1. Kritik Hatalar / Buglar

**Sorun bulunmadı.**

Aşağıdaki başlıkların her biri kaynak üzerinde tek tek doğrulandı; ihlal bulunamadı:

| Kontrol | Yöntem | Sonuç |
|---|---|---|
| Sonsuz döngü / render döngüsü | Tüm `useEffect`/`useCallback` bağımlılık dizileri ve store abonelikleri okundu | İhlal yok |
| `useEffect` bağımlılık eksikliği | `DocsView`, `SettingsView`, `AgentsView`, `CachesView`, `HistoryView`, `OverviewView`, `CleanupPlanDialog`, `ScanHeader`, `Dialog`, `WindowControls`, `CloseGuardDialog`, `ErrorBoundary` | İhlal yok |
| Memory leak (listener/timer/AudioContext) | `addEventListener`/`setInterval`/`setTimeout`/`AudioContext` sahipliği | Her sahip cleanup döndürüyor: `DocsView:44-50`, `Dialog:44-...`, `WindowControls:20-30`, `use-throttled-value:32-37`, `main.tsx:14` (`pagehide` → `disposeNotifications`) |
| Async race condition | `useScanController` (`activeScanRun`, `startPending`), `CleanupPlanDialog` (`loadGenerationRef`, `pendingKey`), `AgentsView` (`loadGenerationRef`, `unmountedRef`, `pendingReloadRef`), `scan-store` (`persistGeneration`) | Her yarış noktası jenerasyon/iptal bayrağıyla korunuyor |
| Unmount sonrası state yazımı | `AgentsView:178-187`, `BridgeUnavailableScreen:17-25`, `use-legal-locale:20-28`, `use-docs-i18n` | Hepsi `alive`/`unmounted` bayrağı kullanıyor |
| Global klavye çakışması | `Dialog` yığını (`dialogStack`), `SearchField.shouldHandleSearchShortcut`, `DocsView` Ctrl+F | Escape yığında en üstteki diyalogu kapatıyor; Ctrl+F modal açıkken çalan alanı çalmıyor |

---

## 2. Performans

### P-1 — Docs aramasında her tuş vuruşu makale gövdesini yeniden render ediyordu

**Dosya:** `src/features/docs/DocsView.tsx:99-126, 158-183, 317`
**Önem:** 🟡 Orta (yalnızca Docs sekmesi; kullanıcı algısı: yazarken gecikme)
**Durum:** Düzeltildi

**Sorun:** `searchQuery` her karakterde değişiyor ve `DocsView` yeniden render ediliyor. `contentProps` her render'da yeni bir nesne olduğu ve `DocsContentEn`/`DocsContentTr` memoize edilmediği için, arama kutusuyle hiçbir ilgisi olmayan **800+ satırlık makale gövdesi** (15 konu, kod blokları, tablolar) her tuş vuruşunda baştan kuruluyordu. `copyToClipboard` da her render'da yeni kimlik alıyordu; bu, olası bir `React.memo`'yu tek başına etkisiz kılardı.

**Önce:**

```tsx
const copyToClipboard = async (text: string, key: string) => { /* ... */ };

const contentProps = {
  activeTopicId,
  copiedKey,
  copyToClipboard,
  // ... 22 alan
};

{isTr ? <DocsContentTr {...contentProps} /> : <DocsContentEn {...contentProps} />}
```

**Sonra:**

```tsx
// src/features/docs/DocsView.tsx:15-22
/**
 * The article bodies are large trees and none of their props depend on the
 * sidebar search box. Memoizing them here (rather than inside the generated
 * docs sources, which `build-docs-index.mjs` parses) keeps a search keystroke
 * from rebuilding the whole documentation pane.
 */
const MemoDocsContentEn = React.memo(DocsContentEn);
const MemoDocsContentTr = React.memo(DocsContentTr);

// src/features/docs/DocsView.tsx:99-126
const copyToClipboard = useCallback(
  async (text: string, key: string) => { /* ... */ },
  [showToast, ui.errors.unknown],
);

// src/features/docs/DocsView.tsx:170-216
const contentProps = useMemo(
  () => ({ activeTopicId, copiedKey, copyToClipboard, /* ... */ generatedCliCommand }),
  [activeTopicId, copiedKey, copyToClipboard, cliShell, /* ... */ generatedCliCommand],
);

// src/features/docs/DocsView.tsx:317
{isTr ? <MemoDocsContentTr {...contentProps} /> : <MemoDocsContentEn {...contentProps} />}
```

**Neden gövde dosyalarında değil:** `scripts/build-docs-index.mjs` `DocsContentEn.tsx`/`DocsContentTr.tsx` dosyalarını ham metin olarak parse ediyor. Sarmalayıcı bu dosyalara konduğunda üreteç son konu bloğunun kuyruğunu da dizine ekledi ve `scripts/lib/docs-index.test.mjs` "kept in sync" testi kırıldı (bkz. §5, Ö-1). Sarmalayıcı bu yüzden tüketim noktasında, `DocsView` modül kapsamında tanımlandı.

**Doğrulama:** `npm run typecheck` 0, `npm test` 21 dosya / 191 test, `npm run build` 0; `DocsView` chunk'ı 137,05 kB (gzip 34,06 kB) sınırında kaldı, giriş chunk'ı değişmedi.

### Doğrulanan diğer performans kontrolleri

| Kontrol | Kanıt | Sonuç |
|---|---|---|
| Ağır türetmelerin throttle'ı | `useThrottledValue` Overview/History agregalarında (250 ms) | Uygun |
| Sanallaştırma | `ItemTable` `@tanstack/react-virtual` | Uygun |
| Store abonelik daraltması | `useShallow` (`SettingsView`), tekil seçiciler, `[items]` memo'ları | Uygun |
| Paket bölme | 73 dil dosyası ayrı chunk; `locales-bundle-*.js` yok; `theme-boot.js` ayrı | Uygun |
| Ölü ağırlık | `src/features/concepts/*` yalnız `import.meta.env.DEV` + `?concept` ile yükleniyor | Üretim paketinde yok |

---

## 3. Temizlik / Teknik Borç

### T-1 — `localizeAppError` içinde gereksiz `as any` daraltmaları

**Dosya:** `src/lib/ui-text/index.ts:948-958`
**Önem:** 🔵 Düşük
**Durum:** Düzeltildi

**Önce:**

```ts
if ("code" in err && typeof (err as any).code === "string") {
  code = (err as any).code;
}
if ("message" in err && typeof (err as any).message === "string") {
  rawMsg = (err as any).message;
}
```

**Sonra:**

```ts
// Narrow once instead of asserting `any` at every read: the payload may
// arrive from Rust, a rejected promise, or a synthetic test object.
const candidate = err as { code?: unknown; message?: unknown };
if (typeof candidate.code === "string") {
  code = candidate.code;
}
if (typeof candidate.message === "string") {
  rawMsg = candidate.message;
}
```

**Etki:** `src/` içindeki `as any` sayısı 6 → 2'ye indi.

### Doğrulanan temizlik kontrolleri

| Kontrol | Kanıt | Sonuç |
|---|---|---|
| Doğrudan `console.*` | Yalnız `src/lib/logging.ts:28` (tasarım gereği tek sink) | Hedefe uygun (0) |
| `?raw` kullanımı | `src/features/docs` ve tüm `src/` içinde 0 | Hedefe uygun |
| `TODO`/`FIXME`/`HACK`/`@ts-ignore`/`@ts-expect-error` | `src/` içinde 0 | Temiz |
| Ölü kod | `settings-sections.tsx` yalnız `SettingsView` tarafından tüketiliyor; `concepts/*` dev-only; kullanılmayan export tespit edilmedi | Temiz |
| Mock veri | `src/lib/tauri/scanner-api.mock.ts` yalnız `import.meta.env.DEV` dalında | Temiz |
| Kalan `as any` | `src/lib/ui-text/index.ts:724` (fallback `Proxy` hedefi `any`), `src/test/i18n.test.ts:92` (bilinçli geçersiz dil testi) | Gerekçeli |

---

## 4. Veri Bütünlüğü / Hata Yönetimi

**Sorun bulunmadı.**

| Kontrol | Kanıt | Sonuç |
|---|---|---|
| Hardcoded endpoint / gizli anahtar | `src/` içinde API anahtarı, token, gizli URL yok; yalnız `https://vellium.dev` ve `mailto:` sabitleri | Temiz |
| Env sızıntısı | Yalnız `import.meta.env.DEV` ve `import.meta.env?.DEV`; değer loglanmıyor | Temiz |
| Webhook kimlik bilgisi | `redactWebhookUrl` (`notification-service.ts:16-25`) yalnız origin gösteriyor; backend loopback/private hedefleri reddediyor | Uygun |
| Kullanıcı yolu maskeleme | `maskPath` tüm görünür yollarda; `docs` ve `history` dahil | Uygun |
| İç detay sızdıran hata | `localizeAppError` yol/errno ayrıntısını kullanıcıya taşımıyor; teknik bağlam `withTechnicalContext` ile ayrı | Uygun |
| Girdi doğrulama | `webhook-url.ts` şema + literal host; backend DNS pinleme; `NumberField` clamp; `preferences-store` `normalize*` katmanı | Uygun |
| Sözleşme kayması | `check:bindings` byte drift, `bindings-contract.test.ts` anlamsal drift, `check:gates` üretilen dosya varlığı | Uygun |
| Audit dayanıklılığı | SQLite WAL + `busy_timeout`, `user_version` migrasyonu, 50 000 satır prune, `clear_all` + `VACUUM` | Uygun |

---

## 5. Geliştirme Önerileri

**Ö-1 — Docs indeks üreteci kuyruk metnini konu içeriği sanıyor.**
`scripts/build-docs-index.mjs` son `activeTopicId === "..."` bloğundan dosya sonuna kadar olan metni de tarıyor. Bu turda `DocsContentEn.tsx` sonuna eklenen bir yorum bloğu `troubleshooting` konusunun indeksine girdi. Öneri: üreteç yalnızca `export const DocsContent*` bileşen gövdesini (`{ ... };`) kapsasın; bileşen dışına yazılan her metin yok sayılsın. Kabul: dosya sonuna eklenen bir yorum `docs-index.generated.json`'u değiştirmemeli.

**Ö-2 — Docs gövdelerini konu başına modüle ayır.**
`DocsContentEn.tsx` (1 117 satır) ve `DocsContentTr.tsx` (1 102 satır) tek dosyada 15 konu barındırıyor. Konu başına `lazy()` modül, hem ilk açılış chunk'ını küçültür hem de `React.memo` sınırını konu düzeyine indirir. Ön koşul: Ö-1 (üreteç dosya düzenine bağımlı).

**Ö-3 — `as any` için lint kapısı.**
`eslint`/`typescript-eslint` `no-explicit-any` kuralı `src/` için `error`, test ve `createFallbackProxy` için gerekçeli `eslint-disable` ile açılsın. Kabul: yeni `as any` CI'da kırmızı.

**Ö-4 — Performans regresyon testi.**
Vitest + React Testing Library ile "Docs aramasına 5 karakter yazıldığında makale gövdesi render sayısı artmaz" testi eklenebilir (render sayacı `React.Profiler` ile). Kabul: memo kaldırıldığında test kırmızı.

**Ö-5 — Sözleşme daraltmalarını görünür tut.**
`bindings-contract.test.ts` içindeki `NARROWED` tablosu büyümeye açık; her yeni daraltma için gerekçe zorunlu kalsın. Kabul: gerekçesiz daraltı eklenirse test kırmızı (mevcut yapı bunu zaten destekliyor, dokümantasyon eklensin).

---

## 6. WBS — Atomik İş Parçaları

| ID | İş parçası | Bağımlılık | Çıktı | Durum |
|---|---|---|---|---|
| W-01 | Docs gövde memoizasyonu (`React.memo` + `useCallback` + `useMemo`) | — | `DocsView.tsx` değişikliği | ✅ |
| W-02 | Docs indeks üretecinin sınırını doğrula (regresyon testi yeşil) | W-01 | `npm test` 191/191 | ✅ |
| W-03 | `localizeAppError` daraltması | — | `ui-text/index.ts` değişikliği | ✅ |
| W-04 | Tip kapısı | W-01, W-03 | `typecheck` 0 | ✅ |
| W-05 | JS kapıları | W-04 | `check:gates`/`check:audit`/`check:i18n`/`check:version`/`check:languages`/`check:bindings` 0 | ✅ |
| W-06 | Format kapısı | W-01, W-03 | `format:check` 0 | ✅ |
| W-07 | Üretim derlemesi ve boyut ölçümü | W-04 | `dist/assets/index-*.js` 233 747 B; `theme-boot.js` var; `locales-bundle-*` 0 | ✅ |
| W-08 | Rust kapıları | — | `cargo test` 184 lib + 20 entegrasyon; `clippy -D warnings` 0; `fmt --check` 0 | ✅ |
| W-09 | Rapor ve kapanış kaydı | W-05..W-08 | Bu dosya + `docs/REMEDIATION_PLAN.md` §13 | ✅ |
| W-10 | Ö-1 üreteç sıkılaştırması | W-02 | `build-docs-index.mjs` değişikliği | ⏭ Sıradaki sürüm (yayın engeli değil) |
| W-11 | Ö-2 konu bazlı kod bölme | W-10 | Yeni modül yapısı | ⏭ Sıradaki sürüm |

---

## 7. Parça Bazlı Risk Tablosu

| ID | Risk | Etki | Olasılık | Azaltma | Geri dönüş (fallback) |
|---|---|---|---|---|---|
| W-01 | `React.memo` eski prop kimliği nedeniyle güncellenmeyen içerik | Orta | Düşük | `contentProps` tüm bağımlılıkları listeliyor; `copiedKey`/`activeTopicId`/CLI alanları dahil | `MemoDocsContent*` sarmalayıcısını kaldır, `DocsContent*` doğrudan kullan |
| W-01 | Memo'nun docs indeks üretecini bozması | Orta | Orta (bir kez gerçekleşti) | Sarmalayıcı gövde dosyalarının dışında | Sarmalayıcıyı `DocsView` içine taşı (mevcut çözüm) |
| W-03 | Hata nesnesinin `code`/`message` alanlarını kaybetmesi | Düşük | Düşük | `unknown` daraltması + `typeof === "string"`; 191 test ve `localizeAppError` çağrı yolları | Eski `in` + cast bloğuna dön |
| W-05 | Üretilen sözleşme ile Rust arasında bayt kayması | Yüksek | Düşük | `check:bindings --check` + CI adımı | `npm run generate:bindings` ile yeniden üret |
| W-07 | Giriş chunk'ının 2 097 152 B hedefini aşması | Yüksek | Düşük | Ölçüm: 233 747 B; dil dosyaları lazy | Yeni eager import'u geri al |
| W-08 | Windows'a özgü testlerin ortamda kilitlenmesi | Orta | Orta | `cargo test --locked`; junction/recycle testleri hedefli | Testi `#[ignore]` ile ayır (mevcut desen) |
| W-10 | Üreteç sıkılaştırmasının mevcut indeksi değiştirmesi | Orta | Orta | Değişiklik öncesi/sonrası indeks diff'i | Üreteci eski haline döndür, indeksi yeniden üret |

---

## 8. Senaryolar, Adımlar ve Kabul Kriterleri

### 8.1 Kritik akış senaryoları

| ID | Senaryo | Adımlar | Kabul kriteri |
|---|---|---|---|
| S-1 | Tarama → plan → geri dönüşüm kutusu | Klasör seç → Tara → hedef seç → Planı aç → Onayla | İlerleme 0→%100; rapor satırları `movedBytes > 0`; audit kaydı 1; hata yok |
| S-2 | Kalıcı silme onayı | Plan → Kalıcı sil → onay kutusu → `confirm` | Onay yoksa buton pasif; onayla `reclaimedBytes > 0`; TOCTOU kontrolü logda |
| S-3 | Tarama iptali | Tarama başlat → durdur | Terminal olay `cancelled`; kısmi sonuç korunur; plan oluşturulamaz |
| S-4 | Arka plana alınan temizlik | Plan → Arka planda sürdür → başka sekme | Dock ilerlemeyi gösterir; uygulama kapanışı temizliği iptal edip bekler |
| S-5 | Webhook testi | Ayarlar → Webhook URL → Test | Geçerli URL'de başarı toast'ı; geçersizde alan hatası; URL maskeli log |
| S-6 | Dil değişimi | Ayarlar → Dil → 73 dilin herhangi biri | UI dili anında değişir; yeni dil chunk'ı ayrı yüklenir; `index` chunk büyümez |
| S-7 | Docs araması | Docs → arama kutusuna "TOCTOU" | Sonuç listesi filtrelenir; makale gövdesi yeniden kurulmaz; Ctrl+F alanı odaklar |
| S-8 | Ayar yazımı hatası | Disk dolu benzeri hata enjekte et | Tek toast; kuyruk canlı kalır; sonraki yazım başarılı |
| S-9 | Bozuk ayar dosyası | Geçersiz JSON yaz → uygulamayı aç | Varsayılanlar yüklenir; dosya korunur; kurtarma bayrağı görünür |
| S-10 | Sözleşme kayması | Rust DTO'suna alan ekle, üretme | `check:bindings` kırmızı; `generate:bindings` sonrası yeşil; sözleşme testi alanı doğrular |

### 8.2 Kapı senaryoları

| ID | Senaryo | Adımlar | Kabul kriteri |
|---|---|---|---|
| G-1 | Tip kapısı | `npm run typecheck` | 0 hata |
| G-2 | Birim testleri | `npm test` | 21 dosya / 191 test geçer |
| G-3 | Üretim derlemesi | `npm run build` | 0 hata; `dist/theme-boot.js` var; `locales-bundle-*` yok |
| G-4 | Regresyon kapıları | `npm run check:gates` | "Regression gates passed" |
| G-5 | Audit değişmezleri | `npm run check:audit` | 5 kural, 0 ihlal |
| G-6 | i18n | `npm run check:i18n` | 3 alt denetim geçer |
| G-7 | Format | `npm run format:check` | Tüm dosyalar Prettier uyumlu |
| G-8 | Sürüm | `npm run check-version` | 2.2.2 üç yerde eşit |
| G-9 | Kurulum dilleri | `npm run check:languages` | 73/73 |
| G-10 | Sözleşme | `npm run check:bindings` | "up to date" |
| G-11 | Rust testleri | `cargo test --locked` | 184 lib + entegrasyon geçer |
| G-12 | Clippy | `cargo clippy --locked --all-targets -- -D warnings` | 0 uyarı |
| G-13 | Rust format | `cargo fmt -- --check` | 0 fark |

---

## 9. Ölçülen Kapı Sonuçları

| Kapı | Komut | Sonuç |
|---|---|---|
| Tip | `npm run typecheck` | ✅ 0 hata |
| Test | `npm test` | ✅ 21 dosya / 191 test |
| Derleme | `npm run build` | ✅ 2 226 modül; `index-DUg7gbb9.js` **233 747 B** (gzip 71,41 kB) |
| Regresyon | `npm run check:gates` | ✅ docs `?raw`, `console.*`, mutex unwrap, IPC parity, üretilen sözleşme |
| Audit | `npm run check:audit` | ✅ 5 kural / 0 ihlal |
| i18n | `npm run check:i18n` | ✅ 86 870 string / 502 dosya; 86 974 anahtar; 214 locale dosyası |
| Format | `npm run format:check` | ✅ |
| Sürüm | `npm run check-version` | ✅ 2.2.2 |
| Diller | `npm run check:languages` | ✅ 73/73 |
| Sözleşme | `npm run check:bindings` | ✅ "up to date" |
| Rust test | `cargo test --locked` | ✅ 184 lib + 20 entegrasyon testi (3 ağır test `#[ignore]`) |
| Clippy | `cargo clippy --locked --all-targets -- -D warnings` | ✅ 0 |
| Rust format | `cargo fmt -- --check` | ✅ 0 |

**Ölçülebilir hedefler:**

| Hedef | Ölçüm | Durum |
|---|---|---|
| `index` chunk < 2 097 152 B | 233 747 B | ✅ |
| `locales-bundle-*.js` yok | 0 dosya | ✅ |
| `dist/theme-boot.js` var | Var | ✅ |
| Üretimde `.lock().unwrap()` = 0 | `check:gates` | ✅ |
| `src/features/docs` içinde `?raw` = 0 | 0 | ✅ |
| `logging.ts` dışında `console.*` = 0 | 0 | ✅ |

---

## 10. Kapsam Notları ve Ertelenen İşler

- **RSC / Server Component:** uygulanamaz (Vite SPA + Tauri). Bu raporun mimari sınırı WebView ↔ IPC ↔ Rust'dır.
- **Yapılandırma dosyaları:** talep üzerine denetlenmedi; yalnızca ürettikleri ölçümler raporlandı.
- **T-37/T-38/T-39:** kapalı. Ayrıntı: `docs/audit/2026-11-16-remaining-work-plan.md` §5, `docs/REMEDIATION_PLAN.md` §12.
- **Ertelenen (yayın engeli değil):** Ö-1, Ö-2 (docs üreteci sıkılaştırma ve konu bazlı bölme). Gerekçe: yayın davranışını etkilemiyor, regresyon riski Ö-1'de ölçülmüş durumda.
