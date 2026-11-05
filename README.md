# Todo App

## Opis projektu

Aplikacja typu Todo List wykonana w pełnym stacku (frontend + backend + baza danych).
Umożliwia zarządzanie zadaniami oraz kategoriami z pełną integracją z bazą danych PostgreSQL.

Projekt został wykonany bez frameworków frontendowych (Vanilla JS), aby pokazać zrozumienie działania komunikacji klient–serwer oraz REST API.

---

## Technologie

### Frontend
- HTML
- CSS
- JavaScript (Vanilla JS)
- Fetch API

### Backend
- Node.js
- Express.js
- REST API

### Baza danych
- PostgreSQL

---

## Funkcjonalności

### Zadania (Tasks)
- Dodawanie nowych zadań
- Usuwanie pojedynczych zadań
- Usuwanie wszystkich zadań z danej daty
- Edycja zadań (update)
- Oznaczanie zadań jako wykonane
- Grupowanie zadań według daty

### Kategorie (Categories)
- Dodawanie kategorii
- Usuwanie kategorii
- Przypisywanie kategorii do zadań
- Licznik zadań w kategoriach

### Dodatkowe funkcjonalności
- Walidacja danych po stronie backendu
- Obsługa błędów API
- Formatowanie dat (Dzisiaj / Wczoraj / konkretna data)
- Przechowywanie danych w PostgreSQL (brak localStorage)

---

## Architektura aplikacji

Aplikacja działa w architekturze klient–serwer:

- Frontend komunikuje się z backendem poprzez HTTP (Fetch API)
- Backend udostępnia REST API
- Dane przechowywane są w bazie PostgreSQL
- Relacje między tabelami:
  - tasks.category_id -> categories.id (FOREIGN KEY)

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
