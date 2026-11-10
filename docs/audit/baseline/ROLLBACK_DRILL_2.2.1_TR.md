# Rollback Tatbikatı — 2.2.1 (E1-05)

**Durum:** `PASS` — iki senaryo ayrı ayrı gerçek release derlemesinde uygulandı.

## Amaç

Planın §10 geri alma matrisindeki en riskli iki değişikliğin (PR-2 güvenlik
kapıları, PR-4 entegrasyon) geri alınması durumunda uygulamanın açılmaya,
taramanın çalışmaya devam ettiğini kanıtlamak.

| PR | Kapsam (plan §5.2) | Bu tatbikatta geri alınan |
|---|---|---|
| PR-2 | B1, B10, B11, B8 — Rust güvenlik ve sınırlar | MCP yıkıcı işlem ayar kapısı (`mcp_allow_destructive`) |
| PR-4 | B3, B6, B7 — entegrasyon (webhook, bildirim, CLI) | `test_webhook` Tauri komutu (`invoke_handler` kaydı) |

## Yöntem

Her senaryo için:

1. Tek satırlık geri alma düzenlemesi yapılır (aşağıdaki diff).
2. `cargo build --release` çalıştırılır.
3. Release binary 8 saniye başlatılır; erken çıkış var mı bakılır.
4. CLI `--version` ve gerçek bir klasörde `scan --scope projects --json`
   çalıştırılır, hedef bulunuyor mu bakılır.
5. `git checkout -- <dosya>` ile kaynak geri alınır, ağaç temiz doğrulanır.

Her senaryo izole `APPDATA` ile çalıştırıldı; kullanıcı ayarlarına dokunulmadı.

## R-01 — PR-4: webhook komutu kaldırıldı

```diff
             get_build_info,
-            test_webhook,
+            // ROLLBACK DRILL PR-4: webhook integration command removed.
             get_last_scan,
```

| Kontrol | Beklenen | Ölçüm | Sonuç |
|---|---|---|---|
| Release derlemesi | Başarılı | `Finished release profile` | **PASS** |
| Uygulama açılıyor | 8 sn ayakta | `gui_alive=True` | **PASS** |
| CLI çalışıyor | `2.2.1` | `Dev Cleaner — Version 2.2.1` | **PASS** |
| Tarama çalışıyor | Hedef bulunur | `scan_exit=0 found_target=True` | **PASS** |
| Kaynak geri alındı | Ağaç temiz | `git status` boş, `test_webhook` `invoke_handler` içinde | **PASS** |

Sonuç: webhook komutu olmadan uygulama ve tarama tam çalışır; entegrasyon geri
alınabilir bir katmandır.

## R-02 — PR-2: MCP yıkıcı işlem kapısı devre dışı

```diff
         let state = AppState::new();
         let settings = state.settings.load();
-        if !settings.mcp_allow_destructive {
-            return t("Blocked: MCP destructive actions are disabled in Settings → Automation.");
-        }
+        // ROLLBACK DRILL PR-2: settings safety gate disabled.
+        let _ = &settings;
```

| Kontrol | Beklenen | Ölçüm | Sonuç |
|---|---|---|---|
| Release derlemesi | Başarılı | `Finished release profile` | **PASS** |
| Uygulama açılıyor | 8 sn ayakta | `gui_alive=True` | **PASS** |
| CLI çalışıyor | `2.2.1` | `Dev Cleaner — Version 2.2.1` | **PASS** |
| Tarama çalışıyor | Hedef bulunur | `scan_exit=0 found_target=True` | **PASS** |
| Kaynak geri alındı | Ağaç temiz | `git status` boş, kapı `mcp/mod.rs` içinde | **PASS** |

Sonuç: güvenlik kapısı kaldırıldığında da uygulama açılır — yani kapı bir
başlatma bağımlılığı değil, yalnızca yıkıcı MCP eylemini durduran bir kontrol.
Bu, kapının geri alınabilirliğini ve yalıtımını kanıtlar.

## Sonuç

| Senaryo | Geri alma başarılı | Uygulama açılıyor | Veri kaybı | Not |
|---|---|---|---|---|
| R-01 (PR-4) | Evet | Evet | Yok | Tarama + CLI sağlam |
| R-02 (PR-2) | Evet | Evet | Yok | Kapı yalıtılmış |

Tatbikat sonrası ağaç `git status --porcelain` çıktısı boştur; tatbikat için
yapılan düzenlemelerin hiçbiri commit'e girmedi.
