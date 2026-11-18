# Kod Denetim Raporu — Dev Cleaner / Node Cleaner 2.2.2

**Tarih:** 2026-11-13
**Kapsam:** `src/` (React/TS), `src-tauri/src` (Rust), CLI, MCP, paketleme betikleri.
**Yöntem:** Tüm ana akışların kod okuması + çapraz çağrı doğrulaması.
**Doğrulama durumu (denetim anı):** `npm run typecheck` temiz, 139 frontend testi geçti,
137 Rust birim testi + entegrasyon testleri geçti, i18n denetimleri (98.858 string) temiz.
Yani aşağıdaki bulgular **testlerin kapsamadığı** alanlarda.

> Bu raporun kalıcı düzeltme planı: `docs/audit/2026-11-13-kalici-duzeltme-plani.md`.
> Önceki 12 maddelik rapor (`2026-11-13-audit-report.md`) maddelerinin çoğu kapalıdır;
> M1 (proje tarafı) ve M3 (backend normalize) bu raporda yeniden ele alınmıştır.

---

## 🔴 Yüksek önem (4)

### H1 — Uygulama açmak, çalışan MCP sunucusunu / CLI taramasını öldürüyor
`src-tauri/src/main.rs:8-10`, `src-tauri/src/platform/windows/instance_guard.rs:57-72, 105-118`

`preflight_cleanup_zombies()` CLI/MCP dağıtımından **önce ve koşulsuz** çağrılıyor.
Görünür pencere kontrolü yalnızca `IsWindowVisible`; penceresi olmayan her aynı-adlı
süreç `TerminateProcess` ile öldürülüyor.

**Kullanıcı ne yaşıyor:** GUI'yi açmak, o sırada çalışan `dev-cleaner mcp` stdio sunucusunu
veya süren bir CLI taramasını aniden sonlandırıyor. Tepsiye gizlenmiş GUI (`hide_to_tray`)
ikinci açılışta "zombie" sayılıp öldürülüyor — tek örnek davranışı bozuluyor. Yani yarım
kalan bir temizlik/tarama sessizce kesiliyor.

**Kök neden:** "Pencere yok = zombie" varsayımı; süreç kimliği (MCP/CLI/GUI) ayrımı yok.

---

### H2 — MCP `devcleaner_clean_cache` tüm yıkıcı güvenlik kapılarını atlıyor
`src-tauri/src/mcp/mod.rs:171-179` (koşulsuz kayıt), `:451-509` (doğrudan preview+execute),
karşılaştırma `:728-762`

`devcleaner_execute_cleanup` için `confirm:true` + `--allow-destructive` + tek kullanımlık
token + `settings.mcp_allow_destructive` kontrol edilirken, `clean_cache` bunların
**hiçbirini** yapmıyor; `preview_action` → `execute_action` zincirini doğrudan çalıştırıyor.

**Kullanıcı ne yaşıyor:** Ajan tek çağrıyla npm/pip/cargo cache'ini onay almadan siliyor.
Kullanıcı Ayarlar → Otomasyon → "MCP yıkıcı işlem" kapalı olsa bile silme gerçekleşiyor —
ayar yalan söylüyor.

**Kök neden:** Araç tanımı `allow_destructive` koşulunun dışında; `clean_cache` kendi
güvenlik kontrolünü içermiyor.

---

### H3 — MCP `scan_workspace` ve CLI `scan` her şeyi **0 B** gösteriyor; `--min-size` / `--auto-clean` işlevsiz
`src-tauri/src/mcp/mod.rs:318-343, 511-592`, `src-tauri/src/cli/mod.rs:519-566`,
`src-tauri/src/scanner/discovery.rs:340-342`, `src-tauri/src/cleanup/plan.rs:265-276`

Her iki yol da yalnızca `DiscoveryEngine` kullanıyor; ölçüm yapılmıyor, dolayısıyla
`logical_bytes/estimated_reclaim_bytes = None` kalıyor. Sonra:

```rust
.filter(|it| it.estimated_reclaim_bytes.unwrap_or(0) >= min_bytes)   // min>0 → hep boş
let bytes = item.estimated_reclaim_bytes.unwrap_or(0);               // → 0 B
let size_match = bytes >= min_bytes;                                 // → false
```

Ayrıca `plan.rs` ölçülmemiş hedefi `NOT_MEASURED` ile blokluyor.

**Kullanıcı ne yaşıyor:**
- `devcleaner_scan_workspace` → `total_reclaimable_bytes: 0`, tüm satırlar `"0 B"`,
  `min_size_mb>0` verilince sıfır hedef. Aynı hedefler `devcleaner_preview_cleanup`
  içinde gerçek boyutlarla çıkıyor → araç kendi kendisiyle çelişiyor.
- `dev-cleaner scan --auto-clean` hiçbir şey silmiyor; `--min-size 10` ile hiçbir hedef eşleşmiyor.
- `scope` parametresi MCP'de tamamen yok sayılıyor (`let _ = scope;`) → `agents`/`caches`/`all`
  aynı davranıyor.

**Etki:** CLI ve MCP otomasyonu pratikte kullanılamaz durumda; "temizlenecek alan 0 B"
yanıltıcı sonucu.

---

### H4 — Kullanıcının korumalı klasörü hedefin *içindeyse* siliniyor (veri kaybı)
`src-tauri/src/safety/path_guard.rs:220-234`

```rust
if key == protected_key || is_within(key, &protected_key) { ... reddet }
```

`is_within(child, root)` tek yönlü: yalnızca "hedef, korumalı yolun altında mı?" sorusunu
soruyor. "Korumalı yol, hedefin altında mı?" kontrol edilmiyor.

**Kullanıcı ne yaşıyor:** `D:\proj\.venv\keep` korumalı işaretliyken `.venv` temizlenirse
korumalı `keep` klasörü de geri dönüşüm kutusuna gidiyor. Alt ağaç silmelerinde koruma
sözü tutulmuyor.

**Öneri yönü:** Alt ağaç silmede `is_within(&protected_key, key)` de reddedilmeli.

---

## 🟠 Orta önem (10)

| # | Bulgu | Konum | Kullanıcı etkisi |
|---|---|---|---|
| M1 | **Min. öğe boyutu proje taramasında uygulanmıyor** | `scanner/discovery.rs` (hiç kullanılmıyor), `scanner/mod.rs:177`, `ItemTable.tsx:132-136` | Tablo 50 MB filtresiyle boş görünürken Overview/KPI toplamları ve sağlayıcı toplamları küçük hedefleri de içeriyor → iki ekran çelişiyor. Ajan kapsamında doğru, proje kapsamında değil. |
| M2 | **Agents kartlarındaki "Temizlenebilir" toplamı yanlış** | `features/agents/AgentsView.tsx:192-193` vs `:299`, Rust `scanner/mod.rs:73` | Kart istatistiği yalnızca `item.protected` bakıyor; sayfa toplamı `protected \|\| keep \|\| !selectable` bakıyor. Kartların toplamı üstteki toplamdan büyük çıkıyor; kullanıcı temizleyemeyeceği veriyi temizlenebilir sanıyor. |
| M3 | **Dokümanlar her dilde İngilizce açılıyor; Türkçe içerik ölü kod** | `features/docs/DocsView.tsx:256, 274`; `DocsContentTr.tsx` hiç import edilmiyor | Türkçe seçiliyken bile gövde İngilizce + "yalnızca İngilizce" uyarısı. Oysa tam Türkçe doküman bileşeni projede duruyor. 73 dil vaadiyle çelişen görünür eksik. |
| M4 | **Sıfırlama/konum değişikliği sonrası hayalet "önceki tarama" karşılaştırması** | `stores/scan-store.ts:541-559` (`resetScan`), `:352-354`, `OverviewView.tsx:205, 294` | `resetScan` `previousSummary/previousCleanableBytes/previousItemCount` alanlarını temizlemiyor. Yeni taramada var olmayan eski taramaya göre anlamsız artış/azalış rozeti görünüyor. |
| M5 | **CLI hata durumunda çıkış kodu 0** | `cli/mod.rs:68-71, 76-88, 665-693` | `clean_errors` doldurulsa da `Ok(())` dönülüyor; belgelenen "2 = cleanup failure" hiç üretilmiyor. CI/otomasyon başarısız temizliği başarı sanıyor. `caches --clean` her durumda 0. |
| M6 | **Recycle Bin temizliğinde `reclaimed_bytes` 0** | `cleanup/coordinator.rs:396-400` | `reclaim_bytes` yalnızca `Permanent` modda dolduruluyor; MCP/CLI her zaman `RecycleBin` kullandığı için GB'larca veri taşınsa da "Reclaimed: 0 B". (GUI `moved_bytes` ile telafi ediyor, MCP/CLI etmiyor.) |
| M7 | **Ölçüm hatası "0 B" olarak görünüyor (proje tarafı)** | `scanner/measurement.rs:225-233`, `scanner/mod.rs:460-476` | M1 düzeltmesi ajan dalında yapılmış; proje dalında `None → logical_bytes: 0, status: Error`. Okunamayan hedef boş klasör gibi görünüp toplamlara 0 olarak giriyor. |
| M8 | **Geri dönüşüm doğrulaması 1 saniyeye sıkışmış → yanlış "başarısız"** | `cleanup/recycle_bin.rs:41-58` (20 × 50 ms) | Büyük ağaçta shell handle'ı geç bırakınca işlem başarılı olduğu halde `VERIFY_FAILED` / "failed" raporlanıyor; geçmiş kaydı hatalı. |
| M9 | **Cache sayfası ilk açılışta donabilir** | `cleanup/official_actions.rs:745`, `:663` (10 sn timeout) | "Hızlı" denilen `list_cache_providers()` her sağlayıcı için senkron `tool_version()` çağırıyor; yavaş shim'lerde (npx/conda) toplam süre dakikalara çıkabiliyor. |
| M10 | **CLI `--scope caches` sessiz "başarılı boş tarama"** | `cli/mod.rs:104-108, 519-545` vs `scanner/mod.rs:182-193` | GUI aynı kapsam için açık hata verirken CLI "0 target" diyor; kullanıcı "temizlenecek bir şey yok" sanıyor. |

---

## 🟡 Düşük önem (15)

| # | Bulgu | Konum | Etki |
|---|---|---|---|
| L1 | Cache metadata yenilemesi silinmiş yolların eski boyutunu koruyor | `stores/cache-store.ts:48-66, 122` | Bir cache klasörü yok olmasına rağmen eski boyut gösterilebiliyor; süren ölçüm sırasında `startMeasure` sessizce atlanıyor. |
| L2 | Sıfırlama sonrası "Son taramayı geri yükle" yarışı | `scan-store.ts:280-291, 553-554`, `OverviewView.tsx:57-70` | `clearPersistedLastScan` asenkron; IPC hızına göre buton etkin kalıp "son tarama yok" hatası verebilir. |
| L3 | `Checkbox` indeterminate durumu AT'ye yansımıyor | `components/primitives/Checkbox.tsx:28-43` | "Tümünü seç" görsel olarak yarım ama ekran okuyucu "işaretli değil" diyor (`el.indeterminate` / `aria-checked="mixed"` yok). |
| L4 | `NumberField` 0 değerinde eski değeri okuyor | `components/primitives/NumberField.tsx:74` | `Number(draft) \|\| value` → 0 falsy; min. boyut 0 iken AT eski değeri duyuruyor. |
| L5 | Webhook olay eşleşmesi fail-open | `commands/webhook_commands.rs:106-110` | Bilinmeyen olay adı kullanıcı toggle'larını atlayıp gönderiliyor (`_ => true`). |
| L6 | CLI `caches --clean all` onaysız/ayarsız | `cli/mod.rs:223-277` | Tespit edilen tüm sağlayıcıların tüm action'ları tek komutla; `--dry-run`, `allow_cache_cleanup` veya onay yok. |
| L7 | CLI ile backend webhook olay adları uyuşmuyor | `cli/mod.rs:774-781` vs `webhook_commands.rs:106-110` | CLI `cleanup_completed/scan_completed`, backend `clean/scan` bekliyor → filtreler tutmuyor. |
| L8 | `clear_cleanup_history` her şeyi siliyor | `commands/history_commands.rs:59-63` | Adı "temizlik geçmişi" ama `clear_all_history` çağırıp tarama geçmişini de siliyor. |
| L9 | Explorer "dosyayı göster" virgüllü yolda bozuluyor | `commands/scan_commands.rs:195-198` | `/select,{path}` biçiminde virgül içeren yol yanlış ayrıştırılıyor. |
| L10 | MCP tarama oturumları hiç temizlenmiyor | `mcp/mod.rs:44-55, 569-575` | Uzun ömürlü sunucuda `scans` map'i sınırsız büyüyor; ayrıca `scan_id` yoksa yanlış kapsam/path ile yeniden tarıyor. |
| L11 | Snapshot yazma hataları sessizce yutuluyor | `scanner/mod.rs:233-235` | `let _ = append_snapshots(...)`; disk dolu/DB hatasında kullanıcı geçmişin yazılmadığını öğrenmiyor. |
| L12 | Bozuk kayıtlı webhook sessizce siliniyor | `stores/preferences-store.ts:509` | Geçersiz URL `null`'a çevriliyor, uyarı yok; sonraki kayıtta kalıcı kayboluyor. |
| L13 | `save_app_settings` normalize edilmiş değeri döndürmüyor | `commands/settings_commands.rs:13-22` | M3'ün backend yarısı: yalnızca `Ok(())`. Frontend aynı sınırları kendisi uyguladığı için bugün kullanıcıya yansımıyor; başka istemci/ileri değişiklikte sessiz sapma riski. |
| L14 | `.cmd/.bat` çağrısında boşluklu yol | `cleanup/official_actions.rs:590-605` | `cmd /C <exe>` yol tırnaksız geçiyor; `C:\Program Files\nodejs\npm.cmd` gibi yollarda resmi cache temizliği başarısız olabilir. |
| L15 | `release_output/` mevcut düzeltmeleri içermiyor | `release_output/BUILD_INFO.json` | Artefaktlar `239d168` commit'inden, `dirty:false` ile üretilmiş; çalışma ağacındaki 200+ değişiklik (bu denetim düzeltmeleri dahil) paketlerde yok. Yeni sürüm yayınlanmadan önce yeniden derleme şart. |

---

## ✅ Şüpheli görünüp doğru bulunanlar

1. **Plan tek kullanımlığı** — `consume_plan` planı map'ten çıkarıyor; aynı `plan_id`
   ikinci kez çalıştırılamıyor (`scanner/session.rs:148`, `deletion_commands.rs:108`).
2. **Recycle Bin fail-closed** — kalıcı silmeye sessiz fallback yok; shell hatasında hata
   dönüyor (yalnızca M8'deki doğrulama bütçesi sorunlu).
3. **`normalize_key` + `is_within` bileşen bazlı** — `C:\foo` ↔ `C:\foobar` karışmıyor,
   `\\?\`/UNC normalize ediliyor. (Tek eksik H4'teki ters yön.)
4. **`Switch` klavye çift-tetikleme yapmıyor** — `preventDefault()` native aktivasyonu iptal
   ediyor; Chromium/WebView2'de Enter/Space tek toggle üretiyor.
5. **`recomputeSummary` backend ile aynı kuralları kullanıyor** — `protected || !selectable`,
   `allocatedBytes`; `markDeleted` sonrası KPI'lar şişmiyor.
6. **Temizleme ilerleme yüzdesi tutarlı** — 1-tabanlı `index` doğrudan `processed`'a yazılıyor.

## Kapsam dışı / kullanıcıya yansımayanlar

- `src/lib/tauri/scanner-api.mock.ts:396,410,498-503` — sahte modda kalıcı silme sonucu
  "recycleBin" ve sabit `item-1` dönüyor, cache ölçümü no-op. Yalnızca tarayıcı önizlemesi/test;
  üretim derlemesinde import edilmiyor.
- `Mutex::lock().unwrap()` panik riski (`scanner/mod.rs:214`) — tetikleyici senaryo kanıtlanmadı.

## Öncelik sırası

1. **H1** (çalışan işlemi öldürme) → **H4** (korunan veri kaybı) → **H2** (onaysız silme)
2. **H3** (CLI/MCP tamamen işlevsiz)
3. **M1/M2/M4/M7** (kullanıcının gördüğü sayı tutarsızlıkları)
4. **M5/M6** (otomasyon sözleşmesi: exit code ve taşınan bayt)
5. **M8/M9** (yanlış "başarısız" ve donma algısı)
6. M3/M10 ve tüm Düşük maddeler
