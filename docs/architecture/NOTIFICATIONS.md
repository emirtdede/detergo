# Bildirim Mimarisi — 2.2.1

Bu belge, ön dağıtım denetimindeki **B6-04** maddesinin ("WebView2 bildirim
desteğini doğrula, desteklenmiyorsa geri düşüş kararı ver") kanıt kaydıdır.

## Özet karar

| Soru | Yanıt |
|---|---|
| WebView2 `new Notification()` çağrısını kendisi gösteriyor mu? | **Hayır** |
| Tauri/wry `NotificationReceived` olayını işliyor mu? | **Hayır** (0 eşleşme) |
| 2.2.1'de ne yapıldı? | Masaüstü kanalı, kabuk içinde **uygulama içi toast'a düşer** |
| Kalıcı çözüm | 2.3: yerel Windows toast + AUMID kaydı |

## Kanıt

1. **Microsoft dokümanı** — `ICoreWebView2_24::add_NotificationReceived`:
   > "Add an event handler for the `NotificationReceived` event for
   > non-persistent notifications."
   > "If a deferral is not taken on the event args, the subsequent scripts after
   > the DOM notification creation call (i.e. `Notification()`) are blocked until
   > the event handler returns."

   Yani sayfa `new Notification()` çağırdığında WebView2 *mesajı barındırıcıya
   devreder*; toast'u çizen barındırıcıdır. Barındırıcı bir işleyici kaydetmezse
   hiçbir şey görünmez.

2. **wry 0.55.1 kaynak taraması** — `~/.cargo/registry/src/*/wry-0.55.1`
   ağacında `Notification` içeren **tek bir eşleşme yok**. `webview2-com`
   bağlayıcılarında `NotificationReceived` tanımı var, ancak wry bu olaya abone
   olmuyor. Dolayısıyla Tauri uygulamasında `new Notification()` sessiz bir
   no-op'tur.

3. **Kapı gözlemi** — 2.2.1 smoke tatbikatında Ayarlar → Bildirimler →
   "Masaüstü testi" düğmesi işlevsel bir bildirim üretmiyordu; sorun uygulama
   mantığında değil, kabuk katmanındaydı.

## 2.2.1'deki davranış

`notificationService` iki yeteneği ayırır:

```ts
private canShowDesktop(): boolean {
  if (typeof window === "undefined") return false;
  if ("__TAURI_INTERNALS__" in window) return false; // WebView2: no host handler
  return "Notification" in window;
}
```

`dispatch()` bu değeri kullanır:

| Kanal | Tarayıcı önizleme | Tauri kabuğu (Windows) |
|---|---|---|
| `both` | OS bildirimi + toast | toast |
| `desktop` | OS bildirimi | **toast** (sessiz kayıp yerine geri düşüş) |
| `in_app` | toast | toast |
| `none` | — | — |

Böylece "yalnızca masaüstü" seçen bir kullanıcı hiçbir geri bildirim almadan
kalmaz. Aynı kural "Masaüstü testi" düğmesi için de geçerlidir: kabuk içinde
düğme, uygulama içi toast gösterir.

Bu davranış `src/test/notification-service.test.ts` içinde doğrulanır
(9 test): kanal matrisi, izin reddi, webhook hata kanalı, dil değişimi ve
Tauri kabuğu geri düşüşü.

## 2.3 planı (kapsam dışı, kayıtlı)

Yerel toast için üç parça gerekir:

1. **Gösterim:** `tauri-plugin-notification` veya doğrudan
   `Windows.UI.Notifications` (`windows` crate, `Win32_UI_Notifications`
   özelliği). WebView2 yolundan vazgeçilir.
2. **Kimlik:** paketlenmemiş uygulamada toast, Başlat menüsü kısayoluna yazılmış
   bir **AppUserModelID** ister. NSIS/WiX hook'ları kısayolu
   `com.vellium.devcleaner` AUMID'i ile oluşturmalı.
3. **Doğrulama:** toast gönderildikten sonra
   `HKCU\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\<AUMID>`
   anahtarının oluşması otomatik kapı olarak kullanılabilir; böylece "gözle
   görüldü" demek zorunda kalmadan kanıt üretilir.

Bu üç adım tamamlanana kadar `desktop` kanalı geri düşüşlü kalır.
