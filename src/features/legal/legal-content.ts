/**
 * The legal documents shipped inside the application.
 *
 * They are embedded rather than fetched: the app is local-first and must stay
 * readable offline, and vellium.dev has no hosted legal pages to link to. The
 * English text is authoritative; the Turkish text is an official translation
 * for the primary user base. Any other UI language falls back to English, which
 * is stated in the documents themselves.
 */

import { resolveUiLocale } from "@/lib/ui-locale";
import { APP_VERSION } from "@/lib/app-version";

export type LegalDocId = "eula" | "privacy" | "thirdParty";

export interface LegalClause {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface LegalDocument {
  title: string;
  /** Human-readable revision date shown next to the title. */
  updated: string;
  /** One-sentence purpose shown under the title. */
  summary: string;
  clauses: LegalClause[];
}

export interface LegalDocMeta {
  id: LegalDocId;
  label: string;
  hint: string;
}

const UPDATED_TR = "17 Kasım 2026 (v" + APP_VERSION + ")";
const UPDATED_EN = "17 November 2026 (v" + APP_VERSION + ")";

const TR_DOCUMENTS: Record<LegalDocId, LegalDocument> = {
  eula: {
    title: "Son Kullanıcı Lisans Sözleşmesi",
    updated: UPDATED_TR,
    summary:
      "Dev Cleaner'ı indirerek, kurarak veya kullanarak bu sözleşmenin tamamını kabul etmiş olursunuz.",
    clauses: [
      {
        heading: "1. Taraflar ve kapsam",
        paragraphs: [
          'Bu Son Kullanıcı Lisans Sözleşmesi ("Sözleşme"), Vellium ("Vellium", "biz") ile Dev Cleaner yazılımını kullanan gerçek veya tüzel kişi ("siz", "Kullanıcı") arasında kurulur. Sözleşme; Dev Cleaner\'ın kurulum paketini, yürütülebilir dosyalarını, arayüzünü, yerleşik kataloğunu ve beraberinde sunulan belgeleri (birlikte "Yazılım") kapsar.',
          "Yazılımı kurmadan önce bu Sözleşmeyi okumanız gerekir. Kurulum, çalıştırma veya herhangi bir biçimde kullanım, bu Sözleşmenin tüm hükümlerini kabul ettiğiniz anlamına gelir. Koşulları kabul etmiyorsanız Yazılımı kullanmayın ve kurulu kopyayı kaldırın.",
          "Yazılımı bir kuruluş adına kullanıyorsanız, bu Sözleşmeyi o kuruluş adına kabul etmeye yetkili olduğunuzu beyan edersiniz.",
        ],
      },
      {
        heading: "2. Lisans verilmesi",
        paragraphs: [
          "Vellium, size Yazılımı kişisel ve ticari projelerinizin bakımı amacıyla, sahip olduğunuz veya kullanma yetkiniz bulunan cihazlarda kurmak, çalıştırmak ve kullanmak üzere dünya çapında, münhasır olmayan, devredilemez, alt lisansı verilemez ve geri alınabilir sınırlı bir lisans verir.",
          "Bu lisans, Yazılımın mülkiyetini devretmez; yalnızca kullanım hakkı tanır. Yazılım satılmaz, lisanslanır.",
          "Kurumsal kullanımda, Yazılımı kuran her cihaz için ayrı bir kurulum esas alınır. Yazılımı kendi altyapınızda, kendi çalışanlarınız veya yüklenicileriniz için çalıştırabilirsiniz; üçüncü kişilere hizmet olarak sunamazsınız.",
        ],
      },
      {
        heading: "3. Kullanım sınırlamaları",
        paragraphs: ["Açıkça izin verilen hâller ve emredici hukuk kuralları dışında:"],
        bullets: [
          "Yazılımı kopyalayamaz, satamaz, kiralayamaz, dağıtamaz veya alt lisans veremezsiniz.",
          "Yazılımı tersine mühendislik, kaynak koda dönüştürme veya parçalara ayırma işlemlerine tabi tutamazsınız; ancak yürürlükteki hukukun bu tür kısıtlamalara izin verdiği ölçüde bunu yapabilirsiniz.",
          "Lisans, kopya koruma veya güvenlik denetimlerini kaldıramaz, atlatamaz veya devre dışı bırakamazsınız.",
          "Yazılımı, Vellium'un yazılı izni olmadan Vellium veya Dev Cleaner adını, logosunu ya da markasını taşıyan türev bir ürün oluşturmak için kullanamazsınız.",
          "Yazılımı yasa dışı amaçlarla, üçüncü kişilerin sistemlerine izinsiz erişmek için veya kullanma yetkiniz bulunmayan dosya ve klasörlere işlem yapmak için kullanamazsınız.",
        ],
      },
      {
        heading: "4. Üçüncü taraf bileşenleri ve açık kaynak",
        paragraphs: [
          'Yazılım, açık kaynak lisansları altında dağıtılan üçüncü taraf bileşenler içerir. Bu bileşenlerin listesi ve lisans koşulları, Yazılım içindeki "Üçüncü Taraf Lisanslar" sayfasında yer alır ve Yazılımın ayrılmaz bir parçasıdır.',
          "İlgili açık kaynak lisansları, sizinle ilgili bileşenin hak sahipleri arasında doğrudan haklar doğurur. Bu Sözleşmedeki hiçbir hüküm, size açık kaynak lisanslarının tanıdığı hakları kısıtlamaz veya ortadan kaldırmaz. Açık kaynak lisansı ile bu Sözleşme arasında çelişki bulunması hâlinde, ilgili bileşen bakımından açık kaynak lisansı geçerli olur.",
        ],
      },
      {
        heading: "5. Veri, gizlilik ve telemetri",
        paragraphs: [
          "Yazılım yerel öncelikli (local-first) çalışır. Hesap oluşturmanız gerekmez; kullanım verileri, tarama sonuçları veya temizlik geçmişi Vellium'a gönderilmez, satılmaz veya paylaşılmaz.",
          "Yazılımın verileri nasıl işlediği, hangi dosyaları okuduğu, hangi kayıtları yerel olarak tuttuğu ve tercihlerin nerede saklandığı Gizlilik Politikasında ayrıntılı olarak açıklanmıştır.",
        ],
      },
      {
        heading: "6. Güncellemeler ve değişiklikler",
        paragraphs: [
          "Vellium, Yazılımı zaman zaman güncelleyebilir, özellik ekleyebilir veya kaldırabilir. Güncellemeler, aksi belirtilmedikçe bu Sözleşmeye tabidir. Yazılım, siz güncellemeyi kurmadığınız sürece kendiliğinden güncelleme indirmez.",
          "Vellium, Yazılımın belirli bir sürümünü veya belirli bir özelliğini süresiz olarak sunma yükümlülüğü altında değildir.",
        ],
      },
      {
        heading: "7. Geri bildirim",
        paragraphs: [
          "Yazılım hakkında bize ilettiğiniz hata bildirimleri, öneriler ve geri bildirimler, sizin adınıza herhangi bir yükümlülük doğurmaksızın, Yazılımı geliştirmek amacıyla Vellium tarafından kullanılabilir. Bu geri bildirimlerde kişisel veri veya gizli bilgi paylaşmamanızı öneririz.",
        ],
      },
      {
        heading: "8. Garanti reddi",
        paragraphs: [
          'Yazılım "OLDUĞU GİBİ" ve "MEVCUT OLDUĞU ŞEKİLDE" sunulur. Vellium, yürürlükteki hukukun izin verdiği azami ölçüde; ticari elverişlilik, belirli bir amaca uygunluk, hak ihlali içermeme ve kesintisiz veya hatasız çalışma dâhil olmak üzere açık veya zımni hiçbir garanti vermez.',
          "Yazılım dosya sistemi üzerinde silme işlemleri gerçekleştirir. Silme kararı ve kapsamı her zaman size aittir. Çalışma dizinlerinizi, sürüm kontrol geçmişinizi ve yedeklerinizi düzenli olarak doğrulamak sizin sorumluluğunuzdadır. Yazılım, varsayılan olarak geri dönüşüm kutusu üzerinden siler ve kalıcı silme için ayrıca onay ister.",
        ],
      },
      {
        heading: "9. Sorumluluğun sınırlandırılması",
        paragraphs: [
          "Yürürlükteki hukukun izin verdiği azami ölçüde Vellium; kâr kaybı, veri kaybı, iş kesintisi, itibar kaybı veya dolaylı, arızi, özel ya da cezai zararlar dâhil olmak üzere Yazılımın kullanımından veya kullanılamamasından doğan hiçbir zarardan sorumlu tutulamaz.",
          "Vellium'un bu Sözleşmeden doğan toplam sorumluluğu, her hâlükârda Yazılım için ödediğiniz tutarla sınırlıdır. Yazılım ücretsiz sunulduğunda bu tutar sıfırdır.",
          "Bu sınırlamalar, hukuken sınırlandırılamayan sorumluluk hâlleri ile tüketici mevzuatından doğan ve sözleşmeyle ortadan kaldırılamayan haklarınızı etkilemez.",
        ],
      },
      {
        heading: "10. Fesih",
        paragraphs: [
          "Bu Sözleşme, Yazılımı kullandığınız sürece yürürlükte kalır. Sözleşmeyi dilediğiniz zaman, Yazılımı kaldırarak ve tüm kopyalarını silerek sona erdirebilirsiniz.",
          "Sözleşme hükümlerini ihlal etmeniz hâlinde lisans kendiliğinden ve bildirimsiz olarak sona erer. Bu durumda Yazılımın tüm kopyalarını silmeniz gerekir. Fesih, tahakkuk etmiş yükümlülükleri ve niteliği gereği ayakta kalması gereken hükümleri (sorumluluk sınırlaması, mülkiyet, uygulanacak hukuk dâhil) etkilemez.",
        ],
      },
      {
        heading: "11. Uygulanacak hukuk ve uyuşmazlıklar",
        paragraphs: [
          "Bu Sözleşme, Türkiye Cumhuriyeti hukukuna tabidir; milletlerarası özel hukuk kuralları uygulanmaz. Uyuşmazlıklarda İstanbul (Türkiye) mahkemeleri ve icra daireleri yetkilidir.",
          "Tüketici sıfatını taşıyorsanız, yerleşim yerinizdeki tüketici hakem heyetlerine ve tüketici mahkemelerine başvurma hakkınız saklıdır. Bu madde, emredici tüketici mevzuatından doğan haklarınızı sınırlandırmaz.",
        ],
      },
      {
        heading: "12. Sözleşme değişiklikleri",
        paragraphs: [
          "Vellium bu Sözleşmeyi güncelleyebilir. Önemli değişiklikler, yeni sürümün içinde yayımlanır ve belgenin üst kısmındaki revizyon tarihi güncellenir. Değişiklikten sonra Yazılımı kullanmaya devam etmeniz, güncel metni kabul ettiğiniz anlamına gelir. Metni kabul etmiyorsanız Yazılımı kullanmayı bırakmalısınız.",
        ],
      },
      {
        heading: "13. İletişim",
        paragraphs: [
          "Bu Sözleşmeye ilişkin sorularınız için Vellium'un resmî iletişim kanalı https://vellium.dev/contact adresidir. Yazılım, Vellium tarafından geliştirilir ve yayımlanır.",
        ],
      },
    ],
  },

  privacy: {
    title: "Gizlilik Politikası",
    updated: UPDATED_TR,
    summary:
      "Dev Cleaner verilerinizi cihazınızda tutar. Hesap, telemetri, reklam ve bulut senkronizasyonu yoktur.",
    clauses: [
      {
        heading: "1. Kısa özet",
        paragraphs: [
          "Dev Cleaner yerel öncelikli bir masaüstü uygulamasıdır. Çalışması için hesap açmanız, oturum açmanız veya internet bağlantısı kurmanız gerekmez. Vellium'un işlettiği bir sunucu yoktur; uygulama hiçbir kullanım verisini bize otomatik olarak göndermez.",
          "Bu politika; hangi bilgilerin okunduğunu, nerede saklandığını, ne kadar süre tutulduğunu ve bunlar üzerinde hangi haklara sahip olduğunuzu açıklar. Yürürlükteki sürüm her zaman uygulama içindeki bu sayfadır.",
        ],
      },
      {
        heading: "2. İşlediğimiz veriler",
        paragraphs: [
          "Uygulama aşağıdaki verileri yalnızca temizlik işlevini yerine getirmek için işler:",
        ],
        bullets: [
          "Dosya ve klasör üst verileri: yol, boyut, son değiştirilme zamanı ve kategori. Bu bilgiler taramadan sonra, uygulamayı yeniden açtığınızda son sonuçları gösterebilmek için son taramanın özetiyle birlikte yerel olarak saklanır (bkz. bölüm 3).",
          "Tercihler: tema, dil, tarama limitleri, koruma listeleri ve pencere davranışı.",
          "Temizlik geçmişi: zaman damgası, hedef türü, boyut, sonuç ve hata kodları. Ekranda yolları maskele seçeneği açıkken tam yollar kaydedilmez.",
          "Resmî araç kayıtları: sizin çalıştırdığınız `npm`, `pnpm`, `yarn`, `cargo` gibi komutların çıkış kodu ve süresi.",
        ],
      },
      {
        heading: "3. Verilerin saklandığı yer",
        paragraphs: [
          "Tüm kalıcı veriler kendi bilgisayarınızda, Windows kullanıcı profilinizin içinde tutulur:",
        ],
        bullets: [
          "%APPDATA%\\dev-cleaner\\config.json — uygulama tercihleri.",
          "%APPDATA%\\dev-cleaner\\last-scan.json — son tamamlanan veya iptal edilen taramanın aday listesi (yol, boyut, sınıflandırma) ve özeti. Tek bir anlık görüntü tutulur, geçmiş biriktirilmez; 64 MB sınırı aşılırsa dosya yazılmaz. Bir sonraki tarama dosyanın üzerine yazar; kalıcı olarak kaldırmak için bu dosyayı silebilirsiniz.",
          "%APPDATA%\\dev-cleaner\\history.jsonl — temizlik geçmişi.",
          "%APPDATA%\\dev-cleaner\\snapshots.jsonl ve actions.jsonl — sürücü doluluk anlık görüntüleri ve resmî araç kayıtları.",
          "Windows Geri Dönüşüm Kutusu — varsayılan silme yönteminde taşınan dosyalar.",
        ],
      },
      {
        heading: "4. Dosya sistemi erişimi",
        paragraphs: [
          "Uygulama yalnızca sizin seçtiğiniz veya izin verdiğiniz kök dizinleri tarar. Sistem dizinleri (Windows, Program Files, sürücü kökleri) koruma kurallarıyla taranmaz ve silinemez. Silme işlemi, siz onaylamadan hiçbir zaman başlamaz.",
          "Yazılım hiçbir dosyayı okumadan dışarı aktarmaz; dosya içerikleri analiz edilmez, yüklenmez veya kopyalanmaz. Yalnızca üst veri (boyut, yol, tarih) kullanılır.",
        ],
      },
      {
        heading: "5. Ağ erişimi ve üçüncü taraflar",
        paragraphs: [
          "Uygulama; analiz, telemetri, kilitlenme raporu, reklam veya kimlik doğrulama amacıyla hiçbir ağ isteği göndermez. Vellium'a ait bir analitik veya izleme altyapısı yoktur.",
          "Sizin başlattığınız durumlarda ağ kullanılabilir: resmî araç komutlarını çalıştırdığınızda ilgili araç kendi paket kayıt defterine bağlanabilir; bir bağlantıya tıkladığınızda sayfa varsayılan tarayıcınızda açılır. Bu işlemler ilgili üçüncü tarafın kendi gizlilik politikasına tabidir ve Vellium bu hizmetlere veri sağlamaz.",
        ],
      },
      {
        heading: "6. Hukuki dayanak ve amaç",
        paragraphs: [
          "Kişisel verileriniz, yalnızca sizinle kurduğumuz yazılım kullanım ilişkisini yürütmek (sözleşmenin ifası) ve uygulamanın yerel işlevlerini sağlamak amacıyla işlenir. Veriler Vellium'a aktarılmadığı için Vellium tarafından yürütülen bir sunucu tarafı işleme faaliyeti bulunmamaktadır.",
          "Uygulama; özel nitelikli kişisel veri, sağlık verisi, biyometrik veri veya konum verisi toplamaz.",
        ],
      },
      {
        heading: "7. Saklama süresi ve silme",
        paragraphs: [
          "Veriler siz silene kadar cihazınızda kalır. Ayarlar > Gizlilik bölümünden yerel geçmişi kapatabilir veya geçmişi tek işlemle temizleyebilirsiniz. Uygulamayı kaldırmak, %APPDATA% altındaki veri klasörünü otomatik olarak silmez; kalıcı olarak kaldırmak için bu klasörü de silebilirsiniz.",
          "Geri dönüşüm kutusuna taşınan dosyalar, Windows'un kendi saklama kurallarına tabidir ve geri dönüşüm kutusu boşaltıldığında kalıcı olarak silinir.",
        ],
      },
      {
        heading: "8. Haklarınız",
        paragraphs: [
          "KVKK (6698 sayılı Kanun) ve uygulanabilir olduğu ölçüde GDPR kapsamında; verilerinize erişme, düzeltme, silinmesini isteme ve işlemeye itiraz etme haklarına sahipsiniz. Veriler cihazınızda tutulduğu için bu hakların tamamını doğrudan uygulama üzerinden ve dosya sisteminden kullanabilirsiniz.",
          "Talepleriniz için https://vellium.dev/contact adresini kullanabilirsiniz. Kimlik doğrulaması gerektiren bir sunucu kaydımız bulunmadığından, Vellium'un elinde silinecek bir kullanıcı verisi bulunmamaktadır.",
        ],
      },
      {
        heading: "9. Çocukların gizliliği",
        paragraphs: [
          "Uygulama çocuklara yönelik değildir ve bilerek çocuklardan kişisel veri toplamaz. Zaten hiçbir kullanıcıdan kişisel veri toplanmamaktadır.",
        ],
      },
      {
        heading: "10. Güvenlik",
        paragraphs: [
          "Uygulama, ağ üzerinden veri alışverişi yapmadığı için aktarım sırasında veri sızması riski oluşmaz. Yerel dosyalar Windows kullanıcı profilinizin erişim izinleriyle korunur. Uygulama, yönetici (administrator) yetkisi talep etmez.",
          "Bilgisayarınızı paylaşıyorsanız, %APPDATA% klasöründeki yerel geçmiş dosyalarına diğer kullanıcıların erişebileceğini unutmayın; ekranda yolları maskele seçeneği yalnızca arayüzü etkiler, dosya içeriğini değiştirmez.",
        ],
      },
      {
        heading: "11. Politika değişiklikleri",
        paragraphs: [
          "Bu politika güncellendiğinde revizyon tarihi değişir ve güncel metin uygulama içinde yayımlanır. Veri işleme biçimini önemli ölçüde etkileyen değişiklikler, sürüm notlarında ayrıca belirtilir.",
        ],
      },
      {
        heading: "12. İletişim",
        paragraphs: [
          "Gizlilikle ilgili sorularınız için: https://vellium.dev/contact. Veri sorumlusu Vellium'dur (vellium.dev).",
          "Veri sorumlusunun kimlik ve iletişim bilgileri ile tebligat adresi talebi aynı iletişim kanalı üzerinden iletilebilir; talepler KVKK'nın öngördüğü süre içinde yanıtlanır. Uygulama hesap açmadığı ve veri aktarmadığı için Vellium'un elinde ayrıca bir kullanıcı kaydı bulunmaz.",
        ],
      },
    ],
  },

  thirdParty: {
    title: "Üçüncü Taraf Lisanslar",
    updated: UPDATED_TR,
    summary:
      "Dev Cleaner, açık kaynak topluluğunun ürettiği bileşenler üzerine kuruludur. Bu sayfa kullanılan her bileşeni ve lisansını listeler.",
    clauses: [
      {
        heading: "1. Bu liste nasıl üretilir?",
        paragraphs: [
          "Aşağıdaki liste, yayın derlemesinin gerçek bağımlılık grafiğinden otomatik olarak üretilir: Rust tarafı için `cargo metadata`, arayüz tarafı için kurulu npm ağacı. Yalnızca ikili dosyaya veya pakete gerçekten dâhil edilen bileşenler listelenir; geliştirme sırasında kullanılan ve ürüne girmeyen araçlar (test koşucusu, derleyici, paketleyici) bu listeye dâhil edilmez.",
          "Bileşenlerin adı ve sürümü, lisans koşullarını doğrulamanız için yeterlidir. Her bileşenin tam lisans metni, ilgili paketin kendi dağıtımında (crates.io veya npm) yer alır.",
        ],
      },
      {
        heading: "2. Lisans yükümlülükleri",
        paragraphs: [
          "Kullanılan lisansların tamamı, ticari kapalı kaynak bir uygulamada kullanıma izin verir. Yerine getirdiğimiz başlıca yükümlülükler:",
        ],
        bullets: [
          "MIT, ISC, BSD ve Apache-2.0: telif bildirimlerinin ve lisans metinlerinin korunması. Bildirimler bu sayfada ve paketlenmiş bileşenlerin kendi dosyalarında yer alır.",
          "MPL-2.0 (cssparser, selectors, dtoa-short, option-ext): MPL kapsamındaki dosyalarda yapılan değişikliklerin kaynak kodu erişilebilir olmalıdır. Bu bileşenler değiştirilmeden kullanılmaktadır; değiştirilmiş bir sürüm yayımlanırsa ilgili kaynak da yayımlanacaktır.",
          "Unicode-3.0 (ICU4X bileşenleri): Unicode lisans bildiriminin korunması.",
          "Apache-2.0: varsa NOTICE dosyasının korunması ve patent hükmüne uyum.",
        ],
      },
      {
        heading: "3. Garanti ve sorumluluk",
        paragraphs: [
          "Üçüncü taraf bileşenleri, kendi lisanslarında belirtildiği şekilde \"olduğu gibi\" sunulur. Bileşenlerin yazarları, bu uygulamadaki kullanımlarından doğan zararlardan sorumlu değildir. Bu bileşenlerin listelenmesi, ilgili projelerin Vellium'u veya Dev Cleaner'ı onayladığı anlamına gelmez.",
        ],
      },
      {
        heading: "4. Bildirimler ve iletişim",
        paragraphs: [
          "Bu sayfa Yazılımın her sürümüyle birlikte güncellenir ve o sürümde gerçekten bulunan bileşenleri yansıtır. Bir bileşenin lisansı veya telif bildirimi hakkında sorunuz varsa https://vellium.dev/contact adresinden Vellium'a ulaşabilirsiniz. Geçerli bildirimlerin tam metni her zaman Yazılımın içindeki bu sayfadır.",
        ],
      },
    ],
  },
};

const EN_DOCUMENTS: Record<LegalDocId, LegalDocument> = {
  eula: {
    title: "End User License Agreement",
    updated: UPDATED_EN,
    summary: "By downloading, installing or using Dev Cleaner you accept this agreement in full.",
    clauses: [
      {
        heading: "1. Parties and scope",
        paragraphs: [
          'This End User License Agreement ("Agreement") is entered into between Vellium ("Vellium", "we") and the natural or legal person using the Dev Cleaner software ("you", "User"). The Agreement covers the installer, the executable files, the user interface, the built-in catalog and the accompanying documentation (together, the "Software").',
          "You must read this Agreement before installing the Software. Installing, running or otherwise using the Software means you accept all of its terms. If you do not accept them, do not use the Software and remove any installed copy.",
          "If you use the Software on behalf of an organisation, you represent that you are authorised to accept this Agreement for that organisation.",
        ],
      },
      {
        heading: "2. License grant",
        paragraphs: [
          "Vellium grants you a worldwide, non-exclusive, non-transferable, non-sublicensable and revocable limited license to install, run and use the Software on devices you own or are authorised to use, for the maintenance of your personal and commercial projects.",
          "This license does not transfer ownership of the Software; it grants a right of use only. The Software is licensed, not sold.",
          "In organisational use, each device on which the Software is installed counts as a separate installation. You may run the Software within your own infrastructure for your employees and contractors, but you may not offer it to third parties as a service.",
        ],
      },
      {
        heading: "3. Restrictions",
        paragraphs: ["Except where expressly permitted below or required by mandatory law:"],
        bullets: [
          "You may not copy, sell, rent, distribute or sublicense the Software.",
          "You may not reverse engineer, decompile or disassemble the Software, except to the extent applicable law permits despite this restriction.",
          "You may not remove, bypass or disable license, copy-protection or security checks.",
          "You may not use the Software to create a derivative product bearing the Vellium or Dev Cleaner name, logo or trademarks without written permission from Vellium.",
          "You may not use the Software for unlawful purposes, to gain unauthorised access to third-party systems, or to act on files and folders you are not authorised to modify.",
        ],
      },
      {
        heading: "4. Third-party components and open source",
        paragraphs: [
          'The Software includes third-party components distributed under open-source licenses. Their list and license terms appear on the "Third-Party Licenses" page inside the Software and form an integral part of it.',
          "Those open-source licenses grant you rights directly from the respective copyright holders. Nothing in this Agreement limits or removes the rights granted to you by an open-source license. If an open-source license conflicts with this Agreement, the open-source license prevails for that component.",
        ],
      },
      {
        heading: "5. Data and privacy",
        paragraphs: [
          "The Software is local-first. No account is required, and usage data, scan results and cleanup history are never sent to, sold by or shared with Vellium.",
          "How the Software processes data, which files it reads, what it records locally and where preferences are stored is described in the Privacy Policy.",
        ],
      },
      {
        heading: "6. Updates and changes",
        paragraphs: [
          "Vellium may update the Software and add or remove features from time to time. Updates are subject to this Agreement unless stated otherwise. The Software does not download updates on its own unless you install them.",
          "Vellium is not obliged to provide any particular version or feature indefinitely.",
        ],
      },
      {
        heading: "7. Feedback",
        paragraphs: [
          "Bug reports, suggestions and other feedback you send us may be used by Vellium to improve the Software without any obligation to you. Please do not include personal data or confidential information in such feedback.",
        ],
      },
      {
        heading: "8. Disclaimer of warranty",
        paragraphs: [
          'The Software is provided "AS IS" and "AS AVAILABLE". To the maximum extent permitted by law, Vellium disclaims all express or implied warranties, including merchantability, fitness for a particular purpose, non-infringement and uninterrupted or error-free operation.',
          "The Software performs deletion operations on your file system. The decision to delete, and its scope, is always yours. You are responsible for verifying your working trees, version-control history and backups. By default the Software deletes through the Recycle Bin and asks for separate confirmation before permanent deletion.",
        ],
      },
      {
        heading: "9. Limitation of liability",
        paragraphs: [
          "To the maximum extent permitted by law, Vellium shall not be liable for any loss of profits, loss of data, business interruption, loss of goodwill, or any indirect, incidental, special or punitive damages arising out of or relating to the use of, or inability to use, the Software.",
          "Vellium's total aggregate liability under this Agreement shall in all cases be limited to the amount you paid for the Software. Where the Software is provided free of charge, that amount is zero.",
          "These limitations do not apply to liability that cannot be limited by law, nor do they affect statutory consumer rights that cannot be waived by contract.",
        ],
      },
      {
        heading: "10. Termination",
        paragraphs: [
          "This Agreement remains in force for as long as you use the Software. You may terminate it at any time by uninstalling the Software and deleting all copies.",
          "If you breach these terms, the license terminates automatically and without notice. You must then delete all copies of the Software. Termination does not affect accrued obligations or provisions that by their nature survive, including ownership, limitation of liability and governing law.",
        ],
      },
      {
        heading: "11. Governing law and disputes",
        paragraphs: [
          "This Agreement is governed by the laws of the Republic of Türkiye, excluding its conflict-of-law rules. The courts and enforcement offices of Istanbul (Türkiye) have jurisdiction.",
          "If you qualify as a consumer, you retain the right to apply to the consumer arbitration committees and consumer courts of your place of residence. Nothing in this clause limits rights arising from mandatory consumer protection law.",
        ],
      },
      {
        heading: "12. Changes to this Agreement",
        paragraphs: [
          "Vellium may update this Agreement. Material changes are published with the new release and the revision date at the top of the document is updated. Continuing to use the Software after a change means you accept the revised text. If you do not accept it, you must stop using the Software.",
        ],
      },
      {
        heading: "13. Contact",
        paragraphs: [
          "For questions about this Agreement, Vellium's official contact channel is https://vellium.dev/contact. The Software is developed and published by Vellium.",
        ],
      },
    ],
  },

  privacy: {
    title: "Privacy Policy",
    updated: UPDATED_EN,
    summary:
      "Dev Cleaner keeps your data on your device. No accounts, no telemetry, no advertising, no cloud sync.",
    clauses: [
      {
        heading: "1. Summary",
        paragraphs: [
          "Dev Cleaner is a local-first desktop application. It needs no account, no sign-in and no internet connection to work. Vellium operates no server for it, and the application never automatically transmits usage data to us.",
          "This policy explains what information is read, where it is stored, how long it is kept and what rights you have. The version published inside the application is always the current one.",
        ],
      },
      {
        heading: "2. What data is processed",
        paragraphs: [
          "The application processes the following data solely to perform its cleanup function:",
        ],
        bullets: [
          "File and folder metadata: path, size, last-modified time and category. After a scan, this is stored locally together with the scan summary so the last results can be shown when you reopen the app (see section 3).",
          "Preferences: theme, language, scan limits, protection lists and window behaviour.",
          "Cleanup history: timestamps, target type, size, result and error codes. With path masking enabled, full paths are not recorded.",
          "Official tool records: exit code and duration of commands you run, such as `npm`, `pnpm`, `yarn` or `cargo`.",
        ],
      },
      {
        heading: "3. Where the data is stored",
        paragraphs: [
          "All persistent data stays on your own computer, inside your Windows user profile:",
        ],
        bullets: [
          "%APPDATA%\\dev-cleaner\\config.json — application preferences.",
          "%APPDATA%\\dev-cleaner\\last-scan.json — the candidate list (path, size, classification) and summary of the last completed or cancelled scan. Only one snapshot is kept, never a history; writes over 64 MB are refused. Your next scan replaces the file; delete it to remove it permanently.",
          "%APPDATA%\\dev-cleaner\\history.jsonl — cleanup history.",
          "%APPDATA%\\dev-cleaner\\snapshots.jsonl and actions.jsonl — drive-usage snapshots and official tool records.",
          "The Windows Recycle Bin — files moved there by the default deletion method.",
        ],
      },
      {
        heading: "4. File system access",
        paragraphs: [
          "The application scans only the root directories you select or authorise. System locations (Windows, Program Files, drive roots) are excluded by protection rules and cannot be scanned or deleted. No deletion ever starts without your confirmation.",
          "The Software never exports file contents; file bodies are not analysed, uploaded or copied. Only metadata (size, path, date) is used.",
        ],
      },
      {
        heading: "5. Network access and third parties",
        paragraphs: [
          "The application sends no network request for analytics, telemetry, crash reporting, advertising or authentication. Vellium has no analytics or monitoring infrastructure.",
          "Network access can occur only when you initiate it: running an official tool command may let that tool contact its own package registry, and clicking a link opens the page in your default browser. Those actions are governed by the third party's own privacy policy, and Vellium does not supply data to those services.",
        ],
      },
      {
        heading: "6. Legal basis and purpose",
        paragraphs: [
          "Your personal data is processed only to perform our software-use relationship with you and to provide the application's local functions. Because data is not transmitted to Vellium, there is no server-side processing activity carried out by Vellium.",
          "The application does not collect special-category personal data, health data, biometric data or location data.",
        ],
      },
      {
        heading: "7. Retention and deletion",
        paragraphs: [
          "Data remains on your device until you delete it. Under Settings > Privacy you can disable local history or clear it in one action. Uninstalling the application does not automatically remove the data folder under %APPDATA%; you may delete that folder as well.",
          "Files moved to the Recycle Bin are subject to Windows' own retention rules and are permanently removed when the Recycle Bin is emptied.",
        ],
      },
      {
        heading: "8. Your rights",
        paragraphs: [
          "Under KVKK (Turkish Law No. 6698) and, where applicable, the GDPR, you have the right to access, rectify and erase your data and to object to its processing. Because the data lives on your device, you can exercise all of these rights directly through the application and the file system.",
          "You may use https://vellium.dev/contact for requests. Since we keep no server-side record that could identify you, Vellium holds no user data to erase.",
        ],
      },
      {
        heading: "9. Children's privacy",
        paragraphs: [
          "The application is not directed at children and does not knowingly collect personal data from them. In fact, it collects no personal data from any user.",
        ],
      },
      {
        heading: "10. Security",
        paragraphs: [
          "Because the application exchanges no data over the network, there is no interception risk in transit. Local files are protected by the access permissions of your Windows user profile. The application does not request administrator rights.",
          "If you share your computer, remember that other users may be able to read the local history files under %APPDATA%; the path-masking option affects the interface only and does not change file contents.",
        ],
      },
      {
        heading: "11. Changes to this policy",
        paragraphs: [
          "When this policy is updated, the revision date changes and the current text is published inside the application. Changes that materially affect how data is processed are additionally described in the release notes.",
        ],
      },
      {
        heading: "12. Contact",
        paragraphs: [
          "Privacy questions: https://vellium.dev/contact. The data controller is Vellium (vellium.dev).",
          "You can request the controller's identification and contact details, including a postal address for formal notices, through the same contact channel; requests are answered within the period required by the applicable data-protection law. Because the app creates no account and transmits nothing, Vellium holds no separate user record to disclose.",
        ],
      },
    ],
  },

  thirdParty: {
    title: "Third-Party Licenses",
    updated: UPDATED_EN,
    summary:
      "Dev Cleaner is built on components produced by the open-source community. This page lists every component and its license.",
    clauses: [
      {
        heading: "1. How this list is produced",
        paragraphs: [
          "The list below is generated automatically from the actual dependency graph of the release build: `cargo metadata` for the Rust side and the installed npm tree for the interface. Only components genuinely included in the binary or the bundle are listed; development-only tooling (test runner, compiler, bundler) is excluded.",
          "Component names and versions are sufficient to verify the license terms. The full license text of each component ships with that package's own distribution on crates.io or npm.",
        ],
      },
      {
        heading: "2. License obligations",
        paragraphs: [
          "Every license in use permits use inside a commercial, closed-source application. The main obligations we meet:",
        ],
        bullets: [
          "MIT, ISC, BSD and Apache-2.0: retain copyright notices and license texts. Notices appear on this page and inside the bundled components' own files.",
          "MPL-2.0 (cssparser, selectors, dtoa-short, option-ext): source code for modifications to MPL-covered files must remain available. These components are used unmodified; if a modified version were published, the corresponding source would be published too.",
          "Unicode-3.0 (ICU4X components): retain the Unicode license notice.",
          "Apache-2.0: retain any NOTICE file and comply with its patent clause.",
        ],
      },
      {
        heading: "3. Warranty and liability",
        paragraphs: [
          'Third-party components are provided "as is" under their own licenses. Their authors are not liable for damages arising from their use in this application. Listing these components does not imply that their projects endorse Vellium or Dev Cleaner.',
        ],
      },
      {
        heading: "4. Notices and contact",
        paragraphs: [
          "This page is updated with every release of the Software and reflects the components actually present in that release. If you have a question about a component's license or copyright notice, you can reach Vellium at https://vellium.dev/contact. The authoritative notices are always the ones published on this page inside the Software.",
        ],
      },
    ],
  },
};

export const LEGAL_DOCUMENTS: Record<"tr" | "en", Record<LegalDocId, LegalDocument>> = {
  tr: TR_DOCUMENTS,
  en: EN_DOCUMENTS,
};

/**
 * Convenience translations of the authoritative English text. They live in
 * JSON dictionaries keyed by the exact English source string so the document
 * structure stays single-sourced.
 */
const LEGAL_LOADERS = import.meta.glob("./legal-locales/*.json", {
  import: "default",
}) as Record<string, () => Promise<Record<string, string>>>;

const LEGAL_DICTS: Record<string, Record<string, string>> = {};
const pendingLegalLocales = new Map<string, Promise<void>>();

/**
 * Loads the convenience translation dictionary for a locale.
 *
 * Documents are single-sourced in English and translated sentence by sentence,
 * so the dictionaries are large. They are fetched per language instead of being
 * bundled into the entry chunk.
 */
export function loadLegalLocale(language: string | null | undefined): Promise<void> {
  const locale = resolveUiLocale(language);
  if (locale === "en" || locale === "tr" || LEGAL_DICTS[locale]) return Promise.resolve();

  const inflight = pendingLegalLocales.get(locale);
  if (inflight) return inflight;

  const load = LEGAL_LOADERS[`./legal-locales/${locale}.json`];
  const promise = (load ? load() : Promise.resolve({}))
    .then((data) => {
      LEGAL_DICTS[locale] = data ?? {};
    })
    .catch(() => {
      // A missing dictionary leaves the English source in place.
      LEGAL_DICTS[locale] = {};
    })
    .finally(() => {
      pendingLegalLocales.delete(locale);
    });

  pendingLegalLocales.set(locale, promise);
  return promise;
}

/** Notice shown above machine-translated documents. */
export const LEGAL_TRANSLATION_NOTICE =
  "This translation is provided for convenience only. In case of any divergence, the English original prevails.";

function legalText(locale: string, text: string): string {
  return LEGAL_DICTS[locale]?.[text] ?? text;
}

/** Translate a standalone legal string (e.g. the translation notice). */
export function localizeLegalString(language: string | null | undefined, text: string): string {
  const locale = resolveUiLocale(language);
  if (locale === "en" || locale === "tr") return text;
  return legalText(locale, text);
}

function localizeDocument(locale: string, document: LegalDocument): LegalDocument {
  return {
    title: legalText(locale, document.title),
    updated: localizeRevisionDate(locale),
    summary: legalText(locale, document.summary),
    clauses: document.clauses.map((clause) => ({
      heading: legalText(locale, clause.heading),
      paragraphs: clause.paragraphs?.map((paragraph) => legalText(locale, paragraph)),
      bullets: clause.bullets?.map((bullet) => legalText(locale, bullet)),
    })),
  };
}

/** Localized revision date; falls back to the English spelling. */
export function localizeRevisionDate(locale: string): string {
  try {
    const formatted = new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(Date.UTC(2026, 10, 17)));
    return `${formatted} (v${APP_VERSION})`;
  } catch {
    return UPDATED_EN;
  }
}

/** Returns the document for the UI language, falling back to English. */
export function getLegalDocument(
  language: string | null | undefined,
  id: LegalDocId,
): LegalDocument {
  const locale = resolveUiLocale(language);
  if (locale === "tr") return TR_DOCUMENTS[id];
  if (locale === "en") return EN_DOCUMENTS[id];
  return localizeDocument(locale, EN_DOCUMENTS[id]);
}

/** Whether the active locale renders a convenience translation. */
export function isLegalTranslation(language: string | null | undefined): boolean {
  const locale = resolveUiLocale(language);
  return locale !== "en" && locale !== "tr";
}

export const LEGAL_DOC_META: Record<"tr" | "en", LegalDocMeta[]> = {
  tr: [
    { id: "eula", label: "Kullanım Koşulları", hint: "Lisans, sınırlamalar ve sorumluluk" },
    { id: "privacy", label: "Gizlilik", hint: "Veri, saklama ve haklarınız" },
    { id: "thirdParty", label: "Üçüncü Taraf", hint: "Açık kaynak bileşenler ve lisanslar" },
  ],
  en: [
    { id: "eula", label: "Terms of Use", hint: "License, restrictions and liability" },
    { id: "privacy", label: "Privacy", hint: "Data, retention and your rights" },
    { id: "thirdParty", label: "Third-Party", hint: "Open-source components and licenses" },
  ],
};

export function getLegalDocMeta(language: string | null | undefined): LegalDocMeta[] {
  const locale = resolveUiLocale(language);
  if (locale === "tr") return LEGAL_DOC_META.tr;
  if (locale === "en") return LEGAL_DOC_META.en;
  return LEGAL_DOC_META.en.map((meta) => ({
    ...meta,
    label: legalText(locale, meta.label),
    hint: legalText(locale, meta.hint),
  }));
}

/** The revision date shared by every document, shown in the About page. */
export const LEGAL_REVISION = { tr: UPDATED_TR, en: UPDATED_EN };
