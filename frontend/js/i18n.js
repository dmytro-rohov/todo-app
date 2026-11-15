// Interface language: Ukrainian (default) or Polish (the source language of the app). Kept on this device; switching reloads.
// The interface is written in Polish; in Ukrainian a translator replaces the interface's texts (text, title,
// aria-label, placeholder) as they appear. Content people write (tasks, notes, mail, names) is marked translate="no"
// where it is rendered and never touched.
import { setupKit } from "../vendor/mytko-kit/js/core.js";

// Mytko Kit (vendor/mytko-kit: a copy of the shared kit, never edited here — change the kit and run its tools/sync.mjs)
// set up for Mytko Tasks: its id (storage keys "mytko-tasks:…", the same language key as below) and name, and the
// texts its components show in Tasks (KIT_TEXTS, laid over the kit's own: Tasks keeps its wording where it differs;
// every key in both languages, test/kit.test.js). The kit's components translate their own texts; this file's
// translator keeps translating Tasks' Polish interface. Tasks keeps its own http.js: the kit's is never loaded.
export const KIT_TEXTS = {
  uk: {
    "startup.session": "Перевірка сесії…",
    "startup.loading": "Завантаження завдань…",
    "startup.preparing": "Підготовка дошки…",
    "startup.ready": "Готово — відкриваємо Tasks…",
    // the login screen (the kit's): Tasks' own lead and three features
    "hero.title": "Від ідеї",
    "hero.titleAccent": "до виконаного завдання",
    "hero.lead": "Mytko Tasks — приватний список завдань: робота й особисті справи, проєкти клієнтів, терміни й час роботи — в одному місці, поруч із Mytko Workflow.",
    "hero.f1.title": "Дошка, список і календар", "hero.f1.text": "Чотири робочі колонки, перетягування й порядок як пріоритет.",
    "hero.f2.title": "Простори й проєкти", "hero.f2.text": "Робота, приватне й проєкти клієнтів в окремих папках.",
    "hero.f3.title": "Терміни й час роботи", "hero.f3.text": "Сьогодні, прострочене, найближчі 7 днів і таймер.",
    // the phone's tab bar and its "more" sheet (the kit's shell)
    "nav.board": "Дошка", "nav.list": "Список", "nav.calendar": "Календар", "nav.goals": "Цілі / Мрії", "nav.archive": "Архів",
    "nav.mail": "Пошта", "nav.scope": "Простори й проєкти", "nav.accounts": "Облікові записи", "nav.ai": "AI і Workflow",
    "nav.scale": "Розмір інтерфейсу", "nav.notifications": "Сповіщення", "nav.language": "Мова", "nav.add": "Нове завдання"
  },
  pl: {
    "startup.session": "Weryfikacja sesji…",
    "startup.loading": "Wczytywanie zadań…",
    "startup.preparing": "Przygotowanie tablicy…",
    "startup.ready": "Gotowe — otwieranie Tasks…",
    "hero.title": "Od pomysłu",
    "hero.titleAccent": "do zrobionego zadania",
    "hero.lead": "Mytko Tasks to prywatna lista zadań: praca i sprawy prywatne, projekty klientów, terminy i czas pracy — w jednym miejscu, obok Mytko Workflow.",
    "hero.f1.title": "Tablica, lista i kalendarz", "hero.f1.text": "Cztery kolumny pracy, przeciąganie i kolejność jako priorytet.",
    "hero.f2.title": "Przestrzenie i projekty", "hero.f2.text": "Praca, prywatne i projekty klientów w osobnych folderach.",
    "hero.f3.title": "Terminy i czas pracy", "hero.f3.text": "Dziś, po terminie, najbliższe 7 dni i licznik czasu.",
    "nav.board": "Tablica", "nav.list": "Lista", "nav.calendar": "Kalendarz", "nav.goals": "Cele / Marzenia", "nav.archive": "Archiwum",
    "nav.mail": "Poczta", "nav.scope": "Przestrzenie i projekty", "nav.accounts": "Konta", "nav.ai": "AI i Workflow",
    "nav.scale": "Rozmiar interfejsu", "nav.notifications": "Powiadomienia", "nav.language": "Język", "nav.add": "Nowe zadanie"
  }
};
// the login screen's three features (texts: hero.f1-3 above)
setupKit({ id: "tasks", name: "Mytko Tasks", short: "Tasks", locales: KIT_TEXTS,
  features: [{ icon: "board", key: "hero.f1" }, { icon: "folder", key: "hero.f2" }, { icon: "clock", key: "hero.f3" }] });

const KEY = "mytko-tasks:lang";
export const LANGUAGES = { pl: "Polski", uk: "Українська" };

function stored() {
  try { return typeof localStorage === "undefined" ? null : localStorage.getItem(KEY); } catch { return null; }
}
// Ukrainian is the default; Polish (the language the interface is written in) when chosen on this device.
export const LANG = stored() === "pl" ? "pl" : "uk";
export const LOCALE = LANG === "uk" ? "uk-UA" : "pl-PL";

export function setLang(lang) {
  try { localStorage.setItem(KEY, lang === "uk" ? "uk" : "pl"); } catch { /* storage unavailable: stays for this page only */ }
  window.location.reload();
}

// ---- Ukrainian ----------------------------------------------------------------------------------------------------
const UK = {
  // navigation, views, board
  "Tasks": "Tasks", "Wszystkie zadania": "Усі завдання", "Przestrzenie": "Простори", "Projekty": "Проєкти", "Klienci": "Клієнти",
  "Porządek": "Упорядкування", "Etykiety": "Мітки", "Wykonawcy": "Виконавці", "Konta": "Облікові записи", "Rozmiar interfejsu": "Розмір інтерфейсу",
  "Język": "Мова", "Język interfejsu": "Мова інтерфейсу", "Praca": "Робота", "Prywatne": "Приватне",
  "Tablica": "Дошка", "Lista": "Список", "Kalendarz": "Календар", "Archiwum": "Архів", "Poczta": "Пошта",
  "ToDo": "До виконання", "W realizacji": "В роботі", "Needs review": "На перевірці", "Zakończone": "Завершено", "Plany długoterminowe": "Довгострокові плани",
  "Otwarte": "Відкриті", "Na dziś": "На сьогодні", "Po terminie": "Прострочені", "W ciągu 7 dni": "Протягом 7 днів",
  "Nowe zadanie": "Нове завдання", "Filtry": "Фільтри", "Pokaż zakończone": "Показувати завершені", "Wyczyść filtry": "Очистити фільтри",
  "Wszystkie projekty": "Усі проєкти", "Wszyscy klienci": "Усі клієнти", "Wszystkie etykiety": "Усі мітки", "Wszyscy wykonawcy": "Усі виконавці",
  "Wszystkie statusy": "Усі статуси", "Szukaj": "Пошук", "Szukaj zadań, osób lub etykiet…": "Шукати завдання, людей або мітки…",
  "Wszystkie zadania, prace i działania": "Усі завдання, роботи й справи", "Widok zadań": "Вигляд завдань", "Szybkie filtry terminów": "Швидкі фільтри термінів",
  "Brak zadań. Przeciągnij tu kartę albo dodaj nową.": "Немає завдань. Перетягніть сюди картку або додайте нову.",
  "Zakończone są ukryte.": "Завершені приховані.", "Brak zadań dla tych filtrów.": "Немає завдань для цих фільтрів.",
  "Cele na rok, dwa, pięć lat. Nie liczą się do „Otwarte” i terminów.": "Цілі на рік, два, п’ять років. Не враховуються у «Відкриті» та терміни.",
  "Przewiń do kolumny Plany długoterminowe": "Прокрутити до колонки «Довгострокові плани»", "Wróć do tablicy": "Повернутися до дошки",
  "Wróć do początku tablicy": "Повернутися на початок дошки", "Pokaż tylko tę kolumnę": "Показати лише цю колонку",
  "Brak projektów w tej przestrzeni.": "У цьому просторі немає проєктів.", "Brak klientów.": "Немає клієнтів.",
  "Zarządzaj przestrzeniami": "Керувати просторами", "Zarządzaj projektami": "Керувати проєктами", "Zarządzaj klientami": "Керувати клієнтами",
  "Otwórz menu": "Відкрити меню", "Zamknij menu": "Закрити меню", "Zwiń panel": "Згорнути панель", "Rozwiń panel": "Розгорнути панель",
  "Zwiń panel boczny": "Згорнути бічну панель", "Rozwiń panel boczny": "Розгорнути бічну панель", "Powiadomienia": "Сповіщення",
  "Więcej: nowy projekt, etykieta, przestrzeń": "Більше: новий проєкт, мітка, простір", "Nowy projekt": "Новий проєкт", "Nowa etykieta": "Нова мітка",
  "Nowa przestrzeń": "Новий простір", "Nowe spotkanie": "Нова зустріч", "Wyloguj": "Вийти", "Administrator": "Адміністратор",
  "Na dziś i po terminie": "На сьогодні й прострочені", "Nic na dziś i nic po terminie.": "Нічого на сьогодні й нічого простроченого.",
  "Spotkania dziś": "Зустрічі сьогодні", "Lista zadań": "Список завдань", "Kolejność": "Порядок",
  // cards, statuses, priorities, dates
  "Dziś": "Сьогодні", "Jutro": "Завтра", "Wczoraj": "Вчора", "kiedyś": "колись", "Bez wykonawcy": "Без виконавця",
  "Krytyczny": "Критичний", "Wysoki": "Високий", "Normalny": "Звичайний", "Niski": "Низький", "Priorytet": "Пріоритет",
  "Rozpocznij pracę": "Почати роботу", "Wznów licznik": "Відновити таймер", "Zatrzymaj licznik": "Зупинити таймер", "Przenieś do ToDo": "Перенести до «До виконання»",
  "Zatwierdź i zakończ": "Затвердити й завершити", "Zarejestrowany czas": "Зареєстрований час", "Pracujesz nad": "Ви працюєте над", "Otwórz zadanie": "Відкрити завдання",
  "Czeka na Workflow": "Чекає на Workflow", "W Workflow": "У Workflow", "Workflow: w realizacji": "Workflow: в роботі",
  "Workflow: wymaga uwagi": "Workflow: потребує уваги", "Workflow: zrobione": "Workflow: виконано", "Wycofane z Workflow": "Відкликано з Workflow",
  "Pn": "Пн", "Wt": "Вт", "Śr": "Ср", "Cz": "Чт", "Pt": "Пт", "So": "Сб", "Nd": "Нд",
  "Miesiąc": "Місяць", "Tydzień": "Тиждень", "Poprzedni miesiąc": "Попередній місяць", "Następny miesiąc": "Наступний місяць",
  "Poprzedni tydzień": "Попередній тиждень", "Następny tydzień": "Наступний тиждень", "Dzisiaj": "Сьогодні", "więcej": "більше",
  "Brak zadań i spotkań w tym dniu.": "У цей день немає завдань і зустрічей.", "cały dzień": "увесь день", "Cały dzień": "Увесь день",
  // new task, task panel
  "Tytuł": "Назва", "Co jest do zrobienia?": "Що потрібно зробити?", "Status": "Статус", "Termin": "Термін", "Cel (opcjonalnie)": "Ціль (необов’язково)",
  "Cel za:": "Ціль через:", "rok": "рік", "2 lata": "2 роки", "5 lat": "5 років", "Przestrzeń": "Простір", "Projekt": "Проєкт", "Bez projektu": "Без проєкту",
  "Klient": "Клієнт", "Bez klienta": "Без клієнта", "Wykonawca": "Виконавець", "Etykieta": "Мітка", "Opis": "Опис",
  "Szczegóły, linki, kontekst…": "Деталі, посилання, контекст…", "Otwórz szczegóły po dodaniu": "Відкрити деталі після додавання",
  "Anuluj": "Скасувати", "Dodaj zadanie": "Додати завдання", "Szczegóły zadania": "Деталі завдання", "Zamknij szczegóły": "Закрити деталі",
  "Usuń zadanie": "Видалити завдання", "Czas pracy": "Час роботи", "Start": "Старт", "Wznów": "Відновити", "Zatrzymaj": "Зупинити",
  "Co trzeba zrobić, linki, kontekst…": "Що потрібно зробити, посилання, контекст…", "Podzadania": "Підзавдання", "Dodaj podzadanie…": "Додати підзавдання…",
  "Dodaj podzadanie": "Додати підзавдання", "Notatki": "Нотатки", "Nowa notatka…": "Нова нотатка…", "Nowa notatka": "Нова нотатка", "Dodaj notatkę": "Додати нотатку",
  "Usuń notatkę": "Видалити нотатку", "Usunąć tę notatkę?": "Видалити цю нотатку?", "Historia zmian": "Історія змін", "Brak historii.": "Історії немає.",
  "Workflow": "Workflow", "Wyślij do Workflow": "Надіслати у Workflow", "Wycofaj": "Відкликати", "Otwórz w Workflow": "Відкрити у Workflow",
  "Ta przestrzeń nie jest widoczna dla agentów": "Цей простір невидимий для агентів", "Workflow pobierze je, gdy Fujitsu będzie włączone.": "Workflow забере його, коли Fujitsu буде увімкнено.",
  "E-mail": "Ел. пошта", "Otwórz wiadomość": "Відкрити лист", "Utworzono": "Створено", "Zmieniono": "Змінено", "Z projektu:": "З проєкту:",
  "Brak etykiet. Dodaj je w menu „Etykiety”.": "Міток немає. Додайте їх у меню «Мітки».", "Etykieta główna": "Основна мітка",
  "Licznik działa tylko dla otwartych zadań.": "Таймер працює лише для відкритих завдань.",
  // manage dialog
  "Nowa przestrzeń…": "Новий простір…", "Nowy projekt…": "Новий проєкт…", "Nowa etykieta…": "Нова мітка…", "Nowy klient lub lead…": "Новий клієнт або лід…",
  "Nowy wykonawca…": "Новий виконавець…", "Dodaj": "Додати", "Nazwa": "Назва", "Kolor": "Колір", "Usuń": "Видалити", "Wbudowana": "Вбудована",
  "Jeszcze nic tu nie ma.": "Тут поки нічого немає.", "Dla agentów": "Для агентів", "Wspólna": "Спільна", "wspólne": "спільне", "Karta": "Картка",
  "Tylko takie przestrzenie mogą kiedyś zobaczyć integracje i agenci AI": "Лише такі простори зможуть бачити інтеграції та агенти ШІ",
  "Wspólną przestrzeń widzą i edytują osoby, które do niej dodasz lub zaprosisz": "Спільний простір бачать і редагують люди, яких ви до нього додасте або запросите",
  "Należy do innego konta, widoczna przez wspólną przestrzeń": "Належить іншому обліковому запису, видно через спільний простір",
  "Zarchiwizowany projekt znika z list, jego zadania zostają": "Архівований проєкт зникає зі списків, його завдання залишаються",
  "Praca i Prywatne są wbudowane: można zmienić ich nazwę i kolor, nie można ich usunąć. Zadania z usuniętej przestrzeni trafiają do Prywatnych. Każda przestrzeń może mieć własny Kalendarz Google.":
    "«Робота» і «Приватне» вбудовані: їх можна перейменувати й змінити колір, але не видалити. Завдання з видаленого простору потрапляють до «Приватне». Кожен простір може мати власний Google Календар.",
  "Prywatne są wbudowane. Własną przestrzeń możesz oznaczyć jako wspólną i zaprosić do niej kogoś kodem lub linkiem. Przestrzenie oznaczone ikoną osób udostępnił Ci ktoś inny.":
    "«Приватне» вбудоване. Власний простір можна позначити спільним і запросити до нього когось кодом або посиланням. Простори з іконкою людей вам надав хтось інший.",
  "Projekt to folder klienta w jednej przestrzeni. Jego zadania dostają jego etykietę. Usunięcie projektu zostawia zadania bez projektu.":
    "Проєкт — це папка в одному просторі. Його завдання отримують його мітку. Видалення проєкту залишає завдання без проєкту.",
  "Etykiety można łączyć: zadanie może mieć kilka. Usunięcie etykiety zdejmuje ją ze wszystkich zadań.":
    "Мітки можна поєднувати: завдання може мати кілька. Видалення мітки знімає її з усіх завдань.",
  "Ty jesteś tu zawsze (ze swoim zdjęciem) i nowe zadania trafiają domyślnie do Ciebie; można też wybrać „Bez wykonawcy”. Pozostali to osoby, którym przypisujesz zadania (to nie są konta logowania). Usunięcie zostawia zadania bez wykonawcy.":
    "Ви тут завжди (зі своїм фото), і нові завдання за замовчуванням призначаються вам; можна також вибрати «Без виконавця». Інші — люди, яким ви призначаєте завдання (це не облікові записи для входу). Видалення залишає завдання без виконавця.",
  "Ty": "Ви", "To ja": "Це я", "To Ty: to konto, zawsze na liście": "Це ви: цей обліковий запис, завжди у списку",
  "Przenieś zadania tego wykonawcy na siebie i usuń ten wpis": "Перенести завдання цього виконавця на себе і видалити цей запис",
  "Przestać udostępniać tę przestrzeń? Zadania innych kont z tej przestrzeni wrócą do ich Prywatnych.":
    "Припинити спільний доступ до цього простору? Завдання інших облікових записів повернуться до їхнього «Приватне».",
  "Przestań udostępniać": "Припинити спільний доступ", "Podłącz Kalendarz Google": "Під’єднати Google Календар", "Synchronizuj": "Синхронізувати",
  "Zmień konto": "Змінити обліковий запис", "Odłącz kalendarz": "Від’єднати календар", "Odłącz": "Від’єднати", "synchronizacja…": "синхронізація…",
  "Odłączyć kalendarz od tej przestrzeni? Spotkania znikną z Tasks (w Google zostają).": "Від’єднати календар від цього простору? Зустрічі зникнуть із Tasks (у Google залишаться).",
  // accounts, password, scale, language
  "Nowe konto": "Новий обліковий запис", "Imię": "Ім’я", "Login": "Логін", "Wygeneruj": "Згенерувати", "Utwórz konto": "Створити обліковий запис",
  "Hasło startowe (przekaż je tej osobie; może je potem zmienić)": "Початковий пароль (передайте його цій людині; потім вона може його змінити)",
  "Nowe hasło": "Новий пароль", "Zablokuj": "Заблокувати", "Odblokuj": "Розблокувати", "Usuń konto": "Видалити обліковий запис", "Ustaw hasło": "Встановити пароль",
  "Nie ma jeszcze innych kont.": "Інших облікових записів ще немає.", "Konto usunięte.": "Обліковий запис видалено.", "Zmień hasło": "Змінити пароль",
  "Obecne hasło": "Поточний пароль", "Powtórz nowe hasło": "Повторіть новий пароль", "Nowe hasła się różnią.": "Нові паролі не збігаються.",
  "Obecne hasło jest nieprawidłowe.": "Поточний пароль неправильний.", "Hasło zmienione. Inne urządzenia zostały wylogowane.": "Пароль змінено. Інші пристрої вийшли з облікового запису.",
  "Ten login jest już zajęty.": "Цей логін уже зайнятий.", "Podaj imię lub nazwę.": "Вкажіть ім’я або назву.", "Osiągnięto limit kont.": "Досягнуто ліміту облікових записів.",
  "Login: 3–40 znaków, małe litery, cyfry, kropka, myślnik lub podkreślenie.": "Логін: 3–40 символів, малі літери, цифри, крапка, дефіс або підкреслення.",
  "Ustawienie tego urządzenia. Zmianę widać od razu.": "Налаштування цього пристрою. Зміну видно одразу.",
  "Automatycznie (komputer 75%, telefon 70%)": "Автоматично (комп’ютер 75%, телефон 70%)", "Gotowe": "Готово", "Zamknij": "Закрити",
  "Ustawienie tego urządzenia.": "Налаштування цього пристрою.",
  // login and start-up
  "Zaloguj się": "Увійти", "Zaloguj kontem Mytko": "Увійти з обліковим записом Mytko", "albo loginem i hasłem": "або логіном і паролем",
  "E-mail lub login": "Ел. пошта або логін", "Hasło": "Пароль", "Pokaż hasło": "Показати пароль", "Ukryj hasło": "Сховати пароль",
  "Konto Mytko Tasks: login i hasło nadane przez operatora.": "Обліковий запис Mytko Tasks: логін і пароль від оператора.",
  "Potrzebujesz dostępu?": "Потрібен доступ?", "Skontaktuj się z operatorem.": "Зверніться до оператора.", "Od pomysłu": "Від ідеї",
  "do zrobionego zadania": "до виконаного завдання", "Tablica, lista i kalendarz": "Дошка, список і календар",
  "Cztery kolumny pracy, przeciąganie i kolejność jako priorytet.": "Чотири робочі колонки, перетягування й порядок як пріоритет.",
  "Przestrzenie i projekty": "Простори й проєкти", "Praca, prywatne i projekty klientów w osobnych folderach.": "Робота, приватне й проєкти клієнтів в окремих папках.",
  "Terminy i czas pracy": "Терміни й час роботи", "Dziś, po terminie, najbliższe 7 dni i licznik czasu.": "Сьогодні, прострочене, найближчі 7 днів і таймер.",
  "Mytko Tasks to prywatna lista zadań: praca i sprawy prywatne, projekty klientów, terminy i czas pracy — w jednym miejscu, obok Mytko Workflow.":
    "Mytko Tasks — приватний список завдань: робота й особисті справи, проєкти клієнтів, терміни й час роботи — в одному місці, поруч із Mytko Workflow.",
  "Nieprawidłowy login lub hasło.": "Неправильний логін або пароль.", "Podaj login i hasło.": "Вкажіть логін і пароль.",
  "Logowanie nie powiodło się. Spróbuj ponownie.": "Не вдалося увійти. Спробуйте ще раз.",
  "Zbyt wiele nieudanych prób. Spróbuj ponownie za kilkanaście minut.": "Забагато невдалих спроб. Спробуйте ще раз за кілька хвилин.",
  "Mytko Workflow jest teraz niedostępny": "Mytko Workflow зараз недоступний", "Mytko Workflow jest teraz niedostępny. Użyj loginu i hasła.": "Mytko Workflow зараз недоступний. Використайте логін і пароль.",
  "Weryfikacja sesji…": "Перевірка сесії…", "Wczytywanie zadań…": "Завантаження завдань…", "Przygotowanie tablicy…": "Підготовка дошки…",
  "Gotowe — otwieranie Tasks…": "Готово — відкриваємо Tasks…", "Uruchamianie Mytko Tasks": "Запуск Mytko Tasks",
  "Brak połączenia z serwerem.": "Немає з’єднання з сервером.", "Spróbuj ponownie": "Спробувати ще раз",
  // toasts and errors
  "Nie udało się.": "Не вдалося.", "Nie udało się zapisać.": "Не вдалося зберегти.", "Nie udało się zapisać zmian.": "Не вдалося зберегти зміни.",
  "Nie udało się wczytać zadań.": "Не вдалося завантажити завдання.", "Nie udało się dodać zadania.": "Не вдалося додати завдання.",
  "Nie udało się przenieść zadania.": "Не вдалося перемістити завдання.", "Nie udało się usunąć zadania.": "Не вдалося видалити завдання.",
  "Nie udało się uruchomić licznika.": "Не вдалося запустити таймер.", "Nie udało się zatrzymać licznika.": "Не вдалося зупинити таймер.",
  "Nie udało się zmienić tytułu.": "Не вдалося змінити назву.", "Nie udało się zapisać opisu.": "Не вдалося зберегти опис.",
  "Nie udało się zmienić terminu.": "Не вдалося змінити термін.", "Nie udało się zmienić przestrzeni.": "Не вдалося змінити простір.",
  "Nie udało się zmienić projektu.": "Не вдалося змінити проєкт.", "Nie udało się zmienić wykonawcy.": "Не вдалося змінити виконавця.",
  "Nie udało się zmienić priorytetu.": "Не вдалося змінити пріоритет.", "Nie udało się zmienić etykiet.": "Не вдалося змінити мітки.",
  "Nie udało się zmienić klienta.": "Не вдалося змінити клієнта.", "Nie udało się zapisać podzadania.": "Не вдалося зберегти підзавдання.",
  "Nie udało się usunąć.": "Не вдалося видалити.", "Nie udało się ustawić celu.": "Не вдалося встановити ціль.",
  "Nie udało się zmienić Workflow.": "Не вдалося змінити Workflow.", "Zadanie usunięte.": "Завдання видалено.", "Zadanie dodane.": "Завдання додано.",
  "Tablica zmieniła się w międzyczasie. Odświeżono, spróbuj ponownie.": "Дошка тим часом змінилася. Оновлено, спробуйте ще раз.",
  "Tablica zmieniła się w międzyczasie. Spróbuj ponownie.": "Дошка тим часом змінилася. Спробуйте ще раз.",
  "Brak połączenia z serwerem. Odśwież dane przed ponownym zapisem.": "Немає з’єднання з сервером. Оновіть дані перед повторним збереженням.",
  "Przekroczono czas oczekiwania. Odśwież dane przed ponownym zapisem — operacja mogła zostać wykonana.": "Час очікування вичерпано. Оновіть дані перед повторним збереженням — операцію могло бути виконано.",
  "Tytuł musi mieć od 3 do 100 znaków.": "Назва має містити від 3 до 100 символів.", "Tytuł zadania musi mieć co najmniej 3 znaki.": "Назва завдання має містити щонайменше 3 символи.",
  "Nazwa musi mieć co najmniej 2 znaki.": "Назва має містити щонайменше 2 символи.", "Nazwa jest za długa.": "Назва задовга.",
  "To zadanie już nie istnieje.": "Цього завдання вже не існує.", "Ta etykieta już nie istnieje.": "Цієї мітки вже не існує.",
  "Ta przestrzeń już nie istnieje.": "Цього простору вже не існує.", "Ten wykonawca już nie istnieje.": "Цього виконавця вже не існує.",
  "Ten projekt już nie istnieje albo jest w archiwum.": "Цього проєкту вже не існує або він в архіві.", "Ten projekt należy do innej przestrzeni.": "Цей проєкт належить іншому простору.",
  "Ta przestrzeń ma jeszcze projekty. Usuń je albo przenieś do innej przestrzeni.": "У цьому просторі ще є проєкти. Видаліть їх або перенесіть до іншого простору.",
  "Wbudowanych przestrzeni (Praca, Prywatne) nie można usunąć.": "Вбудовані простори («Робота», «Приватне») не можна видалити.",
  "Przestrzeń prywatna nigdy nie jest widoczna dla agentów.": "Приватний простір ніколи не видно агентам.",
  "Zadanie może mieć najwyżej 10 różnych etykiet.": "Завдання може мати щонайбільше 10 різних міток.", "Zadanie może mieć najwyżej 100 podzadań.": "Завдання може мати щонайбільше 100 підзавдань.",
  "Zadanie usunięte na zawsze.": "Завдання видалено назавжди.", "Cofnij": "Скасувати", "Otwórz": "Відкрити", "Usuń teraz": "Видалити зараз",
  // archive
  "Zasady archiwum": "Правила архіву", "Archiwum jest puste.": "Архів порожній.", "Przywróć": "Відновити", "Praca i klienci": "Робота й клієнти",
  "Zostaje w archiwum": "Залишається в архіві", "nie są usuwane": "не видаляються", "Wczytywanie archiwum…": "Завантаження архіву…",
  // calendar, meetings
  "Spotkanie": "Зустріч", "Spotkania": "Зустрічі", "Dzień": "День", "Od": "Від", "Do": "До", "Goście (e-maile, dostaną zaproszenie od Google)": "Гості (ел. адреси, отримають запрошення від Google)",
  "Dodaj link Google Meet": "Додати посилання Google Meet", "Miejsce": "Місце", "Dodaj spotkanie": "Додати зустріч", "Dołącz do Google Meet": "Приєднатися до Google Meet",
  "Spotkanie z…": "Зустріч із…", "Podaj tytuł.": "Вкажіть назву.", "Koniec musi być po początku.": "Кінець має бути після початку.",
  "Spotkanie zapisane.": "Зустріч збережено.", "Spotkanie dodane.": "Зустріч додано.", "Spotkanie dodane, zaproszenia wysłane.": "Зустріч додано, запрошення надіслано.",
  "Spotkanie usunięte.": "Зустріч видалено.", "Nie udało się zapisać spotkania.": "Не вдалося зберегти зустріч.", "Zadania do spotkania": "Завдання до зустрічі",
  "Np. przygotować wycenę…": "Напр., підготувати кошторис…", "Zadanie dodane do spotkania.": "Завдання додано до зустрічі.", "Brief ze spotkania": "Бриф зустрічі",
  "Najpierw podłącz kalendarz Google do przestrzeni (Porządek → Przestrzenie).": "Спочатку під’єднайте Google Календар до простору (Упорядкування → Простори).",
  "Kalendarz Google podłączony. Spotkania pojawią się za chwilę.": "Google Календар під’єднано. Зустрічі з’являться за мить.",
  "Nie udzielono dostępu do kalendarza.": "Доступ до календаря не надано.", "Podłączenie kalendarza nie powiodło się. Spróbuj ponownie.": "Не вдалося під’єднати календар. Спробуйте ще раз.",
  "Sesja wygasła w trakcie łączenia kalendarza. Zaloguj się i spróbuj ponownie.": "Сесія завершилася під час під’єднання календаря. Увійдіть і спробуйте ще раз.",
  "przyjął": "прийняв", "odrzucił": "відхилив", "może": "можливо", "bez odpowiedzi": "без відповіді",
  // clients
  "Lead": "Лід", "Zostaje klientem": "Стає клієнтом", "Firma": "Компанія", "Telefon": "Телефон", "Strona": "Сайт", "Zadanie": "Завдання",
  "Brak zaplanowanych spotkań.": "Немає запланованих зустрічей.", "Otwarte zadania": "Відкриті завдання", "Brak otwartych zadań.": "Немає відкритих завдань.",
  "Brak projektów. Przypisz projekt do klienta w „Porządek → Projekty”.": "Немає проєктів. Призначте проєкт клієнту в «Упорядкування → Проєкти».",
  "Karta klienta": "Картка клієнта", "Zapisz": "Зберегти", "Zapisano.": "Збережено.",
  // mail
  "Skrzynka": "Скринька", "Od klientów": "Від клієнтів", "Nieprzeczytane": "Непрочитані", "Załatwione": "Опрацьовані", "Szukaj w poczcie…": "Шукати в пошті…",
  "Szukaj w poczcie": "Шукати в пошті", "Odśwież": "Оновити", "Pierwsza synchronizacja…": "Перша синхронізація…", "Wiadomości": "Листи", "Wybierz wiadomość.": "Виберіть лист.",
  "Wczytuję wiadomość…": "Завантажую лист…", "Nowy lead z nadawcy": "Новий лід із відправника", "Przypisz klienta…": "Призначити клієнта…", "Odepnij klienta": "Відв’язати клієнта",
  "Utwórz zadanie": "Створити завдання", "Odpowiedz": "Відповісти", "Przywróć do skrzynki": "Повернути до скриньки", "Zaproszenie": "Запрошення",
  "Odwołanie spotkania": "Скасування зустрічі", "Link do spotkania": "Посилання на зустріч", "Dodaj do kalendarza Praca": "Додати до календаря «Робота»",
  "Zaproponuj zadania (AI)": "Запропонувати завдання (AI)", "AI czyta wiadomość…": "AI читає лист…", "AI proponuje": "AI пропонує",
  "Jeszcze raz": "Ще раз", "czeka na odpowiedź": "чекає на відповідь", "Bez zadań do zrobienia.": "Без завдань до виконання.", "Załączniki": "Вкладення",
  "Zadania z tej wiadomości": "Завдання з цього листа", "Brak wiadomości. Wszystko załatwione.": "Листів немає. Усе опрацьовано.", "Nic tu jeszcze nie ma.": "Тут ще нічого немає.",
  "Poczta nie jest podłączona": "Пошту не під’єднано", "Oznaczono jako załatwione.": "Позначено як опрацьоване.", "Wraca do skrzynki.": "Повертається до скриньки.",
  "Zadanie dodane, e-mail załatwiony.": "Завдання додано, лист опрацьовано.", "Cofnij załatwienie": "Скасувати опрацювання",
  "Spotkanie dodane do kalendarza Praca.": "Зустріч додано до календаря «Робота».", "Nie udało się wczytać poczty.": "Не вдалося завантажити пошту.",
  "Nie udało się otworzyć wiadomości.": "Не вдалося відкрити лист.", "Notatki ze spotkania → brief": "Нотатки зустрічі → бриф", "Otwórz brief": "Відкрити бриф",
  "Tasks przypisał je do spotkania i przygotował brief.": "Tasks прив’язав їх до зустрічі й підготував бриф.", "Filtr ToDo": "Фільтр ToDo",
  // briefs
  "Podsumowanie": "Підсумок", "Ustalenia": "Домовленості", "Do dopytania": "Уточнити", "Brief strony": "Бриф сайту", "Kopiuj JSON (Website Factory)": "Копіювати JSON (Website Factory)",
  "Proponowane zadania": "Запропоновані завдання", "Dodaj wszystkie": "Додати всі", "Bez nowych zadań.": "Без нових завдань.", "Kolejne spotkanie": "Наступна зустріч",
  "Zaplanuj spotkanie": "Запланувати зустріч", "Notatki ze spotkania": "Нотатки зустрічі", "Przygotuj brief jeszcze raz": "Підготувати бриф ще раз",
  "AI przygotowuje brief…": "AI готує бриф…", "Notatki ze spotkania…": "Нотатки зустрічі…", "Zapisz notatki": "Зберегти нотатки",
  "Przygotuj brief (AI)": "Підготувати бриф (AI)", "Wklej notatki (co najmniej kilka zdań).": "Вставте нотатки (принаймні кілька речень).",
  "Nie udało się wczytać briefu.": "Не вдалося завантажити бриф.", "Skopiowano brief strony (JSON).": "Бриф сайту скопійовано (JSON).", "Nie udało się skopiować.": "Не вдалося скопіювати.",
  "Firma": "Компанія", "Kontakt": "Контакт", "Cel strony": "Мета сайту", "O firmie": "Про компанію", "Odbiorcy": "Аудиторія", "Oferta": "Пропозиція", "Ton": "Тон",
  "Lubi": "Подобається", "Nie lubi": "Не подобається", "Uwagi": "Примітки", "Wczytuję…": "Завантажую…", "Zapisuję…": "Зберігаю…",
  // AI i Workflow
  "AI i Workflow": "AI і Workflow", "Aktywne": "Активне", "Brak kontaktu": "Немає зв’язку", "Wyłączone": "Вимкнено", "Nie skonfigurowane": "Не налаштовано",
  "Brak klucza": "Немає ключа", "Włączone": "Увімкнено", "Wstrzymane": "Призупинено", "nigdy": "ніколи", "przed chwilą": "щойно",
  "Workflow pyta Tasks co 2 minuty, gdy Fujitsu działa. Ostatni kontakt:": "Workflow звертається до Tasks кожні 2 хвилини, коли Fujitsu працює. Останній контакт:",
  "Połączenie włączone": "З’єднання увімкнено",
  "Wyłączone: Workflow nie dostaje zadań i nie zmienia ich statusu, a przycisk wysyłania znika. Zadania w Workflow:":
    "Вимкнено: Workflow не отримує завдань і не змінює їхнього статусу, а кнопка надсилання зникає. Завдань у Workflow:",
  "Na serwerze nie ustawiono tokenu Workflow (WORKFLOW_TOKEN_SHA256), więc połączenie jest niedostępne.": "На сервері не задано токен Workflow (WORKFLOW_TOKEN_SHA256), тож з’єднання недоступне.",
  "AI włączone": "AI увімкнено", "Na serwerze nie ustawiono klucza AI (AI_API_KEY), więc funkcje AI są niedostępne.": "На сервері не задано ключ AI (AI_API_KEY), тож функції AI недоступні.",
  "Zadania do Mytko Workflow": "Завдання до Mytko Workflow", "Ręcznie": "Вручну", "AI podpowiada": "AI підказує", "AI wysyła sama": "AI надсилає сам",
  "Tylko przycisk na karcie i w szczegółach zadania.": "Лише кнопка на картці та в деталях завдання.",
  "AI oznacza zadania programistyczne w Praca, a Ty wysyłasz je jednym kliknięciem.": "AI позначає програмістські завдання в «Робота», а ви надсилаєте їх одним кліком.",
  "AI sama wysyła nowe zadania, co do których jest pewna. Każde możesz wycofać, a już podświetlone wyślesz przyciskiem.": "AI сам надсилає нові завдання, щодо яких певен. Кожне можна відкликати, а вже підсвічені надішлете кнопкою.",
  "Analiza wstrzymana na 15 minut (zmiana ustawień wznawia ją od razu).": "Аналіз призупинено на 15 хвилин (зміна налаштувань одразу його відновлює).",
  "Przeanalizuj teraz": "Проаналізувати зараз", "AI analizuje…": "AI аналізує…",
  "Tylko przestrzenie widoczne dla agentów (np. Praca). Prywatne zadania i konta innych osób nigdy nie trafiają do AI ani do Workflow.":
    "Лише простори, видимі для агентів (напр., «Робота»). Приватні завдання й облікові записи інших людей ніколи не потрапляють до AI чи Workflow.",
  "Nie udało się wczytać ustawień.": "Не вдалося завантажити налаштування.", "Wyślij do ToDo w Mytko Workflow": "Надіслати до ToDo в Mytko Workflow",
  "Nie udało się wysłać do Workflow.": "Не вдалося надіслати до Workflow.", "Nie udało się wycofać.": "Не вдалося відкликати.", "AI → Workflow": "AI → Workflow",
  "Wysłane przez AI": "Надіслано AI", "AI: praca dla Workflow": "AI: робота для Workflow",
  "Połączenie z Mytko Workflow jest wyłączone (Porządek → AI i Workflow)": "З’єднання з Mytko Workflow вимкнено (Упорядкування → AI і Workflow)",
  "Mytko Workflow: aktywne": "Mytko Workflow: активне", "Mytko Workflow: brak kontaktu": "Mytko Workflow: немає зв’язку",
  "Klucz API AI jest nieprawidłowy.": "Ключ API AI недійсний.", "Limit zapytań do AI: spróbuj za chwilę.": "Ліміт запитів до AI: спробуйте за мить.",
  "Brak środków na koncie API AI.": "Немає коштів на рахунку API AI.", "AI odrzuciło zapytanie.": "AI відхилило запит.",
  "AI nie odpowiada. Spróbuj za chwilę.": "AI не відповідає. Спробуйте за мить.", "AI nie zwróciło odpowiedzi.": "AI не повернуло відповіді.",
  "AI nie odpowiada.": "AI не відповідає.", "Dostawca:": "Постачальник:", ", model": ", модель", "AI (API zgodne z OpenAI)": "AI (API, сумісне з OpenAI)",
  "Wyłącz, gdy skończą się środki na API: nic nie trafi wtedy do AI (propozycje z maili, briefy, analiza zadań), a wszystko robisz ręcznie.":
    "Вимкніть, коли закінчаться кошти на API: тоді нічого не потрапить до AI (пропозиції з листів, брифи, аналіз завдань), а все робите вручну.",
  "Sortuj według priorytetu (najwyższy na górze)": "Сортувати за пріоритетом (найвищий угорі)",
  "Kolejność według priorytetu (kliknij: kolejność ręczna)": "Порядок за пріоритетом (клік: ручний порядок)",
  // Cele / Marzenia
  "Cele / Marzenia": "Цілі / Мрії", "Cele": "Цілі", "/ Marzenia": "/ Мрії", "Marzenie": "Мрія", "Rok": "Рік", "Okres": "Період", "Rodzaj": "Тип", "Nagłówek": "Заголовок",
  "Na miesiąc albo na cały rok: co chcesz osiągnąć i o czym marzysz": "На місяць або на цілий рік: чого хочете досягти й про що мрієте",
  "Poprzedni okres": "Попередній період", "Następny okres": "Наступний період", "Nowy cel…": "Нова ціль…", "Nowe marzenie…": "Нова мрія…",
  "Opis i termin": "Опис і термін", "Bez opisu i terminu": "Без опису й терміну", "Opis (opcjonalnie)": "Опис (необов’язково)", "Inne listy": "Інші списки",
  "Pusta lista. Dodaj pierwszy cel albo marzenie na ten okres.": "Список порожній. Додайте першу ціль або мрію на цей період.",
  "Zrobione": "Виконано", "Wyżej": "Вище", "Niżej": "Нижче", "Edytuj": "Редагувати", "Zmień na: Marzenie": "Змінити на: Мрія", "Zmień na: Cel": "Змінити на: Ціль",
  "Podaj nagłówek.": "Вкажіть заголовок.", "Nie udało się wczytać listy.": "Не вдалося завантажити список.", "Nie udało się zmienić kolejności.": "Не вдалося змінити порядок.",
  "Nie udało się dodać.": "Не вдалося додати.",
  // more
  "Bez daty": "Без дати", "Bez terminu": "Без терміну", "Bez przypisanego spotkania": "Без прив’язаної зустрічі", "Cel": "Ціль", "Data": "Дата",
  "Dodaj zadanie do spotkania": "Додати завдання до зустрічі", "Nowe zadanie do spotkania": "Нове завдання до зустрічі", "Nowe podzadanie": "Нове підзавдання",
  "Administrator · konto Mytko": "Адміністратор · обліковий запис Mytko", "Konto Mytko nie ma dostępu do Mytko Tasks.": "Обліковий запис Mytko не має доступу до Mytko Tasks.",
  "Logowanie…": "Вхід…", "Logowanie kontem Mytko nie jest skonfigurowane na serwerze": "Вхід через обліковий запис Mytko не налаштовано на сервері",
  "Logowanie kontem Mytko nie powiodło się. Spróbuj ponownie albo użyj loginu i hasła.": "Не вдалося увійти через обліковий запис Mytko. Спробуйте ще раз або використайте логін і пароль.",
  "Mytko Tasks ma jedno konto właściciela, konfigurowane po stronie serwera. Nowych kont nie można tu utworzyć.": "Mytko Tasks має один обліковий запис власника, налаштований на сервері. Нові облікові записи тут створити не можна.",
  "Najpierw zaloguj się w Mytko Workflow w tej przeglądarce, potem kliknij ponownie „Zaloguj kontem Mytko”.": "Спочатку увійдіть у Mytko Workflow у цьому браузері, потім знову натисніть «Увійти з обліковим записом Mytko».",
  "Nie znaleziono spotkania: brief czeka bez przypisania.": "Зустріч не знайдено: бриф чекає без прив’язки.", "notatki Gemini z Poczty": "нотатки Gemini з Пошти",
  "np. ola": "напр., ola", "np. Ola": "напр., Оля", "Okruszki": "Навігаційний ланцюжок", "Ostatnio zmienione": "Нещодавно змінені", "Skrzynka studia": "Скринька студії",
  "Sortuj:": "Сортувати:", "Wczytywanie poczty…": "Завантаження пошти…", "Widok poczty": "Вигляд пошти", "Włącz JavaScript, aby korzystać z Mytko Tasks.": "Увімкніть JavaScript, щоб користуватися Mytko Tasks.",
  "Wspólna przestrzeń": "Спільний простір", "Wybierz kolor.": "Виберіть колір.", "Wylogować się z Mytko Tasks?": "Вийти з Mytko Tasks?", "Zadania tego spotkania:": "Завдання цієї зустрічі:",
  "Zakres": "Діапазон", "Zaloguj kontem": "Увійти з обліковим записом", "jeszcze nie": "ще ні", "kod → Workflow": "код → Workflow", "zadań": "завдань",
  "AI czyta notatki i przygotowuje brief… (do minuty)": "AI читає нотатки й готує бриф… (до хвилини)",
  "AI jest wyłączone albo nie jest skonfigurowane: zapisano same notatki.": "AI вимкнено або не налаштовано: збережено лише нотатки.",
  "Lead to ktoś przed współpracą (np. po rezerwacji spotkania), klient to stała współpraca. Spotkania z gośćmi z jego adresu lub domeny same się do niego przypinają. Usunięcie zostawia zadania i projekty bez klienta.":
    "Лід — це хтось до початку співпраці (напр., після бронювання зустрічі), клієнт — постійна співпраця. Зустрічі з гостями з його адреси або домену прив’язуються до нього самі. Видалення залишає завдання й проєкти без клієнта.",
  "Spróbuj ponownie": "Спробуйте ще раз", "Wiadomości": "Листи", "Załączniki (otwórz w programie pocztowym):": "Вкладення (відкрийте в поштовій програмі):",
  "Otwórz ponownie": "Відкрити знову", "Oznacz jako zakończone": "Позначити як завершене", "Za rok": "Через рік", "za rok": "через рік", "za 2 lata": "через 2 роки", "za 5 lat": "через 5 років",
  "Niedostępne:": "Недоступно:", "Mytko Workflow nie odpowiada": "Mytko Workflow не відповідає", "logowanie kontem Mytko nie jest skonfigurowane": "вхід через обліковий запис Mytko не налаштовано",
  "Użyj loginu i hasła.": "Використайте логін і пароль.", "lead": "лід", "zablokowane": "заблоковано", "Zakończ": "Завершити",
  "nie są usuwane": "не видаляються", "karta zadania": "картка завдання",
  "Tylko Ty zarządzasz kontami. Osoba z kontem widzi wyłącznie swoje zadania oraz wspólne przestrzenie, do których ją dodasz albo zaprosisz (np. Dom). Nie widzi klientów, spotkań ani innych kont.":
    "Лише ви керуєте обліковими записами. Людина з обліковим записом бачить лише свої завдання та спільні простори, до яких ви її додасте або запросите (напр., Дім). Не бачить клієнтів, зустрічей та інших облікових записів.",
  // shared spaces: people, invitation codes, joining; account pictures
  "Kto jest w tej przestrzeni": "Хто є в цьому просторі", "Osoby": "Люди", "Mam kod zaproszenia": "Маю код запрошення",
  "Masz kod od kogoś? Dołącz nim do jego przestrzeni.": "Маєте код від когось? Приєднайтеся ним до його простору.",
  "Wspólną przestrzeń widzą i edytują tylko osoby, które do niej dodasz z listy kont albo zaprosisz kodem lub linkiem.":
    "Спільний простір бачать і редагують лише люди, яких ви додасте зі списку облікових записів або запросите кодом чи посиланням.",
  "Usuń z przestrzeni": "Видалити з простору", "Szczegóły projektu": "Деталі проєкту", "Przestrzeń, klient, archiwum": "Простір, клієнт, архів", "zarządza przestrzenią": "керує простором", "w przestrzeni": "у просторі",
  "zarządza przestrzenią · to Ty": "керує простором · це ви", "w przestrzeni · to Ty": "у просторі · це ви",
  "Wspólną przestrzeń widzą i edytują tylko osoby z tej listy. Gdy ktoś odchodzi, jego zadania wracają do jego Prywatnych.":
    "Спільний простір бачать і редагують лише люди з цього списку. Коли хтось іде, його завдання повертаються до його «Приватне».",
  "Ta przestrzeń należy do innego konta. Widzisz i edytujesz ją razem z osobami z tej listy.":
    "Цей простір належить іншому обліковому запису. Ви бачите й редагуєте його разом із людьми з цього списку.",
  "Twoje konta": "Ваші облікові записи",
  "Nie masz jeszcze innych kont. Dodasz je w Porządek → Konta albo zaprosisz kogoś kodem.":
    "У вас ще немає інших облікових записів. Додайте їх у «Порядок → Облікові записи» або запросіть когось кодом.",
  "Zaproś kodem lub linkiem": "Запросити кодом або посиланням", "Opuść przestrzeń": "Вийти з простору", "Opuść": "Вийти",
  "Przekaż ten kod albo link jednej osobie. Po wpisaniu kodu (lub otwarciu linku) od razu dołączy do przestrzeni. Kod widzisz tylko teraz.":
    "Передайте цей код або посилання одній людині. Після введення коду (або відкриття посилання) вона одразу приєднається до простору. Код видно лише зараз.",
  "Kod zaproszenia": "Код запрошення", "Udostępnij": "Поділитися", "Kopiuj link": "Копіювати посилання", "Kopiuj kod": "Копіювати код",
  "Link zaproszenia": "Посилання запрошення", "Czekające kody": "Коди, що очікують", "ten powyżej": "той, що вище", "Wycofaj kod": "Відкликати код",
  "Link skopiowany.": "Посилання скопійовано.", "Kod skopiowany.": "Код скопійовано.", "Kod wycofany.": "Код відкликано.",
  "Nie udało się skopiować. Zaznacz i skopiuj ręcznie.": "Не вдалося скопіювати. Виділіть і скопіюйте вручну.",
  "Dołącz do wspólnej przestrzeni": "Приєднатися до спільного простору", "Sprawdź kod": "Перевірити код", "Dołącz": "Приєднатися",
  "Już jesteś w tej przestrzeni.": "Ви вже в цьому просторі.",
  "Zdjęcie profilowe": "Фото профілю", "Usuń zdjęcie": "Видалити фото", "Zmień zdjęcie": "Змінити фото", "Wybierz zdjęcie": "Вибрати фото",
  "Każde zdjęcie zmniejszamy i zapisujemy jako małe, okrągłe zdjęcie. Widzisz je Ty, osoby ze wspólnych przestrzeni i administrator.":
    "Кожне фото зменшуємо й зберігаємо як невелике кругле фото. Його бачите ви, люди зі спільних просторів і адміністратор.",
  "Zdjęcie zapisane.": "Фото збережено.", "Zdjęcie usunięte.": "Фото видалено.",
  "Nie udało się odczytać tego zdjęcia. Wybierz inne (JPG, PNG, WebP, HEIC z iPhone'a).": "Не вдалося прочитати це фото. Виберіть інше (JPG, PNG, WebP, HEIC з iPhone).",
  "Przesuń zdjęcie palcem lub myszką i przybliż je: zapisze się to, co jest w kółku.": "Пересуньте фото пальцем або мишею й наблизьте: збережеться те, що в колі.",
  "Kadrowanie zdjęcia": "Кадрування фото", "Przybliżenie": "Наближення", "Zapisz zdjęcie": "Зберегти фото",
  "Nie udało się zapisać tego zdjęcia. Wybierz inne.": "Не вдалося зберегти це фото. Виберіть інше.",
  "Ten kod nie działa: jest błędny, już użyty, wycofany albo wygasł.": "Цей код не працює: він помилковий, уже використаний, відкликаний або прострочений.",
  "Za dużo błędnych kodów. Spróbuj ponownie za 15 minut.": "Забагато помилкових кодів. Спробуйте знову через 15 хвилин.",
  "Ta przestrzeń ma już 20 czekających kodów. Wycofaj któryś.": "Цей простір уже має 20 кодів, що очікують. Відкличте якийсь.",
  "W tej przestrzeni jest już komplet osób.": "У цьому просторі вже повний склад.", "To konto już jest w tej przestrzeni.": "Цей обліковий запис уже в цьому просторі.",
  "Nie można dodać tego konta.": "Не можна додати цей обліковий запис.", "Tej osoby już nie ma w przestrzeni.": "Цієї людини вже немає в просторі.",
  "Tego kodu już nie ma.": "Цього коду вже немає.", "Ta przestrzeń już nie istnieje albo nie masz do niej dostępu.": "Цей простір уже не існує або ви не маєте до нього доступу.",
  "Wbudowanych przestrzeni (Praca, Prywatne) nie można udostępniać.": "Вбудованими просторами («Робота», «Приватне») не можна ділитися.",
  "Tego zdjęcia nie da się zapisać. Wybierz inne.": "Це фото не можна зберегти. Виберіть інше.",
  "Zadanie może trafić tylko do przestrzeni, którą widzi jego autor.": "Завдання може потрапити лише до простору, який бачить його автор."
};

// Sentences with names or numbers in them: [Polish pattern, Ukrainian template with $1, $2…, where]. "attr" patterns only
// touch attributes (labels of buttons that end with a task's title), so text a person wrote is never rewritten.
const STATUS = "(ToDo|W realizacji|Needs review|Zakończone|Plany długoterminowe)";
const rule = text => (text === "nie są usuwane" ? "не видаляються"
  : text.replace(/^usuwane na zawsze po (\d+) dniach w archiwum$/, "видаляються назавжди через $1 дн. в архіві"));
const PATTERNS = [
  [/^Dodano „(.+)” i wysłano do Workflow\.$/, "Додано «$1» і надіслано у Workflow."],
  [/^Dodano „(.+)”\.$/, "Додано «$1»."],
  [/^Dodano zadania: (\d+)\.$/, "Додано завдань: $1."],
  [new RegExp(`^„(.+)” → ${STATUS}$`), (m, title, status) => `«${title}» → ${UK[status]}`],
  [/^„(.+)” wraca do ToDo\.$/, "«$1» повертається до «До виконання»."],
  [/^Usunąć zadanie „(.+)” razem z notatkami i podzadaniami\? Tego nie da się cofnąć\.$/, "Видалити завдання «$1» разом із нотатками й підзавданнями? Цього не можна скасувати."],
  [/^Usunąć na zawsze „(.+)” razem z notatkami i historią\?$/, "Видалити назавжди «$1» разом із нотатками й історією?"],
  [/^Usunąć „(.+)”\? Goście dostaną odwołanie\.$/, "Видалити «$1»? Гості отримають скасування."],
  [/^Usunąć „(.+)”\? Zadania, projekty i spotkania zostaną, bez klienta\.$/, "Видалити «$1»? Завдання, проєкти й зустрічі залишаться, без клієнта."],
  [/^Usunąć „(.+)”\?$/, "Видалити «$1»?"],
  [/^Rozpocznij pracę: (.+)$/, "Почати роботу: $1", "attr"], [/^Wznów licznik: (.+)$/, "Відновити таймер: $1", "attr"],
  [/^Zatrzymaj licznik: (.+)$/, "Зупинити таймер: $1", "attr"], [/^Przenieś do ToDo: (.+)$/, "Перенести до «До виконання»: $1", "attr"],
  [/^Zatwierdź i zakończ: (.+)$/, "Затвердити й завершити: $1", "attr"], [/^Usuń teraz: (.+)$/, "Видалити зараз: $1", "attr"],
  [/^Otwórz ponownie: (.+)$/, "Відкрити знову: $1", "attr"], [/^Oznacz jako zakończone: (.+)$/, "Позначити як завершене: $1", "attr"],
  [/^Usuń podzadanie (.+)$/, "Видалити підзавдання $1", "attr"], [/^Usuń konto (.+)$/, "Видалити обліковий запис $1", "attr"], [/^Usuń (.+)$/, "Видалити $1", "attr"],
  [new RegExp(`^(.+)\\. ${STATUS}\\. Alt i strzałki przenoszą, Enter otwiera\\.$`), (m, title, status) => `${title}. ${UK[status]}. Alt і стрілки переміщують, Enter відкриває.`, "attr"],
  [new RegExp(`^(.+) — ${STATUS}$`), (m, title, status) => `${title} — ${UK[status]}`, "attr"],
  [new RegExp(`^Dodaj zadanie do kolumny ${STATUS}$`), (m, status) => `Додати завдання до колонки «${UK[status]}»`, "attr"],
  [new RegExp(`^Pokaż tylko kolumnę ${STATUS}$`), (m, status) => `Показати лише колонку «${UK[status]}»`, "attr"],
  [/^Dodaj zadanie na (\d{4}-\d{2}-\d{2})$/, "Додати завдання на $1", "attr"], [/^Nowe spotkanie (\S+) (\d+):00$/, "Нова зустріч $1 $2:00", "attr"],
  [/^Zadania w przestrzeni (.+)$/, "Завдання в просторі $1"], [/^Zadania, prace i działania w projekcie (.+)$/, "Завдання, роботи й справи в проєкті $1"],
  [/^Zakończone dłużej niż (\d+) dni trafiają do Archiwum\.$/, "Завершені понад $1 дн. тому потрапляють до архіву."],
  [/^Zakończone (\d{1,2} \S+ \d{4})$/, "Завершено $1"], [/^Archiwum od (\d{1,2} \S+ \d{4})$/, "В архіві з $1"],
  [/^za (\d+) (dzień|dni)$/, "через $1 дн."], [/^(\d+) (zadanie|zadania|zadań)$/, "завдань: $1"],
  [/^(\d+), (\d+) (zadanie|zadania|zadań)$/, "$1, завдань: $2", "attr"],
  [/^Cel: (\d{4}|\d{1,2} \S+( \d{4})?|Dziś|Jutro|Wczoraj)$/, (m, when) => `Ціль: ${UK[when] || when}`],
  [/^· zadania: (\d+)$/, "· завдань: $1"], [/^· od (.+)$/, "· від $1"], [/^E-mail od (.+)$/, "Лист від $1"],
  [/^zsynchronizowano (\d{1,2}:\d{2})$/, "синхронізовано $1"], [/^Zsynchronizowano \((\d+) wydarzeń\)\.$/, "Синхронізовано ($1 подій)."],
  [/^Nowe wiadomości: (\d+)\.$/, "Нові листи: $1."], [/^Lead „(.*)” dodany do Klientów\.$/, "Лід «$1» додано до клієнтів."],
  [/^(.+) jest teraz klientem\.$/, "$1 тепер клієнт."], [/^Konto (.+) utworzone\. Login: (.+)$/, "Обліковий запис $1 створено. Логін: $2"],
  [/^Konto (.+) zablokowane i wylogowane\.$/, "Обліковий запис $1 заблоковано й виведено із системи."], [/^(.+) może się znowu logować\.$/, "$1 знову може входити."],
  [/^Nowe hasło dla (.+): (\S+)$/, "Новий пароль для $1: $2"],
  [/^Ustawić nowe hasło dla konta (.+)\? To konto zostanie wylogowane na wszystkich urządzeniach\. Nowe hasło: (\S+)$/,
    "Встановити новий пароль для облікового запису $1? Цей обліковий запис вийде на всіх пристроях. Новий пароль: $2"],
  [/^Usunąć konto (.+) razem z jego zadaniami, przestrzeniami i etykietami\? Twoje zadania z przestrzeni tego konta wrócą do Twoich Prywatnych\. Tego nie da się cofnąć\.$/,
    "Видалити обліковий запис $1 разом із його завданнями, просторами й мітками? Ваші завдання з просторів цього облікового запису повернуться до вашого «Приватне». Цього не можна скасувати."],
  [/^Hasło musi mieć co najmniej (\d+) znaków\.$/, "Пароль має містити щонайменше $1 символів."],
  [/^Nowe hasło musi mieć co najmniej (\d+) znaków\.$/, "Новий пароль має містити щонайменше $1 символів."],
  [/^Nowe hasło \(co najmniej (\d+) znaków\)$/, "Новий пароль (щонайменше $1 символів)"],
  [/^Masz aktywną sesję Mytko\? Wejdziesz jednym kliknięciem\. Sesja trwa (\d+) (dni|godzinę|godziny|godzin)\.$/,
    (m, n, unit) => `Маєте активну сесію Mytko? Увійдете одним кліком. Сесія триває ${n} ${unit === "dni" ? "дн." : "год"}.`],
  [/^Zakończone zadania trafiają tu po (\S+) dniach\. Prywatne są (.+), praca i projekty klientów (.+) — razem z notatkami, podzadaniami i historią\.$/,
    (m, days, own, work) => `Завершені завдання потрапляють сюди через ${days} дн. «Приватне» ${rule(own)}, робота й проєкти клієнтів ${rule(work)} — разом із нотатками, підзавданнями та історією.`],
  [/^usuwane na zawsze po (\d+) dniach w archiwum$/, (m, days) => rule(m)],
  [/^(.+) · wiadomości, zadania i leady z e-maili$/, (m, box) => `${UK[box] || box} · листи, завдання й ліди з ел. пошти`],
  [/^Spotkanie: (.+)$/, "Зустріч: $1", "attr"],
  [/^Osoby w „(.+)”$/, "Люди в «$1»"], [/^Zaproszenie do „(.+)”$/, "Запрошення до «$1»"], [/^Usuń z przestrzeni: (.+)$/, "Видалити з простору: $1", "attr"],
  [/^Opuścić „(.+)”\? Przestrzeń zniknie z Twojej tablicy, a Twoje zadania z niej wrócą do Twoich Prywatnych\.$/,
    "Вийти з «$1»? Простір зникне з вашої дошки, а ваші завдання з нього повернуться до вашого «Приватне»."],
  [/^„(.+)” to Ty\? Jego zadania zostaną przypisane do Ciebie, a ten wpis zniknie\.$/, "«$1» — це ви? Його завдання буде призначено вам, а цей запис зникне."],
  [/^Przypisano do Ciebie zadań: (\d+)\.$/, "Призначено вам завдань: $1."],
  [/^Opuszczono „(.+)”\.$/, "Ви вийшли з «$1»."], [/^Dołączono do „(.+)”\.$/, "Ви приєдналися до «$1»."],
  [/^Usunąć (.+) z „(.+)”\? Zadania tej osoby z tej przestrzeni wrócą do jej Prywatnych\.$/, "Видалити $1 з «$2»? Завдання цієї людини з цього простору повернуться до її «Приватне»."],
  [/^Jednorazowy, ważny do (.+)\.$/, "Одноразовий, дійсний до $1."], [/^Ważny do (.+)$/, "Дійсний до $1"], [/^Osób w przestrzeni: (\d+)$/, "Людей у просторі: $1"],
  [/^(\d+) min temu$/, "$1 хв тому"], [/^(\d+) godz\. temu$/, "$1 год тому"],
  [/^Ostatnia analiza: (.+) · do wysłania: (\d+) · wysłane przez AI: (\d+)$/, (m, when, todo, sent) => `Останній аналіз: ${UK[when] || when.replace(/^(\d+) min temu$/, "$1 хв тому").replace(/^(\d+) godz\. temu$/, "$1 год тому")} · до надсилання: ${todo} · надіслано AI: ${sent}`],
  [/^Sprawdzone zadania: (\d+), wysłane do Workflow: (\d+)\.$/, "Перевірено завдань: $1, надіслано до Workflow: $2."],
  [/^„(.+)” → ToDo w Mytko Workflow\.$/, "«$1» → ToDo в Mytko Workflow."],
  [/^Wyślij do ToDo w Mytko Workflow: (.+)$/, "Надіслати до ToDo в Mytko Workflow: $1", "attr"],
  [/^AI: (.+) Wyślij do ToDo w Mytko Workflow$/, "AI: $1 Надіслати до ToDo в Mytko Workflow", "attr"],
  [/^Zrobione (\d+) z (\d+)$/, "Виконано $1 з $2"], [/^Cele (\d+\/\d+) · Marzenia (\d+\/\d+)$/, "Цілі $1 · Мрії $2"], [/^Rok (\d{4})$/, "Рік $1"],
  [/^Zrobione: (.+)$/, "Виконано: $1", "attr"], [/^(.+)\. Alt i strzałki zmieniają kolejność\.$/, "$1. Alt і стрілки змінюють порядок.", "attr"], [/^\+(\d+) więcej$/, "+$1 більше"],
  [/^(P\d) · termin (\S+)$/, "$1 · термін $2"], [/^· termin (\S+)$/, "· термін $1"],
];

// Content people write is shown inside these; its text is never translated (their buttons' labels still are).
const PROTECTED = [
  '[translate="no"]', ".card__title", ".row__title", ".agenda__title", ".subtasks span", ".notes p", ".event", ".week__event span",
  ".client-row > span", ".chip--client", ".chip--project", ".chip--label", '[data-action="scope"].nav-item--sub > span', '[data-action="client-scope"] > span:not(.folder)', ".crumb:not(.crumb--home)",
  ".account__text strong", ".person__name", ".join-space strong", ".mail-row__from", ".mail-row__subject", ".mail-row__snippet", ".mail__reader h2", ".mail__from strong",
  ".mail__body", ".mail-proposals strong", ".brief__section > p", ".timer-dock__text strong", ".popover__item > span:last-child", ".goal__title", ".goal__desc",
].join(", ");
const BUILT_IN = new Set(["Praca", "Prywatne"]);
const ATTRIBUTES = ["title", "aria-label", "placeholder", "aria-valuetext", "aria-roledescription"];
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "CODE", "PRE", "svg"]);

function translate(text, where = "text") {
  const core = text.trim().replace(/\s+/g, " ");
  if (!core || !/[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]/.test(core)) return text;
  let out = UK[core];
  if (out === undefined) {
    for (const [pattern, replacement, scope] of PATTERNS) {
      if (scope && scope !== where) continue;
      if (pattern.test(core)) { out = core.replace(pattern, replacement); break; }
    }
  }
  if (out === undefined || out === core) return text;
  return text.match(/^\s*/)[0] + out + text.match(/\s*$/)[0];
}

function translateText(node) {
  const parent = node.parentElement;
  if (!parent || SKIP.has(parent.tagName) || parent.closest(PROTECTED)) return;
  // an option holding a project, client, label, person or space (its value is an id) is a name someone gave
  if (parent.tagName === "OPTION" && /^\d+$/.test(parent.value) && !BUILT_IN.has(node.data.trim())) return;
  const next = translate(node.data);
  if (next !== node.data) node.data = next;
}

function translateAttributes(element) {
  if (element.closest('[translate="no"]')) return;
  for (const name of ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (value) { const next = translate(value, "attr"); if (next !== value) element.setAttribute(name, next); }
  }
}

function translateTree(root) {
  if (root.nodeType === Node.TEXT_NODE) return translateText(root);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  if (SKIP.has(root.tagName)) return translateAttributes(root);
  // a text field's or a script's content is never translated, its placeholder and label are
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: node => {
      if (node.nodeType !== Node.ELEMENT_NODE || !SKIP.has(node.tagName)) return NodeFilter.FILTER_ACCEPT;
      translateAttributes(node);
      return NodeFilter.FILTER_REJECT;
    }
  });
  for (let node = walker.currentNode; node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) translateText(node);
    else translateAttributes(node);
  }
}

// Starts translating the page (and everything rendered later). Nothing happens in Polish.
export function startTranslation() {
  if (LANG === "pl") return;
  document.documentElement.lang = "uk";
  document.title = translate(document.title);
  translateTree(document.body);
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "attributes") translateAttributes(record.target);
      else if (record.type === "characterData") translateText(record.target);
      else for (const node of record.addedNodes) translateTree(node);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
}

// For text that never reaches the page (confirm() dialogs) and for tests.
export const t = text => (LANG === "uk" ? translate(text) : text);
