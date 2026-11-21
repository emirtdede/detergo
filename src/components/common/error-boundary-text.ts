/**
 * Static copy for the top-level error boundary.
 *
 * The boundary renders when the React tree - possibly the locale loader itself
 * - has failed, so it cannot call the async dictionary loader or any hook. It
 * also must not import the UI dictionary bundle: that dragged all 73
 * translation files into the entry chunk (finding Y-1). These three strings per
 * language are the only ones the fallback screen needs.
 *
 * Generated from `src/lib/ui-text/error-boundary.json`; run
 * `node scripts/generate-error-boundary-text.mjs` when a language is added.
 */
export interface ErrorBoundaryText {
  title: string;
  unknownError: string;
  reload: string;
}

export const ERROR_BOUNDARY_TEXT: Record<string, ErrorBoundaryText> = {
  af: {
    title: "'n Fout het Voorgekom Tydens Begin van Toepassing",
    unknownError: "'n Onverwagte fout het voorgekom.",
    reload: "Herbegin",
  },
  am: {
    title: "መተግበሪያውን ሲጀምር ስህተት ተከስቷል",
    unknownError: "ያልተጠበቀ ስህተት ተከስቷል።",
    reload: "እንደገና ጀምር",
  },
  ar: {
    title: "حدث خطأ أثناء بدء التطبيق",
    unknownError: "حدث خطأ غير متوقع.",
    reload: "إعادة التشغيل",
  },
  az: {
    title: "Tətbiq Başladılarkən Xəta Baş Verdi",
    unknownError: "Gözlənilməz bir xəta baş verdi.",
    reload: "Yenidən Başlat",
  },
  bg: {
    title: "Възникна Грешка при Стартиране на Приложението",
    unknownError: "Възникна неочаквана грешка.",
    reload: "Рестартиране",
  },
  bn: {
    title: "অ্যাপ্লিকেশন শুরু করার সময় একটি ত্রুটি ঘটেছে",
    unknownError: "একটি অপ্রত্যাশিত ত্রুটি ঘটেছে।",
    reload: "পুনরায় চালু করুন",
  },
  bs: {
    title: "Došlo je do Greške Prilikom Pokretanja Aplikacije",
    unknownError: "Došlo je do neočekivane greške.",
    reload: "Ponovo pokreni",
  },
  ca: {
    title: "S'ha Produït un Error en Iniciar l'Aplicació",
    unknownError: "S'ha produït un error inesperat.",
    reload: "Reiniciar",
  },
  cs: {
    title: "Při Spuštění Aplikace Došlo k Chybě",
    unknownError: "Došlo k neočekávané chybě.",
    reload: "Restartovat",
  },
  da: {
    title: "Der Opstod en Fejl Under Start af Programmet",
    unknownError: "Der opstod en uventet fejl.",
    reload: "Genstart",
  },
  de: {
    title: "Beim Starten der Anwendung ist ein Fehler aufgetreten",
    unknownError: "Ein unerwarteter Fehler ist aufgetreten.",
    reload: "Neu starten",
  },
  el: {
    title: "Παρουσιάστηκε Σφάλμα κατά την Εκκίνηση",
    unknownError: "Παρουσιάστηκε ένα απροσδόκητο σφάλμα.",
    reload: "Επανεκκίνηση",
  },
  en: {
    title: "An Error Occurred While Starting the Application",
    unknownError: "An unexpected error occurred.",
    reload: "Restart",
  },
  es: {
    title: "Ocurrió un Error al Iniciar la Aplicación",
    unknownError: "Ocurrió un error inesperado.",
    reload: "Reiniciar",
  },
  et: {
    title: "Rakenduse Käivitamisel Ilmnes Viga",
    unknownError: "Ilmnes ootamatu viga.",
    reload: "Taaskäivita",
  },
  eu: {
    title: "Errore Bat Gertatu Da Aplikazioa Hastean",
    unknownError: "Ustekabeko errore bat gertatu da.",
    reload: "Berrabiarazi",
  },
  fa: {
    title: "هنگام راه‌اندازی برنامه خطایی روی داد",
    unknownError: "یک خطای غیرمنتظره روی داد.",
    reload: "راه‌اندازی مجدد",
  },
  fi: {
    title: "Sovelluksen Käynnistyksessä Tapahtui Virhe",
    unknownError: "Odottamaton virhe tapahtui.",
    reload: "Käynnistä uudelleen",
  },
  fil: {
    title: "May Naganap na Error Habang Sinisimulan ang Application",
    unknownError: "May naganap na hindi inaasahang error.",
    reload: "I-restart",
  },
  fr: {
    title: "Une Erreur est Survenue lors du Lancement",
    unknownError: "Une erreur inattendue est survenue.",
    reload: "Redémarrer",
  },
  ga: {
    title: "Tharla Earráid Nuair a Bhíothas ag Tosú an Fheidhmchláir",
    unknownError: "Tharla earráid gan choinne.",
    reload: "Atosaigh",
  },
  gl: {
    title: "Produciuse un Erro ao Iniciar a Aplicación",
    unknownError: "Produciuse un erro inesperado.",
    reload: "Reiniciar",
  },
  gu: {
    title: "એપ્લિકેશન શરૂ કરતી વખતે ભૂલ આવી",
    unknownError: "એક અનપેક્ષિત ભૂલ આવી.",
    reload: "ફરી શરૂ કરો",
  },
  ha: {
    title: "Kuskure Ya Faru Yayin Fara Manhaja",
    unknownError: "Wani kuskure da ba a zata ba ya faru.",
    reload: "Sake Farawa",
  },
  he: {
    title: "אירעה שגיאה בעת הפעלת היישום",
    unknownError: "אירעה שגיאה בלתי צפויה.",
    reload: "הפעל מחדש",
  },
  hi: {
    title: "एप्लिकेशन शुरू करते समय एक त्रुटि हुई",
    unknownError: "एक अप्रत्याशित त्रुटि हुई।",
    reload: "पुनः आरंभ करें",
  },
  hr: {
    title: "Došlo je do Pogreške Prilikom Pokretanja Aplikacije",
    unknownError: "Došlo je do neočekivane pogreške.",
    reload: "Ponovno pokreni",
  },
  hu: {
    title: "Hiba Történt az Alkalmazás Indításakor",
    unknownError: "Váratlan hiba történt.",
    reload: "Újraindítás",
  },
  hy: {
    title: "Ծրագիրը գործարկելիս տեղի է ունեցել սխալ",
    unknownError: "Տեղի է ունեցել անսպասելի սխալ:",
    reload: "Վերագործարկել",
  },
  id: {
    title: "Terjadi Kesalahan Saat Memulai Aplikasi",
    unknownError: "Terjadi kesalahan yang tidak terduga.",
    reload: "Mulai Ulang",
  },
  is: {
    title: "Villa Kom Upp Við Ræsingu Forritsins",
    unknownError: "Óvænt villa kom upp.",
    reload: "Endurræsa",
  },
  it: {
    title: "Si è Verificato un Errore all'Avvio",
    unknownError: "Si è verificato un errore imprevisto.",
    reload: "Riavvia",
  },
  ja: {
    title: "アプリケーションの起動中にエラーが発生しました",
    unknownError: "予期しないエラーが発生しました。",
    reload: "再起動",
  },
  ka: {
    title: "აპლიკაციის გაშვებისას წარმოიშვა შეცდომა",
    unknownError: "დაფიქსირდა მოულოდნელი შეცდომა.",
    reload: "ხელახლა გაშვება",
  },
  kk: {
    title: "Қолданбаны Іске Қосу Кезінде Қате Орын Алды",
    unknownError: "Күтпеген қате орын алды.",
    reload: "Қайта қосу",
  },
  km: {
    title: "មានកំហុសមួយបានកើតឡើងពេលចាប់ផ្តើមកម្មវិធី",
    unknownError: "មានកំហុសដែលមិនបានរំពឹងទុកមួយបានកើតឡើង។",
    reload: "ចាប់ផ្តើមឡើងវិញ",
  },
  kn: {
    title: "ಅಪ್ಲಿಕೇಶನ್ ಪ್ರಾರಂಭಿಸುವಾಗ ದೋಷ ಸಂಭವಿಸಿದೆ",
    unknownError: "ಅನಿರೀಕ್ಷಿತ ದೋಷ ಸಂಭವಿಸಿದೆ.",
    reload: "ಮತ್ತೆ ಪ್ರಾರಂಭಿಸಿ",
  },
  ko: {
    title: "애플리케이션을 시작하는 동안 오류가 발생했습니다",
    unknownError: "예기치 않은 오류가 발생했습니다.",
    reload: "다시 시작",
  },
  ky: {
    title: "Колдонмону Ишке Киргизүүдө Ката Кетти",
    unknownError: "Күтүлбөгөн ката кетти.",
    reload: "Кайра баштоо",
  },
  lt: {
    title: "Paleidžiant Programą Įvyko Klaida",
    unknownError: "Įvyko netikėta klaida.",
    reload: "Paleisti iš naujo",
  },
  lv: {
    title: "Palaižot Lietotni Radās Kļūda",
    unknownError: "Radās negaidīta kļūda.",
    reload: "Restartēt",
  },
  mk: {
    title: "Настана Грешка при Стартување на Апликацијата",
    unknownError: "Настана неочекувана грешка.",
    reload: "Рестартирај",
  },
  ml: {
    title: "ആപ്ലിക്കേഷൻ ആരംഭിക്കുമ്പോൾ ഒരു പിശക് സംഭവിച്ചു",
    unknownError: "പ്രതീക്ഷിക്കാത്ത ഒരു പിശക് സംഭവിച്ചു.",
    reload: "വീണ്ടും ആരംഭിക്കുക",
  },
  mn: {
    title: "Програмыг эхлүүлэх үед алдаа гарлаа",
    unknownError: "Гэнэтийн алдаа гарлаа.",
    reload: "Дахин ачааллах",
  },
  mr: {
    title: "ॲप्लिकेशन सुरू करताना एक त्रुटी आली",
    unknownError: "एक अनपेक्षित त्रुटी आली.",
    reload: "पुन्हा सुरू करा",
  },
  ms: {
    title: "Ralat Berlaku Semasa Memulakan Aplikasi",
    unknownError: "Ralat tidak dijangka berlaku.",
    reload: "Mulakan Semula",
  },
  my: {
    title: "အက်ပ်စတင်စဉ် အမှားတစ်ခု ဖြစ်ပွားခဲ့သည်",
    unknownError: "မမျှော်လင့်ထားသော အမှားတစ်ခု ဖြစ်ပွားခဲ့သည်။",
    reload: "ပြန်လည်စတင်ရန်",
  },
  nl: {
    title: "Er is een Fout Opgedoken bij het Starten van de Applicatie",
    unknownError: "Er is een onverwachte fout opgetreden.",
    reload: "Herstarten",
  },
  no: {
    title: "Det Oppsto en Feil Under Oppstart av Appen",
    unknownError: "En uventet feil oppsto.",
    reload: "Start på nytt",
  },
  pa: {
    title: "ਐਪਲੀਕੇਸ਼ਨ ਸ਼ੁਰੂ ਕਰਦੇ ਸਮੇਂ ਇੱਕ ਗਲਤੀ ਆਈ",
    unknownError: "ਇੱਕ ਅਣਕਿਆਸੀ ਗਲਤੀ ਆਈ।",
    reload: "ਮੁੜ ਚਾਲੂ ਕਰੋ",
  },
  pl: {
    title: "Wystąpił Błąd Podczas Uruchamiania Aplikacji",
    unknownError: "Wystąpił nieoczekiwany błąd.",
    reload: "Uruchom ponownie",
  },
  pt: {
    title: "Ocorreu um Erro ao Iniciar o Aplicativo",
    unknownError: "Ocorreu um erro inesperado.",
    reload: "Reiniciar",
  },
  ro: {
    title: "A Apărut o Eroare la Pornirea Aplicației",
    unknownError: "A apărut o eroare neașteptată.",
    reload: "Repornește",
  },
  ru: {
    title: "Произошла Ошибка При Запуске Приложения",
    unknownError: "Произошла непредвиденная ошибка.",
    reload: "Перезапустить",
  },
  si: {
    title: "යෙදුම ආරම්භ කිරීමේදී දෝෂයක් සිදු විය",
    unknownError: "අනපේක්ෂිත දෝෂයක් සිදු විය.",
    reload: "නැවත අරඹන්න",
  },
  sk: {
    title: "Pri Spustení Aplikácie Vyskytla sa Chyba",
    unknownError: "Vyskytla sa neočakávaná chyba.",
    reload: "Reštartovať",
  },
  sl: {
    title: "Pri Zagonu Aplikacije je Prišlo do Napake",
    unknownError: "Prišlo je do nepričakovane napake.",
    reload: "Ponovno zaženi",
  },
  sq: {
    title: "Ndodhi një Gabim Gjatë Nisjes së Aplikacionit",
    unknownError: "Ndodhi një gabim i papritur.",
    reload: "Rinis",
  },
  sr: {
    title: "Дошло је до Грешке Приликом Покретања",
    unknownError: "Дошло је до неочекиване грешке.",
    reload: "Поново покрени",
  },
  sv: {
    title: "Ett Fel Uppstod När Programmet Startades",
    unknownError: "Ett oväntat fel uppstod.",
    reload: "Starta om",
  },
  sw: {
    title: "Hitilafu Ilitokea Wakati wa Kuanzisha Programu",
    unknownError: "Hitilafu isiyotarajiwa ilitokea.",
    reload: "Anzisha Tena",
  },
  ta: {
    title: "பயன்பாட்டைத் தொடங்கும்போது பிழை ஏற்பட்டது",
    unknownError: "எதிர்பாராத பிழை ஏற்பட்டது.",
    reload: "மீண்டும் தொடங்கு",
  },
  te: {
    title: "అప్లికేషన్ ప్రారంభించేటప్పుడు లోపం సంభవించింది",
    unknownError: "ఊహించని లోపం సంభవించింది.",
    reload: "పునఃప్రారంభించండి",
  },
  th: {
    title: "เกิดข้อผิดพลาดขณะเริ่มแอปพลิเคชัน",
    unknownError: "เกิดข้อผิดพลาดที่ไม่คาดคิด",
    reload: "เริ่มใหม่",
  },
  tk: {
    title: "Programma Başladylanda Säwlik Ýüze Çykdy",
    unknownError: "Garaşylmadyk säwlik ýüze çykdy.",
    reload: "Täzeden başlat",
  },
  tr: {
    title: "Uygulama Başlatılırken Bir Hata Oluştu",
    unknownError: "Bilinmeyen bir hata meydana geldi.",
    reload: "Yeniden Başlat",
  },
  uk: {
    title: "Сталася Помилка Під Час Запуску Програми",
    unknownError: "Сталася неочікувана помилка.",
    reload: "Перезапустити",
  },
  ur: {
    title: "ایپلی کیشن شروع کرتے وقت ایک خرابی پیش آگئی",
    unknownError: "ایک غیر متوقع خرابی پیش آگئی۔",
    reload: "دوبارہ شروع کریں",
  },
  uz: {
    title: "Dasturni Ishga Tushirishda Xatolik Yuz Berdi",
    unknownError: "Kutilmagan xatolik yuz berdi.",
    reload: "Qayta ishga tushirish",
  },
  vi: {
    title: "Đã Xảy Ra Lỗi Khi Khởi Động Ứng Dụng",
    unknownError: "Đã xảy ra lỗi không mong muốn.",
    reload: "Khởi động lại",
  },
  yo: {
    title: "Àṣìṣe Kan Ṣẹlẹ̀ Nígbà Tí A N Bẹ̀rẹ̀ Ìṣàfilọ́lẹ̀ Náà",
    unknownError: "Àṣìṣe tí a kò retí ṣẹlẹ̀.",
    reload: "Tún Bẹ̀rẹ̀",
  },
  "zh-tw": {
    title: "啟動應用程式時發生錯誤",
    unknownError: "發生未預期的錯誤。",
    reload: "重新啟動",
  },
  zh: { title: "启动应用程序时发生错误", unknownError: "发生了意外错误。", reload: "重新启动" },
};

/** Keys the app has used for the persisted language at some point. */
const LANGUAGE_KEYS = ["detergo_lang", "detergo_language", "node_cleaner_language"];

function readStoredLanguage(): string | null {
  try {
    for (const key of LANGUAGE_KEYS) {
      const value = localStorage.getItem(key);
      if (value) return value;
    }
  } catch {
    // Storage can be unavailable in hardened contexts; fall through.
  }
  return null;
}

/**
 * Resolves the boundary copy without touching React state or the async locale
 * loader. Falls back to English, then Turkish, then the first available entry.
 */
export function getErrorBoundaryText(language?: string | null): ErrorBoundaryText {
  const candidate = language ?? readStoredLanguage() ?? "en";
  return (
    ERROR_BOUNDARY_TEXT[candidate] ??
    ERROR_BOUNDARY_TEXT[candidate.split("-")[0]] ??
    ERROR_BOUNDARY_TEXT.en ??
    ERROR_BOUNDARY_TEXT.tr
  );
}
