# Installer Doğrulama Raporu — 2.2.1 (E1-04)

**Durum:** `BEKLİYOR` — `npm run build:release` ve temiz Windows makine/VM gerektirir.

## Amaç

NSIS ve MSI paketlerinin temiz kurulum, yükseltme ve kaldırma davranışını doğrulamak.

## Ön koşullar

1. Çalışma ağacı temiz (`git status --porcelain` boş).
2. `npm run check-version` → 2.2.1, üç dosya eşit.
3. `npm run typecheck`, `npm test`, `cargo test`, `clippy`, `fmt` yeşil (bkz. üretim kapısı 1–9).
4. `npm run build:release` tamamlanır; `release_output/` içinde NSIS `.exe`, MSI `.msi` ve
   `BUILD_INFO.json` oluşur.

## Test matrisi

| # | Senaryo | Beklenen | Sonuç |
|---|---|---|---|
| I-01 | Temiz makinede NSIS kurulumu | Kurulum tamamlanır, kısayol oluşur, uygulama açılır | ☐ |
| I-02 | Temiz makinede MSI kurulumu | Kurulum tamamlanır, uygulama açılır | ☐ |
| I-03 | 2.2.0 → 2.2.1 yükseltme (NSIS) | Ayarlar korunur, sürüm 2.2.1 görünür | ☐ |
| I-04 | 2.2.0 → 2.2.1 yükseltme (MSI) | Ayarlar korunur, sürüm 2.2.1 görünür | ☐ |
| I-05 | NSIS kaldırma | Program dosyaları, kısayollar ve kayıt defteri girdileri temizlenir | ☐ |
| I-06 | MSI kaldırma | Aynı; `%APPDATA%\dev-cleaner` kullanıcı verisi korunur | ☐ |
| I-07 | Kaldırma sonrası yeniden kurulum | Temiz kurulum gibi çalışır, artık dosya kalmaz | ☐ |
| I-08 | İmza/akıllı ekran | Yayın imzası geçerli; SmartScreen sertifika uyarısı yok | ☐ |

## Kanıt

- `release_output/BUILD_INFO.json` içeriği (commit, dirty, artefakt sha256).
- Her senaryo için ekran görüntüsü veya komut çıktısı.
- Kaldırma sonrası `Get-ChildItem "$env:LOCALAPPDATA\Programs"`, `%APPDATA%\dev-cleaner`
  ve `Get-ItemProperty HKLM:\...\Uninstall\*` kontrol çıktısı.

## Sonuç

| Paket | Boyut | SHA-256 (BUILD_INFO) | Kurulum | Kaldırma |
|---|---|---|---|---|
| NSIS | | | ☐ | ☐ |
| MSI | | | ☐ | ☐ |

**İmza:** ____________________  **Tarih:** __________
