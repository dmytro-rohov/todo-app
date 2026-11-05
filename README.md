# Mytko Tasks

Prywatna lista zadań właściciela Mytko: praca i sprawy prywatne, projekty klientów, terminy i czas pracy.
Działa na `tasks.mytko.dev`, wygląda i loguje się tak samo jak Mytko Workflow.

## Technologie

- **Frontend:** Vanilla JS (natywne moduły ES, bez bundlera), SCSS, ikony SVG inline.
- **Backend:** Node.js 24, Express 5, REST API.
- **Baza:** PostgreSQL 17, schemat i migracje w Drizzle.

## Funkcjonalności

### Logowanie
- Ekran logowania taki sam jak w Mytko Workflow: login i hasło właściciela.
- **„Zaloguj kontem Mytko”**: kto jest zalogowany w Mytko Workflow, jest logowany automatycznie.
- Sesje po stronie serwera: 7 dni, wylogowanie, blokada po nieudanych próbach.

### Tablica
- Cztery kolumny: **ToDo, W realizacji, Needs review, Zakończone**.
- Przeciąganie kart między kolumnami i w obrębie kolumny: myszą, palcem (przytrzymaj kartę) i klawiaturą (Alt + strzałki).
  Kolejność w kolumnie to priorytet. Przeniesienie można cofnąć.
- Karty pokazują projekt, etykiety, wykonawcę, termin (Dziś / Jutro / data; po terminie na czerwono), podzadania i czas pracy.
- **Licznik czasu**: ▶ na karcie ToDo zaczyna pracę (zadanie przechodzi do „W realizacji”). Działa jeden licznik naraz.
  ⚠ w „Needs review” zatwierdza zadanie i je kończy.

### Szczegóły zadania (panel boczny)
- Edycja tytułu, statusu, terminu, przestrzeni, projektu, wykonawcy, priorytetu, etykiet i opisu.
- Podzadania, notatki z datą, historia zmian, licznik czasu, usuwanie.

### Widoki, wyszukiwanie i filtry
- **Tablica, Lista** (grupy po statusie, sortowanie) i **Kalendarz** (miesiąc; przeciągnięcie zadania na inny dzień zmienia termin, klik w dzień dodaje zadanie).
- Kafelki: otwarte, na dziś, po terminie, w ciągu 7 dni. Kliknięcie kafelka filtruje.
- Wyszukiwarka (Ctrl K) po tytule, opisie, projekcie, etykietach i osobach.
- Filtry: status, projekt, etykieta, wykonawca, „Pokaż zakończone”. Powiadomienia (dzwonek): na dziś i po terminie.

### Porządek
- **Przestrzenie**: Praca, Prywatne i własne. Prywatne nigdy nie są widoczne dla integracji ani agentów.
- **Projekty / klienci** jako foldery w przestrzeni, z kolorem i archiwum.
- **Etykiety** (kilka na zadanie) i **wykonawcy**.
- Linki: `#board`, `#list`, `#calendar`, `#task-<id>`, `#new`, `#manage-projects`.

---

## Struktura bazy danych

- `spaces`: przestrzenie (wbudowane Praca i Prywatne oraz własne)
- `projects`: projekty i klienci, każdy w jednej przestrzeni
- `tasks`: zadania (status, priorytet, termin, kolejność, przestrzeń, projekt, etykieta główna)
- `categories`: etykiety; dodatkowe etykiety zadania w `task_labels`
- `task_notes`, `task_subtasks`, `task_history`: notatki, podzadania i historia zmian zadania

Szczegóły modelu, reguły i API: [docs/TASKS-1-0-DATA-MODEL.md](docs/TASKS-1-0-DATA-MODEL.md).

---

## Instalacja i uruchomienie projektu (lokalnie)

Wymagania: Node.js 24, PostgreSQL.

```bash
# 1. Baza danych: dwie role (właściciel schematu i aplikacja) – patrz deploy/db-roles.sql.example

# 2. Backend
cd backend
npm install
cp .env.example .env        # uzupełnić DATABASE_URL / MIGRATION_DATABASE_URL
npm run migrate             # tworzy/aktualizuje schemat (backend/drizzle/*.sql, Drizzle)
npm run dev                 # http://localhost:3000 – API + frontend

# 3. Style (SCSS -> frontend/dist/style.css)
cd ../frontend
npm install
npm run build:css

# 4. Testy
cd ../backend
npm test                    # testy integracyjne wymagają TEST_DATABASE_URL, patrz docs/PRODUCTION.md
../deploy/smoke-test.sh     # pełny test obrazu Docker (wymaga Dockera)
```

Schemat bazy jest zdefiniowany w `backend/db/schema.js`, a migracje (Drizzle, `backend/drizzle/`) generuje `npm run db:generate`. Na produkcji migracje stosuje zatwierdzona ścieżka Mytko (Database Broker); `npm run migrate` służy do baz dev/test. Reguły domenowe (`completed` ⇔ `status`, `position`, `updated_at`) są w aplikacji, nie w triggerach.

## Produkcja

Obraz Docker, Compose, zmienne środowiskowe, kopie zapasowe, rollback i kryteria akceptacji: [docs/PRODUCTION.md](docs/PRODUCTION.md).

# Stopka

zrobione przez mytko.dev
