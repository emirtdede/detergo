# Node Cleaner 2.2.1 — Üretim Öncesi Denetim Düzeltme ve Uygulama Planı

**Girdi:** `docs/audit/PRE_DEPLOYMENT_QA_AUDIT_TR.md` (K-1…K-3, Y-1…Y-10, O-1…O-12, D-1…D-8, P-1…P-5)
**Sürüm hedefi:** 2.2.1 (yalnızca düzeltme; yeni özellik yok)
**Platform:** Windows 10/11 x64, WebView2, Tauri 2
**Plan tarihi:** 9 Kasım 2026
**Durum:** Uygulanabilir — tüm kararlar aşağıdaki doğrulanmış teknik temele dayanır.

---

## 1. Planın kesin kuralları

| Kural | Karar |
|---|---|
| Kapsam | Rapordaki 42 bulgunun tamamı; hiçbiri "sonra bakılır" olarak bırakılmaz. |
| Sürümleme | `2.2.0 → 2.2.1`; `package.json`, `Cargo.toml`, `tauri.conf.json` aynı anda güncellenir, `npm run check-version` geçer. |
| Dallanma | `fix/audit-2.2.1` ana dalı; altında 6 bağımsız PR. Her PR kendi başına geri alınabilir. |
| Yeni bağımlılık | Yalnızca `reqwest 0.12` (webhook) ve test için `httpmock` (dev-dependency). Başka yeni crate/npm paketi yok. |
| Veri migrasyonu | `AppSettings.schemaVersion` 3 → 4; geriye dönük uyumlu `#[serde(default)]`. Kullanıcı ayarı silinmez. |
| Test eşiği | Mevcut 97 Rust + 32 Vitest testinin tamamı korunur; her WP için aşağıdaki yeni testler eklenir. |
| Üretim kapısı | Bölüm 9'daki 18 maddelik kapı geçmeden paket üretilmez. |
| Geri alma | Her PR `git revert` ile tek başına geri alınabilir; MCP ve webhook için ayrıca çalışma zamanı kill-switch vardır. |

---

## 2. Doğrulanmış teknik temel

Bu plandaki kararlar aşağıdaki birincil kaynaklara ve kod incelemesine dayanır. Varsayım kullanılmamıştır.

| # | Doğrulanan gerçek | Kaynak | Planda etkisi |
|---|---|---|---|
| D-1 | `AudioContext` yeniden kullanılmalıdır; her ses için yeni context oluşturmak önerilmez. | MDN, `AudioContext` ("recommended to create one AudioContext and reuse it") | B6-02: tek singleton context. |
| D-2 | Tarayıcı otomatik oynatma politikası: context kullanıcı hareketi içinde oluşturulmalı veya `resume()` ile sürdürülmelidir. | MDN, Web Audio API Best Practices → Autoplay policy | B6-02: ilk kullanıcı etkileşiminde `resume()`. |
| D-3 | `Notification.requestPermission()` kullanıcı etkileşimine yanıt olarak çağrılmalıdır. | MDN, `Notification.requestPermission()` | B6-01: constructor'da izin istenmez. |
| D-4 | MCP, 2025-06-18 sürümünde `elicitation/create` ile kullanıcıdan onay istemeyi standartlaştırır; sunucular hassas bilgi isteyemez, istemciler kullanıcı onayı göstermelidir. | modelcontextprotocol.io, Elicitation | B1-04/B1-05: iki aşamalı önizleme + onay; elicitation opsiyonel ama önerilen. |
| D-5 | Tauri HTTP eklentisi `reqwest`'i Rust tarafında yeniden dışa aktarır; JS `fetch` kullanımı statik URL kapsamı (`allow`) gerektirir. | v2.tauri.app/plugin/http-client | B3-02: kullanıcı tanımlı URL için statik kapsam uygun değil → Rust komutu. |
| D-6 | Üretim CSP'si `connect-src 'self' ipc: http://ipc.localhost` ile sınırlıdır. | `src-tauri/tauri.conf.json` | B3: webhook `fetch`'i üretimde güvenilir çalışamaz; K-3 bulgusu doğrulandı. |
| D-7 | React StrictMode geliştirmede render'ı iki kez çalıştırır; render sırasında yan etki yasaktır. | React dokümantasyonu (StrictMode) | B2: mutasyon kaldırılır; testte StrictMode ile doğrulanır. |
| D-8 | `walkdir` `skip_current_dir` yalnızca geçerli dizini atlar; aday sayacı tek kapıdan yönetilmelidir. | `walkdir` dokümantasyonu + `discovery.rs` incelemesi | B8: `try_add_candidate()` tek kapı. |
| D-9 | MCP stdio taşıması satır sonu ayrımlı JSON-RPC kullanır; mevcut sunucu bu biçimi doğru uygular. | MCP spec, stdio transport + `mcp/mod.rs:14-46` | B1-03: mevcut döngü korunur, yalnızca test edilebilir hale getirilir. |
| D-10 | Windows'ta süreç ağacı `taskkill /PID <pid> /T /F` ile sonlandırılır; kod bunu zaten yapıyor. | `official_actions.rs:505-530` | O-11 yalnızca Windows dışı dal için geçerli; ürün Windows-only olduğu için dal kaldırılır. |

### 2.1 Planlama sırasında tespit edilen rapor düzeltmeleri

Aşağıdaki üç nokta raporda farklı konumlandırılmıştı; uygulama planı kesin dosya/satır ile düzeltir:

1. **Y-10:** GUI temizlik akışı (`deletion_commands.rs:46-80`) zaten gerçek `CancellationToken` kullanıyor ve iptal çalışıyor. Sorun yalnızca `execute_plan` sarmalayıcısını kullanan **CLI ve MCP** yollarında. Bu nedenle Y-10, "GUI iptali bozuk" değil, "API tutarlılığı ve CLI/MCP iptali eksik" olarak ele alınır.
2. **O-11:** Windows dalı doğru (`taskkill /T /F`). Sorunlu olan yalnızca `#[cfg(not(windows))]` dalındaki `kill -TERM -<pid>` çağrısıdır.
3. **D-1:** `SelectionActionBar` dosyası `src/features/items/` değil `src/features/results/` altındadır. `formatSavedAt` tekrarı bu dosya ile `StaleScanBanner.tsx` arasındadır.
4. **D-8:** `clear_cleanup_history` → `audit.clear_all()` eşleşmesi doğrulandı; komut hem temizlik hem eylem geçmişini siliyor. Yeniden adlandırma zorunlu.

---

## 3. Risk ölçeği

| Puan | Etki (I) | Olasılık (P) |
|---|---|---|
| 5 | Veri kaybı, güvenlik ihlali, üretimde çökme | Neredeyse kesin |
| 4 | Kullanıcıya yanlış sonuç, geri alınamaz davranış | Yüksek |
| 3 | Özellik çalışmıyor, manuel müdahale gerekiyor | Orta |
| 2 | Kozmetik/performans, kolay telafi | Düşük |
| 1 | İç kod kalitesi, kullanıcıya yansımıyor | Çok düşük |

**Risk düzeyi = I × P.** 15+ Kritik, 8–14 Yüksek, 3–7 Orta, 1–2 Düşük. Her iş paketinde ayrı risk tablosu vardır.

---

## 4. Kapsam eşlemesi (bulgu → iş paketi)

| Bulgu | İş paketi | Bulgu | İş paketi |
|---|---|---|---|
| K-1 | B1 | O-1 | C1 |
| K-2 | B2 | O-2 | C2 |
| K-3 | B3 | O-3 | C3 |
| Y-1 | B4 | O-4 | B4 |
| Y-2 | B4 | O-5 | C1 |
| Y-3 | B5 | O-6 | C4 |
| Y-4 | B6 | O-7 / D-7 | C5 |
| Y-5 | B6 | O-8 / D-6 | C6 |
| Y-6 | B7 | O-9 | C7 |
| Y-7 | B8 | O-10 | C2 |
| Y-8 | B9 | O-11 | B11 |
| Y-9 | B10 | O-12 | C8 |
| Y-10 | B11 | D-1…D-8 | D1–D4 |
| P-1 | B2 | P-2 | B5 |
| P-3 | B6 | P-4 | C6 |
| P-5 | D4 | — | — |

---

## 5. Yürütme stratejisi

### 5.1 Bağımlılık grafiği

```text
P0 (baseline + CI)
 ├─ B1 (MCP) ──────────────┐
 ├─ B3 (webhook) ──────────┤
 ├─ B2 (ItemTable) ────────┤
 ├─ B4 (App effects) ──────┤
 ├─ B5 (prefs) ────────────┤
 ├─ B6 (notify/error) ─────┤
 ├─ B7 (CLI) ──────────────┼─ C1…C8 ─ D1…D4 ─ E1 (release)
 ├─ B8 (scanner) ──────────┤
 ├─ B9 (scan store) ───────┤
 ├─ B10 (path guard) ──────┤
 └─ B11 (cancellation) ────┘
```

B1, B7 ve B11 aynı Rust derleme birimlerine dokunur; **sıra: B1 → B11 → B7**. Diğer B paketleri paralel yürütülebilir.

### 5.2 PR planı

| PR | İçerik | Bağımlılık | Geri alma |
|---|---|---|---|
| PR-1 | P0: CI kapıları, baseline, invariant script | — | Bağımsız |
| PR-2 | B1, B10, B11, B8: Rust güvenlik ve sınırlar | PR-1 | Bağımsız |
| PR-3 | B2, B4, B5, B9: Frontend durum ve render | PR-1 | Bağımsız |
| PR-4 | B3, B6, B7: Entegrasyon (webhook, bildirim, CLI) | PR-1, PR-2 | Bağımsız |
| PR-5 | C1…C8: Veri bütünlüğü ve UX | PR-2…PR-4 | Bağımsız |
| PR-6 | D1…D4: Borç, performans, i18n | PR-5 | Bağımsız |

### 5.3 Karar kayıtları (ADR)

| ADR | Karar | Gerekçe |
|---|---|---|
| ADR-1 | Webhook isteği Rust `reqwest` ile yapılır; JS `fetch` ve `tauri-plugin-http` JS API'si kullanılmaz. | Kullanıcı tanımlı URL statik Tauri kapsamına sığmaz; üretim CSP'si dış alan adlarını engeller. |
| ADR-2 | MCP'de yıkıcı işlem üç koşula bağlıdır: `--allow-destructive` başlatma bayrağı + `mcpAllowDestructive` ayarı + tek kullanımlık önizleme token'ı. | Tek başına token, ajanın kendi kendine onay vermesini engellemez; üç bağımsız kapı gerekir. |
| ADR-3 | Tarama geçmişi 2.2.1'de `localStorage`'da kalır; şema doğrulama + 90 gün saklama eklenir. Backend'e taşıma 2.3'e bırakılır. | Backend migrasyonu yeni komut, migrasyon ve test yüzeyi gerektirir; 2.2.1 kapsamı düzeltme sürümüdür. |
| ADR-4 | Doküman içerikleri 2.2.1'de İngilizce kalır; yalnızca gezinme/başlık metinleri yerelleştirilir ve "Docs are in English" bildirimi gösterilir. | 73 dilde doküman çevirisi tek sürümde doğrulanamaz; yanlış/eksik çeviri daha kötüdür. |
| ADR-5 | Durum yönetimi Zustand'da kalır; `persist` middleware'e geçilmez. | Mevcut Tauri IPC kalıcılığı test edilmiş; middleware değişikliği veri migrasyonu riski yaratır. |
| ADR-6 | Ürün Windows-only kabul edilir; Windows dışı süreç sonlandırma dalı kaldırılır. | Desteklenen tek platform Windows; yanlış `kill -TERM -pid` çağrısı derleme dışı bırakılır. |

---

## 6. İş Kırılım Yapısı (WBS)

### Faz P0 — Baseline ve güvenlik ağı

| ID | Atomik iş | Dosya/alan | Bağımlılık | Çıktı |
|---|---|---|---|---|
| P0-01 | Mevcut durumu etiketle ve ölç: `git tag audit-baseline-2.2.0`; test/build çıktılarını kaydet | repo kökü, `docs/audit/baseline/` | — | Baseline raporu: test sayıları, dist boyutu, süreler |
| P0-02 | CI'ya zorunlu kapılar ekle: `typecheck`, `vitest`, `cargo test`, `cargo clippy -D warnings`, `cargo fmt --check` | `.github/workflows/` | P0-01 | Kırmızı/yeşil kapı |
| P0-03 | `scripts/check-audit-invariants.mjs` yaz: yasak desenler (`_searchHaystack`, `mode: "no-cors"`, `window.confirm`, sabit `"2.2.0"`, `as any` navigasyon) | `scripts/` | P0-01 | CI'da çalışan grep kapısı |
| P0-04 | Frontend test harness: `invoke` mock'u ve `scannerApi` fake'i; Rust MCP test harness iskeleti | `src/test/`, `src-tauri/tests/` | P0-02 | Tekrar kullanılabilir test yardımcıları |
| P0-05 | Sürümü 2.2.1'e yükselt ve CHANGELOG aç | `package.json`, `src-tauri/Cargo.toml`, `tauri.conf.json`, `CHANGELOG.md` | P0-01 | `npm run check-version` yeşil |

**P0 riskleri**

| Risk | I | P | Skor | Önlem | Fallback |
|---|---|---|---|---|---|
| Baseline testleri ortam farkı nedeniyle kırmızı | 3 | 3 | 9 | Aynı Node/Rust sürümlerini CI'da sabitle; `rust-toolchain.toml` ekle | Baseline'ı yalnızca değişen testler için kabul et, farkı rapora yaz |
| Invariant script yanlış pozitif üretir | 2 | 3 | 6 | Desenleri dosya kapsamıyla sınırla; `--fix` yok, yalnızca rapor | Script'i uyarı moduna al, kapıyı PR-2'de zorunlu yap |

**P0 testleri**

| ID | Senaryo | Adımlar | Beklenen (kabul) |
|---|---|---|---|
| P0-T1 | Baseline tekrar üretilebilir | Temiz klonda `npm ci && npm test && cargo test` | Sayılar baseline raporuyla birebir aynı |
| P0-T2 | Invariant script yakalar | Bilerek `mode: "no-cors"` ekle | Script exit 1 ve dosya/satır raporlar |
| P0-T3 | Sürüm senkronu | `npm run check-version` | 2.2.1 üç dosyada eşit, exit 0 |

---

### Faz B — Yayın engelleyicileri

#### B1 — MCP yıkıcı işlem güvenliği (K-1)

| ID | Atomik iş | Dosya | Bağımlılık | Çıktı |
|---|---|---|---|---|
| B1-01 | `AppSettings`'e `mcp_allow_destructive: bool` (`default false`) ekle; şema 3→4 migrasyonu; frontend tipi ve Ayarlar > Gelişmiş anahtarı | `settings/model.rs`, `src/types/index.ts`, `SettingsView.tsx` | P0 | Varsayılan kapalı ayar |
| B1-02 | CLI'ya `mcp --allow-destructive` bayrağı ekle; bayrak yoksa execute aracı listede görünmez | `cli/mod.rs` | B1-01 | Başlatma kapısı |
| B1-03 | `run_mcp_server_with(reader, writer, options)` refaktörü; mevcut `run_mcp_server()` ince sarmalayıcı olur | `mcp/mod.rs` | P0-04 | Test edilebilir MCP döngüsü |
| B1-04 | `devcleaner_preview_cleanup` aracı: ayarlardan `excluded_names` + `protected_paths` + policy uygula; plan üret; grant kaydet | `mcp/mod.rs` | B1-03 | Önizleme + token |
| B1-05 | `devcleaner_execute_cleanup` aracı: token + `confirm:true` + üç kapı doğrulaması; tek kullanımlık tüketim | `mcp/mod.rs` | B1-04 | Onaylı yürütme |
| B1-06 | `devcleaner_clean_safe` adını koru ama yalnızca önizleme döndür; açıklamada `deprecated` işaretle | `mcp/mod.rs` | B1-04 | Geriye dönük uyumlu alias |
| B1-07 | Önizleme/ret/yürütme için audit kaydı yaz | `mcp/mod.rs`, `audit/repository.rs` | B1-05 | İzlenebilirlik |
| B1-08 | Araç açıklamaları + `docs/architecture/MCP.md` güncelle | `docs/` | B1-06 | Kullanıcı/ajan sözleşmesi |
| B1-09 | MCP entegrasyon testleri: preview → execute, süresi geçmiş token, replay, kapalı ayar | `src-tauri/tests/mcp_flow.rs` | B1-05 | 12+ test |

**B1 tasarım sözleşmesi**

```json
// tools/list — yeni yüzey
{
  "name": "devcleaner_preview_cleanup",
  "description": "Builds a cleanup plan. Never deletes anything. Returns a single-use confirmation_token valid for 5 minutes.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": { "type": "string" },
      "target_ids": { "type": "array", "items": { "type": "string" } }
    },
    "required": ["target_ids"]
  }
}
```

```json
// preview yanıtı
{
  "plan_id": "p-...",
  "confirmation_token": "uuid",
  "expires_at": "2026-11-09T12:05:00Z",
  "target_count": 12,
  "total_bytes": 483920128,
  "blocked": [{ "target_id": "t...", "reason": "USER_PROTECTED" }],
  "requires_user_confirmation": true
}
```

```json
// execute isteği
{
  "name": "devcleaner_execute_cleanup",
  "arguments": {
    "plan_id": "p-...",
    "confirmation_token": "uuid",
    "confirm": true
  }
}
```

```rust
// mcp/mod.rs — grant kaydı
struct McpGrant {
    plan_id: String,
    token: String,
    target_hash: String, // plan hedeflerinin sıralı SHA-256'sı
    expires: Instant,
    used: bool,
}

struct McpServerOptions {
    allow_destructive: bool, // CLI bayrağı
}

fn execute_gate(
    grants: &Mutex<HashMap<String, McpGrant>>,
    settings: &AppSettings,
    plan: &CleanupPlan,
    plan_id: &str,
    token: &str,
) -> Result<(), AppError> {
    if !settings.mcp_allow_destructive {
        return Err(AppError::Blocked("MCP destructive mode is disabled in Settings.".into()));
    }
    let mut map = grants.lock().map_err(|_| AppError::Blocked("MCP grant state poisoned".into()))?;
    let grant = map.get_mut(plan_id).ok_or_else(|| AppError::PlanInvalid("Unknown plan.".into()))?;
    if grant.used || grant.expires <= Instant::now() || grant.token != token {
        return Err(AppError::PlanInvalid("Token expired or already used.".into()));
    }
    if grant.target_hash != hash_targets(plan) {
        return Err(AppError::PlanChanged("Plan targets changed after preview.".into()));
    }
    grant.used = true;
    Ok(())
}
```

**B1 riskleri**

| Risk | I | P | Skor | Önlem | Fallback |
|---|---|---|---|---|---|
| Mevcut MCP istemcileri `clean_safe`'in artık silmediğini fark etmez | 3 | 4 | 12 | Alias yanıtına `deprecated: true` + `next_tool` alanı ekle; sürüm notunda duyur | Alias'ı tamamen kaldırma, yalnızca uyarı ver |
| Ajan preview + execute'u arka arkaya çağırır | 4 | 3 | 12 | Üç kapı (bayrak + ayar + token) ve `confirm:true`; isteğe bağlı elicitation | `allow_destructive` varsayılan kapalı; kullanıcı açmadan hiçbir yol çalışmaz |
| Token bellek içi; süreç yeniden başlarsa kaybolur | 2 | 5 | 10 | Bu istenen davranış: yeniden başlatma tüm grant'ları iptal eder | — |
| `excluded_names`/`protected_paths` yaşam süresi uyuşmazlığı | 3 | 3 | 9 | `DiscoveryConfig`'e klonlanmış `Vec<String>` referansları ver; borrow checker derleme zamanında doğrular | — |
| Audit yazımı başarısız olursa silme devam eder | 3 | 2 | 6 | Audit hatasını yürütme sonrası rapora ekle; silmeyi geri alma | Audit'i `tracing` ile ikinci kanala yaz |

**B1 testleri**

| ID | Senaryo | Adımlar | Beklenen |
|---|---|---|---|
| B1-T1 | Preview silmez | `preview_cleanup` çağır, dosya sistemini kontrol et | Hiçbir dosya değişmemiş; plan + token dönmüş |
| B1-T2 | Kapalı ayar | Ayar `false` iken `execute` çağır | `Blocked`, dosya değişmemiş |
| B1-T3 | Kapalı bayrak | `--allow-destructive` yokken `tools/list` | `execute` aracı listede yok |
| B1-T4 | Token tek kullanım | Aynı token ile iki kez execute | İkinci çağrı `PlanInvalid` |
| B1-T5 | Token TTL | Saati 5 dk ileri al (test clock) | `PlanInvalid` |
| B1-T6 | Plan değişti | Preview sonrası hedef setini değiştir | `PlanChanged` |
| B1-T7 | Korumalı yol | `protected_paths` içindeki hedefi preview'a ver | `blocked` listesinde, execute'da atlanır |
| B1-T8 | Exclusion uygulanır | `excluded_names` içindeki dizin taranır | Sonuçta görünmez |
| B1-T9 | Audit | Başarılı execute sonrası geçmiş | Kayıt var, `mode` ve hedef sayısı doğru |

---

#### B2 — ItemTable türetilmiş arama indeksi (K-2, P-1)

| ID | Atomik iş | Dosya | Bağımlılık | Çıktı |
|---|---|---|---|---|
| B2-01 | `(item as any)._searchHaystack ??=` mutasyonunu kaldır | `ItemTable.tsx:215-230` | P0 | Yan etkisiz filtre |
| B2-02 | `useMemo` ile `Map<id, string>` indeksi üret; filtre yalnızca bu map'i okusun | `ItemTable.tsx` | B2-01 | O(n) indeks, O(1) erişim |
| B2-03 | Arama alanlarını tek sabitte topla (`displayPath`, `displayName`, `projectName`, `category`, `ruleId`) | `ItemTable.tsx` | B2-02 | Tutarlı davranış |
| B2-04 | 50.000 öğe ile ilk arama gecikmesini ölçen test | `ItemTable.perf.test.tsx` | B2-02 | Regresyon eşiği |

```tsx
// ItemTable.tsx — hedef uygulama
const searchIndex = useMemo(() => {
  const index = new Map<string, string>();
  for (const item of items) {
    index.set(
      item.id,
      `${item.displayPath} ${item.displayName} ${item.projectName ?? ""} ${item.category} ${item.ruleId}`
        .toLowerCase(),
    );
  }
  return index;
}, [items]);

const filteredItems = useMemo(() => {
  const query = deferredQuery.trim().toLowerCase();
  if (!query) return items;
  return items.filter((item) => searchIndex.get(item.id)?.includes(query));
}, [items, deferredQuery, searchIndex]);
```

**B2 riskleri**

| Risk | I | P | Skor | Önlem | Fallback |
|---|---|---|---|---|---|
| Arama sonuçları öncekiyle birebir uyuşmaz | 3 | 3 | 9 | Alan listesini tek sabitte tut; snapshot testi | Eski davranışı `searchHaystack` alanını ingest'te üretmek suretiyle koru |
| 50k öğede `Map` bellek artışı | 2 | 4 | 8 | Ölçüm testi; indeks yalnızca `items` değişince üretilir | İndeksi ilk aramada tembel üret |
| Sanallaştırma ile çakışma | 3 | 4 | 12 | Filtre çıktısı `@tanstack/react-virtual`'a aynı sözleşmeyle verilir; mevcut stress testi çalıştır | Filtre mantığını ayrı hook'a al, UI'ı değiştirme |

**B2 testleri**

| ID | Senaryo | Adımlar | Beklenen |
|---|---|---|---|
| B2-T1 | Mutasyon yok | StrictMode'da render et, `Object.keys(item)` kontrol et | `_searchHaystack` yok, nesne referansı değişmemiş |
| B2-T2 | Filtre doğruluğu | "node" ara | Ad, yol, kategori eşleşenler; yalnızca eşleşenler |
| B2-T3 | 50k performans | 50k item ile ilk tuş vuruşu | 150 ms altı (ölçüm raporlanır) |
| B2-T4 | Sanallaştırma | 10k item, scroll | Donma yok, satır sayısı doğru |

---

#### B3 — Webhook testinin Rust'a taşınması (K-3)

| ID | Atomik iş | Dosya | Bağımlılık | Çıktı |
|---|---|---|---|---|
| B3-01 | `reqwest 0.12` bağımlılığı ekle (json + default TLS), `httpmock` dev bağımlılığı | `Cargo.toml` | P0 | HTTP istemcisi |
| B3-02 | `webhook_commands.rs`: tek `Client`, 10 sn timeout, en fazla 3 yönlendirme, URL doğrulama | yeni dosya | B3-01 | `test_webhook` komutu |
| B3-03 | `AppError::Network(String)` ekle + `Display` + frontend fallback eşlemesi | `error/app_error.rs`, `ui-text` | B3-02 | Anlamlı hata |
| B3-04 | `lib.rs` `generate_handler!`'a komutu ekle; frontend `fetch` bloğunu kaldır | `lib.rs`, `SettingsView.tsx` | B3-02 | Uçtan uca bağlantı |
| B3-05 | CLI `send_webhook_sync`'i `curl.exe` yerine aynı istemciye geçir | `cli/mod.rs` | B3-02 | Tek HTTP yolu |
| B3-06 | Testler: 200, 500, timeout, geçersiz şema, DNS hatası | `src-tauri/tests/webhook.rs` | B3-02 | 6 test |

```rust
// commands/webhook_commands.rs
use serde::Serialize;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebhookTestResult {
    pub status: u16,
    pub ok: bool,
    pub latency_ms: u64,
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::limited(3))
            .user_agent(concat!("DevCleaner/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("static HTTP client configuration is valid")
    })
}

fn validate(url: &str) -> Result<reqwest::Url, AppError> {
    if url.len() > 2048 {
        return Err(AppError::InvalidPath("Webhook URL is too long.".into()));
    }
    let parsed = reqwest::Url::parse(url)
        .map_err(|_| AppError::InvalidPath("Webhook URL is not valid.".into()))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(AppError::InvalidPath("Only http(s) webhooks are allowed.".into()));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(AppError::InvalidPath("Credentials in URL are not allowed.".into()));
    }
    Ok(parsed)
}

#[tauri::command]
pub async fn test_webhook(url: String) -> Result<WebhookTestResult, AppError> {
    let parsed = validate(&url)?;
    let started = Instant::now();
    let response = client()
        .post(parsed)
        .json(&serde_json::json!({
            "event": "test_ping",
            "timestamp": chrono::Utc::now().to_rfc3339(),
            "product": "Dev Cleaner by Vellium",
            "version": env!("CARGO_PKG_VERSION"),
        }))
        .send()
        .await
        .map_err(|e| AppError::Network(e.without_url().to_string()))?;
    Ok(WebhookTestResult {
        status: response.status().as_u16(),
        ok: response.status().is_success(),
        latency_ms: started.elapsed().as_millis() as u64,
    })
}
```

```tsx
// SettingsView.tsx
try {
  const result = await invoke<WebhookTestResult>("test_webhook", { url });
  if (result.ok) {
    setWebhookTestStatus({ success: true, text: `${ui.settings.webhookSent} (${result.status}, ${result.latencyMs} ms)` });
  } else {
    setWebhookTestStatus({ success: false, text: `HTTP ${result.status}` });
  }
} catch (err) {
  setWebhookTestStatus({ success: false, text: localizeAppError(err, ui) });
}
```

**B3 riskleri**

| Risk | I | P | Skor | Önlem | Fallback |
|---|---|---|---|---|---|
| `reqwest` ikili boyutu artırır | 2 | 4 | 8 | `default-features = false, features=["json","native-tls"]`; release boyutunu ölç | `rustls-tls` yerine Schannel (native-tls) kullan; Windows'ta ek DLL yok |
| Proxy/kurumsal ağda istek başarısız | 3 | 3 | 9 | `reqwest` sistem proxy'sini kullanır; hata mesajında ayrım yap | Kullanıcıya "proxy ortam değişkenlerini kontrol edin" ipucu |
| 10 sn timeout UI'yı kilitler | 2 | 3 | 6 | `async` komut + buton `testing` durumu | Timeout'u 5 sn'ye düşür |
| URL doğrulaması SSRF'ye izin verir | 3 | 2 | 6 | Yalnızca http/https + host zorunlu; dosya/IP şemaları reddedilir | Özel ağ adreslerini reddetme opsiyonu ekle (kurumsal) |
| CLI'de `curl.exe` kaldırılınca eski davranış bozulur | 2 | 3 | 6 | Aynı payload ve başlıkları koru; entegrasyon testi | `--legacy-curl` bayrağı bırakma; gerek yok |

**B3 testleri**

| ID | Senaryo | Adımlar | Beklenen |
|---|---|---|---|
| B3-T1 | 200 | `httpmock` 200 döner | `ok:true`, status 200, latency > 0 |
| B3-T2 | 500 | `httpmock` 500 döner | `ok:false`, status 500; UI kırmızı |
| B3-T3 | Timeout | Sunucu 11 sn bekletir | 10 sn'de `Network` hatası; UI toast |
| B3-T4 | Geçersiz şema | `file:///C:/x` | `InvalidPath`; istek atılmaz |
| B3-T5 | DNS hatası | `https://nonexistent.invalid` | `Network`; çökme yok |
| B3-T6 | CSP regresyonu | Üretim CSP'si ile paket çalıştır | Webhook testi Rust üzerinden çalışır, CSP engeli yok |

---

#### B4 — App effect'leri ve tipli navigasyon (Y-1, Y-2, O-4)

| ID | Atomik iş | Dosya | Bağımlılık | Çıktı |
|---|---|---|---|---|
| B4-01 | Klavye dinleyicisi tüm değerleri `getState()` ile okur; `[]` bağımlılığı gerçekten güvenli olur | `App.tsx:123-182` | P0 | Bayat closure yok |
| B4-02 | Son tarama geri yükleme effect'i yalnızca açılışta çalışır (`[]`), hata loglanır | `App.tsx:98-113` | B4-01 | Tek IPC çağrısı |
| B4-03 | Ayar yükleme effect'i `ui.errors.title` yerine hata anında `getUIText(...)` okur; bağımlılık `[]` | `App.tsx:79-93` | B4-01 | Dil değişiminde yeniden yükleme yok |
| B4-04 | `ViewName` union tipi + `Record<string, ViewName>`; `as any` kaldırılır | `types/index.ts`, `App.tsx` | P0 | Tip güvenliği |

```tsx
// App.tsx
if (matchesShortcut(event, shortcuts.startStopScan)) {
  event.preventDefault();
  const scan = useScanStore.getState();
  if (scan.status === "scanning") {
    void scan.cancelScan();
  } else {
    void scan.startScan();
  }
  return;
}

const navMap: Record<string, ViewName> = {
  navOverview: "overview",
  navProjects: "projects",
  navAgents: "agents",
  navCaches: "caches",
  navDocs: "docs",
  navHistory: "history",
  navSettings: "settings",
};
appStore.setView(viewName);
```

**B4 riskleri**

| Risk | I | P | Skor | Önlem | Fallback |
|---|---|---|---|---|---|
| `scan.status` değerleri `isScanning` ile birebir eşleşmez | 3 | 3 | 9 | `isScanning` tanımını `status === "scanning" \|\| status === "measuring"` olarak tek yerde topla | Mevcut `useScanController`'ı koru, yalnızca ref ile güncel değeri oku |
| Kısayol tekrar bağlanır | 2 | 2 | 4 | `[]` + `getState()`; StrictMode testi | Cleanup'ta `removeEventListener` doğrula |
| Dil değişiminde hata mesajı eski dilde kalır | 2 | 3 | 6 | Hata anında `getUIText(prefs.language)` çağır | `ui` nesnesini ref'te tut |

**B4 testleri**

| ID | Senaryo | Adımlar | Beklenen |
|---|---|---|---|
| B4-T1 | Tarama sırasında kısayol | Tarama başlat, `Ctrl+Shift+S` | `cancelScan` çağrılır, yeni tarama başlamaz |
| B4-T2 | Boşta kısayol | Tarama yokken aynı tuş | `startScan` çağrılır |
| B4-T3 | Dil değişimi | TR → EN | `getAppSettings` yalnızca 1 kez çağrılmış |
| B4-T4 | Durum geçişleri | idle → scanning → completed | `getLastScan` yalnızca 1 kez çağrılmış |
| B4-T5 | Navigasyon | Her kısayol | Doğru `view`, tip hatası yok |

---

#### B5 — Ayar kalıcılığında debounce ve flush (Y-3, P-2)

| ID | Atomik iş | Dosya | Bağımlılık | Çıktı |
|---|---|---|---|---|
| B5-01 | 250 ms debounce + sıralı yazma kuyruğu | `preferences-store.ts:188-198` | P0 | Tek IPC/yazma |
| B5-02 | `flushPreferences()` ekle; pencere kapanışında ve `visibilitychange` sırasında çağır | `preferences-store.ts`, `App.tsx` | B5-01 | Veri kaybı yok |
| B5-03 | Hata toast'ını tekilleştir (aynı hata 5 sn içinde bir kez) | `preferences-store.ts` | B5-01 | Toast spam yok |
| B5-04 | Test: 10 setter → 1 yazma; kapanışta flush | `src/test/preferences.test.ts` | B5-01 | Kabul testi |

```ts
// preferences-store.ts
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let writeChain: Promise<void> = Promise.resolve();
let lastErrorAt = 0;

function syncPreferences(state: PreferencesState) {
  if (!state.isLoaded) return;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flushPreferences();
  }, 250);
}

export function flushPreferences(): Promise<void> {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const state = usePreferencesStore.getState();
  if (!state.isLoaded) return writeChain;
  const snapshot = toSettings(state);
  writeChain = writeChain
    .then(() => scannerApi.saveAppSettings(snapshot))
    .catch((err) => {
      const now = Date.now();
      if (now - lastErrorAt > 5000) {
        lastErrorAt = now;
        useUiStore.getState().showToast(
          getUIText(state.language).settings.saveError, "error", 5000,
        );
      }
    });
  return writeChain;
}
```

**B5 riskleri**

| Risk | I | P | Skor | Önlem | Fallback |
|---|---|---|---|---|---|
| Kapanışta flush çalışmaz | 4 | 4 | 16 | Tauri `getCurrentWindow().onCloseRequested` ile `flushPreferences()` await et | Kritik alanlarda (`theme`, `language`) anında yaz |
| Debounce sırasında çökme veri kaybı | 3 | 2 | 6 | 250 ms kısa; `visibilitychange` flush | `pagehide` dinleyicisi ekle |
| Yazma sırası bozulur | 3 | 3 | 9 | Promise zinciri (`writeChain`) | Son snapshot'ı her zaman kazanacak şekilde sürüm numarası |

**B5 testleri**

| ID | Senaryo | Adımlar | Beklenen |
|---|---|---|---|
| B5-T1 | Debounce | 10 setter hızlı çağır, 300 ms bekle | `saveAppSettings` 1 kez |
| B5-T2 | Flush | setter + hemen `flushPreferences()` | Değer diske yazılmış |
| B5-T3 | Hata | `saveAppSettings` reject | Tek toast; diğer setter'lar çalışmaya devam |
| B5-T4 | Kapanış | Pencere kapat | Son değer kaydedilmiş |

---

#### B6 — Bildirim izni, AudioContext ve hata sızıntısı (Y-4, Y-5, P-3)

| ID | Atomik iş | Dosya | Bağımlılık | Çıktı |
|---|---|---|---|---|
| B6-01 | Constructor yalnızca mevcut izni okur; `requestPermission` kaldırılır | `notification-service.ts:77-130` | P0 | Açılışta izin istemi yok |
| B6-02 | Tek `AudioContext` + `resume()` + node `disconnect()` + boşta `suspend()` | `notification-service.ts:141-170` | P0 | Sızıntı yok |
| B6-03 | `ErrorBoundary` üretimde yalnızca mesaj; stack `DEV` altında | `ErrorBoundary.tsx:80-95` | P0 | Bilgi sızıntısı yok |
| B6-04 | WebView2 bildirim desteğini doğrula; desteklenmiyorsa `tauri-plugin-notification`'a geçiş kararı | `notification-service.ts`, spike testi | B6-01 | Kanıtlı karar |
| B6-05 | Testler: izin çağrısı yok, tek context, prod stack yok | `src/test/notifications.test.tsx` | B6-01 | 4 test |

**B6 riskleri**

| Risk | I | P | Skor | Önlem | Fallback |
|---|---|---|---|---|---|
| WebView2 `Notification` API'si yok | 3 | 4 | 12 | B6-04 spike: hedef WebView2'de `"Notification" in window` ölç | `tauri-plugin-notification` ekle (yalnızca bu durumda) |
| `AudioContext` askıda kalır | 2 | 3 | 6 | İlk `pointerdown`'da `resume()`; hata sessiz | Ses kapalıysa hiç oluşturma |
| Bildirim izni reddedilirse tekrar sorma | 3 | 3 | 9 | `Notification.permission === "denied"` ise UI'da "tarayıcı ayarlarından açın" | Uygulama içi toast'a düş |
| Stack gizlenince saha teşhisi zorlaşır | 2 | 3 | 6 | `import.meta.env.DEV` + opsiyonel `log_frontend_error` | Log dosyasına yaz, UI'da gösterme |

**B6 testleri**

| ID | Senaryo | Adımlar | Beklenen |
|---|---|---|---|
| B6-T1 | Açılış | Servisi import et | `requestPermission` çağrılmamış |
| B6-T2 | Ses | 3 bildirim gönder | `new AudioContext` 1 kez; 3 osilatör |
| B6-T3 | Üretim stack | `ErrorBoundary` hata yakala (prod build) | Stack DOM'da yok, mesaj var |
| B6-T4 | İzin reddi | `permission = "denied"` | İkinci istek yok; kullanıcı yönlendirmesi var |

---

#### B7 — CLI çıkış kodları, scope ve sürüm (Y-6)

| ID | Atomik iş | Dosya | Bağımlılık | Çıktı |
|---|---|---|---|---|
| B7-01 | `run_scan_cli` / `run_clean_cli` `Result<(), AppError>` döndürür | `cli/mod.rs:332` | P0 | Hata yayılımı |
| B7-02 | `handle_cli` çıkış kodları: 0 başarı, 1 tarama, 2 temizlik, 3 argüman, 4 engellendi | `cli/mod.rs:38-71` | B7-01 | Otomasyon doğru |
| B7-03 | `--scope` → `ScanScope` eşlemesi (`projects/agents/caches/all`) | `cli/mod.rs:332-430` | B7-01 | Scope çalışır |
| B7-04 | Tüm sabit `"2.2.0"` metinleri `build_info::VERSION` / `env!("CARGO_PKG_VERSION")` | `cli/mod.rs`, `mcp/mod.rs` | P0 | Tek sürüm kaynağı |
| B7-05 | "Checked 21 tools" sayısını katalogdan üret | `cli/mod.rs` | B7-04 | Doğru sayı |
| B7-06 | `assert_cmd` ile çıkış kodu testleri | `src-tauri/tests/cli.rs` | B7-02 | 6 test |

```rust
pub fn handle_cli() -> Option<i32> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        Some("scan") => run_scan_cli(&args[1..]).map(|_| 0),
        Some("clean") => run_clean_cli(&args[1..]).map(|_| 0),
        Some("mcp") => { run_mcp_cli(&args[1..]); Ok(0) }
        Some("--version") | Some("-V") => { println!("{}", build_info::VERSION); Ok(0) }
        _ => { print_help(); Err(AppError::InvalidPath("Unknown command".into())) }
    };
    Some(match result {
        Ok(code) => code,
        Err(AppError::InvalidPath(_)) => 3,
        Err(AppError::Blocked(_)) => 4,
        Err(_) => 1,
    })
}
```

**B7 riskleri**

| Risk | I | P | Skor | Önlem | Fallback |
|---|---|---|---|---|---|
| Mevcut CI betikleri `0` bekliyor | 3 | 4 | 12 | Sürüm notunda duyur; `--legacy-exit-codes` bayrağı | Bayrağı bir sürüm boyunca tut |
| Scope eşlemesi yanlış katalog kuralı seçer | 4 | 3 | 12 | `ScanScope` enum'ı ile derleme zamanı; her scope için entegrasyon testi | Yalnızca `projects` destekle, diğerlerinde açık hata |
| `mcp` komutu artık `Result` döndürür | 2 | 2 | 4 | İnce sarmalayıcı | — |

**B7 testleri**

| ID | Senaryo | Adımlar | Beklenen |
|---|---|---|---|
| B7-T1 | Başarılı tarama | `scan . --json` | exit 0, JSON geçerli |
| B7-T2 | Geçersiz dizin | `scan Z:\yok` | exit 1, stderr'de hata |
| B7-T3 | Bilinmeyen komut | `foo` | exit 3, yardım |
| B7-T4 | Scope agents | `scan . --scope agents` | Yalnızca agent hedefleri |
| B7-T5 | Scope all | `scan . --scope all` | Üç katalog birleşimi |
| B7-T6 | Sürüm | `--version` | `CARGO_PKG_VERSION` ile aynı |

---

#### B8 — Aday limiti off-by-one (Y-7)

| ID | Atomik iş | Dosya | Bağımlılık | Çıktı |
|---|---|---|---|---|
| B8-01 | `try_add_candidate()` tek kapı; limit kontrolü + sayaç artırımı birlikte | `scanner/discovery.rs:282, 373` | P0 | Kesin limit |
| B8-02 | Limit dolduğunda `partial` bayrağı ve `StopReason::CandidateLimit` doğru raporlanır | `discovery.rs`, `scanner/session.rs` | B8-01 | Doğru özet |
| B8-03 | Test: limit 10, 20 aday | `src-tauri/tests/scan_limits.rs` | B8-01 | Tam 10 |

**B8 riskleri**

| Risk | I | P | Skor | Önlem | Fallback |
|---|---|---|---|---|---|
| Limitin bir eksiğine düşmek | 2 | 3 | 6 | Sınır testleri 10/10.000 | Sayaç ve kontrolü aynı fonksiyonda tut |
| `break` sonrası yarım ölçüm | 3 | 3 | 9 | Ölçümü yalnızca eklenen öğe için yap; kabul edilen öğe sayısını raporla | `partial: true` ile kullanıcıya bildir |

**B8 testleri**

| ID | Senaryo | Adımlar | Beklenen |
|---|---|---|---|
| B8-T1 | Tam limit | 20 aday, limit 10 | 10 öğe, `CandidateLimit` |
| B8-T2 | Limit altı | 5 aday, limit 10 | 5 öğe, `StopReason::None` |
| B8-T3 | Limit 1 | 1 aday | 1 öğe, taşma yok |

---

#### B9 — Scan store şema ve timer (Y-8)

| ID | Atomik iş | Dosya | Bağımlılık | Çıktı |
|---|---|---|---|---|
| B9-01 | `restoreScan` içinde `schemaVersion` kontrolü; uyumsuzsa `clearLastScan()` + uyarı | `scan-store.ts:192` | P0 | Eski snapshot yüklenmez |
| B9-02 | `resetScan` bekleyen `persistTimer`'ı iptal eder | `scan-store.ts:107-135` | B9-01 | Hayalet yazma yok |
| B9-03 | Yazmaları sıraya al (`persistChain`) | `scan-store.ts` | B9-02 | Yarış yok |
| B9-04 | Testler: şema uyuşmazlığı, reset sırasında timer | `src/test/scan-store.test.ts` | B9-01 | 4 test |

**B9 riskleri**

| Risk | I | P | Skor | Önlem | Fallback |
|---|---|---|---|---|---|
| Şema bump'ı mevcut kullanıcıların son taramasını siler | 3 | 2 | 6 | Uyumsuz snapshot'ı silme; yalnızca yükleme ve "yeni tarama gerekli" bilgisi | Migrasyon fonksiyonu ekle |
| Reset sonrası son persist kaybolur | 2 | 2 | 4 | Reset öncesi açık `flush` çağrısı yok; reset zaten siler | — |

**B9 testleri**

| ID | Senaryo | Adımlar | Beklenen |
|---|---|---|---|
| B9-T1 | Eski şema | `schemaVersion: 1` snapshot | Yüklenmez, bilgi gösterilir |
| B9-T2 | Güncel şema | `schemaVersion: 2` | Yüklenir |
| B9-T3 | Reset + timer | Persist zamanla, hemen reset | Diske yazılmaz |
| B9-T4 | Ardışık persist | 5 hızlı değişiklik | Son snapshot kazanır |

---

#### B10 — Sistem yolu koruması (Y-9)

| ID | Atomik iş | Dosya | Bağımlılık | Çıktı |
|---|---|---|---|---|
| B10-01 | `validate_system_path` tüm bileşenleri normalize edip kontrol eder | `safety/path_guard.rs:161-200` | P0 | Derin sistem yolları reddedilir |
| B10-02 | Aşırı koruma için izin listesi: yalnızca kullanıcı projeleri altındaki `node_modules` gibi bilinen hedefler | `path_guard.rs` | B10-01 | Yanlış pozitif yok |
| B10-03 | Güvenlik matrisi testleri: 12 yol | `src-tauri/tests/path_guard.rs` | B10-01 | 12 test |

```rust
let forbidden: HashSet<&str> = [
    "windows", "program files", "program files (x86)", "programdata",
    "system volume information", "$recycle.bin", "recovery", "msocache",
    "boot", "perflogs", "system32", "syswow64",
].into_iter().collect();

for (depth, part) in parts.iter().enumerate().skip(1) {
    if forbidden.contains(part.as_str()) {
        // Sürücü kökü altındaki sistem dizinleri her zaman yasak.
        // Derin yollarda da yasak: yanlış pozitif, yanlış negatiften iyidir.
        return Err(AppError::UnsafeDeleteTarget(format!(
            "System directory component is protected: {}", part
        )));
    }
    let _ = depth;
}
```

**B10 riskleri**

| Risk | I | P | Skor | Önlem | Fallback |
|---|---|---|---|---|---|
| Meşru proje `windows` klasörü içerir | 3 | 3 | 9 | Yalnızca silme hedefi için uygula; kullanıcıya "korumalı" gerekçesi göster | Kullanıcı ayarına "bu adı korumayı kapat" **eklenmez**; güvenlik önce gelir |
| `parts` normalizasyonu UNC/verbatim yolları kaçırır | 4 | 2 | 8 | Mevcut `normalize_key` + reparse reddi korunur | Silme yerine `Blocked` |
| Test ortamı Windows dışı | 2 | 3 | 6 | `#[cfg(windows)]` testleri + CI Windows runner | Unix'te derleme testi |

**B10 testleri**

| ID | Senaryo | Yol | Beklenen |
|---|---|---|---|
| B10-T1 | Windows kökü | `C:\Windows\Temp` | Red |
| B10-T2 | Program Files | `D:\Program Files\X` | Red |
| B10-T3 | Derin Windows | `C:\Users\X\AppData\Local\Windows\Temp` | Red |
| B10-T4 | SVI | `D:\$Recycle.Bin\X` | Red |
| B10-T5 | System32 | `C:\System32\drivers` | Red |
| B10-T6 | Normal proje | `C:\Users\X\dev\app\node_modules` | İzin |
| B10-T7 | Symlink | Junction ile sistem dizini | Red |
| B10-T8 | UNC | `\\server\share\Windows` | Red |
| B10-T9 | Göreli | `..\Windows` | Red |
| B10-T10 | Sürücü kökü | `C:\` | Red |
| B10-T11 | Boş | `` | Red |
| B10-T12 | Türkçe karakter | `C:\Users\X\dev\üygulama\node_modules` | İzin |

---

#### B11 — İptal token'ı ve süreç ağacı (Y-10, O-11)

| ID | Atomik iş | Dosya | Bağımlılık | Çıktı |
|---|---|---|---|---|
| B11-01 | `execute_plan` imzasına `&CancellationToken` ekle; CLI/MCP çağrıları güncelle | `coordinator.rs:117`, `cli/mod.rs:482`, `mcp/mod.rs:365` | B1, B7 | API tutarlılığı |
| B11-02 | CLI'de `ctrlc` ile token iptali (yeni bağımlılık yok: `std` + sinyal işleyici) | `cli/mod.rs` | B11-01 | Ctrl+C çalışır |
| B11-03 | Windows dışı `kill -TERM -pid` dalını kaldır; ürün Windows-only | `official_actions.rs:520-530` | P0 | Yanlış süreç öldürme yok |
| B11-04 | Test: iptal edilen plan kalan öğeleri işlemez | `cleanup/tests.rs` | B11-01 | 2 test |

**B11 riskleri**

| Risk | I | P | Skor | Önlem | Fallback |
|---|---|---|---|---|---|
| İmza değişikliği tüm çağrıları kırar | 2 | 5 | 10 | Derleyici kılavuzluğunda toplu düzeltme; testler | Eski imzayı sarmalayıcı olarak koru |
| Ctrl+C yarım kalan Recycle Bin işlemi | 4 | 2 | 8 | İptal yalnızca öğeler arasında; belgede açık | İptal sonrası rapor `stopped_early` |
| Windows dışı derleme artık yok | 1 | 3 | 3 | `#[cfg(windows)]` dışında derleme hatası bilinçli | — |

**B11 testleri**

| ID | Senaryo | Adımlar | Beklenen |
|---|---|---|---|
| B11-T1 | İptal | 10 öğe, 3. öğede token iptal | 3 öğe işlenir, rapor `stopped_early` |
| B11-T2 | İptalsiz | Token iptal edilmez | 10/10 |
| B11-T3 | CLI Ctrl+C | Uzun tarama, Ctrl+C | Süreç 130/1 koduyla çıkar, kilit kalmaz |

---

### Faz C — Veri bütünlüğü ve UX düzeltmeleri

#### C1 — Hata görünürlüğü ve geçmiş yükleme (O-1, O-5)

| ID | İş | Dosya | Bağımlılık | Çıktı |
|---|---|---|---|---|
| C1-01 | `OverdueView` geçmiş `.catch(() => {})` yerine `historyError` state + boş durum | `OverviewView.tsx:159-171` | PR-3 | Görünür hata |
| C1-02 | `HistoryView.load` `useCallback` + effect bağımlılığı | `HistoryView.tsx:61-63` | PR-3 | Doğru yenileme |
| C1-03 | Ortak `describeError`/`toUserMessage` yardımcı | `src/lib/errors/user-message.ts` | C1-01 | Tek hata dili |

**C1 riskleri:** Hata mesajı çevirisi eksik (I2/P3=6) → `ui.errors.*` fallback; boş durumda yanlış "hata" gösterimi (I2/P2=4) → yalnızca gerçek hata varsa.

**C1 testleri:** Geçmiş API reject → hata bileşeni görünür; sekme değişimi → tek `load`; başarılı boş yanıt → "kayıt yok" (hata değil).

#### C2 — Dialog tutarlılığı ve effect bağımlılığı (O-2, O-10)

| ID | İş | Dosya | Çıktı |
|---|---|---|---|
| C2-01 | `window.confirm` yerine `Dialog` + `pendingRemove` state | `AgentsView.tsx:292` | Erişilebilir onay |
| C2-02 | `CleanupPlanDialog` effect'ini `planId`/`targetIds` ilkellerine bağla; eslint-disable kaldır | `CleanupPlanDialog.tsx:77` | Kural temiz |
| C2-03 | Test: dialog klavye/focus; plan değişiminde yeniden yükleme | `src/test/dialogs.test.tsx` | 4 test |

**C2 riskleri:** Dialog focus trap regresyonu (I3/P2=6) → mevcut `Dialog` testleri; plan effect'inin iki kez çalışması (I2/P3=6) → `useRef` guard.

**C2 testleri:** `Escape` kapatır ve odağı geri verir; `Enter` onaylar; plan id değişince yeni plan; aynı id'de yeniden yükleme yok.

#### C3 — Sürüm tek kaynağı (O-3, D-3)

| ID | İş | Dosya | Çıktı |
|---|---|---|---|
| C3-01 | `AboutView` fallback'i `"—"` / `ui.about.unknown` yap | `AboutView.tsx:167,229,234` | Yanlış sürüm yok |
| C3-02 | `check-version` script'ine CLI/MCP sabit taraması ekle | `scripts/check-version.js` | Otomatik kapı |
| C3-03 | `audit/repository.rs:149` çelişkili doc yorumunu düzelt | `audit/repository.rs` | Doc rot yok |

**C3 testleri:** `buildInfo` null → "—"; `check-version` sabit `"2.2.0"` bulursa exit 1.

#### C4 — Mutex zehirlenmesi (O-6)

| ID | İş | Dosya | Çıktı |
|---|---|---|---|
| C4-01 | `pending.lock().unwrap()` → `map_err(AppError::Blocked)` | `official_actions.rs:844,859` | Panic yok |
| C4-02 | Test: zehirli mutex simülasyonu | `official_actions` testleri | Kontrollü hata |

**C4 riskleri:** Hata yolu test edilemez (I2/P3=6) → `Mutex`'i panikleten test iş parçacığı; fallback `catch_unwind`.

#### C5 — Tarama geçmişi dayanıklılığı (O-7, D-7)

| ID | İş | Dosya | Çıktı |
|---|---|---|---|
| C5-01 | `isScanHistoryRecord` tip koruması + 50 kayıt + 90 gün budama | `scan-history.ts` | Bozuk kayıt listeyi bozmaz |
| C5-02 | Kota hatasında kullanıcıya bilgi | `scan-history.ts` | Sessiz kayıp yok |
| C5-03 | Test: bozuk JSON, eksik alan, 100 kayıt | `src/test/scan-history.test.ts` | 5 test |

**ADR-3 gereği backend'e taşınmaz.** 2.3 için `docs/architecture/SCAN_HISTORY_MIGRATION.md` taslağı açılır (uygulanmaz).

#### C6 — Mock/demo katmanının ayrılması (O-8, D-6, P-4)

| ID | İş | Dosya | Çıktı |
|---|---|---|---|
| C6-01 | Demo verisini `scanner-api.mock.ts`'e taşı | yeni dosya | Üretimde yok |
| C6-02 | `import.meta.env.DEV` ile dinamik import; üretimde `throwNoBackend()` | `scanner-api.ts` | Gerçek hata |
| C6-03 | `Concept*` ekranlarını `import.meta.env.DEV` ile koşulla | `ConceptContainer` vb. | Üretimde erişilemez |
| C6-04 | Bundle boyutu karşılaştırması | `dist/` | Ölçülebilir düşüş |

```ts
// scanner-api.ts
async function createApi(): Promise<ScannerApi> {
  if (isTauriEnvironment()) return realApi;
  if (import.meta.env.DEV) {
    const { createMockScannerApi } = await import("./scanner-api.mock");
    return createMockScannerApi();
  }
  throw new Error("Backend unavailable: this build requires the desktop runtime.");
}

export const scannerApi: ScannerApi = await createApi();
```

> Not: Top-level await Vite hedefiyle uyumludur; alternatif olarak `getScannerApi()` async erişimcisi kullanılabilir. Karar: **top-level await**, çünkü mevcut tüm çağrılar modül yüklenirken hazır bir nesne bekliyor.

**C6 riskleri:** Top-level await bazı test ortamlarında sorun (I2/P3=6) → Vitest `esbuild` hedefi `es2022`; fallback `getScannerApi()`.

#### C7 — i18n kapsamı (O-9)

| ID | İş | Dosya | Çıktı |
|---|---|---|---|
| C7-01 | Docs/About gezinme ve başlıklarını `ui-text`'e taşı | `docs-data.ts`, `DocsContent*` | Yerelleşmiş başlık |
| C7-02 | "Docs are in English" bildirimi ekle | `DocsView` | Açık beklenti |
| C7-03 | Konsept pazarlama metinlerini üretimden çıkar (C6-03) | Concept* | Üretimde yok |
| C7-04 | `check:i18n:coverage`'a Docs anahtarlarını ekle | script | Kapı |

**ADR-4 gereği doküman gövdesi çevrilmez.** Kabul: başlık/gezinme %100 çevrili; gövde İngilizce ve bildirim var.

#### C8 — Cache ölçüm durumu (O-12)

| ID | İş | Dosya | Çıktı |
|---|---|---|---|
| C8-01 | `finished` → `measuring:false`; `cancelled` → `measuring:false` | `cache-store.ts:57-89` | UI takılmaz |
| C8-02 | Test: olay sırası ve kaçan olay | `src/test/cache-store.test.ts` | 3 test |

---

### Faz D — Teknik borç, performans ve tutarlılık

#### D1 — Ortak yardımcılar (D-1, D-4, D-5)

| ID | İş | Dosya | Çıktı |
|---|---|---|---|
| D1-01 | `formatSavedAt` tek kaynak: `src/lib/format/date.ts` | `StaleScanBanner.tsx`, `results/SelectionActionBar.tsx` | Tekrar yok |
| D1-02 | `describeError` tek kaynak: `src/lib/errors/user-message.ts` | 4 dosya | Tekrar yok |
| D1-03 | `maskPath` `src/lib/format/path.ts`'e taşı | `ItemTable.tsx` + 6 import | Bağımlılık yönü doğru |
| D1-04 | `truncatePath` ayırıcıyı koru | `formatters.ts:148` | Çapraz platform |
| D1-05 | Seviyeli `logger` (`debug/info/warn/error`) + üretimde dosyaya yönlendirme | `src/lib/logging.ts` | Sessiz console yok |

**D1 riskleri:** Import döngüsü (I2/P3=6) → `lib/` katmanı `features/`'a bağımlı olmaz; testler.

#### D2 — Biçimlendirme ve doküman (D-2, D-3)

| ID | İş | Dosya | Çıktı |
|---|---|---|---|
| D2-01 | `prettier` + `cargo fmt` CI'da zorunlu | CI | Temiz diff |
| D2-02 | `AgentsView` çift boş satır, `OverviewView` girinti, `lib.rs:162` | ilgili dosyalar | Okunabilirlik |
| D2-03 | `audit/repository.rs` doc yorumu | aynı | Doğru doc |

#### D3 — Adlandırma (D-8)

| ID | İş | Dosya | Çıktı |
|---|---|---|---|
| D3-01 | `clear_cleanup_history` → `clear_all_history` (Tauri komutu + frontend) | `history_commands.rs`, `scanner-api.ts` | Ad davranışı yansıtır |
| D3-02 | Eski komut adını deprecated alias olarak koru | aynı | Geriye dönük uyum |

#### D4 — Performans doğrulaması (P-5 ve genel)

| ID | İş | Çıktı |
|---|---|---|
| D4-01 | `dist/` boyut baseline karşılaştırması | Rapor |
| D4-02 | 50k item arama + sanallaştırma ölçümü | Rapor |
| D4-03 | Ayar yazma sayısı ölçümü (10 setter → 1) | Rapor |
| D4-04 | Geçmiş ekranı yalnızca aktif sekme yüklemesi | Kod + test |

---

### Faz E — Yayın doğrulaması

| ID | İş | Çıktı |
|---|---|---|
| E1-01 | Tam regresyon: `npm test`, `cargo test`, `clippy`, `fmt`, `typecheck`, `build` | Yeşil |
| E1-02 | Güvenlik matrisi: 12 path + 9 MCP senaryosu | Rapor |
| E1-03 | Manuel smoke: webhook, bildirim, iptal, restore, dil değişimi | İmzalı kontrol listesi |
| E1-04 | Installer: NSIS + MSI, temiz kurulum/kaldırma | Rapor |
| E1-05 | Rollback tatbikatı: PR-2 ve PR-4 geri al, uygulama açılıyor mu | Rapor |
| E1-06 | `BUILD_INFO.json` commit eşleşmesi | Kanıt |

---

## 7. Work package risk özeti (konsolide)

| WP | En yüksek risk | I | P | Skor | Birincil önlem |
|---|---|---|---|---|---|
| B1 | Ajanın onayı atlaması | 4 | 3 | 12 | Üç bağımsız kapı + tek kullanımlık token |
| B2 | Arama regresyonu | 3 | 4 | 12 | Alan listesi sabiti + snapshot test |
| B3 | Proxy/TLS ortamı | 3 | 3 | 9 | Sistem proxy'si + net hata |
| B4 | `scan.status` eşleşmemesi | 3 | 3 | 9 | Tek `isScanning` tanımı |
| B5 | Kapanışta flush kaçması | 4 | 4 | 16 | `onCloseRequested` + await |
| B6 | WebView2 bildirim desteği yok | 3 | 4 | 12 | Spike + plugin fallback |
| B7 | CI betiklerinin exit 0 beklemesi | 3 | 4 | 12 | Sürüm notu + geçiş bayrağı |
| B8 | Limitin bir eksiğine düşmesi | 2 | 3 | 6 | Tek kapı + sınır testi |
| B9 | Eski snapshot'ın silinmesi | 3 | 2 | 6 | Silme değil, yükleme reddi |
| B10 | Meşru `windows` klasörü | 3 | 3 | 9 | Gerekçeli ret + kullanıcı bilgisi |
| B11 | Ctrl+C yarım işlem | 4 | 2 | 8 | Öğeler arası iptal |
| C2 | Focus trap regresyonu | 3 | 2 | 6 | Mevcut Dialog testleri |
| C6 | Top-level await test uyumu | 2 | 3 | 6 | es2022 hedefi |
| D1 | Import döngüsü | 2 | 3 | 6 | Katman kuralı |

---

## 8. Test stratejisi ve kabul kriterleri

### 8.1 Test katmanları

| Katman | Araç | Kapsam | Çalışma |
|---|---|---|---|
| Birim (Rust) | `cargo test` | Path guard, discovery, plan, audit, MCP grant | Her PR |
| Entegrasyon (Rust) | `cargo test --test` | CLI, webhook, MCP stdio, temizlik akışı | Her PR |
| Birim (Frontend) | Vitest + jsdom | Store'lar, yardımcılar, effect'ler | Her PR |
| Bileşen | Vitest + Testing Library | ItemTable, Dialog, ErrorBoundary | Her PR |
| E2E (web) | Playwright | Navigasyon, filtre, ayar kaydı | PR-5 sonrası |
| Manuel (Tauri) | Kontrol listesi | Bildirim, webhook, installer, iptal | E1 |

### 8.2 Genel kabul kriterleri

1. Her yeni test, düzeltme öncesi **kırmızı**, sonrası **yeşil** olmalı (regresyon kanıtı).
2. Hiçbir test `sleep` ile beklememeli; fake timer/`waitFor` kullanılmalı.
3. Rust testleri Windows'ta ve CI'da aynı sonucu vermeli; platforma özgü testler `#[cfg(windows)]`.
4. Testler kullanıcı verisine dokunmamalı; tüm dosya işlemleri `tempfile` ile.
5. MCP testleri gerçek stdin/stdout yerine `run_mcp_server_with` üzerinden buffer kullanmalı.
6. Frontend testleri `invoke` mock'u ile ağ/disk erişimi yapmamalı.

### 8.3 Regresyon matrisi

| Alan | Test | Öncesi | Sonrası |
|---|---|---|---|
| Tarama doğruluğu | Mevcut 97 Rust testi | Yeşil | Yeşil |
| Aday limiti | B8-T1 | Kırmızı (11 öğe) | Yeşil (10) |
| Path güvenliği | B10-T3 | Kırmızı (izin) | Yeşil (ret) |
| MCP | B1-T2 | Kırmızı (silme) | Yeşil (Blocked) |
| Webhook | B3-T2 | Kırmızı (başarı) | Yeşil (HTTP 500) |
| Arama | B2-T1 | Kırmızı (mutasyon) | Yeşil |
| Ayar yazımı | B5-T1 | Kırmızı (10 çağrı) | Yeşil (1) |
| Kısayol | B4-T1 | Kırmızı (yeni tarama) | Yeşil (iptal) |
| Restore | B4-T4 | Kırmızı (çok çağrı) | Yeşil (1) |
| Bildirim | B6-T1 | Kırmızı (izin isteği) | Yeşil |
| Stack | B6-T3 | Kırmızı (stack var) | Yeşil |
| CLI | B7-T2 | Kırmızı (exit 0) | Yeşil (exit 1) |
| Scan store | B9-T1 | Kırmızı (yüklenir) | Yeşil (reddedilir) |

---

## 9. Üretim kapısı (18 madde)

Aşağıdaki maddelerin tamamı sağlanmadan `build:release` çalıştırılmaz:

1. `npm run typecheck` → exit 0.
2. `npm test` → tüm testler yeşil, 0 atlanmış.
3. `cargo test` → tüm testler yeşil.
4. `cargo clippy --all-targets -- -D warnings` → 0 uyarı.
5. `cargo fmt --check` → temiz.
6. `npm run build` → başarılı.
7. `npm run check-version` → 2.2.1 üç dosyada eşit.
8. `node scripts/check-audit-invariants.mjs` → 0 ihlal.
9. `npm run check:i18n` → 0 eksik anahtar.
10. MCP entegrasyon paketi → 12/12.
11. Webhook entegrasyon paketi → 6/6.
12. Path güvenlik matrisi → 12/12.
13. 50k öğe arama ölçümü → baseline'dan yavaş değil.
14. `dist/` boyutu → baseline'dan büyük değil (mock çıkarımı sonrası).
15. Manuel smoke: webhook 200/500, bildirim, iptal, restore, dil değişimi → imzalı.
16. NSIS + MSI temiz kurulum/kaldırma → başarılı.
17. Rollback tatbikatı → PR-2 ve PR-4 geri alındığında uygulama açılıyor.
18. `BUILD_INFO.json` commit'i `git rev-parse HEAD` ile aynı; `dirty: false`.

---

## 10. Geri alma (rollback) planı

| Senaryo | Tetikleyici | Adım | Süre hedefi |
|---|---|---|---|
| MCP istemcileri bozuldu | `clean_safe` beklenen davranışı vermiyor | `devcleaner_clean_safe` alias'ını eski önizleme metnine döndür; execute'u kapat | Tek yapılandırma değişikliği |
| Webhook kurumsal ağda çalışmıyor | Proxy/TLS hatası | `test_webhook` komutunu devre dışı bırak; UI'da "desteklenmiyor" göster | Ayar bayrağı |
| CLI exit kodları CI'yı kırdı | Pipeline kırmızı | `--legacy-exit-codes` bayrağını varsayılan yap | Tek satır |
| Ayar migrasyonu veri kaybettirdi | Kullanıcı ayarları sıfırlandı | PR-3'ü geri al; `settings.json.bak`'tan yükle | Revert + dosya geri yükleme |
| Yeni sürüm açılmıyor | Açılışta çökme | PR-6/PR-5/PR-4 sırasıyla geri al; son bilinen iyi etikete dön | Revert |
| Installer başarısız | NSIS/MSI hatası | Önceki `release_output/` paketini yayınla | Paket değişimi |

**Zorunlu ön koşul:** Her PR birleşmeden önce `git tag pre-merge-<PR>` alınır. Ayarlar için `settings.json` yazımından önce `.bak` kopyası oluşturulur.

---

## 11. Üretim sonrası izleme (ilk 2 hafta)

| Metrik | Kaynak | Eşik | Aksiyon |
|---|---|---|---|
| MCP `Blocked` sayısı | audit log | > 0 ve kullanıcı şikayeti | Araç açıklamasını netleştir |
| Webhook başarı oranı | test sonucu (yerel) | < %80 | Proxy dokümantasyonu |
| Temizlik iptal oranı | audit `stopped_early` | > %10 | İptal gecikmesini ölç |
| Ayar yazma hatası | toast/log | > 5/gün | Disk izni/antivirüs kontrolü |
| Uygulama açılış süresi | yerel ölçüm | baseline + %10 | C6 bundle etkisini incele |
| Çökme | Windows Event Log | herhangi | Stack'i log dosyasından al |

---

## 12. Nihai uygulama sırası (tek bakışta)

```text
1.  P0-01 → P0-05        Baseline, CI, invariant script, sürüm
2.  B1-01 → B1-09        MCP güvenliği (en yüksek risk)
3.  B11-01 → B11-04      İptal token'ı + süreç ağacı
4.  B10-01 → B10-03      Path guard
5.  B8-01 → B8-03        Aday limiti
6.  B7-01 → B7-06        CLI exit/scope/version
7.  B2-01 → B2-04        ItemTable
8.  B4-01 → B4-05        App effect'leri
9.  B5-01 → B5-04        Ayar debounce
10. B9-01 → B9-04        Scan store
11. B3-01 → B3-06        Webhook
12. B6-01 → B6-05        Bildirim/ErrorBoundary
13. C1 → C8              Veri bütünlüğü ve UX
14. D1 → D4              Borç/performans/i18n
15. E1-01 → E1-06        Yayın kapısı
```

**Kritik yol:** `P0 → B1 → B11 → B7 → E1`. Diğer tüm işler bu yol dışında paralel yürütülebilir; yayın kapısı kritik yolun tamamlanmasını bekler.

---

## 13. Kapanış kriteri

Plan, aşağıdaki üç koşul birlikte sağlandığında tamamlanmış sayılır:

1. `docs/audit/PRE_DEPLOYMENT_QA_AUDIT_TR.md` içindeki **42 bulgunun tamamı** ya düzeltilmiş ya da ADR ile gerekçeli olarak kapsam dışı bırakılmış (yalnızca ADR-3, ADR-4 ve ADR-6 istisnadır).
2. Bölüm 9'daki 18 kapı kanıtlarıyla birlikte yeşil.
3. `git tag v2.2.1` üzerinde `BUILD_INFO.json` temiz commit'i gösteriyor ve installer imzalanmış.
