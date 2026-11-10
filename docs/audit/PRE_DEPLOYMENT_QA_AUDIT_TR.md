# Node Cleaner — Üretim Öncesi QA ve Mimari Denetim Raporu

**Uygulama:** Node Cleaner / Dev Cleaner by Vellium
**Sürüm:** 2.2.0
**Denetim tarihi:** 9 Kasım 2026
**Kapsam:** `src/` (React arayüzü, Zustand store'ları, Tauri köprüsü) ve `src-tauri/` (Rust çekirdeği: tarama, temizlik, güvenlik, ayarlar, CLI, MCP)
**Kapsam dışı:** Yapılandırma dosyaları (`vite.config.ts`, `tauri.conf.json`, `tsconfig*.json`, CI tanımları) — talep doğrultusunda atlandı.

> **Önemli mimari not:** Bu proje Next.js değildir. Yığın **Vite 6 + React 19 + TypeScript + Zustand + Tauri 2 (Rust)** üzerinedir. Bu nedenle "Server Component / Client Component" sınırı yerine **WebView (frontend) ↔ Tauri IPC ↔ Rust çekirdeği** sınırı ve dosya sistemi/süreç yetkileri denetlenmiştir. Rapor, üretim hedefli olduğu için varsayılan önem düzeyi yüksektir.

---

## 0. Yönetici Özeti

Kod tabanı genel olarak olgun; özellikle Rust tarafında güvenlik odaklı tasarım (path containment, reparse point reddi, tek kullanımlık onay token'ı, audit kaydı) ve test kapsamı dikkat çekicidir. Buna karşılık üretime çıkmadan önce kapatılması gereken **3 kritik**, **8 yüksek** ve çok sayıda orta/düşük öncelikli bulgu vardır.

| Önem | Adet | Başlıklar |
|---|---|---|
| 🔴 Kritik | 3 | MCP üzerinden onaysız silme; React render sırasında store mutasyonu; webhook testinin her zaman başarılı görünmesi |
| 🟠 Yüksek | 8 | Kısayol stale closure; restore effect'in tekrar tetiklenmesi; ayar yazma fırtınası; bildirim izni/AudioContext sızıntısı; stack trace sızıntısı; CLI hatalı çıkış kodu ve scope yok sayması; aday limiti off-by-one; restore şema doğrulaması |
| 🟡 Orta | 13 | Sessiz hata yutma, `window.confirm`, sabit sürüm metinleri, `as any`, eksik effect bağımlılıkları, Mutex panic, localStorage tutarsızlığı, i18n sertleştirilmiş metinler vb. |
| 🔵 Düşük | 8 | Kod tekrarı, biçimlendirme, doküman eskimesi, console kullanımı, Windows'a özgü path varsayımı vb. |

**Üretim kararı:** Mevcut haliyle **KO (yayına hazır değil)**. Kritik ve yüksek maddeler kapatılmadan doğrudan kullanıcıya dağıtım önerilmez.

---

## 1. 🔴 KRİTİK BULGULAR

### K-1 — MCP `devcleaner_clean_safe` onay almadan gerçek silme yapıyor

**Dosya:** `src-tauri/src/mcp/mod.rs:312-400`

MCP sunucusundaki `devcleaner_clean_safe` aracı, çağrıldığı anda planı oluşturup **aynı planın onay token'ını kendisi üreterek** `execute_plan` çağırıyor. Kullanıcıya önizleme, onay veya ikinci adım gösterilmiyor. Ayrıca tarama yapılandırmasında `exclusions: &[]` ve `protected_paths: &[]` veriliyor; yani kullanıcının ayarlarındaki dışlamalar ve korumalı yollar tarama aşamasında yok sayılıyor. Bir LLM/otomasyon istemcisi bu aracı yanlış parametrelerle çağırdığında geri dönüşü olmayan (Recycle Bin'e taşıma olsa bile) istenmeyen silmeler oluşabilir.

```rust
// src-tauri/src/mcp/mod.rs — ÖNERİLEN
"devcleaner_clean_safe" => {
    let target_ids: Vec<String> = /* ... */;
    let path_str = args.get("path").and_then(|p| p.as_str()).unwrap_or(".");
    let root_path = PathBuf::from(path_str);

    // 1) Kullanıcı ayarlarını ve korumalı yolları mutlaka uygula.
    let state = AppState::new();
    let settings = state.settings.load();
    let policy = crate::cleanup::CleanupPolicy::from(&settings);
    let exclusions = settings.excluded_names.clone();
    let protected = settings.protected_paths.clone();

    // 2) Yalnızca önizleme üret; gerçek silme için ayrı ve açık bir onay ara.
    let plan = crate::cleanup::build_plan(/* ... */)?;
    if args.get("confirm").and_then(|v| v.as_bool()) != Some(true) {
        return serde_json::json!({
            "status": "preview_only",
            "plan_id": plan.id,
            "confirmation_token": plan.confirmation_token,
            "requires_user_confirmation": true,
            "targets": plan.targets,
        }).to_string();
    }
    // 3) Onay varsa bile token'ı dışarıdan gelen değerle doğrula.
    let token = args.get("confirmation_token").and_then(|v| v.as_str())
        .unwrap_or_default();
    crate::cleanup::execute_plan(&plan, &session, &catalog, &policy, token, false)
}
```

**Ek şart:** `devcleaner_clean_safe` adı yanıltıcıdır; "safe" kelimesi kullanıcıya garanti izlenimi verir. Araç `devcleaner_preview_cleanup` ve `devcleaner_confirm_cleanup` olarak ikiye ayrılmalı, MCP istemcisine araç açıklamasında "onaysız silme yapmaz" garantisi yazılmalıdır.

---

### K-2 — `ItemTable` render/memo sırasında Zustand store nesnesini mutasyona uğratıyor

**Dosya:** `src/features/items/ItemTable.tsx:221`

```ts
const haystack = (item as any)._searchHaystack ??= `${item.displayPath} ...`;
```

`useMemo` içinde store'dan gelen `item` nesnesine yeni bir alan yazılıyor. React'te render sırasında yapılan bu yan etki:

- StrictMode'da çift render ile beklenmeyen davranış üretir,
- Zustand nesnesi referansı değişmediği için abone bileşenlerin yeniden render edilmesini garanti etmez,
- `CleanupItem` tipini gizli bir alanla kirletir ve ileride `Object.keys`/serialize eden kodlarda sürpriz üretir.

**Düzeltme — türetilmiş veriyi store'a yazmadan hesapla:**

```tsx
// ItemTable.tsx
const haystackIndex = useMemo(() => {
  const map = new Map<string, string>();
  for (const item of items) {
    map.set(
      item.id,
      `${item.displayPath} ${item.displayName} ${item.providerLabel ?? ""}`.toLowerCase()
    );
  }
  return map;
}, [items]);

const filtered = useMemo(() => {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => haystackIndex.get(item.id)?.includes(q));
}, [items, query, haystackIndex]);
```

Alternatif ve daha performanslı çözüm: haystack alanını tarama sonucu store'a **yazılırken** (ingest aşamasında) bir kez üretmek ve `CleanupItem` tipine opsiyonel `searchHaystack?: string` olarak eklemek.

---

### K-3 — Webhook testi `mode: "no-cors"` nedeniyle her zaman başarılı raporluyor

**Dosya:** `src/features/settings/SettingsView.tsx:155-173`

`fetch(..., { mode: "no-cors" })` çağrısı opak (`opaque`) bir yanıt döndürür. HTTP 500, DNS hatası veya sunucu reddi durumunda bile `fetch` promise'i çözülür; `catch` bloğu neredeyse hiç çalışmaz. Kullanıcı "Webhook gönderildi" mesajını görür ama istek hiç ulaşmamış olabilir. Üstelik Tauri WebView'ında CORS politikası nedeniyle çoğu webhook uç noktası zaten engellenir.

**Düzeltme — isteği Rust tarafına taşı (CORS yok, durum kodu okunabilir):**

```rust
// src-tauri/src/commands/webhook_commands.rs (yeni)
#[tauri::command]
pub async fn test_webhook(url: String) -> Result<u16, AppError> {
    let parsed = reqwest::Url::parse(&url)
        .map_err(|_| AppError::InvalidInput("Geçersiz webhook URL".into()))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::InvalidInput("Yalnızca http/https".into()));
    }
    let resp = reqwest::Client::new()
        .post(parsed)
        .json(&serde_json::json!({ "event": "test_ping" }))
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(AppError::Network)?;
    Ok(resp.status().as_u16())
}
```

```tsx
// SettingsView.tsx
const status = await invoke<number>("test_webhook", { url });
if (status >= 200 && status < 300) {
  setWebhookTestStatus({ success: true, text: ui.settings.webhookSent });
} else {
  setWebhookTestStatus({ success: false, text: `HTTP ${status}` });
}
```

Ara çözüm olarak `mode: "no-cors"` kaldırılıp `response.ok` kontrol edilebilir; ancak Tauri'de CORS nedeniyle asıl doğru çözüm Rust tarafıdır.

---

## 2. 🟠 YÜKSEK ÖNCELİKLİ BULGULAR

### Y-1 — Klavye kısayolu dinleyicisi bayat `isScanning` değeri kullanıyor

**Dosya:** `src/app/App.tsx:123-182`

Effect bağımlılık dizisi boş (`[]`), fakat içeride `isScanning`, `cancelScan`, `startScan` closure'dan okunuyor. Tarama başladıktan sonra kısayola basıldığında `isScanning` hâlâ `false` olduğu için yeni tarama başlatılmaya çalışılır; iptal çağrılmaz. Ayrıca `startScan`/`cancelScan` kimlikleri değişirse eski closure çalışmaya devam eder.

```tsx
// App.tsx — ÖNERİLEN
useEffect(() => {
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (target?.isContentEditable) return;

    const prefs = usePreferencesStore.getState();
    const shortcuts = prefs.shortcuts ?? DEFAULT_SHORTCUTS;

    if (matchesShortcut(event, shortcuts.toggleSidebar)) { /* ... */ }
    if (matchesShortcut(event, shortcuts.focusSearch)) { /* ... */ }

    if (matchesShortcut(event, shortcuts.startStopScan)) {
      event.preventDefault();
      // Store'dan anlık değer oku — closure'a güvenme.
      const scan = useScanStore.getState();
      if (scan.status === "scanning" || scan.status === "measuring") {
        void scan.cancelScan();
      } else {
        void scan.startScan();
      }
      return;
    }
    // ...
  };

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}, []); // Artık gerçekten bağımsız: tüm değerler getState() ile okunuyor.
```

### Y-2 — Son tarama geri yükleme effect'i her tarama durum değişiminde yeniden çalışıyor

**Dosya:** `src/app/App.tsx:98-113`

Bağımlılıklar `[isScanning, startScan, cancelScan]`. `isScanning` her değiştiğinde `getLastScan()` yeniden çağrılır. Tarama bitişinde gereksiz IPC, yarış koşulu ve "eski snapshot yeni taramanın üzerine yazılabilir" riski doğar (guard olsa da gereksiz yük).

```tsx
// Yalnızca açılışta bir kez çalıştır.
useEffect(() => {
  let cancelled = false;
  scannerApi.getLastScan()
    .then((snapshot) => {
      if (cancelled || !snapshot) return;
      const store = useScanStore.getState();
      if (store.status !== "idle" || store.itemIds.length > 0) return;
      store.restoreScan(snapshot);
    })
    .catch(() => { /* sessiz değil: aşağıdaki O-1'e bakın */ });
  return () => { cancelled = true; };
}, []);
```

### Y-3 — Her ayar setter'ı anında IPC yazması tetikliyor (yazma fırtınası)

**Dosya:** `src/stores/preferences-store.ts:188-198` ve tüm setter'lar (`:208-305`)

`syncPreferences` debounce içermiyor. Tema + dil + bildirim gibi art arda yapılan değişikliklerde her biri ayrı `saveAppSettings` IPC çağrısı üretir. Bu hem disk yazımını hem de UI jank'ini artırır; hata durumunda birden fazla toast üst üste biner.

```ts
// preferences-store.ts
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSave: Promise<void> = Promise.resolve();

function syncPreferences(state: PreferencesState) {
  if (!state.isLoaded) return;
  if (saveTimer !== null) clearTimeout(saveTimer);

  saveTimer = setTimeout(() => {
    saveTimer = null;
    pendingSave = pendingSave
      .then(() => scannerApi.saveAppSettings(toSettings(state)))
      .catch((err) => {
        console.error("Failed to persist settings:", err);
        useUiStore.getState().showToast(
          getUIText(state.language).settings.saveError, "error", 5000
        );
      });
  }, 250);
}
```

**Ek:** Uygulama kapanırken bekleyen yazımı kaybetmemek için `beforeunload`/Tauri `CloseRequested` olayında `flushPreferences()` çağrılmalı.

### Y-4 — Bildirim servisi açılışta izin istiyor ve her ses için yeni `AudioContext` açıyor

**Dosya:** `src/lib/notifications/notification-service.ts:77-160`

- `constructor()` içinde `checkPermission()` çağrılıyor; bu da daha önce karar verilmemişse **uygulama açar açılmaz** `Notification.requestPermission()` tetikliyor. Kullanıcı bağlamı olmadan çıkan izin penceresi reddedilme oranını yükseltir ve ürün güvenini zedeler.
- `playChime()` her çağrıda yeni `AudioContext` oluşturuyor ve `close()` etmiyor. Tarama/temizlik bildirimleri biriktikçe ses donanımı tutamaçları sızar; bazı Windows sürücülerinde ses tamamen kesilebilir.

```ts
// notification-service.ts
class NotificationService {
  private audioCtx: AudioContext | null = null;

  private getAudioContext(): AudioContext | null {
    if (this.audioCtx && this.audioCtx.state !== "closed") return this.audioCtx;
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    this.audioCtx = new Ctor();
    return this.audioCtx;
  }

  private playChime() {
    const ctx = this.getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    // ...
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  }
}
```

İzin isteği yalnızca kullanıcı Ayarlar'da bildirimi açtığında `requestDesktopPermission()` üzerinden yapılmalı; constructor yalnızca mevcut izni okumalı (`Notification.permission === "granted"`).

### Y-5 — `ErrorBoundary` son kullanıcıya ham stack trace gösteriyor

**Dosya:** `src/components/common/ErrorBoundary.tsx:87`

```tsx
{[this.state.error?.message, this.state.error?.stack]}
```

Stack trace; dosya yolları, kullanıcı adı, iç modül yapısı ve olası token/URL parçaları içerebilir. Bu, hem bilgi sızıntısı hem de kötü kullanıcı deneyimidir.

```tsx
// ErrorBoundary.tsx
<pre className="error-boundary__details">
  {this.state.error?.message}
</pre>
{import.meta.env.DEV && (
  <details>
    <summary>Geliştirici ayrıntısı</summary>
    <pre>{this.state.error?.stack}</pre>
  </details>
)}
```

Üretimde stack'i bir log dosyasına/audit'e yazmak isteniyorsa Rust tarafında `log_frontend_error` komutu ile yapılmalı; UI'da gösterilmemeli.

### Y-6 — CLI her durumda `0` döndürüyor ve `--scope` yok sayılıyor

**Dosya:** `src-tauri/src/cli/mod.rs:38-71`, `:332-430`

`handle_cli()` tüm komutlarda `Some(0)` döndürüyor. Otomasyon/CI, tarama başarısız olsa bile başarılı sanır. Ayrıca `run_scan_cli` `--scope agents|caches|all` değerini parse ediyor fakat taramayı her zaman `ScanScope::Project` ile başlatıyor (`:422`).

```rust
// cli/mod.rs
pub fn handle_cli() -> Option<i32> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("scan") => Some(match run_scan_cli(&args[1..]) {
            Ok(()) => 0,
            Err(e) => { eprintln!("scan failed: {e:?}"); 1 }
        }),
        Some("clean") => Some(match run_clean_cli(&args[1..]) {
            Ok(()) => 0,
            Err(e) => { eprintln!("clean failed: {e:?}"); 2 }
        }),
        // ...
        _ => { print_help(); Some(64) }
    }
}
```

```rust
// run_scan_cli içinde
let scope = match scope.as_str() {
    "projects" => ScanScope::Project,
    "agents"   => ScanScope::Agents,
    "caches"   => ScanScope::Caches,
    "all"      => ScanScope::All,
    other => return Err(AppError::InvalidInput(format!("bilinmeyen scope: {other}"))),
};
```

### Y-7 — Aday limiti kontrolü off-by-one: limit aşıldıktan sonra bir öğe daha ekleniyor

**Dosya:** `src-tauri/src/scanner/discovery.rs:282-284`, `:373`

```rust
if self.budget.candidates() >= self.budget.limits().max_candidates {
    stop_reason = Some(StopReason::CandidateLimit);
    break;
}
// ...
self.budget.note_candidate();
```

Kontrol `note_candidate()` çağrısından önce yapıldığı için limit tam dolduğunda bir sonraki aday işlenmeden duruluyor gibi görünse de, `note_candidate` çağrısının yeri ve erken `break` akışı nedeniyle limit + 1 durumu oluşabilir; ayrıca `CandidateLimit` durumunda son eklenen öğenin ölçümü yarım kalabilir. Limitin kesin garanti olması için sayacı artırma ve kontrolü tek noktada yapın.

```rust
// ÖNERİLEN: tek kapı
fn try_add_candidate(&mut self) -> bool {
    if self.budget.candidates() >= self.budget.limits().max_candidates {
        return false;
    }
    self.budget.note_candidate();
    true
}

if !self.try_add_candidate() {
    stop_reason = Some(StopReason::CandidateLimit);
    break;
}
```

### Y-8 — `restoreScan` şema sürümünü doğrulamıyor; bekleyen persist timer reset sonrası çalışabiliyor

**Dosya:** `src/stores/scan-store.ts:107-135`, `:192-215`

- Frontend `LastScanSnapshot` içindeki `schemaVersion` alanını kontrol etmeden doğrudan store'a yazıyor. Backend şema migrasyonu yapsa bile eski/bozuk snapshot UI'da yanlış alanlarla görünebilir.
- `persistTimer` modül seviyesinde; `resetScan()` çağrıldığında temizlenmiyor. Kullanıcı taramayı sıfırladıktan 500 ms sonra eski snapshot diske yazılabiliyor.

```ts
restoreScan: (snapshot) => {
  if (snapshot.schemaVersion !== LAST_SCAN_SCHEMA_VERSION) {
    console.warn("Unsupported last-scan schema", snapshot.schemaVersion);
    void scannerApi.clearLastScan();
    return;
  }
  // ... mevcut restore
},

resetScan: () => {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  set({ /* ... */ });
},
```

### Y-9 — `validate_system_path` yalnızca kökün ikinci bileşenine bakıyor

**Dosya:** `src-tauri/src/safety/path_guard.rs:161-200`

`parts[1]` kontrolü `C:\Windows`, `D:\Program Files` gibi doğrudan kök altındaki sistem dizinlerini yakalar; ancak `C:\Users\X\AppData\Local\Windows` veya farklı sürücüdeki `...\Program Files` gibi iç içe geçmiş yollar yalnızca "hard-protected" isim listesiyle (SVI, `$Recycle.Bin`) korunur. Sistem dizini adı taşıyan herhangi bir derin klasör korunmuyor. Bu, kullanıcı tanımlı bir katalog kuralı yanlış eşleşirse gerçek silmeye yol açabilir.

```rust
// ÖNERİLEN: her bileşeni normalize edip kontrol et
let system_roots: HashSet<&str> = [
    "windows", "program files", "program files (x86)", "programdata",
    "system volume information", "$recycle.bin", "recovery", "msocache",
    "boot", "perflogs", "system32", "syswow64",
].into_iter().collect();

for (i, part) in parts.iter().enumerate() {
    if system_roots.contains(part.as_str()) {
        // Kök sürücüdeki gerçek sistem dizinleri her zaman yasak.
        // Derin yollar için yalnızca bilinen güvenli istisnalar (ör. node_modules) geçebilir.
        if i == 1 || !is_known_safe_nested(part, &parts) {
            return Err(AppError::UnsafeDeleteTarget(format!(
                "System directory is protected: {}", key
            )));
        }
    }
}
```

### Y-10 — `execute_plan` gerçek olmayan, asla iptal edilemeyen bir `CancellationToken` kullanıyor

**Dosya:** `src-tauri/src/cleanup/coordinator.rs:124-136`, `:150-165`

`execute_plan` ve `execute_plan_with_probe`, `&CancellationToken::new()` geçiyor. Bu token hiçbir yere bağlı olmadığı için temizlik sırasında "İptal" çağrısı etkisiz kalır (yalnızca hook'lu varyant gerçek token alıyor). Uzun süren temizliklerde kullanıcı iptal edemez.

```rust
pub fn execute_plan(
    plan: &CleanupPlan,
    session: &ScanSession,
    catalog: &CatalogIndex,
    policy: &CleanupPolicy,
    confirmation_token: &str,
    permanent_acknowledged: bool,
    cancel: &CancellationToken, // yeni parametre
) -> Result<CleanupReport, AppError> {
    execute_plan_with_hooks(
        plan, session, catalog, policy, confirmation_token,
        permanent_acknowledged, &active_use_for_provider,
        &|_| {}, cancel,
    )
}
```

Çağıran komut (`deletion_commands.rs`) elindeki `CleanupSlot` token'ını buraya geçirmeli; testlerde ise `CancellationToken::new()` kullanılabilir.

---

## 3. 🟡 ORTA ÖNCELİKLİ BULGULAR

### O-1 — Overview'da geçmiş yükleme hatası sessizce yutuluyor

**Dosya:** `src/features/overview/OverviewView.tsx:159-171`

```ts
scannerApi.getCleanupHistory(100)
  // ...
  .catch(() => {});
```

Geçmiş okunamazsa kullanıcı boş liste görür ve bunun bir hata mı yoksa gerçekten boş mu olduğunu anlayamaz. En azından `console.warn` + non-blocking toast veya "Geçmiş yüklenemedi" boş durumu gösterilmeli.

```tsx
.catch((err) => {
  console.warn("Cleanup history failed", err);
  setHistoryError(describeError(err));
});
```

### O-2 — `AgentsView` özel Dialog deseniyle tutarsız `window.confirm` kullanıyor

**Dosya:** `src/features/agents/AgentsView.tsx:292`

```ts
if (!window.confirm(ui.agents.removeToolConfirm)) return;
```

Uygulamanın geri kalanı erişilebilir, temalı `Dialog` bileşenini kullanıyor. `window.confirm` Tauri WebView'ında bloklar, tema dışıdır, klavye/ekran okuyucu davranışı platforma göre değişir ve test edilemez.

```tsx
const [pendingRemove, setPendingRemove] = useState<string | null>(null);

// ...
<Dialog
  open={pendingRemove !== null}
  onClose={() => setPendingRemove(null)}
  title={ui.agents.removeTool}
>
  <p>{ui.agents.removeToolConfirm}</p>
  <Button variant="danger" onClick={() => { void confirmRemove(pendingRemove!); }}>
    {ui.common.remove}
  </Button>
  <Button variant="ghost" onClick={() => setPendingRemove(null)}>
    {ui.common.cancel}
  </Button>
</Dialog>
```

### O-3 — `AboutView` sabit sürüm ve commit yedeği gösteriyor

**Dosya:** `src/features/settings/AboutView.tsx:167`, `:229`, `:234`

```tsx
v{buildInfo?.version ?? "2.2.0"}
{buildInfo ? buildInfo.commitShort : "release-v2"}
```

`buildInfo` alınamazsa kullanıcıya yanlış sürüm/commit gösterilir. Sürüm tek kaynaktan (`package.json` → build script → `buildInfo`) gelmeli; fallback "bilinmiyor" olmalı.

```tsx
v{buildInfo?.version ?? ui.about.unknownVersion}
{buildInfo?.commitShort ?? ui.about.unknownCommit}
```

### O-4 — Navigasyon haritası `as any` ile store'a yazılıyor

**Dosya:** `src/app/App.tsx:163-171`

```ts
const navMap: Record<string, string> = { /* ... */ };
appStore.setView(viewName as any);
```

`setView` muhtemelen bir union tipi bekliyor; `as any` bu güvenliği kaldırıyor. Harita `Record<string, ViewName>` olarak tiplenmeli ve `setView` parametresi union olmalı.

```ts
type ViewName = "overview" | "projects" | "agents" | "caches" | "docs" | "history" | "settings";

const navMap: Record<string, ViewName> = {
  navOverview: "overview",
  // ...
};
appStore.setView(viewName);
```

### O-5 — `HistoryView` effect'i `load` fonksiyonunu bağımlılık olarak içermiyor

**Dosya:** `src/features/history/HistoryView.tsx:61-63`

```ts
useEffect(() => { load(); }, []);
```

`load`, `tab` ve dil gibi değerleri closure'dan okuyorsa eski değerlerle çalışır. `load` `useCallback` ile sarılıp bağımlılıklara eklenmeli ya da effect içinde tanımlanmalı.

```tsx
const load = useCallback(async () => {
  // ...
}, [tab, ui]);

useEffect(() => { void load(); }, [load]);
```

### O-6 — `official_actions.rs` içinde `Mutex::lock().unwrap()` panic riski

**Dosya:** `src-tauri/src/cleanup/official_actions.rs:844`, `:859`

Bir iş parçacığı paniklerken mutex zehirlenirse (`poisoned`) sonraki tüm işlemler `unwrap()` ile panikler ve uygulama çökebilir. Üretimde zehirlenme durumu kontrollü ele alınmalı.

```rust
let mut pending = self.pending.lock().map_err(|_| {
    AppError::Internal("official action state poisoned".into())
})?;
```

### O-7 — `scan-history.ts` diğer kalıcı verilerden farklı olarak `localStorage` kullanıyor

**Dosya:** `src/features/history/scan-history.ts:17-48`

Temizlik geçmişi, ayarlar ve son tarama Tauri backend'inde tutulurken tarama geçmişi `localStorage`'da. Sonuçlar:

- Veri, uygulama veri dizini yedeğine/audit'e dahil olmaz.
- `JSON.parse` sonrası şema doğrulaması yok; bozuk kayıt tüm listeyi sessizce boşaltır (`catch { return []; }`).
- 50 kayıt sınırı ve süre aşımı (expiry) yok; zamanla şişer.
- `setItem` kotası dolduğunda hata yalnızca `console.warn`.

**Öneri:** Tarama geçmişini de Rust tarafına taşıyın (`save_scan_history`, `get_scan_history`, `clear_scan_history`) veya en azından:

```ts
function isScanHistoryRecord(value: unknown): value is ScanHistoryRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Partial<ScanHistoryRecord>;
  return typeof r.id === "string"
    && typeof r.timestamp === "string"
    && typeof r.itemCount === "number"
    && (r.status === "completed" || r.status === "cancelled");
}

const parsed: unknown = JSON.parse(raw);
return Array.isArray(parsed) ? parsed.filter(isScanHistoryRecord).slice(0, 50) : [];
```

### O-8 — Üretim paketine demo/fallback veri seti dahil ediliyor

**Dosya:** `src/lib/tauri/scanner-api.ts:84-140` ve devamı (`memorySettings`, `fallbackRules`, `plan-mock-1`, `scan-mock-1` vb.)

Fallback'ler yalnızca `isTauriEnvironment() === false` olduğunda kullanılıyor; yani normal üretimde çalışmıyor. Ancak:

- Yüzlerce satır sahte tarama/temizlik/geçmiş verisi üretim bundle'ına giriyor (boyut + saldırı yüzeyi),
- `isTauriEnvironment` yanlışlıkla `false` dönerse (ör. enjeksiyon sırası değişirse) kullanıcıya **gerçekmiş gibi sahte veri** gösterilir,
- Bakım sırasında `CleanupItem` tipi değişince mock'lar sessizce eskir.

**Öneri:** Demo katmanını `src/lib/tauri/scanner-api.mock.ts` dosyasına ayırın ve yalnızca geliştirme/test derlemesinde dinamik import edin:

```ts
async function loadMockApi(): Promise<ScannerApi | null> {
  if (!import.meta.env.DEV) return null;
  const mod = await import("./scanner-api.mock");
  return mod.createMockScannerApi();
}

export const scannerApi: ScannerApi = isTauriEnvironment()
  ? realApi
  : (await loadMockApi()) ?? throwNoBackend();
```

Üretimde `isTauriEnvironment()` false ise sahte veri yerine açık bir "Backend bağlantısı kurulamadı" hatası gösterilmelidir.

### O-9 — i18n dışında kalan sabit İngilizce ve pazarlama metinleri

**Dosyalar:** `src/features/docs/*` (DocsContent), `src/features/settings/AboutView.tsx`, `src/features/concept/ConceptAView.tsx`, `ConceptBView.tsx`

73 dil desteği varken doküman içerikleri, "scope" etiketleri, konsept ekranlarındaki tanıtım metinleri sabit İngilizce. Kullanıcı arayüzü tamamen çevrilmiş görünürken doküman/About ekranında İngilizce görmek üretim kalitesini düşürür.

**Öneri:** Docs içeriklerini de `ui-text` kataloğuna taşıyın; en azından `docs.*` anahtarları için EN fallback'i açıkça belirtin. Konsept ekranları üretim navigasyonundan çıkarılmalı (bkz. D-6).

### O-10 — `CleanupPlanDialog` effect'inde exhaustive-deps kuralı devre dışı

**Dosya:** `src/features/cleanup/CleanupPlanDialog.tsx:77`

```ts
// eslint-disable-next-line react-hooks/exhaustive-deps
```

Plan yükleme effect'i eksik bağımlılıklarla çalışıyor; plan/target değişiminde eski plan gösterilebilir veya gereksiz yeniden yükleme olabilir.

**Öneri:** Effect'i `planId`/`targetIds` gibi ilkel değerlere bağlayın, `loadPlan`'ı `useCallback` ile sabitleyin ve kuralı kapatmayın.

### O-11 — Windows dışı süreç sonlandırma `kill -TERM -pid` ile şüpheli

**Dosya:** `src-tauri/src/cleanup/coordinator.rs` (`terminate_process_tree`)

Negatif PID ile `kill` süreç grubunu hedefliyor; ancak PID'in grup lideri olduğu garanti değilse yanlış süreç grubu etkilenebilir. Uygulama Windows hedefli olsa da çapraz platform derlemelerde bu kod çalışabilir.

**Öneri:** Windows'ta `taskkill /PID <pid> /T /F`, Unix'te `nix` crate ile `killpg` kullanın; grup lideri doğrulaması yapın.

### O-12 — `cache-store` `finished`/`cancelled` olaylarında ölçüm durumunu sıfırlamıyor

**Dosya:** `src/stores/cache-store.ts:57-89`

```ts
case "finished":
case "cancelled":
  break;
```

`measuring` bayrağı `startMeasure`/`cancelMeasure` içinde yönetiliyor gibi görünse de, backend'den gelen `finished` olayı UI'da ilerleme çubuğunu kapatmak için kullanılmıyor. Olay kaçarsa ekran "ölçülüyor" durumunda kalabilir.

```ts
case "finished":
  set({ measuring: false, measureError: null });
  break;
case "cancelled":
  set({ measuring: false });
  break;
```

---

## 4. 🔵 DÜŞÜK ÖNCELİKLİ BULGULAR

### D-1 — Yardımcı fonksiyon tekrarları

- `formatSavedAt`: `src/features/shell/StaleScanBanner.tsx` ve `src/features/items/SelectionActionBar.tsx`
- `describeError`: `AgentsView`, `CachesView`, `HistoryView`, `cache-store`
- `maskPath`: `src/features/items/ItemTable.tsx:49` içinde tanımlı, 6+ modül tarafından import ediliyor

**Öneri:** `src/lib/format/` ve `src/lib/errors/` altında tek kaynak; `maskPath` `src/lib/format/path.ts`'e taşınmalı.

### D-2 — Biçimlendirme tutarsızlıkları

- `src/features/agents/AgentsView.tsx` genelinde aşırı çift boş satır.
- `src/features/overview/OverviewView.tsx:74-89` girinti tutarsızlığı.
- `src-tauri/src/lib.rs:162` iki ifade tek satırda:

```rust
if let Ok(menu) = Menu::with_items(app, &[&show_item, &quit_item]) {
    let _ = tray.set_menu(Some(menu));
}
```

**Öneri:** `cargo fmt` + `prettier` CI'da zorunlu hale getirilmeli.

### D-3 — Doküman/bilgi eskimesi

**Dosya:** `src-tauri/src/audit/repository.rs:149`

`clear_cleanups` doc yorumu "every" ve "only" ifadeleriyle çelişiyor. Davranış doğru olsa da yorum yanıltıcı.

### D-4 — Üretimde `console.error` / `console.warn`

`preferences-store.ts:191`, `scan-store`, `scan-history.ts`, `scanner-api` fallback'leri. Tauri üretim derlemesinde bunlar log dosyasına yönlendirilmeli; aksi halde WebView konsolunda kalır ve saha teşhisi zorlaşır. `src/lib/logging.ts` altında seviyeli bir logger kullanın.

### D-5 — `truncatePath` her zaman ters bölü ile birleştiriyor

**Dosya:** `src/lib/formatters.ts:148-...`

Windows hedefli üründe kabul edilebilir; ancak çapraz platform testlerinde/önizlemede yol bozulur. `path.sep` yerine gelen ayırıcıyı koruyan bir implementasyon tercih edilmeli.

### D-6 — Konsept önizleme ekranları üretim bundle'ında

`ConceptContainer`, `ConceptAView`, `ConceptBView` ve yüzen tema değiştirici, `?concept` sorgu parametresiyle erişilebilir. Üretimde kullanıcıya görünmese de bundle'a giriyor ve navigasyon dışı bir yüzey oluşturuyor.

**Öneri:** `if (!import.meta.env.DEV) return null;` ile koşullayın veya dosyaları dev-only entry'ye taşıyın.

### D-7 — Tarama geçmişinde süre/sayı sınırı yok

`scan-history.ts:38` yalnızca 50 kayıtla sınırlı; zaman bazlı temizlik yok. Uzun kullanımda 50 kayıt yeterli olsa da eski kayıtların "ne zaman" silineceği belirsiz. `timestamp` bazlı 90 günlük saklama politikası eklenebilir.

### D-8 — `clear_cleanup_history` adı davranışını yansıtmıyor

**Dosya:** `src-tauri/src/commands/history_commands.rs:43-44`

`clear_cleanup_history` aslında `audit.clear_all()` çağırıyor, yani **hem temizlik hem resmi işlem geçmişini** siliyor. Frontend'de "Tümünü temizle" bunu kullanıyor (doğru), ancak komut adı `clear_all_history` olmalı. Gelecekte yanlış çağrı riski var.

---

## 5. ⚡ PERFORMANS BULGULARI

### P-1 — Arama için her render'da string birleştirme ve mutasyon

**Dosya:** `src/features/items/ItemTable.tsx:221`

K-2'deki mutasyon aynı zamanda performans sorunudur: ilk aramada her öğe için string üretilir, sonrasında store nesnesinde tutulur. Binlerce öğede ilk arama gecikmesi ve bellek büyümesi yaratır. Haystack'i ingest sırasında bir kez üretin; `useMemo` yalnızca filtreleme yapsın.

### P-2 — Ayar değişikliklerinde IPC yazma fırtınası

**Dosya:** `src/stores/preferences-store.ts:188-198`

Y-3'teki debounce, disk I/O ve IPC çağrılarını önemli ölçüde azaltır. Ayrıca `saveAppSettings` çağrısı her seferinde tüm ayar nesnesini serialize ediyor; yalnızca değişen alanları göndermek (patch) daha hafif olur.

### P-3 — Bildirim sesi için `AudioContext` sızıntısı

**Dosya:** `src/lib/notifications/notification-service.ts:141-160`

Y-4'teki tek context + `disconnect()` çözümü, uzun oturumlarda ses alt sisteminin tükenmesini engeller.

### P-4 — Demo verisinin üretim bundle'ına girmesi

**Dosya:** `src/lib/tauri/scanner-api.ts`

O-8'deki dev-only ayrım, bundle boyutunu ve parse süresini düşürür. Mock veri yüzlerce satırlık sabit nesne içeriyor; tree-shaking bunu kaldıramaz çünkü aynı modülde koşullu olarak referans ediliyor.

### P-5 — Geçmiş ekranında gereksiz tam liste yüklemesi

**Dosya:** `src/features/history/HistoryView.tsx`

Sekme değişiminde ilgili geçmiş yeniden yükleniyor; `load` bağımlılığı düzeltilirken her sekme için ayrı ve limitli sorgu yapılmalı. Tüm listeleri aynı anda çekmek yerine aktif sekmeye göre `getCleanupHistory(limit)` / `getOfficialActionHistory(limit)` çağrın.

---

## 6. 🗄️ VERİ BÜTÜNLÜĞÜ VE HATA YÖNETİMİ

| Bulgu | Etki | Öneri |
|---|---|---|
| Webhook testi sahte başarı (K-3) | Kullanıcı isteğin ulaştığını sanır | Rust tarafında gerçek HTTP durum kodu |
| `scan-history` şema doğrulaması yok (O-7) | Bozuk tek kayıt tüm geçmişi sıfırlar | `isScanHistoryRecord` + migrasyon |
| `restoreScan` şema kontrolü yok (Y-8) | Eski snapshot yanlış yorumlanır | `schemaVersion` kontrolü + `clearLastScan` |
| Sessiz `.catch(() => {})` (O-1, Y-2) | Hata görünmez, teşhis edilemez | Logger + kullanıcıya non-blocking bildirim |
| `persistTimer` reset sonrası (Y-8) | Silinmiş tarama geri yazılır | `resetScan` içinde timer iptali |
| `clear_cleanup_history` adı (D-8) | Yanlış kullanımda fazla veri silinir | `clear_all_history` olarak yeniden adlandır |
| MCP onaysız silme (K-1) | Geri dönüşü zor veri kaybı | Önizleme + onay + korumalı yol uygulaması |
| Aday limiti off-by-one (Y-7) | Limit garantisi tutmaz, yarım ölçüm | Tek noktadan sayaç kontrolü |

**Olumlu not:** Rust tarafındaki plan tüketimi (`session.rs`), onay token'ının tek kullanımlık olması, audit kaydının başarısız silmede bile yazılması ve `path_guard`'ın symlink/reparse/UNC reddi üretim seviyesinde doğru tasarlanmış. Bu rapordaki veri bütünlüğü bulguları ağırlıklı olarak **frontend kolaylık katmanı** ve **otomasyon yüzeyleri** ile ilgilidir.

---

## 7. 🧹 KOD TEMİZLİĞİ / TEKNİK BORÇ

1. **`as any` kullanımı:** `App.tsx:171`. Navigasyon union tipi tanımlanmalı.
2. **Dev-only kodun üretimde olması:** `scanner-api.ts` mock katmanı, `Concept*` ekranları.
3. **Yardımcı fonksiyon tekrarı:** `formatSavedAt`, `describeError`, `maskPath` (D-1).
4. **Sihirli sayılar/sabitler:** `"2.2.0"` (CLI, MCP, AboutView fallback), `"release-v2"`, `"Checked 21 tools"`, 50 kayıt limiti, 250 ms debounce. Tek bir `constants`/`build_info` kaynağına taşınmalı.
5. **ESLint bastırma:** `CleanupPlanDialog.tsx:77`.
6. **Biçimlendirme:** `AgentsView` çift boş satırlar, `lib.rs:162`, `OverviewView` girintileri.
7. **Doc rot:** `audit/repository.rs:149`.
8. **Kullanılmayan/ölü kod:** `execute_plan_with_probe` üretimde `#[allow(dead_code)]`; test-only yardımcılar `#[cfg(test)]` altına alınmalı.
9. **Tip güvenliği:** `CleanupItem` içine `_searchHaystack` gibi gizli alanlar eklenmemeli (K-2).
10. **i18n:** 73 dil desteğine rağmen Docs/About/Concept metinleri sabit İngilizce (O-9).

---

## 8. 🚀 İYİLEŞTİRME ÖNERİLERİ

### Kısa vade (üretim engelleyiciler)
1. MCP `clean_safe` aracını önizleme + onay akışına bölün; korumalı yolları ve dışlamaları uygulayın (K-1).
2. `ItemTable` mutasyonunu kaldırın (K-2).
3. Webhook testini Rust tarafına taşıyın (K-3).
4. Kısayol stale closure, restore effect, ayar debounce, `AudioContext` ve stack sızıntısını düzeltin (Y-1…Y-5).
5. CLI çıkış kodlarını ve `--scope` davranışını düzeltin (Y-6).

### Orta vade
6. `scan-history`'yi backend'e taşıyın veya şema doğrulaması ekleyin (O-7).
7. Demo/mock katmanını dev-only yapın (O-8).
8. Tüm sabit sürüm metinlerini `build_info` üzerinden tek kaynağa indirin (O-3, D-4).
9. `window.confirm` kullanımını kaldırın (O-2).
10. `mutex` zehirlenmesi ve iptal token'ı gibi hata yollarını sertleştirin (O-6, Y-10).

### Uzun vade (kalite)
11. **CI kapıları:** `tsc --noEmit`, `eslint --max-warnings=0`, `cargo clippy -D warnings`, `cargo fmt --check`, i18n anahtar kapsama testi.
12. **Sözleşme testleri:** Tauri IPC komutları için TypeScript tarafında tek bir tipli istemci; Rust DTO'ları ile `specta`/`ts-rs` üzerinden otomatik tip üretimi.
13. **Performans bütçesi:** `vite build --report`; mock katmanı çıkarıldıktan sonra bundle boyutu ve ilk yükleme süresi ölçülmeli.
14. **Hata gözlemlenebilirliği:** Frontend hatalarını yerel log dosyasına yazan, kullanıcı onaylı (opt-in) tanılama paketi.
15. **Erişilebilirlik:** Dialog focus trap zaten iyi; `window.confirm` kaldırıldıktan sonra tüm yıkıcı işlemler aynı Dialog bileşenini kullanmalı.
16. **Sürüm tekilliği:** `package.json`, `Cargo.toml`, `tauri.conf.json` ve CLI/MCP sabitleri tek script ile senkronize edilmeli (`check-version` genişletilmeli).

---

## 9. ✅ OLUMLU BULGULAR

- `src/components/primitives/Dialog.tsx`: focus trap, `onCloseRef` ve klavye yönetimi doğru.
- `dangerouslySetInnerHTML` / `eval` / `new Function` kullanımı **yok**; XSS yüzeyi düşük.
- `open_url` yalnızca `http/https/mailto` kabul ediyor, tırnak/satır sonu reddediliyor; `open_path_in_explorer` kanonikleştirme + mutlak yol kontrolü yapıyor.
- `path_guard.rs`: bileşen bazlı `is_within`, symlink/reparse/UNC reddi ve derinlik kontrolü güçlü.
- `session.rs`: plan tüketimi kilit altında, oturum 30 dk / plan 15 dk TTL — doğru.
- `deletion_commands.rs`: onay token'ı tek kullanımlık, audit hatası yutulmuyor, slot serbest bırakma doğru.
- Rust tarafında kapsamlı testler (`*_tests.rs` ve inline `#[cfg(test)]`) mevcut.
- Zustand store'ları modüler; UI bileşenleri çoğunlukla seçici abonelik kullanıyor.

---

## 10. SONUÇ

Node Cleaner, güvenlik bilinci yüksek bir Rust çekirdeği ve olgun bir React arayüzüne sahip. Ancak üretim dağıtımı için **K-1, K-2, K-3** mutlaka kapatılmalı; **Y-1…Y-10** ise aynı sürümde düzeltilmelidir. Özellikle MCP otomasyon yüzeyi, ürünün geri kalanındaki "önce önizle, sonra onayla" ilkesiyle hizalanmadığı için en yüksek riski taşıyor.

Kritik ve yüksek maddeler kapandıktan sonra, orta öncelikli bulguların çoğu tek bir sürümde toparlanabilir. Önerilen sıra:

1. K-1 → K-2 → K-3
2. Y-1 → Y-2 → Y-3 → Y-4 → Y-5
3. Y-6 → Y-7 → Y-8 → Y-9 → Y-10
4. O-1 → O-10, ardından D serisi ve performans iyileştirmeleri

Bu sıra, hem veri kaybı riskini hem de kullanıcıya yansıyan hataları en hızlı şekilde azaltır.
