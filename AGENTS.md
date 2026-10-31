# AGENTS.md — Mytko Tasks

Instrukcje dla agentów (Codex, Claude i innych) pracujących nad tym repozytorium
w ramach Mytko Workflow.

## Stos (nie zmieniać bez zgody operatora)

- Vanilla JavaScript (natywne moduły ES, bez bundlera), HTML, SCSS
- Express 5 / Node.js 22+ (CommonJS w `backend/`)
- PostgreSQL

## Izolacja i Git

- Każda sesja pracuje w **osobnym worktree** na **własnym branchu** utworzonym przez Mytko.
- Pracuj wyłącznie na przydzielonym branchu. Nie twórz, nie przełączaj, nie usuwaj branchy.
- Przed zmianami: `pwd`, `git rev-parse --show-toplevel`, `git status --short`,
  `git worktree list`. Nie nadpisuj niezatwierdzonych zmian innych sesji.
- **Zakazane** dla agenta: `push`, `merge`, `rebase`, modyfikacja `main`,
  zmiana konfiguracji/hooków/remote Git, dostęp do poświadczeń GitHub/SSH.
- Commit tylko na branchu sesji, po przejściu walidacji i za zgodą operatora.
- Nie używaj wspólnego `git stash` bez unikalnego tagu.

## Przepływ zmian

1. Implementacja w worktree sesji.
2. Lokalna walidacja (sekcja niżej) — raportuj osobno PASS / FAIL / SKIPPED.
3. PR do `main` (tworzy Mytko / operator) → review.
4. **validate → deploy** wykonuje wyłącznie Mytko (zaufany pipeline).

## Produkcja i dane — bezwzględne zakazy

- Żadnych samodzielnych operacji produkcyjnych: deploy na OVH (`task.mytko.dev`),
  restart usług, zmiany DNS/TLS.
- Nie łącz się z produkcyjną bazą. Nie uruchamiaj migracji na istniejących danych.
- Nie usuwaj danych historycznych.
- Nie odczytuj, nie wypisuj i nie rotuj sekretów (`.env`, `.env.local`, hasła).
  Konfiguracja tylko przez zmienne środowiskowe; szablon: `backend/.env.example`.
- Nie korzystaj z hostowego Docker socketa ani globalnej instalacji Node jako obejścia
  ograniczeń środowiska — zgłoś BLOCKED z instrukcją dla operatora.

## Walidacja (wymagana przed statusem READY FOR REVIEW)

```bash
npm --prefix backend ci
npm --prefix frontend install        # lub `ci`, gdy istnieje frontend/package-lock.json
npm --prefix frontend run build      # generuje frontend/dist/style.css
npm --prefix frontend test
npm --prefix backend test
git diff --check
```

- Testy z prawdziwą bazą: tylko `TEST_DATABASE_URL` wskazujący osobną bazę z `test`
  w nazwie (test odmawia uruchomienia w innym przypadku).
- Smoke test: `DATABASE_URL=<lokalna baza testowa> npm --prefix backend start`, następnie
  `curl -fsS http://127.0.0.1:3000/health` i `curl -fsS http://127.0.0.1:3000/dist/style.css`.
- Nie deklaruj PASS dla testów, których nie uruchomiono.

## Konwencje kodu

- Backend: routery jako fabryki `createXRouter(pool)`; `app.js` nie łączy się z bazą,
  co pozwala testować kontrakt HTTP z fałszywą pulą (`backend/test/helpers.js`).
- Błędy API zawsze jako JSON `{ "message": "..." }`.
- Frontend: wywołania HTTP tylko przez `frontend/js/api/http.js` (rzuca `ApiError`
  przy statusie ≠ 2xx). Tekst użytkownika w szablonach HTML zawsze przez `escapeHtml`,
  kolory w `style` przez `safeColor`.
- `frontend/dist/` jest generowany — nie commituj go.
- Testy: `node:test`, bez dodatkowych frameworków.

## Poza zakresem bez osobnego zadania

Nowy widok Kanban, Drag & Drop, logowanie/sesje, nowe migracje modelu zadań,
załączniki, archiwizacja, Google Calendar, AI Suggestions, integracja API z Mytko
Workflow, wdrożenie na OVH.
