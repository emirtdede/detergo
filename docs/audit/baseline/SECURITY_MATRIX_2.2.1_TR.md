# Güvenlik Matrisi — 2.2.1 (E1-02)

**Kapsam:** B1 (MCP üç kapı) ve B10 (path guard) iş paketlerinin saldırı yüzeyi.
**Yöntem:** Her senaryo otomatik testle kanıtlanır; komutlar aşağıda verilmiştir.

```powershell
cargo test --manifest-path src-tauri/Cargo.toml safety::path_guard
cargo test --manifest-path src-tauri/Cargo.toml --test mcp_flow
cargo test --manifest-path src-tauri/Cargo.toml mcp::tests
```

**Sonuç:** Path matrisi 12/12, MCP matrisi 9/9 — tümü geçti.

---

## 1. Path güvenlik matrisi (12 senaryo)

Kaynak: `src-tauri/src/safety/path_guard.rs`.

| # | Senaryo | Girdi | Beklenen | Test |
|---|---|---|---|---|
| P-01 | Sürücü kökü | `C:\` | Reddet | `drive_root_is_blocked` |
| P-02 | Windows dizini | `C:\Windows\Temp` | Reddet | `windows_directory_is_blocked` |
| P-03 | Program Files | `C:\Program Files\App\cache` | Reddet | `program_files_is_blocked` |
| P-04 | System32 (başka sürücü) | `D:\Windows\System32\foo` | Reddet | `system32_is_blocked` |
| P-05 | Kullanıcı profili altında gizlenmiş `Windows` bileşeni | `C:\Users\me\AppData\Windows\foo` | Reddet | `system_directory_nested_below_user_profile_is_blocked` |
| P-06 | Kullanıcı profili altında gizlenmiş `ProgramData` | `C:\Users\me\tmp\ProgramData\foo` | Reddet | `programdata_nested_is_blocked` |
| P-07 | Çok sığ yol | `C:\Temp` | Reddet | `shallow_path_is_blocked` |
| P-08 | Geri dönüşüm kutusu | `C:\$Recycle.Bin\S-1-5-21` | Reddet | `recycle_bin_component_is_blocked` |
| P-09 | Sıradan proje `node_modules` | `C:\Code\my-app\node_modules` | İzin ver | `ordinary_project_node_modules_is_allowed` |
| P-10 | Sıradan `target` dizini | `D:\work\proj\target\debug` | İzin ver | `ordinary_target_directory_is_allowed` |
| P-11 | Kullanıcı önbelleği | `C:\Users\me\AppData\Local\npm-cache` | İzin ver | `appdata_cache_is_allowed` |
| P-12 | Adında `Windows` geçen meşru klasör | `C:\Users\me\WindowsApps\cache` | İzin ver | `name_containing_windows_substring_is_allowed` |

**Tasarım notu:** P-12, koruma listesinin alt-dize değil bileşen (`path_components`) bazında
eşleştiğini kanıtlar. Aksi halde `WindowsApps` gibi meşru bir klasör yanlışlıkla engellenirdi.
P-05 ve P-06 ise tersini kanıtlar: korumalı bileşen yolun herhangi bir derinliğinde
görünürse hedef reddedilir.

---

## 2. MCP güvenlik matrisi (9 senaryo)

Kaynak: `src-tauri/tests/mcp_flow.rs` (uçtan uca) ve `src-tauri/src/mcp/mod.rs`
(birim seviyesi protokol testleri).

| # | Senaryo | Beklenen | Test |
|---|---|---|---|
| M-01 | `--allow-destructive` yokken yıkıcı araç listelenmez | Araç listede yok | `destructive_tool_is_hidden_without_flag` |
| M-02 | Bayrak varken yıkıcı araç listelenir | Araç listede var | `destructive_tool_is_listed_with_flag` |
| M-03 | Bayrak olmadan `execute_cleanup` çağrısı token aranmadan reddedilir | `allow-destructive` hatası | `execute_without_flag_is_blocked_before_token_lookup` |
| M-04 | `confirm: true` olmadan execute reddedilir | `confirm` hatası | `execute_requires_confirm_even_with_flag` |
| M-05 | Ayar (`mcp_allow_destructive`) kapalıyken geçerli token yürütülmez | Başarı yok | `preview_execute_replay_and_disabled_setting` |
| M-06 | Token tek kullanımlıktır; aynı grant iki kez çalışmaz | İkinci çağrı başarısız | `preview_execute_replay_and_disabled_setting` |
| M-07 | 5 dakikalık TTL aşılmış grant reddedilir | Süre aşımı | `preview_execute_replay_and_disabled_setting` |
| M-08 | Bilinmeyen araç / sağlayıcı / kapsam panik değil, açık hata üretir | Anlaşılır hata | `unknown_tool_is_reported_not_panicked`, `clean_cache_rejects_unknown_provider`, `scan_rejects_unknown_scope_before_touching_disk` |
| M-09 | Bozuk JSON ve bilinmeyen JSON-RPC metodu protokol hatası döndürür | `parse_error` / `method_not_found` | `malformed_json_returns_parse_error`, `unknown_method_returns_method_not_found` |

### Üç bağımsız kapı (ADR-2)

1. **Süreç kapısı** — MCP sunucusu `--allow-destructive` ile başlatılmadıkça yıkıcı araç
   hiç listelenmez (M-01, M-03).
2. **Ayar kapısı** — `mcp_allow_destructive` varsayılan `false`; süreç bayrağı açık olsa bile
   yürütme reddedilir (M-05).
3. **Token kapısı** — `preview_cleanup` tek kullanımlık, 5 dakika ömürlü, yalnızca önizlemede
   ölçülen hedefleri kapsayan bir grant üretir (M-06, M-07). Başarısız bir yürütme grant'ı
   tüketmez; kullanıcı ayarı düzeltip aynı token'ı kullanabilir.

### Önizleme → yürütme bağı

`devcleaner_scan_workspace` artık bir `scan_id` döndürür ve `ScanSession`'ı
`McpContext.scans` içinde saklar. `preview_cleanup` bu oturumu yeniden kullanır ve yalnızca
seçilen hedefleri ölçer. Tek başına keşif `logical_bytes: None` bırakır; `build_plan` bu
durumu reddeder. Böylece bir ajan, taramadığı bir hedef için yürütme izni üretemez.

---

## 3. Webhook (destekleyici)

ADR-1 gereği webhook testi Rust `reqwest` üzerinden yapılır; JS `fetch` CSP tarafından
zaten engellidir. `src-tauri/tests/webhook.rs` 6 senaryo: boş URL, desteklenmeyen şema,
http/https kabulü, JSON gövde + başarı, 2xx olmayan yanıt, erişilemeyen host.

## 4. Sonuç

Yıkıcı işlem için gereken üç kapı da bağımsız olarak test edilmiştir. Path guard, korumalı
bileşenleri derinlikten bağımsız yakalarken meşru benzer adlı klasörleri yanlışlıkla
engellemez. Açık kalan risk yoktur; yalnızca E1-03/E1-04/E1-05 manuel masaüstü
doğrulamasına bağlıdır.
