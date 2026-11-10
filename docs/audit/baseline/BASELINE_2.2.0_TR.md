# Baseline Raporu — 2.2.0 (audit-baseline-2.2.0)

Bu dosya, P0-01 kapsamında denetim öncesi durumu sabitlemek için alınmıştır.
Etiket: `audit-baseline-2.2.0` → commit `c9a5b7e`.

## Sürüm ve araç zinciri

| Öğe | Değer |
| --- | --- |
| Sürüm | 2.2.0 |
| Node | 22 (CI hedefi) |
| TypeScript | 5.7.3 |
| Vite | 6.x |
| Vitest | 3.x |
| Rust | stable (edition 2021) |

## Test sayıları (denetim öncesi)

| Paket | Sonuç |
| --- | --- |
| Vitest | 8 dosya / 77 test — yeşil |
| Cargo lib testleri | 111 test — yeşil |
| Cargo entegrasyon testleri | `recycle_failure_no_fallback`, `secret_persistence`, `crash_during_delete`, `git_unavailable` — yeşil; benchmark ve gerçek geri dönüşüm kutusu testleri `ignored` |

## Üretim paketi (dist/, denetim öncesi)

| Dosya | Boyut |
| --- | --- |
| `index-*.js` | 6.287,47 kB (gzip 1.512,54 kB) |
| `locales-bundle-*.js` | 3.366,83 kB (gzip 925,20 kB) |
| `vendor-core-*.js` | 226,04 kB |
| `index-*.css` | 129,33 kB |
| `ConceptContainer-*.js` | 31,91 kB |
| `ConceptContainer-*.css` | 11,32 kB |
| `vendor-ui-*.js` | 22,48 kB |
| `vendor-*.js` | 19,81 kB |
| **Toplam** | **~9,63 MB / 8 dosya + concept chunk'ları** |

## Bilinen açıklar (özet)

42 bulgu; en yüksek riskliler:

1. MCP `devcleaner_execute_cleanup` tek kapı ile korunuyordu (yalnızca token).
2. CLI `--scope caches|all` yanlış `ScanScope` varyantına eşleniyordu.
3. Webhook testi CSP tarafından sessizce engellenen `fetch` kullanıyordu.
4. Mock/demo katmanı üretim paketine giriyordu (`ConceptContainer`, demo API).
5. Path guard yalnızca ilk bileşene bakıyordu (Y-9).

Ayrıntılar: `docs/audit/PRE_DEPLOYMENT_QA_AUDIT_TR.md`,
`docs/audit/REMEDIATION_PLAN_TR.md`.
