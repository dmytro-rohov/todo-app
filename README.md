# Mytko Tasks (Todo App)

## Opis projektu

Prywatny menedżer zadań rozwijany w ramach Mytko Workflow. Obecnie jest to
aplikacja typu Todo List w pełnym stacku (frontend + backend + baza danych),
docelowo menedżer Kanban dostępny pod `task.mytko.dev`.

Projekt jest wykonany bez frameworków frontendowych (Vanilla JS, natywne moduły ES),
aby pokazać zrozumienie komunikacji klient–serwer oraz REST API.

---

## Technologie

- **Frontend:** HTML, SCSS (kompilowany do `frontend/dist/style.css`), Vanilla JS (moduły ES), Fetch API
- **Backend:** Node.js, Express 5, REST API
- **Baza danych:** PostgreSQL

## Wymagania

| Narzędzie  | Wersja                              |
|------------|-------------------------------------|
| Node.js    | 22 LTS lub nowszy (`.nvmrc`)        |
| npm        | 10 lub nowszy                       |
| PostgreSQL | 16 lub nowszy (zrzut z wersji 16)   |

---

## Funkcjonalności

### Zadania (Tasks)
- Dodawanie, edycja, oznaczanie jako wykonane
- Usuwanie pojedynczych zadań oraz wszystkich zadań z danej daty
- Grupowanie zadań według daty

### Kategorie (Categories)
- Dodawanie i usuwanie kategorii
- Przypisywanie kategorii do zadań
- Licznik zadań w kategoriach

### Dodatkowe
- Walidacja danych po stronie backendu
- Obsługa błędów API po stronie frontendu
- Bezpieczne renderowanie tekstu (escapowanie HTML)
- Formatowanie dat (Dzisiaj / Wczoraj / konkretna data)

---

## Architektura

- Backend Express serwuje API (`/tasks`, `/categories`, `/health`) oraz frontend
  (`/`, `/js/*`, `/dist/*`) z jednego originu — frontend używa względnych ścieżek API.
- Dane przechowywane są w PostgreSQL; relacja `tasks.category_id -> categories.id`
  (`ON DELETE SET NULL`).

```
backend/
  app.js          fabryka aplikacji Express (bez połączenia z bazą — testowalna)
  server.js       punkt startowy: konfiguracja, pula pg, nasłuch
  config.js       odczyt i walidacja zmiennych środowiskowych
  validation.js   walidacja danych wejściowych
  routes/         routery /tasks i /categories
  test/           testy backendu (node:test)
frontend/
  index.html
  js/             moduły ES (bez bundlera)
  styles/         źródła SCSS
  dist/           wynik kompilacji SCSS (generowany, ignorowany przez Git)
  test/           testy frontendu (node:test, bez DOM)
database.sql      schemat bazy (zrzut pg_dump)
```

### API

| Metoda | Ścieżka               | Sukces                         | Błędy          |
|--------|-----------------------|--------------------------------|----------------|
| GET    | `/tasks`              | 200 `[{id,title,completed,date,categoryId}]` | 500 |
| POST   | `/tasks`              | 201 `{message}`                | 400, 500       |
| PUT    | `/tasks/:id`          | 200 zaktualizowany wiersz      | 400, 404, 500  |
| DELETE | `/tasks/:id`          | 200 `{message}`                | 400, 500       |
| DELETE | `/tasks/date/:date`   | 200 `{message}`                | 400, 500       |
| GET    | `/categories`         | 200 `[{id,name,color}]`        | 500            |
| POST   | `/categories`         | 201 `{id,name,color}`          | 400, 500       |
| DELETE | `/categories/:id`     | 200 `{message}`                | 400, 500       |
| GET    | `/health`             | 200 `{status:"ok"}`            | 503            |

Wszystkie błędy zwracają JSON `{ "message": "..." }`.

---

## Konfiguracja

Konfiguracja pochodzi wyłącznie ze zmiennych środowiskowych. Szablon bez sekretów:
`backend/.env.example`.

| Zmienna             | Wymagana | Domyślnie   | Opis |
|---------------------|----------|-------------|------|
| `DATABASE_URL`      | tak      | —           | `postgres://user:password@host:5432/todo_app` |
| `HOST`              | nie      | `127.0.0.1` | adres nasłuchu |
| `PORT`              | nie      | `3000`      | port HTTP |
| `CORS_ORIGIN`       | nie      | brak (CORS wyłączony) | origin dopuszczony, gdy UI działa z innego serwera |
| `TEST_DATABASE_URL` | tylko testy | —        | izolowana baza testowa (nazwa musi zawierać `test`) |

Lokalnie można utworzyć `backend/.env` (ignorowany przez Git) — `server.js` wczyta go
przy starcie; zmienne ustawione w środowisku mają pierwszeństwo. Brak `DATABASE_URL`
kończy start czytelnym błędem i kodem wyjścia 1.

**Nigdy nie commituj prawdziwych haseł.** Hasła produkcyjne zarządza operator.

---

## Uruchomienie lokalne

```bash
# 1. Zależności
npm --prefix backend ci
npm --prefix frontend install     # pierwszy raz utworzy frontend/package-lock.json

# 2. Build CSS (frontend/dist/style.css)
npm --prefix frontend run build

# 3. Lokalna baza (NIE produkcyjna)
createdb todo_app
psql -d todo_app -f database.sql

# 4. Konfiguracja
cp backend/.env.example backend/.env   # uzupełnij DATABASE_URL

# 5. Start
npm --prefix backend start            # lub: npm --prefix backend run dev (nodemon)
# otwórz http://127.0.0.1:3000/
```

Podczas pracy nad stylami: `npm --prefix frontend run watch`.

## Testy

```bash
npm --prefix frontend test   # escapowanie HTML, klient API, regresja podwójnego dodawania, zasoby
npm --prefix backend test    # konfiguracja, kontrakt HTTP (fałszywa pula), serwowanie zasobów
```

Testy integracyjne z prawdziwą bazą uruchamiają się tylko z `TEST_DATABASE_URL`
wskazującym **osobną, jednorazową** bazę, której nazwa zawiera `test`. Każdy przebieg
tworzy własny tymczasowy schemat i usuwa go po zakończeniu:

```bash
createdb todo_app_test
TEST_DATABASE_URL=postgres://user:password@localhost:5432/todo_app_test npm --prefix backend test
```

Bez tej zmiennej testy integracyjne są oznaczone jako SKIPPED.

---

## Praca w Mytko Workflow

Zasady pracy agentów i ograniczenia środowiska opisuje [AGENTS.md](AGENTS.md).

# Stopka

zrobione przez mytko.dev
