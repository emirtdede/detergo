# Üretim Kapısı — 2.2.1

Bu belge, `docs/audit/REMEDIATION_PLAN_TR.md` §9'daki 18 maddelik kapının kaydıdır.
`build:release` yalnızca **18 maddenin tamamı PASS** olduğunda çalıştırılabilir.

**Mevcut durum:** 14 PASS, 4 BEKLİYOR (manuel masaüstü / release derlemesi).
Bu haliyle yayın **hazır değildir**; kod tarafı tamam, operasyonel doğrulama açıktır.

| # | Kapı | Durum | Kanıt |
|---|---|---|---|
| 1 | `npm run typecheck` → exit 0 | **PASS** | `tsc --noEmit` exit 0 |
| 2 | `npm test` → tümü yeşil, 0 atlanmış | **PASS** | 10 dosya / 83 test geçti, atlanan yok |
| 3 | `cargo test` → tümü yeşil | **PASS** | 13 test result satırı; 126 lib + entegrasyon testleri geçti, 0 failed |
| 4 | `cargo clippy --all-targets -- -D warnings` | **PASS** | 0 uyarı |
| 5 | `cargo fmt --check` | **PASS** | exit 0 |
| 6 | `npm run build` | **PASS** | Vite derlemesi başarılı |
| 7 | `npm run check-version` → 2.2.1, üç dosya | **PASS** | `package.json`, `Cargo.toml`, `tauri.conf.json` = 2.2.1 |
| 8 | `node scripts/check-audit-invariants.mjs` → 0 ihlal | **PASS** | 5 kural, ihlal yok |
| 9 | `npm run check:i18n` → 0 eksik anahtar | **PASS** | 3 denetim: script, coverage, untranslated |
| 10 | MCP entegrasyon paketi → 12/12 | **PASS** | 14/14: `mcp_flow` 8 + `mcp::tests` 6 |
| 11 | Webhook entegrasyon paketi → 6/6 | **PASS** | `tests/webhook.rs` 6/6 |
| 12 | Path güvenlik matrisi → 12/12 | **PASS** | `safety::path_guard` 12/12 — bkz. `SECURITY_MATRIX_2.2.1_TR.md` |
| 13 | 50k öğe arama ölçümü → baseline'dan yavaş değil | **PASS** | < 250 ms eşiği — bkz. `PERFORMANCE_2.2.1_TR.md` |
| 14 | `dist/` boyutu → baseline'dan büyük değil | **PASS** | 9,59 MB (−46,2 kB) — concept chunk üretimde yok |
| 15 | Manuel smoke (webhook, bildirim, iptal, restore, dil) → imzalı | **BEKLİYOR** | `MANUAL_SMOKE_CHECKLIST_2.2.1_TR.md` imzalanacak |
| 16 | NSIS + MSI temiz kurulum/kaldırma | **BEKLİYOR** | `INSTALLER_REPORT_2.2.1_TR.md` doldurulacak |
| 17 | Rollback tatbikatı (PR-2, PR-4) | **BEKLİYOR** | `ROLLBACK_DRILL_2.2.1_TR.md` doldurulacak |
| 18 | `BUILD_INFO.json` commit = HEAD, `dirty: false` | **BEKLİYOR / FAIL** | Aşağıya bakın |

## 18. madde ayrıntısı

`release_output/BUILD_INFO.json` (yerel, git dışı) hâlâ **2.2.0** derlemesini gösteriyor:

```json
{ "version": "2.2.0", "commit": "c9a5b7e…", "dirty": true }
```

Bu, eski ve kirli bir derlemedir; yayınlanamaz. Yeni kapı bunu doğru şekilde yakalar:

```powershell
npm run check:build-info
# [FAIL] BUILD_INFO version 2.2.0 != package.json 2.2.1.
```

Kapanış koşulu:

1. Tüm değişiklikler commit'lenir (`git status --porcelain` boş).
2. `npm run build:release` çalıştırılır ve `release_output/` yeniden üretilir.
3. `npm run check:build-info` → `Build provenance OK`.

`scripts/check-build-info.mjs` bu üç koşulu (sürüm, commit, `dirty: false`) birlikte
doğrular. CI'ya eklenmez; yalnızca release artefaktı olduğunda anlamlıdır.

## 15–17. maddeler için ön koşullar

- 15: gerçek Windows oturumu, bildirim izni, geri dönüşüm kutusu erişimi.
- 16: `npm run build:release` çıktısı + temiz VM; madde 18 ile aynı derlemeyi kullanmalı.
- 17: `pre-merge-<PR>` etiketleri ve çalışan uygulama.

Bu maddeler CLI'dan kanıtlanamaz; imzalı belgeler tamamlanmadan kapı kapanmaz.
