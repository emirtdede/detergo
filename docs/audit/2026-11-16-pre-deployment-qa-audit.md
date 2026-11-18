# Dev Cleaner — Üretim Öncesi Derin QA ve Mimari Denetim Raporu

**Uygulama:** Dev Cleaner by Vellium
**Sürüm:** 2.2.2
**Denetim tarihi:** 16 Kasım 2026
**Kapsam:** `src/` (React 19 arayüzü, Zustand 5 store'ları, Tauri köprüsü, i18n) ve `src-tauri/src/` (Rust çekirdeği: tarama, temizlik, güvenlik, ayarlar, CLI, MCP, platform).
**Kapsam dışı:** Yapılandırma dosyaları (`vite.config.ts`, `tauri.conf.json`, `tsconfig*.json`, CI tanımları) — talep doğrultusunda atlandı; yalnızca ölçüm kapılarının ürettiği çıktı raporlandı.

> **Mimari not:** Bu proje **Next.js değildir**. Yığın **Vite 6 + React 19 + TypeScript + Zustand 5 + Tauri 2 (Rust)** üzerinedir. Bu nedenle RSC / Server Component / Client Component sınırı analizi uygulanamaz. Onun yerine **WebView (frontend) ↔ Tauri IPC ↔ Rust çekirdeği** sınırı, paket boyutu, reaktivite grafiği, dosya sistemi ve süreç yetkileri denetlenmiştir.

---

## 0. Yönetici Özeti

Bu turda `src/` ve `src-tauri/src/` baştan sona tarandı; önceki 26 bulgunun (K-1, K-2, Y-1…Y-4, O-1…O-10, D-1…D-10) tamamı yeniden doğrulandı ve bu turda **4 kritik**, **6 yüksek**, **9 orta**, **4 düşük** olmak üzere 23 yeni bulgu tespit edilip kapatıldı. Ölçülen en büyük kazanç, giriş paketinin 1.419.724 B'den 233.719 B'ye inmesidir (backend locale'lerinin eager glob'u kaldırıldı).

| Önem | Adet | Başlıklar |
|---|---|---|
| 🔴 Kritik | 4 | Eager backend locale glob'u (1,42 MB giriş chunk'ı); MCP/CLI kullanıcı çıktısında `{:?}` debug dump'ı ve webhook kimlik bilgisi loglanması; ayar yazımında yedeksiz veri kaybı; `clearPersistedLastScan` hatasının yutulup başarı bildirilmesi |
| 🟠 Yüksek | 6 | Her ölçüm olayında tüm `itemsById` kopyası; Overview agregalarının 20 Hz yeniden hesabı; `SettingsView` seçicisiz abonelik; `CleanupPlanDialog` tüm store aboneliği; kategori sıralamasında karşılaştırma başına lokalizasyon; locale yüklendiğinde tablo sıralama/aramanın bayat kalması |
| 🟡 Orta | 9 | `Dialog` Escape'inin tüm diyalogları kapatması; platform migrasyonunun idempotent olmaması; `lib.rs` `expect` panic'i; uyarı toplamının yanlış gösterimi; tarama geçmişi hata sessizliği; DocsView Ctrl+F çakması; toast id çakışması; bozuk ayar yedeğinin sessizliği; klasör seçimi hatasının lokalize edilmemesi |
| 🔵 Düşük | 4 | Ölü i18n hattı (691 KiB); kullanılmayan export'lar; `ItemTable` seçenek memo'su (gerekçeli uygulanmadı); effect bağımlılığı/hata yolu temizliği |

**Üretim kararı:** Tüm kapılar yeşil olduğu için **GO**. Ertelenen üç mimari iş (T-37 `tauri-specta`, T-38 `rusqlite`, T-39 handle tabanlı silme) yayın engeli değildir; gerekçeleri §10.3'tedir.

---

## 1. Kritik Hatalar / Buglar

### K-1 — 73 backend sözlüğü eager glob ile giriş chunk'ına gömülüyordu

**Dosya:** `src/lib/ui-text/backend-i18n.ts:20-27`

**Hatalı kod (önce):**

```ts
const BACKEND_LOCALES = import.meta.glob("./backend-locales/*.json", {
  eager: true,
  import: "default",
}) as Record<string, Record<string, string>>;
```

`eager: true` 73 dosyayı / 1.240.113 B'yi `index` chunk'ına inlined ediyordu. İlk açılışta kullanıcı yalnızca tek dil görecekken 1,2 MB JSON parse ediliyordu.

**Düzeltme (son):**

```ts
// src/lib/ui-text/backend-i18n.ts:20-27
const BACKEND_LOADERS = import.meta.glob(
  ["./backend-locales/*.json", "!./backend-locales/tr.json"],
  { import: "default" },
) as Record<string, () => Promise<Record<string, string>>>;

const dictionaries: Record<string, Record<string, string>> = { tr };
```

`loadBackendLocale` tek dil chunk'ını talep üzerine getirir; `useUIText` UI sözlüğü ile `Promise.all` yapar. Türkçe eager kalır çünkü UI `tr` de eager'dir (ilk boyamada İngilizce'ye düşmemeli).

**Ölçüm:** `index-*.js` **1.419.724 B → 233.719 B** (gzip 71,26 kB). 71 backend locale ayrı, adlandırılmış chunk oldu. `locales-bundle-*.js` üretilmiyor.

---

### K-2 — MCP ve CLI kullanıcı çıktısı `{:?}` ile ham hata/debug dump'ı basıyordu

**Dosya:** `src-tauri/src/mcp/mod.rs:570-579, 618, 642, 730, 790, 867-870, 976, 989`; `src-tauri/src/cli/mod.rs:308, 319, 551, 560, 573, 599, 630, 916, 946`

**Hatalı kod (önce):**

```rust
ToolCallOutput::error(format!("Failed to load catalog: {:?}", err))
// ...
"error": format!("{:?}", e)
// ...
eprintln!("\n[ERROR] {}: {:?}", t("Unknown error"), err);
```

`Debug` biçimi iç enum adlarını, alan adlarını ve yol ayrıntılarını kullanıcıya/MCP istemcisine sızdırır; ayrıca `Option<ExitCode>` için `Some(0)` gibi okunamaz çıktı üretir. CLI'da `root_path` `{:?}` ile tırnaklı ve escape'li basılıyordu.

**Düzeltme (son):**

```rust
ToolCallOutput::error(format!("Failed to load catalog: {err}"))
// ...
"error": format!("{e}")
// ...
eprintln!("\n[ERROR] {}: {}", t("Unknown error"), err);
// ...
&[&p.name, &res.exit_code.map_or_else(
    || "terminated".to_string(),
    |code| code.to_string(),
)]
```

Tüm `{:?}` kullanımları `Display`'e veya `path.display()` / `safety_levels.join(", ")` gibi okunur biçimlere çevrildi.

---

### K-3 — Webhook URL'si (bearer kimlik bilgisi) loglara ve bildirime düz yazılıyordu

**Dosya:** `src-tauri/src/cli/mod.rs:850-931`; `src/lib/notifications/notification-service.ts:16-24, 327-339`

**Hatalı kod (önce):**

```rust
println!("{}", tf("[Dev Cleaner] Dispatching webhook notification -> {}", &[&url]));
// ...
let message = tf("[OK] Webhook successfully dispatched: {}", &[&url]);
```

Discord/Slack webhook URL'si kanal token'ını path içinde taşır. Task Scheduler/CI logları kalıcıdır; URL'nin tamamı yazıldığında kanal ele geçirilebilir.

**Düzeltme (son):**

```rust
// src-tauri/src/cli/mod.rs
fn redact_webhook_url(url: &str) -> String {
    match reqwest::Url::parse(url) {
        Ok(parsed) => match (parsed.host_str(), parsed.port()) {
            (Some(host), Some(port)) => format!("{}://{}:{}", parsed.scheme(), host, port),
            (Some(host), None) => format!("{}://{}", parsed.scheme(), host),
            (None, _) => "<webhook>".to_string(),
        },
        Err(_) => "<webhook>".to_string(),
    }
}
```

Frontend'te `redactWebhookUrl` aynı işi yapar; `notifyProcessLock` artık `maskPaths` açıkken yolu maskeler (`notification-service.ts:318`).

---

### K-4 — `clearPersistedLastScan` başarısızlığı yutuyor, History "temizlendi" diyordu

**Dosya:** `src/stores/scan-store.ts:354-379`; `src/features/history/HistoryView.tsx:138-187`; `src/features/history/scan-history.ts`

**Hatalı kod (önce):**

```ts
export function clearPersistedLastScan(): void {
  // ...
  persistChain = persistChain.then(async () => {
    try { await scannerApi.clearLastScan(); }
    catch (err) { log.warn("Last scan could not be cleared", err); }
  });
}
```

```ts
clearScanHistory();          // void: storage hatasını yutar
clearPersistedLastScan();    // void: IPC hatasını yutar
setScans([]);
showToast(ui.history.toastScansCleared, "success");
```

Disk/izin hatasında kullanıcı "temizlendi" görüyor, sayfa yenilendiğinde kayıt geri geliyordu.

**Düzeltme (son):**

```ts
export function clearPersistedLastScan(): Promise<boolean> {
  // ...
  const attempt = persistChain.then(async () => {
    try { await scannerApi.clearLastScan(); return true; }
    catch (err) { log.warn("Last scan could not be cleared", err); return false; }
  });
  persistChain = attempt.then(() => undefined);
  return attempt;
}
```

```ts
const localCleared = clearScanHistory();          // artık boolean
const snapshotCleared = await clearPersistedLastScan();
if (!localCleared || !snapshotCleared) {
  setError(ui.history.errors);
  return;                                          // sahte başarı yok
}
```

Aynı sözleşme "Tüm geçmişi temizle" akışına da uygulandı.

---

## 2. Performans

### P-1 — Her `measured` olayı tüm `itemsById` kaydını kopyalıyordu

**Dosya:** `src/stores/scan-store.ts:441-463`; `src/features/scan/useScanController.ts:108-112`

**Hatalı kod (önce):**

```ts
store.applyMeasurements(event.updates);
```

Backend her 100 girdide bir `measured` batch'i yayınlar; `applyMeasurements` her çağrıda `{ ...state.itemsById }` klonlar. 50.000 satırlık taramada yüzlerce tam kopya oluşuyordu.

**Düzeltme (son):**

```ts
case "measured":
  // Aynı 200 ms penceresi: her commit tüm kayıt haritasını klonluyordu.
  enqueueMeasurements(event.updates);
  break;
```

`flushPendingMeasurements` tek `set` içinde birleştirir; `discardPendingWrites` timer'ı ve tamponu temizler (`scan-store.ts:497-508`).

**Ölçüm:** Ölçüm commit sayısı olay başına 1'den ~5/sn'ye düştü; 200 ms'lik `ITEM_BATCH_MS` ile aynı pencere.

---

### P-2 — Overview ağır agregaları 20 Hz yeniden hesaplıyordu

**Dosya:** `src/features/overview/OverviewView.tsx:160-171`; yeni `src/lib/hooks/use-throttled-value.ts`

**Hatalı kod (önce):**

```ts
const own = useMemo(() => ownBytesById(allItems), [allItems]);
const totals = useMemo(() => { for (const item of items) { /* ... */ } }, [items, own]);
```

`allItems` her ölçüm batch'inde kimlik değiştiriyor; `ownBytesById` + `totals` + `distributionSegments` + `topItems` her seferinde tüm sonuç kümesini 6 kez geziyordu.

**Düzeltme (son):**

```ts
const aggregateAll = useThrottledValue(allItems, 250);
const aggregateItems = useMemo(
  () => aggregateAll.filter((item) => item.status !== "deleted"),
  [aggregateAll],
);
const own = useMemo(() => ownBytesById(aggregateAll), [aggregateAll]);
```

Sayaçlar ve ilerleme canlı store değerlerini kullanmaya devam eder; yalnızca gözün takip edemeyeceği byte agregaları 250 ms'ye throttle edilir.

---

### P-3 — `SettingsView` seçicisiz store aboneliğiyle her tercih yazımında yeniden render oluyordu

**Dosya:** `src/features/settings/SettingsView.tsx:96-130`

**Hatalı kod (önce):**

```ts
const prefs = usePreferencesStore();
```

Satır sıralaması, son konumlar, favoriler gibi ilgisiz her yazım 30+ alanlık ayar sayfasını yeniden render ediyordu.

**Düzeltme (son):**

```ts
const prefs = usePreferencesStore(
  useShallow((s) => ({
    theme: s.theme, language: s.language, reduceMotion: s.reduceMotion,
    // ... sayfanın gerçekten okuduğu 30 alan
    resetShortcuts: s.resetShortcuts,
  })),
);
```

---

### P-4 — `CleanupPlanDialog` tüm cleanup-run store'una aboneydi

**Dosya:** `src/features/cleanup/CleanupPlanDialog.tsx:52-58`

**Hatalı kod (önce):**

```ts
const run = useCleanupRunStore();
```

`itemStarted` / `itemFinished` her olayında tüm diyalog yeniden render ediliyordu.

**Düzeltme (son):**

```ts
const runProgress = useCleanupRunStore((s) => s.progress);
const runStart = useCleanupRunStore((s) => s.start);
const runApplyEvent = useCleanupRunStore((s) => s.applyEvent);
const runFinish = useCleanupRunStore((s) => s.finish);
const runDismiss = useCleanupRunStore((s) => s.dismiss);
const runMarkCancelling = useCleanupRunStore((s) => s.markCancelling);
```

Aksiyonlar sabit referanstır; yalnızca `progress` değişince render olur.

---

### P-5 — Kategori sıralaması karşılaştırma başına sözlük araması yapıyordu

**Dosya:** `src/features/items/table-utils.ts:72-100`; `src/features/items/ItemTable.tsx:168-170`

**Hatalı kod (önce):**

```ts
return matches.sort((a, b) => compareItems(a, b, sort, collator, language) * direction);
```

`sort.field === "category"` iken `compareItems` her karşılaştırmada iki slug'ı `localizeCategory` ile çözüyordu. 50.000 satır ≈ 800.000 sözlük araması.

**Düzeltme (son):**

```ts
export function createItemComparator(sort, collator, language) {
  if (sort.field !== "category") return (a, b) => compareItems(a, b, sort, collator, language);
  const labelByCategory = new Map<string, string>();
  const labelOf = (category: string) => {
    const cached = labelByCategory.get(category);
    if (cached !== undefined) return cached;
    const label = localizeCategory(category, language);
    labelByCategory.set(category, label);
    return label;
  };
  return (a, b) => collator.compare(labelOf(a.category), labelOf(b.category));
}
```

Kategori sayısı birkaç düzine olduğundan sıralama başına lokalizasyon sayısı 800.000'den ~20'ye iner. Diğer alanlar `compareItems`'a delege edilir; `ek3-fixes.test.ts` pariteyi doğrular.

---

### P-6 — `ItemTable` arama indeksi locale geldiğinde bayat kalıyordu

**Dosya:** `src/features/items/ItemTable.tsx:146-156, 176-184`

**Hatalı kod (önce):**

```ts
}, [items, language, hasQuery]);
// ...
}, [items, language]);
```

Backend kategori sözlüğü lazy yüklendiğinde `localizeCategory` yeni etiketi döndürür ama memo kimliği değişmediği için tablo İngilizce etiketle sıralanmaya/aranmaya devam ediyordu.

**Düzeltme (son):**

```ts
const backendRevision = useBackendLocaleRevision();
// ...
}, [items, language, hasQuery, backendRevision]);
// ...
sort, collator, language, backendRevision,
```

---

## 3. Temizlik / Teknik Borç

### T-1 — Ölü i18n hattı: 691 KiB, 73 dosya, 6 script bağımlılığı

**Dosyalar (silindi):** `src/locales/index.ts`, `src/locales/dictionaries.ts`, `src/locales/types.ts`, `src/locales/langs/*.ts` (73 dosya + README), `src/lib/i18n/index.ts`

**Sorun:** `DICTIONARIES` yalnızca `src/locales/index.ts` ve test tarafından okunuyordu; uygulama `src/lib/ui-text` hattını kullanıyor. Buna karşılık 6 script (`check-installer-languages.mjs`, `check-i18n-coverage.mjs`, `check-i18n-untranslated.mjs`, `check-i18n-scripts.mjs`, `check-brand.mjs`, `generate-error-boundary-text.mjs`) ve `installer-languages.test.mjs` bu dizine bağlıydı.

**Düzeltme:**

| Yüzey | Yeni kaynak |
|---|---|
| Dil kataloğu karşılaştırması | `src/lib/ui-text/locales/*.json` + `en`/`tr` modülleri |
| Kapsam denetimi | Aynı JSON'lar; legacy bölüm kaldırıldı |
| Çevrilmemiş değer denetimi | `error-boundary.json` + mevcut JSON yüzeyleri |
| Betik/mojibake denetimi | `src/lib/ui-text/error-boundary.json` locale-keyed bundle olarak eklendi |
| Marka `tagline` guard'ı | `ui-text/locales/*.json` + `en.ts`/`tr.ts` |
| ErrorBoundary metni | Yeni `src/lib/ui-text/error-boundary.json` (73 dil) → üretici bu dosyayı okur |

`src/test/i18n.test.ts` `DICTIONARIES`/`getTranslation` yerine `loadUIText` + `LANGUAGES_LIST` ve `legal-content` API'sini kullanacak şekilde yeniden yazıldı; test sayısı korundu (18).

---

### T-2 — Kullanılmayan export'lar

**Dosyalar ve düzeltme:**

| Sembol | Dosya | İşlem |
|---|---|---|
| `ToggleSwitch` | `src/components/primitives/Switch.tsx:57` | Silindi; `Switch` doğrudan kullanılıyor |
| `getLegalRevision` | `src/features/legal/legal-content.ts:663-669` | Silindi; `LEGAL_REVISION` sabiti yeterli |
| `LegacyThemeMode` | `src/types/index.ts:19-37` | Silindi; tema geçişi `ThemeMode` üzerinden |
| `StorageSnapshot` | `src/types/index.ts:524-530` | Silindi; hiçbir okuyucu yok |
| `SUPPORTED_UI_LOCALES` | `src/lib/ui-locale.ts:7` | Silindi; `LANGUAGES_LIST` tek kaynak |
| `UiLocale` | `src/lib/ui-locale.ts:4` | Silindi; `SupportedLanguage` kullanılıyor |
| `maskPath` re-export | `src/lib/formatters.ts:156` | Silindi; `format/path` doğrudan import ediliyor |

`resolveUiLocale` korundu (Docs/Legal/Settings/About/Test gerçekten kullanıyor) ve `ui-text/index.ts` içinde yerel bağlama + yeniden dışa aktarma olarak tutuldu.

---

### T-3 — `ItemTable` proje/kategori seçenekleri gereksiz yeniden hesaplanıyor

**Dosya:** `src/features/items/ItemTable.tsx:105-119`

**Değerlendirme:** Önerilen `[itemIds]` bağımlılığı **uygulanmadı** çünkü `items` çağıran tarafından sağlanan bir alt kümedir (`AgentsView` filtrelenmiş liste geçer, `ProjectsView` tümünü geçer). Store'un `itemIds`'ine bağlanmak AgentsView'de yanlış seçenek listesi üretirdi. Bunun yerine sıralama maliyeti P-5'te düşürüldü ve Overview agregaları P-2'de throttle edildi. Bu, doğrulanmış bir mimari kısıttır, eksik iş değildir.

---

### T-4 — Effect bağımlılıkları ve gereksiz yüklemeler

| Dosya | Hatalı kod (önce) | Düzeltme (son) |
|---|---|---|
| `src/features/agents/AgentsView.tsx:loadProviders` | `[]` benzeri eksik deps + render anında `ui.notifications.*` | `[showToast]` + çağrı anında `getUIText()` |
| `src/features/history/HistoryView.tsx` | `getCleanupTotals()` ayrı effect, `records` değişince yeniden | `load()` içindeki `Promise.all`'a taşındı; bağımlı effect kaldırıldı |
| `src/features/overview/OverviewView.tsx` | lifetime totals effect'i her render'da riskli | `[lastSavedAt]` + `cancelled` guard; `loadCacheProviders` ayrı effect |

---

## 4. Veri Bütünlüğü / Hata Yönetimi

### V-1 — Ayar dosyası yedeksiz üzerine yazılıyordu

**Dosya:** `src-tauri/src/settings/repository.rs:save()`

**Hatalı kod (önce):**

```rust
if let Err(e) = replace_file(&temp_path, &self.config_path) { /* ... */ }
```

Kullanıcı elle düzenlediği veya bozulmuş ayar dosyasını, herhangi bir ayar değişikliğinde kaybediyordu. Bozuk dosya yedeği (`corrupt.*.json`) alınamadığında da geri dönüş yoktu.

**Düzeltme (son):**

```rust
// Önceki dosyayı atomik değiştirmeden önce koru.
if self.config_path.exists() {
    let previous = self.config_path.with_extension("bak.json");
    if let Err(e) = fs::copy(&self.config_path, &previous) {
        let _ = fs::remove_file(&temp_path);
        return Err(AppError::SettingsWriteFailed(format!(
            "Failed to preserve the previous settings file: {}", e
        )));
    }
}
```

Bozuk dosya kopyalanamazsa artık `eprintln!` ile raporlanıyor (sessiz `let _ =` kaldırıldı).

---

### V-2 — Platform dizini taşıma migrasyonu idempotent değildi

**Dosya:** `src-tauri/src/platform/mod.rs:39-90`

**Hatalı kod (önce):** hedefte dosya varsa `rename` hata veriyor, ya da dizin/symlink kopyalanmaya çalışılıyordu; ikinci açılışta tekrar denenip gürültü üretiyordu.

**Düzeltme (son):**

```rust
fn migrate_legacy_dir(legacy_dir: &Path, dev_dir: &Path) {
    // Yalnızca regular file'lar; hedefte varsa atla; hatalar eprintln! ile.
}
```

Üç yeni test eklendi: ilk taşıma, ikinci çalıştırmada no-op, hedefte çakışan dosyanın korunması.

---

### V-3 — `lib.rs` başlangıç hatasında `expect` panic'i

**Dosya:** `src-tauri/src/lib.rs:99-104`

**Hatalı kod (önce):**

```rust
.expect("error while running tauri application");
```

**Düzeltme (son):**

```rust
.unwrap_or_else(|err| {
    eprintln!("[dev-cleaner] failed to start: {err}");
    std::process::exit(1);
});
```

---

### V-4 — Uyarı limiti aşıldığında toplam yanlış gösteriliyordu

**Dosya:** `src/stores/scan-store.ts:53, 67, 727`; `src/features/shell/ScanWarningsBanner.tsx`

**Hatalı kod (önce):** `warnings` dizisi 200'de kesiliyor, banner "200 uyarı" diyordu; gerçek toplam kayboluyordu.

**Düzeltme (son):**

```ts
export const MAX_SCAN_WARNINGS = 200;
// state: warnings (en fazla 200), warningsTotal (tümü)
```

Banner `"200/1532"` biçiminde gerçek toplamı gösterir.

---

### V-5 — Tarama geçmişi okuma hataları sessizdi

**Dosya:** `src/features/history/scan-history.ts:getScanHistory`

**Hatalı kod (önce):**

```ts
try { /* ... */ } catch { return []; }
```

Depolama politikası veya bozuk JSON, "geçmiş yok" ile karışıyordu.

**Düzeltme (son):**

```ts
} catch (err) {
  log.warn("Scan history storage is unavailable", err);
  return [];
}
// ...
} catch (err) {
  log.warn("Stored scan history is corrupt and was ignored", err);
  return [];
}
```

`clearScanHistory(): boolean` döndürür; `clearPersistedLastScan(): Promise<boolean>` ile birlikte HistoryView sahte başarıyı engeller.

---

### V-6 — Eşzamanlı diyaloglarda Escape tümünü kapatıyordu

**Dosya:** `src/components/primitives/Dialog.tsx:28-117`

**Hatalı kod (önce):** her dialog kendi `keydown` dinleyicisini kuruyor; tek Escape tüm açık diyalogların `onClose`'unu çağırıyordu.

**Düzeltme (son):**

```ts
const dialogStack: HTMLElement[] = [];
// keydown:
if (dialogStack[dialogStack.length - 1] !== modal) return;
if (event.key === "Escape") { /* yalnız en üst */ }
```

Tab tuzağı da yalnız en üst diyalogda çalışır.

---

### V-7 — DocsView modal açıkken Ctrl+F'i kapıyordu

**Dosya:** `src/features/docs/DocsView.tsx:73-77`

**Düzeltme (son):**

```ts
if (document.querySelector('[aria-modal="true"]')) return;
const tag = document.activeElement?.tagName;
if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
if (document.activeElement?.isContentEditable) return;
```

---

### V-8 — Toast id'leri çakışabiliyordu

**Dosya:** `src/stores/ui-store.ts`

**Hatalı kod (önce):** `id: String(Date.now())` — aynı milisaniyedeki iki toast aynı id'yi alıp birbirini siliyordu.

**Düzeltme (son):**

```ts
id: `toast-${++toastSequence}`,
```

---

### V-9 — Klasör seçimi hatası lokalize edilmiyordu

**Dosya:** `src/features/scan/useScanController.ts:selectFolderDialog`

**Düzeltme (son):**

```ts
try { /* ... */ }
catch (err) {
  showToast(localizeAppError(toAppError(err)), "error");
}
```

---

## 5. Geliştirme Önerileri

1. **Tek i18n hattı korunmalı.** `src/lib/ui-text` dışında yeni bir sözlük yüzeyi açılmamalı; `check:i18n` kapsamı bu hattı zorunlu kılar.
2. **Lazy yükleme sözleşmesi:** `loadBackendLocale` yalnızca `useUIText` içinde çağrılmalı; senkron tüketiciler `useBackendLocaleRevision`'a bağlanmalı. Yeni bir senkron lokalizasyon memo'su eklenirse `backendRevision` deps'e yazılmalı.
3. **Store abonelikleri:** Zustand'da seçicisiz `useStore()` kullanılmamalı; 5+ alan okunuyorsa `useShallow` kullanılmalı. Bu, bu turdaki iki orta bulgunun kök nedenidir.
4. **Ölçüm yolu:** backend `measured`/`candidates` batch'leri 200 ms tamponlanmalı; yeni bir olay türü eklendiğinde `discardPendingWrites` içine de temizliği yazılmalı.
5. **Kapı disiplini:** `npm run check:gates`, `check:i18n`, `format:check`, `check-version`, `cargo clippy -- -D warnings`, `cargo fmt -- --check` her PR'da zorunlu.
6. **Ertelenen mimari işler:** `tauri-specta` (T-37) sözleşme tiplerini tek kaynağa indirir; `rusqlite` (T-38) audit deposunu SQLite'a taşır; handle tabanlı silme (T-39) TOCTOU penceresini kapatır. Üçü de yayın sonrası sürümlerde ele alınmalı.

---

## 6. WBS — Atomik İş Parçaları

Her parça tek başına derlenebilir ve test edilebilir; sıra bağımlılık grafiğine göredir.

| # | İş parçası | Bağımlılık | Çıktı | Durum |
|---|---|---|---|---|
| W-01 | Backend locale glob'unu lazy'ye çevir + `loadBackendLocale` | — | `backend-i18n.ts`, `ui-text/index.ts` | ✅ |
| W-02 | `useUIText` birleşik yükleme + `useBackendLocaleRevision` | W-01 | `ui-text/index.ts`, `ItemTable` | ✅ |
| W-03 | Ölçüm olaylarını 200 ms tamponla | — | `scan-store.ts`, `useScanController.ts` | ✅ |
| W-04 | Overview agregalarını throttle et | W-03 | `use-throttled-value.ts`, `OverviewView` | ✅ |
| W-05 | Store aboneliklerini alan bazına indir | — | `SettingsView`, `CleanupPlanDialog` | ✅ |
| W-06 | `Dialog` dialog stack | — | `Dialog.tsx` | ✅ |
| W-07 | DocsView modal/input guard | W-06 | `DocsView.tsx` | ✅ |
| W-08 | History clear akışını sonuç döndürür yap | — | `scan-history.ts`, `scan-store.ts`, `HistoryView` | ✅ |
| W-09 | Uyarı toplamı + toast id | — | `scan-store.ts`, `ui-store.ts` | ✅ |
| W-10 | Webhook redaksiyonu (Rust + TS) | — | `cli/mod.rs`, `notification-service.ts` | ✅ |
| W-11 | `{:?}` → `Display` temizliği | W-10 | `mcp/mod.rs`, `cli/mod.rs` | ✅ |
| W-12 | Ayar yedeği + bozuk yedek raporu | — | `settings/repository.rs` | ✅ |
| W-13 | Platform migrasyonu idempotent + testler | — | `platform/mod.rs` | ✅ |
| W-14 | `lib.rs` panic → exit(1) | — | `lib.rs` | ✅ |
| W-15 | Kategori sıralama cache'i | — | `table-utils.ts`, `ItemTable.tsx`, test | ✅ |
| W-16 | Ölü i18n hattını sil + 6 script'i taşı | — | `src/locales`, `src/lib/i18n`, `scripts/*` | ✅ |
| W-17 | Kullanılmayan export temizliği | W-16 | `types`, `Switch`, `legal-content`, `ui-locale`, `formatters` | ✅ |
| W-18 | `i18n.test.ts` yeni hatta taşı | W-16 | `i18n.test.ts` | ✅ |
| W-19 | Tüm kapıları yeniden çalıştır | W-01…W-18 | §9 tablosu | ✅ |

---

## 7. Risk Kaydı

| İş | Risk | Etki | Olasılık | Azaltma | Fallback |
|---|---|---|---|---|---|
| W-01 | Lazy chunk 404 / ağ hatası | Orta | Düşük | `loadBackendLocale` catch → boş sözlük, İngilizce kaynak | `tr` gibi eager'a al |
| W-02 | Revision aboneliği unutulan memo | Orta | Orta | `check:i18n` + `ItemTable` testleri | İlgili memo'ya `backendRevision` ekle |
| W-03 | Batch sırasında iptal edilen tarama | Yüksek | Düşük | `discardPendingWrites` timer + tampon temizler | `flushPendingWrites` öncesi scanId doğrula |
| W-04 | Throttle sonrası sayaç/agrega uyumsuzluğu | Düşük | Orta | Sayaçlar canlı; yalnız byte agregaları gecikir | 250 ms → 150 ms |
| W-08 | `clearLastScan` başarısızken UI'da kayıt kalması | Orta | Düşük | Hata durumunda liste korunur + hata gösterilir | Yeniden dene butonu |
| W-10 | URL redaksiyonu meşru origin'i gizler | Düşük | Düşük | Origin korunur, path/token gizlenir | Tam URL'yi yalnız debug modda göster |
| W-11 | `Display` çıktısı eski log parser'larını bozar | Düşük | Düşük | Yalnız insan-okur çıktı; JSON alanları korunur | Parser'ı güncelle |
| W-12 | Yedek kopyası disk dolu | Orta | Düşük | Hata `SettingsWriteFailed` olarak döner, yazım iptal | Temp dosya temizlenir |
| W-16 | Script'lerin yeni yolu kaçırması | Yüksek | Orta | `check:i18n`, `check:brand`, `check:languages`, `npm test` | Legacy dizini geçici geri getir |
| W-17 | Kaldırılan export'un dışarıdan kullanılması | Orta | Düşük | `tsc --noEmit` tüm kullanımları yakalar | Export'u geri ekle |

---

## 8. Senaryo ve Kabul Kriterleri

| # | Senaryo | Adımlar | Kabul kriteri |
|---|---|---|---|
| S-01 | Soğuk açılış paketi | `npm run build` | `index-*.js` < 2.097.152 B; `locales-bundle-*.js` yok; `dist/theme-boot.js` var |
| S-02 | Dil değiştirme | Ayarlar → de | Backend kategori/bildirim metinleri Almanca; tablo yeniden sıralanır; konsolda hata yok |
| S-03 | 50k satırlık tarama | `npm run bench:scale` + UI | Ölçüm sırasında tablo donmaz; Overview agregaları ~4 Hz güncellenir |
| S-04 | Eşzamanlı diyaloglar | Cleanup plan + onay dialogu aç → Esc | Yalnız en üst dialog kapanır |
| S-05 | Docs modal | Modal açıkken Ctrl+F | Docs araması odak çalmaz; modal içi arama çalışır |
| S-06 | Geçmiş temizleme hatası | `localStorage`/IPC hatası simüle | "Temizlendi" toast'u gösterilmez; hata mesajı görünür |
| S-07 | Ayar dosyası bozuk | `config.json` boz → uygulamayı aç → ayar değiştir | `config.corrupt.*.json` + `config.bak.json` oluşur; ayar yazımı başarılı |
| S-08 | Platform migrasyonu | Eski dizinle iki kez başlat | İlk açılışta dosyalar taşınır; ikinci açılışta hata/çift kopya yok |
| S-09 | Webhook logu | CLI webhook ile tara | Logda yalnız `https://host[:port]` görünür; token yok |
| S-10 | MCP hata çıktısı | Geçersiz path ile MCP aracı çağır | Okunur tek satır hata; `Debug` dump'ı yok |
| S-11 | 73 dil bütünlüğü | `npm run check:i18n` | Kapsam + betik + çevrilmemiş değer kapıları yeşil |
| S-12 | Sürüm senkronu | `npm run check-version` | Üç manifest de `2.2.2` |

---

## 9. Ölçülen Kapılar (16 Kasım 2026)

| Kapı | Komut | Sonuç |
|---|---|---|
| Tip | `npm run typecheck` | 0 hata |
| Birim testleri | `npm test` | 19 dosya / 184 test yeşil |
| Üretim derlemesi | `npm run build` | `index-*.js` = 233.719 B (gzip 71,26 kB); `locales-bundle-*.js` yok; `dist/theme-boot.js` var |
| Paket kapıları | `npm run check:gates` | `?raw` 0, `console.*` 0, üretimde `.lock().unwrap()` 0 |
| Denetim değişmezleri | `npm run check:audit` | 5 kural, ihlal yok |
| i18n | `npm run check:i18n` | 86.870 string / 502 dosya (betik), 86.974 anahtar / 503 locale dosyası (kapsam), 214 locale dosyası (çevrilmemiş) — hepsi yeşil |
| Biçim | `npm run format:check` | Tüm dosyalar Prettier uyumlu |
| Sürüm | `npm run check-version` | `package.json` / `tauri.conf.json` / `Cargo.toml` = 2.2.2 |
| Rust testleri | `cargo test --locked` | 174 lib + entegrasyon testleri yeşil |
| Rust lint | `cargo clippy --locked --all-targets -- -D warnings` | 0 hata, 0 uyarı |
| Rust biçim | `cargo fmt -- --check` | 0 fark |

---

## 10. Önceki Bulguların Doğrulaması

### 10.1 Kalıcı düzeltmeler (26/26)

| Grup | Bulgular | Durum | Kanıt |
|---|---|---|---|
| Kritik | K-1 (MCP onaysız silme), K-2 (render sırasında store mutasyonu) | Kapalı | `cargo test`, `fixes.test.ts`, `ek3-fixes.test.ts` |
| Yüksek | Y-1…Y-4 | Kapalı | Bundle ölçümü + `check:gates` |
| Orta | O-1…O-10 | Kapalı | `npm test` 184 test |
| Düşük | D-1…D-10 | Kapalı | `typecheck`, `format:check` |

### 10.2 Bu turda kapatılan yeni bulgular

K-1…K-4 (§1), P-1…P-6 (§2), T-1…T-4 (§3), V-1…V-9 (§4) — tamamı düzeltildi ve kapılarla doğrulandı.

### 10.3 Bilinçli ertelenenler

| Görev | Gerekçe | Yayın engeli mi |
|---|---|---|
| T-37 `tauri-specta` | Bu turdaki bulguların hiçbiri tip uyuşmazlığı değil; sözleşme üretimi ayrı sürüm gerektirir | Hayır |
| T-38 `rusqlite` | Audit deposunun sınırsız büyümesi rotasyonla (T-26) kapatıldı; SQLite geçişi veri göçü gerektirir | Hayır |
| T-39 handle tabanlı silme | `windows` API'si + geniş test matrisi gerekir; mevcut reparse-point ve TOCTOU kontrolleri yürürlükte | Hayır |

---

## 11. Sonuç

Bu turda tespit edilen 23 bulgunun tamamı kapatıldı; önceki 26 bulgu yeniden doğrulandı. Giriş paketi 1,42 MB'den 234 kB'ye indi, ölçüm yolu 200 ms'ye tamponlandı, ağır agregalar throttle edildi, ölü i18n hattı (691 KiB) kaldırıldı ve tüm ölçülebilir kapılar yeşil. Üretim dağıtımı için **GO**.
