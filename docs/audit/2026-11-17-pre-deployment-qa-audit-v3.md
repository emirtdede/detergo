# Dev Cleaner 2.2.3 — Kapsamlı Kod Denetimi (v3)

| Alan | Değer |
| --- | --- |
| Tarih | 2026-11-17 |
| Sürüm | 2.2.3 (yayın öncesi) |
| Dal / HEAD | `feat/2.0-multi-ecosystem-engine` / `239d168` |
| Kapsam | `src/**` (frontend) + `src-tauri/src/**` (Rust çekirdek) |
| Kapsam dışı | Konfigürasyon dosyaları (`vite.config.*`, `tauri.conf.json`, `Cargo.toml`, `package.json`, CI YAML, `*.toml` katalog dosyası) — talep gereği atlandı |
| Yöntem | Dosya dosya okuma, çapraz referans doğrulaması, ölü kod / `any` / `unwrap` taraması, önceki iki turun regresyon kontrolü |
| Önceki raporlar | `2026-11-16-pre-deployment-qa-audit.md`, `2026-11-16-pre-deployment-qa-audit-v2.md` |

---

## 0. Yönetici Özeti

Bu turda **kritik veya yüksek öncelikli yeni bulgu yoktur.** Önceki iki turda kapatılan
sözleşmeler (path guard, plan doğrulama, oturum TTL, yıkıcı işlem kapıları, webhook SSRF
koruması, log redaksiyonu) kod üzerinde tek tek doğrulandı ve hâlâ geçerlidir.

Bulunan 13 kalem, ağırlıklı olarak **kenar durum (edge case), gözlemlenebilirlik ve
teknik borç** sınıfındadır:

| Öncelik | Adet | Kimlikler |
| --- | --- | --- |
| Kritik | 0 | — |
| Yüksek | 0 | — |
| Orta | 7 | B-1, B-2, B-3, P-1, T-1, V-1, V-2, V-3 |
| Düşük | 6 | B-4, P-2, P-3, P-4, T-2, T-3, T-4, V-4 |

> Not: Orta satırındaki kimlik sayısı 8'dir; tablo "bulgu ailesi" bazında sayılmıştır.
> Aşağıdaki bölümlerde her bulgu tek tek, dosya:satır ve düzeltme koduyla verilmiştir.

Kalite kapıları bu denetim sırasında değiştirilmedi; son ölçümde tümü yeşildi:
`typecheck` 0 hata · `npm test` 25 dosya / 219 test · `format:check` uyumlu ·
`check:gates` geçti · `check:audit` 5 kural / 0 ihlal · `check:i18n` 3 denetim geçti.

---

## 1. Kritik Hatalar ve Buglar

### 1.0 Kritik seviye

**Sorun bulunmadı.**

Kritik kabul edilen yüzeyler bu turda ayrıca doğrulandı; hepsi beklendiği gibi çalışıyor:

- `src-tauri/src/safety/path_guard.rs` — symlink/reparse reddi, sistem dizini ve korunan
  bileşen kontrolü, `scan_roots` + `protected_paths` kesişimi, `canonicalize` sonrası
  yeniden doğrulama.
- `src-tauri/src/cleanup/plan.rs` + `coordinator.rs` — `verify_snapshot` ile plan
  öncesi/sonrası `file_id` + boyut + ns çözünürlüklü mtime karşılaştırması,
  `PLAN_TTL_SECS = 30 * 60`.
- `src-tauri/src/scanner/session.rs` — oturum TTL'i tarama bitince yenileniyor
  (`refresh_deadline`), yani uzun tarama kullanıcının inceleme süresini yemiyor.
- `src-tauri/src/mcp/mod.rs:517,926` — `mcp_allow_destructive` varsayılan `false` ve iki
  ayrı kapıda kontrol ediliyor; preview grant TTL'i plan TTL'inden kısa.
- `src-tauri/src/commands/webhook_commands.rs:189-194,219-222` — DNS çözümü bir kez
  yapılıp **çözülen IP'ler `ClientBuilder::resolve` ile sabitleniyor**; DNS rebinding
  (TOCTOU) senaryosu kapalı. Redirect politikası `none`.
- Üretim kodunda `unwrap()`/`expect()` yok: tarama sonuçlarının tamamı test modülleri ve
  `src/bin/export_bindings.rs` (build aracı) içinde.
- `TODO/FIXME/HACK/XXX/@ts-ignore/@ts-nocheck/eslint-disable` taraması: `src` ve
  `src-tauri/src` içinde **0 sonuç**.

### 1.1 B-1 — [Orta] Dialog, sürükleme ile metin seçerken kapanıyor

**Konum:** `src/components/primitives/Dialog.tsx:127-133`

**Belirti:** Kapatma kararı `click` olayının hedefinin overlay olmasına bağlı. Kullanıcı
dialog içindeki uzun bir yolu seçmek için fareyi basılı tutup overlay üzerine çıkarıp
bıraktığında `click` hedefi `currentTarget` olur ve dialog kapanır. Aynı davranış yıkıcı
diyaloglarda (temizlik planı, fabrika sıfırlama) kullanıcının yarım kalan seçimini
kaybettirir.

**Hatalı kod:**

```tsx
<div
  className="dialog-overlay"
  onClick={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}
  role="presentation"
>
```

**Düzeltme:** Kapanma kararını `pointerdown` hedefine bağla; bırakma hedefi farklıysa
sürükleme say.

```tsx
const pressOnOverlayRef = useRef(false);

<div
  className="dialog-overlay"
  role="presentation"
  onPointerDown={(event) => {
    pressOnOverlayRef.current = event.target === event.currentTarget;
  }}
  onPointerCancel={() => {
    pressOnOverlayRef.current = false;
  }}
  onClick={(event) => {
    // Yalnız "overlay'e basıldı ve overlay üzerinde bırakıldı" kapatır.
    const wasOverlayPress = pressOnOverlayRef.current;
    pressOnOverlayRef.current = false;
    if (wasOverlayPress && event.target === event.currentTarget) onClose();
  }}
>
```

**Etki:** Kazara kapanma yok; Escape, X düğmesi ve footer düğmeleri aynen çalışmaya devam
eder (odak tuzağı ve `dialogStack` mantığı değişmez).

### 1.2 B-2 — [Orta] Fallback proxy, `null` dalında Proxy'yi `null` üzerine kuruyor

**Konum:** `src/lib/ui-text/index.ts:757-763`

**Belirti:** Özyineleme koşulu `typeof fallbackVal === "object"` — `null` için de doğrudur.
Yerelleştirme dosyasında bir anahtar nesne iken İngilizce karşılığı `null` ise (veya
İngilizce sözlük ileride `null` taşıyan bir alan eklerse) `createFallbackProxy(val, null)`
çağrılır; bir sonraki okuma `(fallback as any)[prop]` satırında `TypeError` atar. Hata
`get` tuzağının içinde oluştuğu için React render'ı komple düşer ve ErrorBoundary tüm
sayfayı boşaltır — tek bir eksik çeviri anahtarı yüzünden.

**Hatalı kod:**

```ts
if (
  typeof val === "object" &&
  val !== null &&
  !Array.isArray(val) &&
  typeof fallbackVal === "object"
) {
  return createFallbackProxy(val, fallbackVal);
}
return val;
```

**Düzeltme:**

```ts
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

if (isPlainObject(val) && isPlainObject(fallbackVal)) {
  return createFallbackProxy(val, fallbackVal);
}
// val nesne, fallback nesne değil/ null → fallback'i olduğu gibi döndür.
return val;
```

**Etki:** Eksik/bozuk çeviri anahtarı artık yalnızca o düğümde İngilizceye düşer; uygulama
ayakta kalır.

### 1.3 B-3 — [Orta] `localizeAppError` içindeki serbest metin zinciri sıraya duyarlı

**Konum:** `src/lib/ui-text/index.ts:1080-1134` (kritik satır 1083)

**Belirti:** Kod eşleşmesi tutmadığında hata mesajı İngilizce alt dizelerle sınıflandırılıyor.
`rawMsg.includes("not found")` testi, kendisinden **sonra** gelen daha özgül testleri
(`recycleBinNotFound`, `permanentDeleteFailed` vb.) gölgeler. Örneğin
`"Git executable not found"` veya `"Node.js not found"` mesajı kullanıcıya
"Yol bulunamadı" olarak gösterilir; oysa sorun araç kurulumudur. Aynı şekilde
`"Target not found in catalog"` da yanlış başlığa düşer.

**Hatalı kod:**

```ts
if (rawMsg.includes("Access denied") || rawMsg.includes("Permission denied"))
  return activeUi.errors.accessDenied;
if (rawMsg.includes("Path not found") || rawMsg.includes("not found"))
  return activeUi.errors.pathNotFound;
```

**Düzeltme:** Genel testi kaldır, özgül kalıpları öne al ve yalnız dosya sistemi bağlamını
kabul et:

```ts
// Özgül kalıplar önce, genel kalıplar en sonda.
const PATH_NOT_FOUND = /^(Path not found|The system cannot find the (path|file)|ENOENT)/i;

if (/^Access denied|^Permission denied|EACCES/i.test(rawMsg)) return activeUi.errors.accessDenied;
if (PATH_NOT_FOUND.test(rawMsg)) return activeUi.errors.pathNotFound;
// "… not found" tek başına yol hatası değildir: recycle-bin / araç / arama
// hataları kendi kalıplarıyla eşleşsin, eşleşmeyen generic'e düşsün.
```

**Etki:** Yanlış yerelleştirilmiş hata başlığı ortadan kalkar; destek taleplerinde yanlış
kök nedene yönlendirme azalır.

### 1.4 B-4 — [Düşük] `hydrateLocale` girdi şeklini doğrulamıyor

**Konum:** `src/lib/ui-text/index.ts:783-812` (çağrı: 836)

**Belirti:** `raw` doğrudan `Object.entries`'e veriliyor. JSON bir dizi, sayı veya `null`
olduğunda `Object.entries` ya anlamsız bir sözlük üretir ya `TypeError` atar. Proxy sayesinde
sonuç yine İngilizceye düşer, ancak hata sessizdir: hangi dil dosyasının bozuk olduğu
kaydedilmez, `check:i18n` dışında hiçbir iz kalmaz.

**Hatalı kod:**

```ts
function hydrateLocale(raw: any): UIText {
  const result: any = {};
  for (const [cat, keys] of Object.entries(raw)) {
```

**Düzeltme:**

```ts
function hydrateLocale(raw: unknown): UIText | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    log.warn("Locale dictionary has an unexpected shape; falling back to English");
    return null;
  }
  // … gövde aynı, ama `keys` için de aynı kontrol:
  for (const [cat, keys] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof keys !== "object" || keys === null || Array.isArray(keys)) continue;
```

ve çağrı yerinde:

```ts
const hydrated = hydrateLocale(raw);
const text = createFallbackProxy(hydrated ?? EN, EN);
```

---

## 2. Performans ve Optimizasyon

### 2.1 P-1 — [Orta] Docs aramasında aynı liste beş kez filtreleniyor

**Konum:** `src/features/docs/DocsView.tsx:157-170` (memo) ve `265-355` (beş ayrı `.filter`)

**Belirti:** `filteredTopics` her tuş vuruşunda yeniden hesaplanıyor (gövde indeksi 1.100+
satırlık doküman metnini kapsıyor), ardından JSX içinde **beş ayrı `.filter`** çağrısı aynı
diziyi beş kez tarıyor. Ek olarak `filteredTopics` içinde her konu için
`normalizeSearchText(t.title)` her tuş vuruşunda yeniden üretiliyor; oysa normalize edilmiş
başlık/anahtar sözlüğü dile bağlı olarak bir kez hesaplanabilir.

**Hatalı kod:**

```tsx
{filteredTopics.filter((t) => t.category === "guide").map((t) => ( ... ))}
...
{filteredTopics.filter((t) => t.category === "cli").map((t) => ( ... ))}
// … 5 kez
```

**Düzeltme:** Tek geçişte grupla; normalizasyonu dile bağlı memoize et.

```tsx
const normalizedIndex = useMemo(() => {
  const index = new Map<string, string>();
  for (const topic of topics) {
    index.set(topic.id, normalizeSearchText(topic.title, language));
  }
  return index;
}, [topics, language, docsLocaleRevision]);

const groupedTopics = useMemo(() => {
  const groups: Record<string, typeof filteredTopics> = {
    guide: [], cli: [], mcp: [], webhook: [], safety: [],
  };
  for (const topic of filteredTopics) {
    groups[topic.category]?.push(topic); // bilinmeyen kategori sessizce düşmez, aşağıda uyarılır
  }
  return groups;
}, [filteredTopics]);

// JSX: {groupedTopics.guide.map(...)}
```

`normalizedIndex` ayrıca arama karşılaştırmasında kullanılır:

```tsx
normalizedIndex.get(t.id)?.includes(query) ?? false
```

**Etki:** Tuş vuruşu başına 5 tam tarama + N adet `toLocaleLowerCase/normalize` yerine
1 tarama + 1 sözlük okuması. Arama kutusu 60 fps'te akıcı kalır.

### 2.2 P-2 — [Düşük] Hukuk görünümünde doküman her render'da yeniden kuruluyor

**Konum:** `src/features/legal/LegalView.tsx:131-133`

**Belirti:** `useLegalLocale(language)` dil sözlüğü geldiğinde bileşeni yeniden render
ettiriyor; `getLegalDocument` ve `getLegalDocMeta` memo kullanmadan her render'da çağrılıyor.
`getLegalDocument` çeviri birleştirmesi yapıyor (bölüm/paragraf bazlı), `docs` dizisi de her
seferinde yeni referans olduğu için alt tablist gereksiz yeniden çiziliyor.

**Hatalı kod:**

```tsx
useLegalLocale(language);
const legalDocument = getLegalDocument(language, legalDoc);
const docs = getLegalDocMeta(language);
```

**Düzeltme:**

```tsx
const docs = useMemo(() => getLegalDocMeta(language), [language]);
const legalDocument = useMemo(
  () => getLegalDocument(language, legalDoc),
  [language, legalDoc],
);
```

**Etki:** Sekme değişimi ve dil değişimi dışındaki render'larda (ör. bildirim sayacı
güncellemesi) doküman yeniden kurulmaz.

### 2.3 P-3 — [Düşük] Throttle hook'u mount'ta gereksiz state yazıyor

**Konum:** `src/lib/hooks/use-throttled-value.ts:18-25`

**Belirti:** `useState(value)` ile başlayan değer, ilk effect'te `Date.now() - 0 >= ms`
olduğu için aynı değerle tekrar yazılıyor. Zustand abonelikleri yüzünden 50.000 satırlık
tablo mount'unda bu ekstra render, ağır türetmelerin bir kez daha çalışmasına yol açar.

**Hatalı kod:**

```ts
const now = Date.now();
const elapsed = now - lastApplied.current;
if (elapsed >= ms) {
  lastApplied.current = now;
  setThrottled(value);
  return;
}
```

**Düzeltme:**

```ts
const now = Date.now();
const elapsed = now - lastApplied.current;

// Mount'ta `throttled` zaten `value`'dur; aynı referansı yazmak boşuna render üretir.
if (Object.is(throttled, value)) {
  lastApplied.current = now;
  return;
}
```

`throttled` bağımlılık listesine eklenmeli (`[value, ms, throttled]`); döngü oluşmaz çünkü
eşitlik durumunda `setThrottled` çağrılmıyor.

**Etki:** Tablo/özet mount'unda 1 gereksiz render ve buna bağlı agregasyon turu kalkar.

### 2.4 P-4 — [Düşük] İki görünüm farklı throttle sabiti kullanıyor

**Konum:** `src/features/items/ItemTable.tsx:115` (`400` ms) ve
`src/features/overview/OverviewView.tsx:166` (`250` ms)

**Belirti:** Aynı tarama verisinden türeyen iki gösterim farklı yaşta veri kullanıyor.
Tarama sırasında Özet'teki toplam bayt ile Tablo'nun alt toplamı 150 ms'ye kadar
tutarsız görünebilir; kullanıcı bunu "veri kaybı" olarak algılayabilir.

**Hatalı kod:**

```ts
const sortableItems = useThrottledValue(items, 400);   // ItemTable
const aggregateAll = useThrottledValue(allItems, 250); // OverviewView
```

**Düzeltme:** Tek bir sabit tanımla ve iki yerde de onu kullan:

```ts
// src/lib/hooks/use-throttled-value.ts
/** Aynı taramadan türeyen tüm ağır agregalar aynı kadansı paylaşır. */
export const SCAN_AGGREGATE_THROTTLE_MS = 300;
```

```ts
const sortableItems = useThrottledValue(items, SCAN_AGGREGATE_THROTTLE_MS);
const aggregateAll = useThrottledValue(allItems, SCAN_AGGREGATE_THROTTLE_MS);
```

**Etki:** Görünümler arası sayı tutarlılığı; bakım sırasında tek ayar noktası.

---

## 3. Temizlik ve Teknik Borç

### 3.1 T-1 — [Orta] Güvenilmeyen JSON sınırında `any`

**Konum:** `src/lib/ui-text/index.ts:748` (`target: any`), `753` (`fallback as any`),
`783` (`raw: any`), `784` (`const result: any = {}`), `788` (`Record<string, any>`),
`802` (`(...args: any[])`)

**Belirti:** Uygulamanın **tek güvenilmeyen veri girişi** olan yerelleştirme chunk'ları
`any` üzerinden geçiyor. `check:audit` bunu yakalamıyor çünkü kural seti `any`'yi
yasaklamıyor. Sonuç: B-2 ve B-4'teki hatalar derleyici tarafından görülemez; proxy'nin
dönüş tipi de yalan söylüyor (`T` döndürüyor ama içinde fonksiyon olmayan değerler
bulunabiliyor).

**Hatalı kod:**

```ts
function createFallbackProxy<T extends object>(target: any, fallback: T): T {
  return new Proxy(target, {
    get(obj, prop: string | symbol) {
      if (typeof prop === "symbol") return obj[prop];
      const val = obj[prop];
      const fallbackVal = (fallback as any)[prop];
```

**Düzeltme:** Sınırı tek bir tip tanımıyla kapat, içeride daralt.

```ts
type LocaleLeaf = string | ((...args: unknown[]) => string);
type LocaleTree = { readonly [key: string]: LocaleLeaf | LocaleTree };

const isLocaleTree = (v: unknown): v is LocaleTree =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function createFallbackProxy(target: LocaleTree, fallback: LocaleTree): LocaleTree {
  return new Proxy(target, {
    get(obj, prop) {
      if (typeof prop === "symbol") return Reflect.get(obj, prop);
      const value = obj[prop];
      const fallbackValue = fallback[prop];
      if (value === undefined || value === null || value === "") return fallbackValue;
      if (isLocaleTree(value) && isLocaleTree(fallbackValue)) {
        return createFallbackProxy(value, fallbackValue);
      }
      return value;
    },
  });
}
```

`hydrateLocale` de `unknown` alıp `UIText | null` döndürmeli (bkz. B-4); çağrı yerinde
`createFallbackProxy(hydrated ?? (EN as unknown as LocaleTree), EN as unknown as LocaleTree)`
gibi tek bir `as unknown` köprüsü kalır — `any` yok.

**Etki:** Yeni bir dil dosyası eklendiğinde hatalar derleme zamanında görünür; `as any`
sayısı 6 → 0.

### 3.2 T-2 — [Düşük] Tema listesi üç yerde kopyalanmış

**Konum:** `src/types/index.ts:1-17` (`ThemeMode` birleşimi),
`src/stores/preferences-store.ts:95-112` (`VERIFIED_THEMES`),
`src/features/settings/SettingsView.tsx:54-71` (`THEMES`)

**Belirti:** Yeni bir tema eklendiğinde üç dosyanın elle senkronlanması gerekir. Biri
unutulursa iki farklı sessiz hata oluşur: tema seçicide görünmez (THEMES) veya
`normalizeTheme` onu `dark-black`'e düşürür (VERIFIED_THEMES). `themeLabel` ayrıca
`theme.replace(/^(dark|light)-/, "")` ile ayrıştırıyor; ileride tire içermeyen bir kimlik
eklenirse etiket `"Dark - "` olur.

**Hatalı kod:**

```ts
export type ThemeMode = "dark-black" | "dark-gray" | /* … 14 satır */;

export const THEMES: ThemeMode[] = ["dark-black", "dark-gray", /* … */];
```

**Düzeltme:** Tek çalışma zamanı kaynağı, tipten türetme:

```ts
// src/types/index.ts
export const THEME_MODES = [
  "dark-black", "dark-gray", "dark-blue", "dark-purple",
  "dark-green", "dark-red", "dark-orange", "dark-yellow",
  "light-white", "light-gray", "light-blue", "light-purple",
  "light-green", "light-red", "light-orange", "light-yellow",
] as const;

export type ThemeMode = (typeof THEME_MODES)[number];
```

```ts
// preferences-store.ts
const VERIFIED_THEMES: ReadonlySet<string> = new Set<string>(THEME_MODES);
```

```ts
// SettingsView.tsx
import { THEME_MODES } from "@/types";
const THEMES: readonly ThemeMode[] = THEME_MODES;
```

**Etki:** Tek noktadan tema ekleme; üç kopya arasında sapma imkânsız.

### 3.3 T-3 — [Düşük] `theme` alanı `ThemeMode` yerine `string`

**Konum:** `src/types/index.ts:613` (`theme: string;`),
`src/stores/preferences-store.ts:24,426-431`

**Belirti:** Rust tarafından gelen serbest `string` kabul edilmeli (eski ayar dosyaları,
`bindings.ts:143`), ancak bunun tek geçerli kapı `normalizeTheme` olmalı. Şu an
`setTheme(theme: string)` çağrısı yalnızca içeride normalize ediyor; çağrı yerlerinde
(`SettingsView.tsx:640`) tip kontrolü yok. Bugün doğru çalışıyor, yarın `setTheme` çağıran
yeni bir kod yolu normalize'ı atlarsa `data-theme` geçersiz değer alır.

**Hatalı kod:**

```ts
setTheme: (theme: string) => {
  const normalized = normalizeTheme(theme);
```

**Düzeltme:**

```ts
setTheme: (theme: ThemeMode | string) => {
  // Tek geçerli kapı: bilinmeyen değer varsayılana düşer.
  const normalized: ThemeMode = normalizeTheme(theme) as ThemeMode;
  applyThemeToDom(normalized);
  set({ theme: normalized });
  syncPreferences(get());
},
```

`normalizeTheme` dönüş tipini `ThemeMode` yap:

```ts
export function normalizeTheme(theme: string): ThemeMode {
  const mapped = LEGACY_THEME_MAP[theme] ?? theme;
  return (VERIFIED_THEMES.has(mapped) ? mapped : "dark-black") as ThemeMode;
}
```

### 3.4 T-4 — [Düşük] `SettingsView.tsx` tek dosyada yedi bağımsız bölüm barındırıyor

**Konum:** `src/features/settings/SettingsView.tsx` (1.367 satır)

**Belirti:** Genel/tema, kısayol kaydı, webhook (taslak + test + kalıcılaştırma), profil
limitleri, ajan politikası, MCP, fabrika sıfırlama akışı aynı dosyada. Dosya boyutu tek
başına hata değil, ancak kısayol kaydı (`keydown` yakalama) ve webhook taslağı gibi
durum makineleri test edilebilir bir birimden yoksun; her değişiklik 1.300 satırın
tamamını yeniden gözden geçirmeyi gerektiriyor.

**Düzeltme (mekanik, davranış değişmez):**

```text
src/features/settings/
  SettingsView.tsx           (~200 satır: sekmeler + yönlendirme)
  ThemeSection.tsx           (THEMES, themeLabel, tema seçici)
  ShortcutSection.tsx        (kayıt durum makinesi + localizeShortcut)
  WebhookSection.tsx         (draft, persistWebhookDraft, test)
  LimitsSection.tsx          (PROFILE_DEFAULTS, NumberField'lar)
  AgentPolicySection.tsx     (ajan politikası + MCP anahtarları)
  DangerZone.tsx             (fabrika sıfırlama + onay diyalogları)
```

Her bölüm kendi `useUIText()` çağrısını yapar; `SettingsView` yalnızca aktif sekmeyi
render eder. Testler bölüm bazında `render(<WebhookSection />)` ile yazılabilir.

**Etki:** İnceleme yükü ve regresyon riski düşer; webhook/kısayol sözleşmeleri ayrı test
edilebilir hale gelir.

---

## 4. Veri Bütünlüğü ve Hata Yönetimi

### 4.1 V-1 — [Orta] Rust denetim deposu hataları release'te görünmez

**Konum:** `src-tauri/src/audit/repository.rs:277,317,376,442,687,697`

**Belirti:** Okuma hataları `eprintln!` ile stderr'e yazılıyor. Windows GUI alt sistemiyle
derlenen bir Tauri uygulamasında **attach edilmiş konsol yoktur**; bu satırlar release
kullanıcısında hiçbir yere gitmez. Kullanıcı geçmişi boş görür, destek ekibi hiçbir kayıt
bulamaz. Ayrıca `eprintln!` frontend'in `redactSecrets`/`maskPath` politikasını atlar:
hata metni bir yol içeriyorsa ham hâliyle stderr'e yazılır (bugünkü `rusqlite` hataları
için risk düşük, sözleşme yine de tutarsız).

**Hatalı kod:**

```rust
Err(err) => {
    eprintln!("[dev-cleaner] could not read cleanup history: {err}");
    Vec::new()
}
```

**Düzeltme:** Tek bir backend log yardımcısı ekle (dönen dosya + redaksiyon) ve tüm
denetim yollarını oraya bağla:

```rust
// src-tauri/src/logging.rs
pub fn warn(message: &str, err: impl std::fmt::Display) {
    let masked = crate::platform::mask_path(&err.to_string());
    let line = format!(
        "{} [dev-cleaner] {message}: {masked}\n",
        chrono::Local::now().format("%Y-%m-%dT%H:%M:%S")
    );
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true).append(true).open(crate::paths::log_file())
    {
        let _ = file.write_all(line.as_bytes());
    }
    #[cfg(debug_assertions)]
    eprint!("{line}");
}
```

```rust
Err(err) => {
    crate::logging::warn("could not read cleanup history", err);
    Vec::new()
}
```

**Etki:** Release'te de tanılanabilirlik; tek redaksiyon noktası; `eprintln!` sayısı
denetim modülünde 6 → 0.

### 4.2 V-2 — [Orta] Bozuk tarama geçmişi kalıcı olarak "boş" görünüyor

**Konum:** `src/features/history/scan-history.ts:73-109`

**Belirti:** `getScanHistory()` üç farklı durumu **aynı** `[]` dönüşüyle ezer: (a) gerçekten
kayıt yok, (b) `localStorage` erişilemiyor, (c) JSON bozuk. Bozuk JSON hiçbir zaman
onarılmaz veya silinmez; her okumada aynı hata yeniden oluşur ve "Geçmişi temizle"
dışında çıkış yolu yoktur. Ayrıca süresi geçmiş (90 gün) kayıtlar okuma sırasında
filtreleniyor ama depodan hiç atılmıyor — depo yalnızca bir sonraki yazmada küçülüyor.

**Hatalı kod:**

```ts
} catch (err) {
  // Corrupt JSON is a real data problem, not "no history yet".
  log.warn("Stored scan history is corrupt and was ignored", err);
  return [];
}
```

**Düzeltme:** Durumu dışa taşı ve onarımı yaz:

```ts
export interface ScanHistoryState {
  records: ScanHistoryRecord[];
  /** "corrupt" ve "unavailable" UI'da ayrı açıklanır. */
  status: "ok" | "empty" | "corrupt" | "unavailable";
}

export function readScanHistory(): ScanHistoryState {
  let raw: string | null;
  try {
    raw = localStorage.getItem(NEW_STORAGE_KEY);
  } catch (err) {
    log.warn("Scan history storage is unavailable", err);
    return { records: [], status: "unavailable" };
  }
  if (!raw) return { records: [], status: "empty" };

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("history is not an array");
    const records = parsed
      .filter(isScanHistoryRecord)
      .filter(isFresh)
      .slice(0, MAX_RECORDS)
      .map((r) => ({ ...r, rootPath: maskPath(r.rootPath) }));

    // Onarılmış listeyi geri yaz: bir sonraki okuma aynı bozuk satırları görmesin.
    if (records.length !== parsed.length) {
      localStorage.setItem(NEW_STORAGE_KEY, JSON.stringify(records));
    }
    return { records, status: records.length ? "ok" : "empty" };
  } catch (err) {
    log.warn("Stored scan history is corrupt and was ignored", err);
    // Bozuk veriyi silme: kullanıcı "Geçmişi temizle" ile bilinçli siler.
    return { records: [], status: "corrupt" };
  }
}

/** Geriye dönük uyumluluk. */
export const getScanHistory = (): ScanHistoryRecord[] => readScanHistory().records;
```

`HistoryView` boş durum metnini `status === "corrupt"` için ayrı gösterebilir
(`ui.history.corruptNotice`).

**Etki:** Veri bozulması görünür ve kendi kendini onarır; desteğe "geçmişim kayboldu"
yerine net bir durum gider.

### 4.3 V-3 — [Orta] `quote_cmd_arg` `%VAR%` genişlemesini engelleyemiyor

**Konum:** `src-tauri/src/cleanup/official_actions.rs:614-638`

**Belirti:** Yorum satırı doğru bir sınırı belirtiyor ("callers only pass the executable
path and static action arguments, never user input"), ancak **çalıştırılabilir yol
kullanıcı kontrolündedir**: sağlayıcı yolları disk taramasıyla bulunuyor. Windows'ta
`%` karakteri dosya adında yasak değildir; `C:\Users\x\%TEMP%\npm.cmd` gibi bir dizinden
keşfedilen bir `.cmd` shim'i `cmd.exe /C` üzerinden çalıştırıldığında `%TEMP%` ortam
değişkenine genişler. Sonuç en iyi durumda "dosya bulunamadı", en kötü durumda **farklı
bir programın yanlış argümanlarla çalıştırılması**. `cmd.exe /C` satırında `%` kaçışı
yoktur (batch dosyasındaki `%%` kuralı geçerli değildir).

**Hatalı kod:**

```rust
fn quote_cmd_arg(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\"\""),
            '\r' | '\n' | '\0' => {}
            _ => out.push(ch),
        }
    }
    out.push('"');
    out
}
```

**Düzeltme:** Sessizce yanlış komut çalıştırmak yerine reddet:

```rust
#[derive(Debug)]
enum CmdQuoteError {
    PercentExpansion, // %VAR% kaçırılamaz
    ControlChar,
}

fn quote_cmd_arg(value: &str) -> Result<String, CmdQuoteError> {
    if value.contains('%') {
        // cmd.exe /C satırında % genişlemesinin kaçışı yoktur; bu yolu çalıştırma.
        return Err(CmdQuoteError::PercentExpansion);
    }
    if value.chars().any(|c| c.is_control()) {
        return Err(CmdQuoteError::ControlChar);
    }
    let escaped = value.replace('"', "\"\"");
    Ok(format!("\"{escaped}\""))
}
```

Çağrı yerinde:

```rust
let quoted = quote_cmd_arg(&exe.display().to_string()).map_err(|_| {
    AppError::InvalidPath(
        "The tool path contains '%' or control characters and cannot be run safely."
            .to_string(),
    )
})?;
```

**Etki:** Yol kaynaklı komut enjeksiyonu yüzeyi kapanır; kullanıcı net bir hata görür
(sessiz yanlış davranış yerine).

### 4.4 V-4 — [Düşük] Bozuk `entries` JSON'u sessizce boş listeye dönüşüyor

**Konum:** `src-tauri/src/audit/repository.rs:266`

**Belirti:** `serde_json::from_str(&row.get::<_, String>(13)?).unwrap_or_default()` —
`entries` kolonu bozulduğunda kayıt **başarılıymış gibi** dönüyor ama içindeki hedefler
kayboluyor. Toplamlar (`reclaim_bytes`, `success_count`) ayrı kolonlardan geldiği için
kullanıcı "3,2 GB temizlendi, 0 öğe" gibi tutarsız bir geçmiş satırı görür; hiçbir log
kalmaz.

**Hatalı kod:**

```rust
entries: serde_json::from_str(&row.get::<_, String>(13)?).unwrap_or_default(),
```

**Düzeltme:** Bozuk satırı atlamak yerine kaydı koru, öğe listesini boş bırak ve
işaretle:

```rust
let entries_raw: String = row.get(13)?;
let entries = match serde_json::from_str(&entries_raw) {
    Ok(value) => value,
    Err(err) => {
        crate::logging::warn("audit entry list is corrupt", err);
        Vec::new() // toplamlar korunur, UI "öğe ayrıntısı yok" gösterebilir
    }
};
```

**Etki:** Sessiz veri kaybı yerine izlenebilir, kısmi ama tutarlı bir kayıt.

---

## 5. Geliştirme ve Ekleme Önerileri

Aşağıdakiler hata değil, 2.3+ için değer üretecek eklemelerdir; her biri uygulanabilir
kod örneğiyle verilmiştir.

### 5.1 R-1 — Denetim veritabanı açılışında bütünlük kontrolü

**Konum:** `src-tauri/src/audit/repository.rs:554-557` (PRAGMA bloğu)

**Öneri:** WAL ve `busy_timeout` mevcut, ancak elektrik kesintisi/disk hatası sonrası
sayfa bozulması sessizce "boş geçmiş" olarak görünür. Açılışta `quick_check` çalıştırıp
sonucu logla; bozuksa dosyayı `audit.db.corrupt.<ts>` olarak yanına al ve yeni veritabanı
aç — böylece kullanıcı hem çalışmaya devam eder hem de kanıt korunur.

```rust
fn integrity_ok(conn: &rusqlite::Connection) -> bool {
    conn.query_row("PRAGMA quick_check", [], |row| row.get::<_, String>(0))
        .map(|result| result == "ok")
        .unwrap_or(false)
}

// open() içinde, migration'dan önce:
if !integrity_ok(&connection) {
    drop(connection);
    let backup = db_path.with_extension(format!("db.corrupt.{}", now_secs()));
    let _ = std::fs::rename(&db_path, &backup);
    crate::logging::warn("audit database failed integrity check; archived", backup.display());
    return Self::open(db_path); // yeni, boş veritabanı
}
```

### 5.2 R-2 — Webhook teslimatına sınırlı yeniden deneme + idempotency anahtarı

**Konum:** `src-tauri/src/commands/webhook_commands.rs:237-260` (`post_json`)

**Öneri:** Bugün tek deneme var; 429/503 veya kısa süreli ağ kesintisi bildirimi tamamen
kaybettiriyor. Aynı olayın iki kez iletilmesi ihtimaline karşı kararlı bir
`Idempotency-Key` (olay kimliği) gönderilmeli.

```rust
const RETRY_DELAYS_MS: [u64; 3] = [250, 1000, 3000];

pub async fn post_json_with_retry(
    client: &reqwest::Client,
    url: &reqwest::Url,
    payload: &serde_json::Value,
    event_id: &str,
) -> Result<WebhookTestResult, AppError> {
    let mut last: Option<AppError> = None;
    for delay in std::iter::once(0).chain(RETRY_DELAYS_MS) {
        if delay > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
        }
        let response = client
            .post(url.clone())
            .header("Idempotency-Key", event_id)
            .json(payload)
            .send()
            .await;

        match response {
            Ok(resp) if resp.status().is_success() => return Ok(to_result(resp).await?),
            Ok(resp) if resp.status().as_u16() == 429 || resp.status().is_server_error() => {
                last = Some(AppError::Network(status_message(resp.status())));
            }
            Ok(resp) => return Ok(to_result(resp).await?), // 4xx: tekrar denemek anlamsız
            Err(err) => last = Some(AppError::Network(err.to_string())),
        }
    }
    Err(last.unwrap_or_else(|| AppError::Network("webhook delivery failed".into())))
}
```

Olay kimliği tarama/temizleme kimliğinden türetilmeli (`scan_session_id`), böylece
yeniden denemeler alıcı tarafında tekilleştirilebilir.

### 5.3 R-3 — Önizleme/silme arasındaki yarış için fault-injection testi

**Konum:** `src-tauri/src/cleanup/plan.rs` (`verify_snapshot`), `coordinator.rs`

**Öneri:** `verify_snapshot`'ın üç dalı (boyut değişti, `file_id` değişti, mtime değişti)
birim testlerinde var; ancak "önizleme ile silme arasında dosya değişti" senaryosunun
uçtan uca (plan → dosya mutasyonu → execute → `PlanChanged` + sıfır silme) testi yok.
Zaman bağımlılığını enjekte edilebilir yaparak deterministik test yazılabilir:

```rust
#[test]
fn execute_refuses_when_target_changed_between_preview_and_run() {
    let temp = tempfile::tempdir().unwrap();
    let target = temp.path().join("node_modules");
    fs::create_dir_all(&target).unwrap();
    fs::write(target.join("index.js"), vec![0u8; 1024]).unwrap();

    let mut session = scan_fixture(temp.path()); // test yardımcısı
    let plan = build_plan(&mut session, &[target.clone()]).unwrap();

    // Önizlemeden sonra içerik değişir.
    fs::write(target.join("index.js"), vec![0u8; 8192]).unwrap();

    let err = execute_plan(&plan, &session, DeleteMode::Permanent).unwrap_err();
    assert!(matches!(err, AppError::ContentChanged));
    assert!(target.exists(), "hiçbir dosya silinmemeliydi");
}
```

### 5.4 R-4 — Çeviri anahtarları için "kullanılmayan anahtar" kapısı

**Konum:** `scripts/check-i18n.*` (mevcut `check:i18n`)

**Öneri:** Bugünkü kapı eksik anahtarları yakalıyor; ters yön (İngilizce sözlükte olup
hiçbir çağrı yerinde kullanılmayan anahtar) yakalanmıyor. 1.200+ anahtarlı bir sözlükte
ölü metin birikiyor. Aynı script'e ters tarama ekle:

```ts
// scripts/check-i18n.mjs (özet)
const enKeys = flattenKeys(EN);
const sources = await glob("src/**/*.{ts,tsx}");
const used = new Set<string>();
for (const file of sources) {
  const text = await fs.readFile(file, "utf8");
  for (const match of text.matchAll(/\bui\.([a-zA-Z0-9_.]+)/g)) used.add(match[1]);
}
const orphans = [...enKeys].filter((key) => ![...used].some((u) => u === key || u.startsWith(`${key}.`)) && !key.startsWith("errors.") && !key.startsWith("warnings."));
if (orphans.length) {
  console.warn(`Unused i18n keys (${orphans.length}):`, orphans.slice(0, 20));
}
```

`errors.*` / `warnings.*` gibi dinamik erişilen kategoriler hariç tutulur.

### 5.5 R-5 — "Sistem sağlığı" bölümü

**Öneri:** Destek maliyetini düşürecek, mevcut verilerle beslenebilecek bir tanı sayfası:
denetim veritabanı boyutu ve bütünlüğü (R-1), ayar dosyası yedek/kurtarma durumu
(`settings/repository` zaten `recoveredFromCorrupt` üretiyor), son tarama oturumunun
TTL durumu, webhook son teslimat sonucu (`latencyMs`, `status`). Hepsi bugün üretiliyor,
yalnızca yüzeyi yok; yeni bir backend komutu gerektirmeden `getScanSummary`,
`getAuditRecords`, `testWebhook` sonuçlarıyla doldurulabilir.

---

## 6. Önceki Turun Regresyon Teyidi

| Bulgu (v2) | Durum | Kanıt |
| --- | --- | --- |
| P-1 Docs memoizasyonu | **Düzeltildi, korunuyor** | `DocsView.tsx:21-22` `React.memo`, `201-244` kararlı `contentProps`; gövde bileşenleri arama tuşunda yeniden render edilmiyor |
| T-1 `as any` daraltması | **Kısmen kapalı** | `localizeAppError` (977-990) ve `isScanSessionError` (957-968) artık daraltılmış; ancak proxy/hydrate katmanında 6 `any` kaldı → bu raporun **T-1** maddesi |
| K1–K3, Y1–Y4, O1–O6, D1–D6 | **Düzeltildi, korunuyor** | `measureRunId` nesil sayacı (`cache-store.ts`), `activeGeneration` (`combined-measure.ts`), `withTimeout` (`useScanController`), `normalizeRestoredItem` (`scan-store.ts`), `redactSecrets` (`logging.ts`), `describeWebhookFailure` sözleşmesi |

Yeni regresyon yok; `npm test` 219 testin tamamı geçiyor.

---

## 7. Yayın Durumu

Bu denetim **yayın engelleyici bir kod bulgusu üretmedi.** Açık kapılar kod dışıdır ve
önceki planla aynıdır:

- **G0** — Hukuk metinlerinin onayı (`LegalView` içeriği hazır, onay bekliyor)
- **G4** — Yükseltilmiş MSI imzası / yükleme testi
- **G9** — Tasarım onayı
- Temiz VM üzerinde uçtan uca kurulum + tarama + temizleme tekrarı
- `release_output/` paketleri `BUILD_INFO.json` içinde `"dirty": true` — bu çalışma ağacı
  commit edilmeden yeni paket üretilmemeli

Önerilen sıra: **B-1 → V-2 → V-3 → B-2/B-3 → V-1 → P-1 → T-1 → (T-2, P-2, P-3, P-4, V-4, T-3, T-4)**.
İlk beş madde tek bir odaklı turda kapatılabilir; her biri bağımsız test edilebilir.

---

## 8. Uygulama Durumu (18.11.2026)

Bu bölüm, yukarıdaki bulguların **tamamının** uygulandığını kanıtlarıyla kaydeder. Her satır
dosya:satır ile doğrulanabilir; "Durum" kolonu yalnızca **Kapandı** değeri alır.

### 8.1 Kritik hatalar (B)

| ID | Düzeltme | Kanıt | Durum |
| --- | --- | --- | --- |
| B-1 | Diyalog kapanması `pointerdown` hedefine bağlandı; sürükleme artık kapatmıyor | `src/components/primitives/Dialog.tsx:50`, `:137-145` (`overlayPressRef`) | Kapandı |
| B-2 | `unknown` → `LocaleTree` doğrulaması (`isLocaleTree`, `hydrateNode`, `hydrateLocale`) | `src/lib/ui-text/index.ts:758-846` | Kapandı |
| B-3 | Genel `includes("not found")` kaldırıldı; özgül kurallar gölgelenmiyor | `src/lib/ui-text/index.ts:1169-1177` | Kapandı |
| B-4 | Bozuk locale chunk'ı `log.warn` + İngilizce'ye düşüyor, cache zehirlenmiyor | `src/lib/ui-text/index.ts:869-884` | Kapandı |

### 8.2 Performans (P)

| ID | Düzeltme | Kanıt | Durum |
| --- | --- | --- | --- |
| P-1 | Başlık normalizasyonu `useMemo`; 5 ayrı `.filter` → tek geçişli `groupedTopics` | `src/features/docs/DocsView.tsx:157-196` | Kapandı |
| P-2 | `getLegalDocMeta` / `getLegalDocument` memoize edildi | `src/features/legal/LegalView.tsx:52-64` | Kapandı |
| P-3 | Mount'ta `Object.is` erken çıkışı (gereksiz render yok) | `src/lib/hooks/use-throttled-value.ts:41-47` | Kapandı |
| P-4 | Ortak `SCAN_AGGREGATE_THROTTLE_MS = 300`; tablo/özet tutarlı | `src/lib/hooks/use-throttled-value.ts:21`, `ItemTable.tsx`, `OverviewView.tsx` | Kapandı |

### 8.3 Teknik borç (T)

| ID | Düzeltme | Kanıt | Durum |
| --- | --- | --- | --- |
| T-1 | `ui-text` içindeki 6 `any` kaldırıldı; tek köprü `asLocaleTree` | `src/lib/ui-text/index.ts:845` (kalan `any` yalnızca yorumlarda) | Kapandı |
| T-2 | `THEME_MODES` tek kaynak, `ThemeMode` türetildi | `src/types/index.ts:9-26` | Kapandı |
| T-3 | Store `VERIFIED_THEMES` ve `normalizeTheme` tek kaynaktan besleniyor | `src/stores/preferences-store.ts:97-102` | Kapandı |
| T-4 | Gizlilik + fabrika sıfırlama `PrivacySection.tsx` olarak ayrıldı | `src/features/settings/PrivacySection.tsx:40` | Kapandı |

### 8.4 Veri bütünlüğü (V)

| ID | Düzeltme | Kanıt | Durum |
| --- | --- | --- | --- |
| V-1 | Kalıcı backend log sink'i (rotasyon + yol maskeleme); GUI yolunda `eprintln!` kalmadı | `src-tauri/src/logging.rs:24,55,139` | Kapandı |
| V-2 | `readScanHistory` durum döndürüyor (`ok/empty/corrupt/unavailable`), onarılan liste geri yazılıyor | `src/features/history/scan-history.ts:72-133` | Kapandı |
| V-3 | `quote_cmd_arg` → `Result`; `%VAR%` ve kontrol karakteri reddediliyor | `src-tauri/src/cleanup/official_actions.rs:628-666` | Kapandı |
| V-4 | Bozuk `entries` kolonu sessizce kaybolmuyor; `parse_entries` logluyor | `src-tauri/src/audit/repository.rs:790` | Kapandı |

### 8.5 Geliştirme önerileri (R)

| ID | Düzeltme | Kanıt | Durum |
| --- | --- | --- | --- |
| R-1 | Açılışta `PRAGMA quick_check`; bozuk DB `*.sqlite3.corrupt.<ts>` olarak arşivleniyor | `src-tauri/src/audit/repository.rs:772-790` | Kapandı |
| R-2 | Webhook: 250/1000/3000 ms retry (429 + 5xx), `Idempotency-Key`, 4xx'te durma | `src-tauri/src/commands/webhook_commands.rs:29-56`, `post_json`, `post_blocking_json` | Kapandı |
| R-3 | Uçtan uca fault-injection testi: plan → mutasyon → `CONTENT_CHANGED` → dosya hayatta | `src-tauri/src/cleanup/tests.rs:513` | Kapandı |
| R-4 | Kullanılmayan i18n anahtarı kapısı, `check:i18n` zincirine eklendi | `scripts/check-i18n-unused.mjs`, `package.json` (`check:i18n:unused`) | Kapandı |
| R-5 | "Sistem Sağlığı" paneli: denetim toplamları, son tarama yaşı, store durumu, kurtarma bayrağı | `src/features/settings/SystemHealthPanel.tsx:31`, `AboutView.tsx` | Kapandı |

### 8.6 Kalite kapıları (son ölçüm)

| Kapı | Komut | Sonuç |
| --- | --- | --- |
| Tip denetimi | `npm run typecheck` | 0 hata |
| Birim testleri (FE) | `npm test` | 28 dosya / **237 test** geçti |
| Birim testleri (BE) | `cargo test` | **230 lib + 21 entegrasyon** geçti, 5 opt-in yoksayıldı |
| Rust lint | `cargo clippy --all-targets` | 0 uyarı, 0 hata |
| Rust format | `cargo fmt --check` | temiz |
| Prettier | `npm run format:check` | temiz |
| Regresyon kapıları | `npm run check:gates` | geçti |
| Denetim değişmezleri | `npm run check:audit` | 5 kural, ihlal yok |
| i18n zinciri | `npm run check:i18n` | 4/4 script geçti (orphan: 686/686 anahtar kullanımda) |
| Kontrast | `npm run check:contrast` | 4/4 tema geçti |
| Kurulum dili | `npm run check:languages` | 73 uygulama / 73 NSIS dili |
| Simge ve marka | `npm run check:icons`, `npm run check:brand` | geçti |
| Üretim derlemesi | `npm run build` | başarılı (entry ~254 kB) |
| Erişilebilirlik | `npx playwright test` | **13/13 test** geçti |

Ek doğrulama: geliştirme mock'u (`action-token-mock`) `dist/` içinde **yok**; production
bundle yalnızca gerçek Tauri IPC yolunu içeriyor.

### 8.7 Kalan yayın kapıları (kod dışı)

Bunlar önceki turdan farklılaşmadı ve kod değişikliğiyle kapatılamaz:

- **G0** — hukuk metinlerinin hukuk onayı (`LegalView` içeriği hazır).
- **G4** — yükseltilmiş MSI imzası ve temiz VM kurulum testi.
- **G9** — tasarım onayı.
- `release_output/` paketleri `BUILD_INFO.json` içinde `"dirty": true` taşır; bu çalışma ağacı
  commit edilmeden **yeni paket üretilmemeli**.

Bu maddelerin hiçbiri `src/` veya `src-tauri/src/` içinde açık bir kod kusuru bırakmaz: denetim
kapsamındaki tüm bulgular kapanmış, tüm otomatik kapılar yeşildir.

### 8.8 Erişilebilirlik kapısının ilk gerçek koşusu (18.11.2026)

`check:contrast` 2.2.2'de dört temada da başarısız olduğu için `npx playwright test` hiç
çalışmamıştı; kapı yeşil görünürken 13 testin 9'u kırıktı. İlk koşuda bulunanlar ve düzeltmeleri:

| # | Bulgu | Kök neden | Düzeltme | Kanıt |
| --- | --- | --- | --- | --- |
| A-1 | `aria-progressbar-name` (serious) | `.overview-dist-bar` üzerinde erişilebilir ad yok | `aria-label={ui.overview.distTitle}` | `OverviewView.tsx:519-525` |
| A-2 | 320 px'te yatay taşma (218 px) | Grid izleri `minmax(0, …)` değil; hub kolonu küçülemiyor | Tüm overview gridleri `minmax(0, …)`, `.overview-hub-card`/`.overview-hubs-column` `min-width: 0` | `overview.css:159, 170, 178, 323-330, 473`; test: `scrollWidth 264 = clientWidth 264`, 0 taşan öğe |
| A-3 | About/legal testi 60 s'de zaman aşımı | Test `.about-legal-item` seçicisini arıyordu; bileşen `data-legal-doc` kullanıyor ve About artık üst düzey görünüm | Test `goToView(page, "About")` + `[data-legal-doc]` kullanıyor | `e2e/a11y.spec.ts:89-105` |
| A-4 | APG sekme testi "About" sekmesini bulamıyor | About, Settings sekmesi olmaktan çıkıp birincil navigasyona taşınmış; test eski sıralamaya bağımlıydı | Test gerçek sekme listesine göre `End` → son sekme doğrulaması yapıyor | `e2e/a11y.spec.ts:107-136` |
| A-5 | Sonuç tablosu satır sayısı 11 (beklenen 5) | Mock arka ucun geri yüklediği 10 demo satırı test fixture'ıyla birleşiyordu | Test seed'den önce `resetScan()` çağırıyor | `e2e/a11y.spec.ts:170-200` |
| A-6 | Tarama sırasında "sıfırla" yarış durumu | `getLastScan()` beklerken yapılan sıfırlama, IPC dönünce geri yükleme ile geri alınıyordu | `workspaceResetToken`; `App` token'ı await öncesi alıp sonrası karşılaştırıyor | `scan-store.ts:88-95, 942-985`; `App.tsx:134-149`; regresyon testi `qa-hardening.test.ts` |
| A-7 | `npx playwright test` 2/15 kırık | `e2e/capture-*.spec.ts` tek seferlik tasarım yakalama betikleriydi: `data-concept` kaldırılmış, seçiciler eski, dil sabitlenmemiş | Betikler silindi (hiçbir kod/belge referansı yoktu); kapı yalnızca `a11y.spec.ts` koşuyor | `git ls-files e2e` → `e2e/a11y.spec.ts` |

Kapı son durumu: `npm run test:a11y` → `check:contrast` 4/4 tema + **13/13 Playwright testi**.
Ayrıntılı iş kırılımı, risk kaydı ve test matrisi:
`docs/release/2026-11-18-remediation-wbs-risk-test-matrix.md`.

### 9. Bağımsız denetim turu (18.11.2026)

v3 bulguları kapandıktan sonra `src/` ve `src-tauri/src/` yeniden, bulgu listesinden bağımsız olarak
tarandı. Aşağıdaki maddeler önceki turlarda görülmemişti; hepsi düzeltildi ve regresyon testiyle
sabitlendi.

| # | Önem | Bulgu | Kök neden | Düzeltme | Kanıt |
| --- | --- | --- | --- | --- | --- |
| S-1 | Orta | Destek log dosyasına ham kullanıcı adı yazılabiliyordu | `write_line` yalnızca `detail` alanını maskeliyordu; `format!("could not archive {}", path)` gibi mesajlar maskesizdi | Maskeleme tek yerde: `format_line` hem `message` hem `detail` üzerinde `mask_path` çağırıyor | `src-tauri/src/logging.rs:151-162`; test `a_path_in_the_message_is_masked_too` |
| S-2 | Orta | `mask_path` eski profil ve UNC ev yollarını kaçırıyordu | 20 karakterlik pencere `:\documents and settings\` (25) ile hiç eşleşemiyordu; `\Users\` (sürücü harfsiz/UNC) deseni yoktu | Pencere 40'a çıkarıldı, `\Users\` deseni eklendi, marker başlangıç harfi ön kontrolü eklendi | `logging.rs:66-118`; test `masks_legacy_profile_and_unc_home_paths` |
| S-3 | Düşük | UNC yolu kısaltılınca sunucu adı kayboluyordu (`\...\node_modules`) | `split` iki baştaki boş segmenti baş sanıyordu | `\\server\share` çapası ayrı ele alınıyor | `src/lib/format/path.ts:32-60`; test `keeps the server and share of a UNC path when truncating` |
| S-4 | Düşük | `prune()` tablo adını `format!` ile SQL'e gömüyordu | Çağıranlar bugün sabit literal; sözleşme tip düzeyinde değildi | `PruneTable` enum'u + `as_str()`; tüm çağrılar varyanta taşındı | `src-tauri/src/audit/repository.rs:741-763` |
| S-5 | Düşük | Disk doluluk bekleme anahtarı emekli `node-cleaner.` adını taşıyordu; ayrıca modül yüklemesinde `localStorage` okunuyordu | 2.2.1 anahtarı devralınmamıştı; test tekrar tohumlayamıyordu | `dev-cleaner.` anahtarı + legacy anahtardan tek seferlik taşıma; `lastDiskAlertAt` tembel | `src/lib/notifications/lifecycle.ts:34, 58-68, 100-116`; test `migrates the disk-pressure cooldown...` |
| S-6 | Düşük | Settings'ten hızlı ayrılma, geç gelen katalog/build yanıtının state'e yazılmasına yol açıyordu | `.then(setState)` iptal koruması yoktu | Her iki `useEffect` `cancelled` bayrağıyla korunuyor | `src/features/settings/SettingsView.tsx:168-207` |
| S-7 | Düşük | Silme görevi paniklediğinde panik metni kullanıcıya `AppError` olarak dönüyordu | JoinError doğrudan formatlanıyordu | Ayrıntı log'a, kullanıcıya sabit mesaj | `src-tauri/src/commands/deletion_commands.rs:150-158` |
| S-8 | Düşük | Audit bağlantısı `expect` ile alınıyordu | "az önce kuruldu" değişmezi kilitlenme durumunda paniğe dönüşebilirdi | `let ... else` + `SQLITE_MISUSE` hatası | `src-tauri/src/audit/repository.rs:205-213` |
| S-9 | Düşük | Her log satırında ek `metadata` syscall'ı | Rotasyon kontrolü yazım başına çalışıyordu | 256 satırda bir kontrol (`AtomicU64` sayaç); ilk yazım yine kontrol eder | `logging.rs:33, 130-142` |
| S-10 | Düşük | `as usize`/`as u64` daraltmaları | `processed_count` u64'e açılıp geri daraltılıyordu | Ara değerler `usize`; süreler `u64::try_from(...).unwrap_or(u64::MAX)` | `src-tauri/src/cleanup/coordinator.rs:470-500`; `commands/webhook_commands.rs:301,318,533,548` |

Doğrulanıp **kusur bulunmayan** alanlar: `withTechnicalContext` (prose yollar toast'a taşınmıyor,
`maskPaths` tercihine uyuyor), `validate_open_url` + `validate_shell_argument` + canonicalize,
`redactWebhookUrl` (yalnız origin), `desktop-guard` kısayol matrisi, `JSON.parse` çağrılarının
tamamında tip daraltma, `setInterval` yokluğu, `dangerouslySetInnerHTML` yokluğu, `console.*`
kullanımının yalnız `src/lib/logging.ts` ile sınırlı olması, capabilities `default.json` minimalliği.

Bu turdan sonraki kapı ölçümü: `npm run typecheck` 0 hata; `npm test` **223/223** (25 dosya);
`cargo test` **210 lib + 21 entegrasyon**, 5 ignored, 0 failed; `cargo clippy --all-targets` 0
uyarı; `cargo fmt --check` temiz; `npm run format:check` temiz; `npm run build` başarılı.

### 10. İkinci bağımsız denetim turu (18.11.2026)

§9 kapandıktan sonra `src/` ve `src-tauri/src/` üçüncü kez, yine bulgu listesinden bağımsız olarak
tarandı; bu kez ağırlık **kaynak tükenmesi** (bellek/kanal/kota) ve **yarış koşulları** üzerindeydi.
Sekiz yeni bulgu çıktı (S2-8 kapanış taramasında bulunan ölü kod kalemi), hepsi düzeltildi;
kod davranışı değiştiren yedisi regresyon testiyle sabitlendi.

| # | Önem | Bulgu | Kök neden | Düzeltme | Kanıt |
| --- | --- | --- | --- | --- | --- |
| S2-1 | Orta | MCP önizleme grant'ları süreç ömrü boyunca birikiyordu | `scans` map'inde TTL `retain` vardı, `grants` map'inde yoktu; her grant tam bir `CleanupPlan` + `Arc<ScanSession>` (tüm tarama satırları) tutuyor | `MAX_PENDING_GRANTS = 16`; her `insert` öncesi `make_room_for_grant` süresi geçenleri atıyor, harita doluysa en eskisini tahliye ediyor | `src-tauri/src/mcp/mod.rs` (`make_room_for_grant`, `PREVIEW_TTL`); testler `pending_previews_stay_bounded_and_drop_the_oldest`, `an_expired_preview_is_dropped_before_the_map_fills` |
| S2-2 | Orta | Denetim geçmişi okuması sınırsız `LIMIT` ile tüm tabloyu döndürebiliyordu | Sınır yalnız Tauri komutunda (1..1000) kırpılıyordu; MCP/CLI değeri doğrudan depoya ulaşıyor, `usize::MAX` SQLite'ta **negatif** `LIMIT`e dönüşüyor ve negatif `LIMIT` "sınırsız" demek | Depo katmanında `MAX_QUERY_LIMIT = 1_000`; `list_records`/`list_actions` girişte kırpıyor | `src-tauri/src/audit/repository.rs:32-40, 248-262, 424-432`; test `an_unbounded_limit_cannot_read_more_than_the_cap` |
| S2-3 | Orta | Tarama olay kuyruğu sınırsızdı; askıya alınmış WebView tüm sonuç setinin ikinci kopyasını biriktirebiliyordu | `mpsc::unbounded_channel` — üretici (yürüyücü) hiç beklemiyordu | `EVENT_QUEUE_CAPACITY = 256` sınırlı kanal + tüm gönderimlerde `await`; engellenen yürüyücü geri basınç uyguluyor. Ölçüm geri çağrıları senkron olduğu için `measure_entries` imzası async geri çağrıya geçti (böylece ölçüm toplu gönderimi düşürülmüyor, bekletiliyor) | `src-tauri/src/scanner/mod.rs:31-39, 246-256`; `src-tauri/src/scanner/measurement.rs:169-196, 250-286` |
| S2-4 | Düşük | `last-scan.json` yüklenirken dosya boyutu sınırı yoktu | Yazma `MAX_SNAPSHOT_BYTES` (64 MiB) ile korunuyordu, okuma `read_to_string` ile doğrudan | Okuma `take(MAX + 1)` ile sınırlandı ve aşım `None` döndürüyor | `src-tauri/src/last_scan.rs:79-99`; test `an_oversized_snapshot_is_rejected_without_being_loaded` |
| S2-5 | Düşük | Geçmiş özetinde `Math.max(...timestamps)` | Tüm kayıtlar için ara dizi kurulup her kayıt ayrı argüman olarak yayılıyordu (uzun geçmişte `RangeError`, ayrıca iki gereksiz tahsis) | `latestTimestampMs` tek geçişli döngü; özet üç adayın maksimumunu zaten taşıdığı için `last = newest.at` | `src/lib/format/date.ts:9-25`; `HistoryView.tsx:256-273`; testler `history-timestamp.test.ts` (4 test, 70 000 kayıt dahil) |
| S2-6 | Düşük | İyileşen diskin bekleme kaydı silinmiyordu | `checkDiskPressure` bildirim bekleme süresindeyken `return` ediyordu; bu, üstte yapılan "kritik olmayanları unut" temizliğinin yazılmasını atlıyordu — disk iyileşip yeniden dolduğunda uyarı sessizce bastırılabiliyordu | Erken `return` kaldırıldı; bildirim yalnız süre dolduğunda gönderiliyor, temizlik her durumda yazılıyor | `src/lib/notifications/lifecycle.ts:175-192`; testler `disk-pressure.test.ts` (4 test; ilki düzeltme olmadan kırmızı) |
| S2-7 | Düşük | Konum listesi isteği, görünüm kapandıktan sonra state yazıyordu | `getKnownLocations().then(setState)` iptal koruması yoktu (StrictMode'da iki istek) | `cancelled` bayrağı + hata mesajının olay anında çözülmesi | `src/features/scan/ScanHeader.tsx:72-95` |
| S2-8 | Düşük | `platform::process_running_under` hiçbir çağıranı olmayan ölü koddu ve `Path::starts_with` büyük/küçük harfe duyarlı olduğu için Windows'ta yanlış negatif üretiyordu (kök ile süreç yolu farklı harf büyüklüğündeyse çalışan ajan görülmezdi) | Yardımcı, `running_process_names` tabanlı koruma `safety/process_guard.rs`e taşındıktan sonra da dışa aktarılmaya devam etmiş | Fonksiyon ve iki `pub use` satırı kaldırıldı; kullanılan yol `process_guard::active_use_for_provider` (sağlayıcı adı eşleşmesi, yol karşılaştırması yok) | `src-tauri/src/platform/windows/fs_meta.rs`, `platform/windows/mod.rs:46-48`, `platform/mod.rs:3-6`; doğrulama: repo genelinde `process_running_under` referansı 0, `cargo clippy --all-targets` 0 uyarı |

Doğrulanıp **kusur bulunmayan** alanlar (bu turda satır satır okundu):

- `safety/path_guard.rs` — canonicalize sonrası kapsama testi, sürücü kökü/`Users`/`Program Files`
  reddi, bileşen bazlı koruma (`is_within` + `path_components`), üst dizin symlink kontrolü, UNC ve
  remote yol reddi; korumalı klasör testi her iki yönde (içindekiler ve kapsayanlar).
- `commands/deletion_commands.rs` — plan tüketilmeden önce oturum/katalog/ayar doğrulaması (hata
  planı yakmıyor), tek kullanımlık plan, cleanup slotunun her çıkışta bırakılması, panik metninin
  kullanıcıya sızmaması, `dropped_events` raporlaması.
- `cleanup/official_actions.rs` — `cmd.exe` argüman kaçırma (`quote_cmd_arg`, `%VAR%`/kontrol
  karakteri reddi), zaman aşımında süreç ağacının sonlandırılması, `wait_with_output` ayrı iş
  parçacığında (boru kilidi yok).
- `providers/mod.rs` — zaman aşımı/iptal/kota kontrolleri her kök ve her kuralda; sağlayıcı "in use"
  kararı kök bazında önbellekleniyor (ilk kökün kararı diğerlerine taşınmıyor).
- `scanner/discovery.rs` — `follow_links(false)`, reparse point ve symlink budama, ziyaret edilen
  dizin sayacı; kök reparse point ise tarama reddediliyor.
- Frontend: tüm `addEventListener` çağrılarının eşleşen `removeEventListener`'ı var
  (`App`, `Dialog`, `SearchField`, `DocsView`, `McpIdeSelector`, `ScanHeader`, `SettingsView`,
  `NavRail`, `notification-service`, `desktop-guard`, `CloseGuardDialog`, `WindowControls`);
  `setInterval` hiç yok; `JSON.parse` çağrılarının tamamı tipli daraltma + `try/catch` içinde;
  `localStorage`/`sessionStorage` yazımları kota hatasını yutup zarifçe düşüyor
  (`scan-history`, `preferences-store`, `lifecycle`, `app-data-reset`); `DocsView` kopyalama
  zamanlayıcısı unmount'ta temizleniyor; `selection-store`/`scan-store` değişmez (immutable) güncelleme.
- `platform/windows/delete.rs` — yol yerine tanıtıcı (handle) ile silme: `CreateFileW` +
  `FileDispositionInfoEx`, doğrulanan `FileIdentity` ile karşılaştırma, kimlik değişirse
  `IdentityChanged` (TOCTOU kapalı).
- `platform/windows/fs_meta.rs` — `GetCompressedFileSizeW` hatası `GetLastError` ile ayrıştırılıyor
  (`u32::MAX` gerçek boyut olabilir), `is_in_use` yalnız 32/33'ü "kullanımda" sayıp `ACCESS_DENIED`
  dahil diğer her şeyi `None` (deletion'ı bloklayan) döndürüyor, süreç listesi 2 s TTL ile
  önbellekleniyor ve kilit zehirlenmesi `into_inner` ile toparlanıyor.
- `platform/windows/drives.rs` — `GetLogicalDrives` bit maskesi 26 sürücüyle sınırlı, ağ sürücüleri
  taranmıyor, sürücü etiketi iki karakterden türetiliyor.
- `platform/windows/known_folders.rs` — konumlar yalnız gerçekten var olan dizinler için üretiliyor,
  sabit `C:/D:` listesi yok; tüm kimlikler sürücü harfinden türetilip çakışmıyor.
- `platform/windows/instance_guard.rs` — süreç öldüren "zombie killer" yok; tek örnek kilidi
  `tauri-plugin-single-instance`e bırakılmış, yalnız `AttachThreadInput` eşleştirmesi var.
- `cli/mod.rs` — üç argüman döngüsünün hepsi her turda `i += 1` (sonsuz döngü yok), `--clean all`
  `--yes` olmadan reddediliyor, `--limit` depo katmanında 1 000'e kırpılıyor, `eprintln!` yalnız CLI'da.
- `OverviewView.tsx`, `SettingsView.tsx`, `AgentsView.tsx`, `CachesView.tsx`,
  `CleanupPlanDialog.tsx`, `ScanHeader.tsx`, `useScanController.ts` — tüm IPC sonuçları
  `cancelled`/`generation`/`previewRequestRef`/`runId` korumasıyla state'e yazılıyor; `AgentsView`
  eşzamanlı yenilemeyi `pendingReloadRef` ile sıraya koyuyor; `CachesView` önizleme iptali hem
  yerel nesli hem arka uç yürüyüşünü durduruyor; `SettingsView` kısayol dinleyicisi yalnız kayıt
  sırasında bağlanıp her çıkışta sökülüyor ve webhook taslağı `pagehide` + unmount'ta yazılıyor;
  `CleanupPlanDialog` planı tek kullanımlık tüketiyor; `useScanController` her terminal yolda
  `releaseScanStart` çağırıyor ve eski çalıştırmaların sonucunu `runId` ile düşürüyor.

Bu turdan sonraki kapı ölçümü: `npm run typecheck` 0 hata; `npm test` **237/237** (28 dosya);
`cargo test` **230 lib + 21 entegrasyon**, 5 ignored, 0 failed; `cargo clippy --all-targets` 0
uyarı; `cargo fmt --check` temiz; `npm run format:check` temiz; `npm run check:gates`,
`npm run check:audit` (5 kural), `npm run check:i18n` (4/4), `npm run check:contrast` (4/4) geçti;
`npm run build` başarılı; `npx playwright test` **13/13**.

### 11. Üçüncü bağımsız denetim turu (18.11.2026)

§10 kapandıktan sonra yapılan tarama iki eksene odaklandı: **MCP/CLI yüzeyinde süreç ömrü boyunca
büyüyen kayıt defterleri** ve **ateşle-unut (fire-and-forget) IPC redlerinin yutulması**. Dokuz bulgu
çıktı; hepsi düzeltildi, beşi yeni regresyon testiyle (S3-9 için mevcut test genişletildi) sabitlendi.

| # | Önem | Bulgu | Kök neden | Düzeltme | Kanıt |
| --- | --- | --- | --- | --- | --- |
| S3-1 | Orta | MCP oturumunda `scan_workspace` ile saklanan taramalar süreç ömrü boyunca birikiyordu | `grants` için TTL/tavan eklenmişti, `scans` map'i için yoktu; her kayıt tam bir `ScanSession` (tüm hedefler) tutuyor | `MAX_STORED_SCANS = 8` + `make_room_for_scan`: önce süresi geçenler atılır, harita doluysa en eski tarama tahliye edilir | `src-tauri/src/mcp/mod.rs:45, 129-150, 808`; testler `remembered_scans_stay_bounded_and_drop_the_oldest`, `an_expired_scan_is_dropped_before_the_cap_is_reached` |
| S3-2 | Orta | `min_size_mb * 1024 * 1024` taşabiliyordu | MCP argümanı ve `--min-size-mb` doğrulanmamış `u64`; `u64::MAX` eşiği ya panikletiyor (debug) ya da küçük bir değere sarıyordu (release => "küçük satırları atla" tersine dönüyordu) | `saturating_mul(1024 * 1024)` (hem MCP hem CLI yolu) | `src-tauri/src/mcp/mod.rs:726`; `src-tauri/src/cli/mod.rs:607-609, 632` |
| S3-3 | Orta | Plan kayıt defteri sınırsızdı ve kapasite tahliyesi **çalışmakta olan** planı silebiliyordu | `peek_plan` planı `taken` işaretlemiyordu; tahliye "en eski"yi seçerken kullanımda olanı ayırt edemiyordu | `MAX_PENDING_PLANS = 8`; `PendingPlan { plan, taken }`; `peek_plan` `taken = true` yapar, tahliye yalnız `!taken` adayları arasından seçer | `src-tauri/src/scanner/session.rs:18, 22-27, 372-410`; testler `pending_plans_stay_bounded_and_drop_the_oldest_untouched`, `a_plan_picked_up_for_execution_is_not_evicted_by_capacity` |
| S3-4 | Orta | `list_snapshots` sınırsız `LIMIT` ile tüm tabloyu okuyabiliyordu | `list_records`/`list_actions` kırpılıyordu, `list_snapshots` atlanmıştı | Depo katmanında `limit.min(MAX_QUERY_LIMIT)` | `src-tauri/src/audit/repository.rs:372-380`; test `an_unbounded_snapshot_limit_cannot_read_more_than_the_cap` |
| S3-5 | Orta | Onaylanan resmi işlem, önizlemede gösterilenden **farklı bir program** çalıştırabiliyordu | Yürütme, program adını `PATH` üzerinden yeniden çözüyordu; önizleme ile onay arasında `PATH` değişirse veya daha erken dizine shim konursa başka ikili çalışıyordu | `PendingAction.exe: PathBuf` önizlemede çözülüp sabitlenir; yürütme bu yolu kullanır. Ayrıca `MAX_PENDING_ACTIONS = 16` + `PENDING_TTL = 300 s` | `src-tauri/src/cleanup/official_actions.rs:1023-1043, 1063-1105`; testler `pending_actions_stay_bounded_and_drop_the_oldest`, `an_expired_action_token_is_rejected` |
| S3-6 | Orta | `DepthLimit`, gerçek kesintiyi (zaman aşımı/iptal/aday limiti) maskeleyebiliyordu | Çok köklü döngü ve birleşik ajan adımı `stop_reason`u "son yazan kazanır" biçiminde eziyordu; derinlik kesintisi sonradan yazılırsa kullanıcı "depth-limit" görüp zaman aşımını kaçırıyordu | Ortak `merge_stop_reason(current, next)`: `DepthLimit` asla daha güçlü bir nedeni ezmez | `src-tauri/src/scanner/mod.rs:167-186, 576, 849`; test `a_stop_reason_is_never_downgraded_to_a_depth_cut` |
| S3-7 | Orta | MCP `clean_cache` denetim kaydı yazmıyordu | GUI yolu `append_action` çağırıyordu; MCP yolu çağırmıyordu, böylece ajanın sildiği önbellek Geçmiş'te görünmüyordu | `history_enabled` ise aynı `ActionAuditRecord` MCP yolunda da yazılır; hata loglanır, işlem durmaz | `src-tauri/src/mcp/mod.rs:652-670` |
| S3-8 | Düşük | Ateşle-unut IPC çağrılarının redleri yutuluyordu | `void promise` / `.then` zincirlerinde `catch` yoktu; red, "unhandled rejection" olarak konsola düşüyor ve kullanıcı hiçbir şey görmüyordu | Her çağrıya `catch` + log veya kullanıcı toast'ı: `clearLastScan`, `openUrl` (About/Legal), `hideToTray`/`requestQuit`, `applyChoice` | `src/app/App.tsx:152-157`; `src/features/settings/AboutView.tsx:128-135`; `src/features/legal/LegalView.tsx:142-149`; `src/features/shell/CloseGuardDialog.tsx:46-53, 73-96` |
| S3-9 | Düşük | Başlangıç geri yükleme yarışı | Açılışta snapshot geri yüklenirken kullanıcı yeni tarama başlatırsa eski snapshot yeni çalışma alanını ezebiliyordu | `workspaceResetToken` her sıfırlamada artar; geri yükleme yalnız token değişmediyse uygulanır | `src/app/App.tsx:138-149` |

Doğrulanıp **kusur bulunmayan** alanlar: `cleanup/plan.rs` (plan TTL/tek kullanım/token
karşılaştırması), `settings/repository.rs` (normalize + migrate her okuma/yazmada), 
`cleanup/recycle_bin.rs` ve `cleanup/permanent.rs` (COM HRESULT ayrıştırma, tanıtıcı tabanlı silme).

### 12. Dördüncü bağımsız denetim turu (18.11.2026)

§11 kapandıktan sonra `src/` ve `src-tauri/src/` dördüncü kez, bulgu listesinden bağımsız tarandı.
On beş bulgu çıktı (4 yüksek, 9 orta, 2 düşük); hepsi düzeltildi, sekizi yeni regresyon testiyle sabitlendi.

| # | Önem | Bulgu | Kök neden | Düzeltme | Kanıt |
| --- | --- | --- | --- | --- | --- |
| S4-1 | Yüksek | Geçersiz `start_scan` isteği, ölü bir iptal token'ı bırakıyordu | Token, istek doğrulanmadan kuruluyordu; `allowed_roots` boşsa erken `Err` dönüyor ve `release_scan_token` hiç çalışmıyordu. `active_operation()` sonsuza dek "scan" diyor, "uygulama verisini sıfırla" reddediliyor ve çalışan tarama boşuna iptal ediliyordu | Token, tüm doğrulamalar geçtikten ve oturum kurulduktan **sonra** kurulur | `src-tauri/src/commands/scan_commands.rs:79-89` |
| S4-2 | Yüksek | Temizlik sırasında tek öğe ölçümü iptal edilemiyordu | `measure_path` her öğe için **yeni, asla iptal edilmeyen** bir token alıyordu; çok GB'lık bir dizin "öğeler arasında iptal" sözleşmesini kırıyordu | Ölçüm çalıştırmanın token'ını kullanır; iptal nedeniyle ölçüm başarısızsa döngü `'run` etiketiyle durur ve öğe işlenmemiş sayılır | `src-tauri/src/cleanup/coordinator.rs:248, 305-313` |
| S4-3 | Orta | `max_depth` sınırındaki dizin hiç değerlendirilmiyordu | `depth >= max_depth` kontrolü kural eşleşmesinden **önce** `skip_current_dir()` + `continue` yapıyordu; `maxDepth: 1` ile `<root>/node_modules` hiç bulunmuyor, "depth-limit" kısmi sonucu bildiriliyordu | Sınır dizini kural eşleşmesine sokulur, yalnız **içine** inilmez; `depth_limited` bayrağı budamayı yönetir | `src-tauri/src/scanner/discovery.rs:206-218, 447-456`; test `a_directory_at_the_depth_limit_is_still_discovered` |
| S4-4 | Orta | `recently_modified` junction/reparse noktalarını hedef ağacın dışına takip ediyordu; gelecek tarihli dosya kökü kalıcı "kayıt yapıyor" gösteriyordu | `follow_links(false)` yalnız symlink hedeflerini izlemez; junction/reparse noktaları için açık budama gerekir (projedeki diğer yürüyüşler bunu yapıyor). Ayrıca `modified >= now - window` gelecek mtime'da sonsuza dek doğru kalır | `filter_entry` ile reparse noktaları budanır; karşılaştırma `now.duration_since(modified) <= window` (gelecek tarih => false) | `src-tauri/src/providers/root_locator.rs:265-306`; testler `a_future_timestamp_is_not_recent_activity`, `a_fresh_file_counts_as_recent_activity` |
| S4-5 | Orta | Kullanıcı tanımlı sağlayıcı döngüsü global durma nedenini ve `max_candidates` sınırını yok sayıyordu | Yerleşik kök döngüsü `stop_reason`/aday limitinde kırılıyordu; ikinci döngü koşulsuz çalışıp GB'larca ölçüm yapıyor ve sınırı aşan öğe ekliyordu | Döngü başında `stop_reason.is_some()` ise çıkılır; her kökten önce `entries_scanned >= max_candidates` kontrolü | `src-tauri/src/providers/mod.rs:394-416` |
| S4-6 | Orta | Korumalı klasör **altında** kalan hedef, üst dizini korumuyordu | Keşif yalnız "hedef korumalının içinde mi" bakıyordu; silme koruması her iki yönü de reddediyordu. `node_modules/keep` korumalıyken `node_modules` seçilebilir görünüyor, önizlemede tüm satırlar `PATH_GUARD` ile düşüyordu | Keşif de ters kapsamayı (`is_within(key, &path_key)`) uygular | `src-tauri/src/scanner/discovery.rs:319-327`; test `a_protected_folder_below_a_target_protects_the_target` |
| S4-7 | Orta | Yürüyüş uyarıları tüm tarama boyunca sınırsız birikiyordu | `max_candidates` eşleşen öğeleri sınırlar, hataları sınırlamaz; tam disk taramasında yüz binlerce `ScanNotice` (sahipli `String`) tutuluyordu | `MAX_SCAN_NOTICES = 1_000`; tavan aşılınca tek `WARNINGS_TRUNCATED` (Info) kaydı eklenir | `src-tauri/src/scanner/discovery.rs:27-34, 183-201` |
| S4-8 | Orta | Workspace algılama, workspace **bildirmeyen** manifestleri kök sayıyordu | `"workspaces"` anahtarının varlığı yeterliydi (`[]`/`null` dahil); Cargo tarafında `content.contains("[workspace]")` yorum/açıklamadaki metni de yakalıyordu | npm: dizi ve boş değil; Cargo: TOML ayrıştırılıp `workspace` tablosu aranır | `src-tauri/src/catalog/project.rs:270-299`; testler `an_empty_workspaces_key_is_not_a_workspace_root`, `a_manifest_that_merely_mentions_workspace_is_not_a_root` |
| S4-9 | Yüksek | Geçersiz zaman damgası Geçmiş görünümünü tamamen çökertiyordu | `new Date(x).toLocaleString()` geçersiz tarihte `RangeError` atar; satırlar `formatSavedAt` korumasını kullanmıyordu | Tüm satırlar (cleanup/action/scan) doğrulayan `formatSavedAt` kullanır | `src/features/history/HistoryView.tsx:23, 527, 542, 606, 634`; test `renders a placeholder for an unparseable timestamp instead of throwing` |
| S4-10 | Yüksek | macOS'ta Cmd ile kaydedilen her kısayol ölüydü | Kayıt `Meta+K` üretir; `matchesShortcut` "bildirilmemiş platform birincil modifier" kontrolünde `parsed.meta`yı yok sayıp erken `false` dönüyordu | Kontrol `!parsed.meta && ...`; ayrıca literal `+` tuşu `parseCombo`da korunur (`Ctrl++` artık kaydedilebilir/çalışır) | `src/lib/shortcuts.ts:50-62, 161-172`; testler `fires a Meta binding recorded on macOS`, `parses and matches a literal plus key` |
| S4-11 | Orta | Maskesiz yol içeren geçmiş kaydı diskte onarılmıyordu | Okuma yolu yalnız "satır sayısı değiştiyse" yeniden yazıyordu; yalnız `rootPath` maskesizse uzunluk aynı kalıyor ve ham hesap adı dosyada duruyordu | Yeniden yazma koşulu değer değişimini de kapsar (`healed`) | `src/features/history/scan-history.ts:112-127`; test `rewrites a stored record whose only problem is an unmasked path` |
| S4-12 | Orta | "Geçmişi temizle" sırasında başlatılan Yenile, silinen kayıtları geri getirebiliyordu | Temizleme `loading` kilidini tutmuyor ve nesil sayacını geçersiz kılmıyordu; geç dönen `load` yanıtı `setRecords([])` sonrasında yazıyordu | Temizleme boyunca `loading = true` + `loadGenerationRef` artırılır | `src/features/history/HistoryView.tsx:165-235` |
| S4-13 | Orta | Docs'ta Ctrl+K, başka bir girdide yazarken odağı çalıyordu | `/` dalı `editing` kontrol ediyordu, Ctrl+K etmiyordu; global kısayol politikası (girdi odaktayken yoksay) ile çelişiyordu | Ctrl+K dalı da `!editing` ister | `src/features/docs/DocsView.tsx:109` |
| S4-14 | Düşük | WebView2 "sayfada bul" (Ctrl+F) engellenmiyordu | Modül yalnız Ctrl+G ve F3'ü listeliyordu; asıl hızlandırıcı Ctrl+F idi | `ctrlOrMeta && key === "f"` (Shift/Alt'siz) engellenir | `src/lib/desktop-guard.ts:60-65` |
| S4-15 | Düşük | Bilinen konumlar yenilemesi eski yanıtı yeni yanıtın üzerine yazabiliyordu | Menü açılışındaki istekte nesil/iptal koruması yoktu; ayrıca unmount sonrası state yazılıyordu | Ortak `locationRequestRef` nesli; mount fetch, yenileme ve unmount aynı sayacı kullanır | `src/features/scan/ScanHeader.tsx:72, 79-101, 110-120` |

Doğrulanıp **kusur bulunmayan** alanlar: `safety/path_guard.rs` (yetkilendirme anahtarları
`canonicalize` kaynaklı, reparse/symlink hedefleri reddediliyor, kapsama bileşen bazlı ve iki yönlü),
`settings/model.rs` (`normalize`/`migrate` depo sınırında; `timeout_minutes * 60` ve
`Instant + Duration` taşmıyor; `%`/`~` dilimleri ASCII sınırında), `scanner/models.rs` (yalnız veri
tanımı; yeni alanlarda `serde(default)`), `cleanup/coordinator.rs` (S4-2 dışında yeniden doğrulama/
doğrulama sırası, denetim alanları ve sayaçlar doğru), `lib/validation/webhook-url.ts`,
`lib/format/date.ts`, `features/items/ProjectsView.tsx`, `stores/preferences-store.ts`,
`stores/ui-store.ts`; `dangerouslySetInnerHTML`, güvenilmeyen `href` veya başka bir XSS sink'i yok.

Bu iki turdan sonraki kapı ölçümü: `npm run typecheck` 0 hata; `npm test` **237/237** (28 dosya);
`cargo test --lib` **230/230**; `cargo clippy --all-targets` 0 uyarı; `cargo fmt --check` temiz;
`npm run format:check` temiz; `npm run check:gates`, `npm run check:audit` (5 kural),
`npm run check:i18n` (4/4), `npm run check:contrast` (4/4) geçti; `npm run build` başarılı;
`npx playwright test` **13/13**.

### 13. Kaynak doğrulaması (internet, 18.11.2026)

Düzeltmelerin dayandığı dış davranışlar aşağıdaki birincil kaynaklarla doğrulandı. Kaynaklar yalnız
davranış iddialarını destekler; kod yolu ve test sonuçları bu depodaki gerçek çalıştırmalardan gelir.

| İddia | Kaynak | Kullanıldığı bulgu |
| --- | --- | --- |
| WebView2'de "Find on Page" için tarayıcı hızlandırıcıları **Ctrl+F ve F3**'tür; bunlar `AreBrowserAcceleratorKeysEnabled` kapsamındadır | Microsoft Learn, `CoreWebView2Settings.AreBrowserAcceleratorKeysEnabled`: <https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2settings.arebrowseracceleratorkeysenabled>; Win32 eşdeğeri `ICoreWebView2AcceleratorKeyPressedEventArgs2` | S4-14: Ctrl+F'in de engellenmesi |
| `workspaces` alanı, çalışma alanı konumlarını tanımlayan bir **dizi**dir (doğrudan yollar veya glob'lar) | npm Docs, `package.json` § workspaces: <https://docs.npmjs.com/cli/v10/configuring-npm/package-json#workspaces> | S4-8: `[]`/`null` değerinin kök sayılmaması |
| `walkdir`'da `follow_links` yalnız sembolik bağlantı hedeflerini izler; kapatılması diğer reparse noktaları için ek budama ihtiyacını ortadan kaldırmaz | `walkdir::WalkDir` ve `walkdir::DirEntry` belgeleri: <https://docs.rs/walkdir/latest/walkdir/struct.WalkDir.html>, <https://docs.rs/walkdir/latest/walkdir/struct.DirEntry.html> | S4-4: reparse noktalarının `filter_entry` ile budanması |
| Windows'ta yeniden ayrıştırma noktaları (junction/reparse point) normal dizin gibi görünebilir; güvenlik kontrolü ayrıca `FILE_ATTRIBUTE_REPARSE_POINT` üzerinden yapılmalıdır | Microsoft Learn, "Reparse points": <https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-points> | S4-4: `platform::is_reparse_point` kontrolü |

Bu doğrulamadan sonra kodda ek değişiklik gerekmedi; yukarıdaki düzeltmeler kaynaklarla tutarlıdır.
Yayın kapılarından G0 (hukuk onayı), G4 (imzalı MSI + temiz VM testi) ve G9 (tasarım onayı) bu
depodaki kodla kapatılamaz; kullanıcı tarafından yürütülecektir.
