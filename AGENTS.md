# AGENTS.md — Mytko Tasks

Instrukcje dla agentów (Codex, Claude i innych) pracujących nad tym repozytorium
w ramach Mytko Workflow.

## Stos (nie zmieniać bez zgody operatora)

- Vanilla JavaScript (natywne moduły ES, bez bundlera), HTML, SCSS
- Express 5 / Node.js 22+ (CommonJS w `backend/`)
- PostgreSQL

## Mytko Kit (wspólny kod aplikacji Mytko)

- **Wspólny kod jest w `frontend/vendor/mytko-kit/` i `backend/vendor/mytko-kit/`: to kopia zestawu Mytko Kit
  (osobne repozytorium `mytko-kit`). Nigdy jej tu nie edytuj** — zmień zestaw i uruchom w nim
  `node tools/sync.mjs <ta aplikacja>`, a kopię zacommituj jako całość („chore: Mytko Kit <wersja> (<commit>)”).
  Testy `backend/test/kit.test.js` i `frontend/test/kit.test.js` nie przechodzą, gdy kopia różni się od manifestu
  (`mytko-kit.json`).
- Tasks ma **własny model właściciela** (właściciel = sesja bez `user_id`, konta członków w `users`): własne
  `config.js`, `users.js`, `access.js` i trasy logowania/kont zostają w aplikacji i korzystają z kryptografii, sesji i
  zabezpieczeń zestawu (`backend/kit.js`). Zmienne: `ADMIN_LOGIN` / `ADMIN_PASSWORD_HASH`, a gdy ich nie ma —
  dotychczasowe `AUTH_USERNAME` / `AUTH_PASSWORD_HASH`.
- Frontend: z zestawu pochodzą pomocniki, rozmiar interfejsu, ekran startowy, toasty, ikony, rdzeń service workera,
  tokeny, reset, podstawa strony i style ekranu logowania. Teksty komponentów zestawu: `KIT_TEXTS` w
  `frontend/js/i18n.js` (słowa Tasks nad tekstami zestawu); reszta interfejsu jest pisana po polsku i tłumaczona przez
  `js/i18n.js`. Moduły zestawu importuj z `core.js`, `ui.js`, `icons.js` (dawne ścieżki działają, ale każda to jeden
  plik więcej przy wejściu na stronę).
- Limit żądań na adres (`RATE_LIMIT_MAX` na minutę) liczy tylko `/api` i `/auth` (`kit.limitDynamicRoutes`); pliki
  statyczne się nie liczą. Nowa trasa poza tymi ścieżkami (poza health checks) nie przejdzie
  `backend/test/limit.test.js`.

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

- Żadnych samodzielnych operacji produkcyjnych: deploy na OVH (`tasks.mytko.dev`),
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
