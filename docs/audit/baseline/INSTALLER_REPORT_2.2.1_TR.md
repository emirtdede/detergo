# Installer Doğrulama Raporu — 2.2.1 (E1-04)

**Durum:** `PASS` — 8/8 kontrol, gerçek `release_output/` artefaktlarıyla.
**Betik:** `scripts/verify-installer.ps1` (`npm run verify:installer`)

## Amaç

NSIS ve MSI paketlerinin sessiz kurulum, çalışma ve kaldırma davranışını
yükseltme gerektirmeyen bir oturumda doğrulamak; kaldırma sonrası artık
bırakmadığını kanıtlamak.

## Ön koşullar

1. `npm run build:release` tamamlanmış, `release_output/` güncel.
2. Makinede önceden kurulu Dev Cleaner yok (betik varsa `exit 2` ile durur ve
   kullanıcı kurulumuna dokunmaz).
3. MSI için yönetici oturumu gerekmez: paket `ALLUSERS=2 MSIINSTALLPERUSER=1`
   ile kullanıcı kapsamına kurulur.

## Sonuçlar

| # | Senaryo | Beklenen | Sonuç | Ölçüm |
|---|---|---|---|---|
| I-01 | NSIS sessiz kurulum | Exe `%LOCALAPPDATA%\Dev Cleaner` içine gelir | **PASS** | exit 0, `node-cleaner.exe` mevcut |
| I-02 | NSIS sürümü | Kurulu binary 2.2.1 | **PASS** | `Dev Cleaner — Sürüm 2.2.1` |
| I-03 | MSI sessiz kurulum | Ürün kaydı oluşur | **PASS** | exit 0, 1 uninstall girdisi |
| I-04 | MSI sürümü | Kurulu binary 2.2.1 | **PASS** | `Dev Cleaner — Sürüm 2.2.1` |
| I-05 | NSIS sessiz kaldırma | Dosyalar + kayıt temizlenir | **PASS** | dosyalar gitti, kayıt 0, boş klasör RunOnce'a kuyruklandı |
| I-05b | Kuyruklu klasör temizliği | Kuyruk çalışınca klasör silinir | **PASS** | klasör kaldırıldı |
| I-06 | MSI sessiz kaldırma | Ürün kaydı + klasör temizlenir | **PASS** | exit 0, temiz |
| I-07 | Artık kontrolü | Ne klasör ne kayıt girdisi | **PASS** | 0 / 0 |

## Bulunan ve düzeltilen gerçek kusur

İlk çalıştırmada NSIS kaldırması `C:\Users\<user>\AppData\Local\Dev Cleaner`
klasörünü **boş olarak bırakıyordu**. Kök neden: kaldırıcı (`uninstall.exe`)
kendi çalıştığı klasörden silinemez, dolayısıyla şablonun `RMDir "$INSTDIR"`
çağrısı başarısız olur.

Düzeltme (`src-tauri/nsis/hooks.nsh`, `NSIS_HOOK_POSTUNINSTALL`):

```nsis
WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\RunOnce" \
  "DevCleanerRemoveInstallDir" 'cmd.exe /c rmdir /q "$INSTDIR"'
```

Boş klasör bir sonraki oturum açılışında silinir; I-05b bu kuyruğu gerçekten
çalıştırıp doğrular. `rmdir` (yani `/s` olmadan) kullanıldığı için klasör boş
değilse hiçbir şey silinmez — güvenli davranış.

## Artefaktlar

| Paket | Dosya | Boyut |
|---|---|---|
| Portable | `Dev-Cleaner-2.2.1-Portable.exe` | 17,32 MB |
| NSIS | `Dev-Cleaner-2.2.1-x64-Setup.exe` | 5,49 MB |
| MSI | `Dev-Cleaner-2.2.1-x64.msi` | 7,04 MB |

SHA-256 özetleri derleme sonrası üretilen `release_output/SHA256SUMS.txt` ve
`release_output/BUILD_INFO.json` içinde kayıtlıdır; belgeye kopyalanmaz ki iki
kayıt birbirinden ayrışmasın.

## Kapsam notu

- Kod imzalama sertifikası bu derlemede yoktur; SmartScreen ilk çalıştırmada
  "bilinmeyen yayıncı" uyarısı verebilir. Sertifika temini yayın operasyonunun
  ayrı bir adımıdır ve bu kapının parçası değildir.
- 2.2.0 → 2.2.1 yükseltme senaryosu, 2.2.0 kurulumu gerektirdiği için bu
  tatbikata dahil edilmedi; MSI/NSIS sürüm yükseltmesi Tauri'nin ürün kodu
  eşleşmesiyle yapılır ve ayarlar `%APPDATA%\dev-cleaner` altında kurulumdan
  bağımsız durur.
