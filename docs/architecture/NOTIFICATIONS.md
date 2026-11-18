# Bildirim Mimarisi — 2.2.2

Bu belge, ön dağıtım denetimindeki **B6-04** maddesinin ("WebView2 bildirim
desteğini doğrula, desteklenmiyorsa geri düşüş kararı ver") kanıt kaydıdır.
2.2.2 itibarıyla masaüstü bildirimleri **yerel Windows toast** olarak gönderilir.

## Özet karar

| Soru | Yanıt |
|---|---|
| WebView2 `new Notification()` çağrısını kendisi gösteriyor mu? | **Hayır** |
| Tauri/wry `NotificationReceived` olayını işliyor mu? | **Hayır** (0 eşleşme) |
| 2.2.1'de ne yapıldı? | Masaüstü kanalı, kabuk içinde **uygulama içi toast'a düşer** |
| 2.2.2'de ne yapıldı? | `tauri-plugin-notification` ile **yerel Windows toast** |

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

## 2.2.2'deki davranış

`notificationService` iki yeteneği ayırır. Kabuk içinde yerel plugin, tarayıcı
önizlemesinde ise Web Notification API kullanılır:

```ts
private canShowDesktop(): boolean {
  if (typeof window === "undefined") return false;
  if (isTauriEnvironment()) return true; // tauri-plugin-notification
  return "Notification" in window;
}
```

`dispatch()` bu değeri kullanır:

| Kanal | Tarayıcı önizleme | Tauri kabuğu (Windows) |
|---|---|---|
| `both` | OS bildirimi + toast | yerel toast + uygulama içi toast |
| `desktop` | OS bildirimi | yerel toast |
| `in_app` | toast | toast |
| `none` | — | — |

Yerel toast, `@tauri-apps/plugin-notification` üzerinden
`sendNotification({ title, body })` ile gönderilir. İzin akışı
`isPermissionGranted()` / `requestPermission()` ile yürür ve
`notification:default` capability'si `src-tauri/capabilities/default.json`
içinde tanımlıdır. Rust tarafında plugin `src-tauri/src/lib.rs` içinde kayıtlıdır
(`tauri-plugin-notification = "=2.3.0"`).

> Not: Windows toast'ları, uygulama paketlenip Başlat menüsü kısayolu
> oluşturulduktan sonra uygulama adı ve simgesiyle görünür. `tauri dev`
> çalıştırılırken Windows, PowerShell adını/simgesini gösterebilir; bu bir hata
> değil, geliştirme kabuğunun AUMID kısıtıdır.

Bu davranış `src/test/notification-service.test.ts` içinde doğrulanır: kanal
matrisi, izin reddi, webhook hata kanalı, dil değişimi ve kabuk içinde yerel
plugin çağrısı.

## Uygulama notları

1. **Gösterim:** `tauri-plugin-notification` v2.3.0 (Rust) +
   `@tauri-apps/plugin-notification` 2.3.0 (JS). WebView2 `new Notification()`
   yolundan vazgeçildi.
2. **Kimlik:** Paketlenmiş uygulamada toast, Başlat menüsü kısayolundaki
   AppUserModelID üzerinden görünür. NSIS/WiX kısayolları
   `com.vellium.devcleaner` AUMID'ini kullanır.
3. **Doğrulama:** Toast gönderildikten sonra
   `HKCU\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\<AUMID>`
   anahtarının oluşması otomatik kapı olarak kullanılabilir.
4. **Geri düşüş:** Yerel plugin yüklenemez veya izin verilmezse `dispatch()`
   uygulama içi toast'ı gösterir; masaüstü seçimi sessiz bir kayba dönüşmez.
