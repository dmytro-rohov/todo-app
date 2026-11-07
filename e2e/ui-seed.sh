#!/bin/bash
# Seeds a realistic board through the API (AUTH_DISABLED dev container on 127.0.0.1:3197).
U=${TASKS_URL:-http://127.0.0.1:3197}/api; H=(-s -H content-type:application/json -H sec-fetch-site:same-origin)
post() { curl "${H[@]}" -X POST -d "$2" $U/$1; }
id() { python3 -c "import json,sys;print(json.load(sys.stdin)['id'])"; }
D() { date -d "$1" +%F; }
WORK=$(curl -s $U/spaces | python3 -c "import json,sys;print([s['id'] for s in json.load(sys.stdin) if s['key']=='work'][0])")
PRIV=$(curl -s $U/spaces | python3 -c "import json,sys;print([s['id'] for s in json.load(sys.stdin) if s['key']=='private'][0])")
ORHEA=$(post projects "{\"name\":\"ORHEA\",\"color\":\"#b7e34d\",\"spaceId\":$WORK}" | id)
MARY=$(post projects "{\"name\":\"Made by Mary\",\"color\":\"#38bdf8\",\"spaceId\":$WORK}" | id)
DOM=$(post projects "{\"name\":\"Dom\",\"color\":\"#f2c463\",\"spaceId\":$PRIV}" | id)
L() { post categories "{\"name\":\"$1\",\"color\":\"$2\"}" | id; }
FE=$(L Frontend "#9ca3af"); PERF=$(L Performance "#b7e34d"); SEO=$(L SEO "#e5e7eb"); CONTENT=$(L Content "#d1d5db"); TEST=$(L Testy "#cbd5e1"); UX=$(L UX "#a3e635"); INFRA=$(L Infrastruktura "#94a3b8"); MAINT=$(L Maintenance "#9ca3af"); DEVOPS=$(L DevOps "#a1a1aa")
A() { post assignees "{\"name\":\"$1\",\"color\":\"$2\"}" | id; }
DR=$(A "Dima Rohov" "#8a9a8c"); MR=$(A "Maria Rohova" "#7b8b7d"); KK=$(A "Kamil Kowalski" "#6f7f71")
T() { post tasks "{\"title\":\"$1\",\"date\":\"$(date +%F)\",\"status\":\"$2\",\"projectId\":$3,\"labelIds\":[$4],\"assigneeId\":$5,\"dueDate\":$6}" | id; }
T "Przygotować aktualizację motywu pod nowe komponenty" todo $ORHEA $FE null "\"$(D '+1 day')\"" >/dev/null
T "Zoptymalizować obrazy na stronie usług" todo $ORHEA $PERF $MR "\"$(D '+3 days')\"" >/dev/null
T "Dodać metadane SEO dla kluczowych podstron" todo $ORHEA $SEO $DR "\"$(D '+5 days')\"" >/dev/null
I1=$(T "Wdrożyć zmiany w kafelkach usług" in_progress $ORHEA $FE $DR null)
I2=$(T "Poprawić ładowanie fontów (i wyeliminować CLS)" in_progress $ORHEA $PERF $MR null)
I3=$(T "Uzupełnić treści na podstronie „O nas”" in_progress $ORHEA $CONTENT $KK null)
T "Testowanie nowego motywu na środowisku staging" needs_review $ORHEA $TEST $KK "\"$(D today)\"" >/dev/null
T "Weryfikacja wydajności po optymalizacji obrazów" needs_review $ORHEA $PERF $DR "\"$(D today)\"" >/dev/null
T "Przegląd zmian w strukturze nawigacji" needs_review $ORHEA $UX $MR "\"$(D '-2 days')\"" >/dev/null
T "Migracja strony na nowy serwer" done $ORHEA $INFRA $DR "\"$(D '-6 days')\"" >/dev/null
T "Aktualizacja WordPress do najnowszej wersji" done $MARY $MAINT $MR "\"$(D '-7 days')\"" >/dev/null
T "Konfiguracja środowiska produkcyjnego" done $ORHEA $DEVOPS $KK "\"$(D '-9 days')\"" >/dev/null
T "Zapłacić rachunek za prąd" todo $DOM "" null "\"$(D '-1 day')\"" >/dev/null
for t in $I1 $I2 $I3; do curl "${H[@]}" -X POST -d '{}' $U/tasks/$t/timer/start >/dev/null; done
curl "${H[@]}" -X POST -d '{}' $U/tasks/$I2/timer/stop >/dev/null; curl "${H[@]}" -X POST -d '{}' $U/tasks/$I3/timer/stop >/dev/null
[ -n "${TEST_MIGRATION_DATABASE_URL:-}" ] && psql "$TEST_MIGRATION_DATABASE_URL" -qc "UPDATE task_time_entries SET started_at = started_at - CASE task_id WHEN $I1 THEN interval '200 minutes' WHEN $I2 THEN interval '105 minutes' ELSE interval '130 minutes' END" >/dev/null
post tasks/$I1/subtasks '{"title":"Kafelek: usługi"}' >/dev/null; post tasks/$I1/subtasks '{"title":"Kafelek: realizacje"}' >/dev/null
post tasks/$I1/notes '{"body":"Klient prosi o większe ikony na mobile."}' >/dev/null
# EXTRA=1: a long Done column and three archived tasks; PLANS=1: long-term plans.
if [ -n "${EXTRA:-}" ]; then
  for i in $(seq 1 12); do post tasks "{\"title\":\"Zakończone zadanie numer $i\",\"date\":\"$(date +%F)\",\"status\":\"done\",\"spaceId\":$WORK}" >/dev/null; done
  for t in "Stary prywatny wpis" "Odebrać paczkę"; do post tasks "{\"title\":\"$t\",\"date\":\"$(date +%F)\",\"status\":\"done\"}" >/dev/null; done
  post tasks "{\"title\":\"Raport miesięczny dla klienta\",\"date\":\"$(date +%F)\",\"status\":\"done\",\"spaceId\":$WORK}" >/dev/null
  [ -n "${TEST_MIGRATION_DATABASE_URL:-}" ] && psql "$TEST_MIGRATION_DATABASE_URL" -qc "UPDATE tasks SET archived_at = now() - interval '5 days', completed_at = now() - interval '12 days' WHERE title IN ('Stary prywatny wpis','Odebrać paczkę','Raport miesięczny dla klienta')" >/dev/null
fi
if [ -n "${PLANS:-}" ]; then
  P() { post tasks "{\"title\":\"$1\",\"date\":\"$(date +%F)\",\"status\":\"planned\",\"dueDate\":$2}" >/dev/null; }
  P "Nauczyć się latać szybowcem" "\"$(D '+2 years')\""; P "Własny produkt SaaS dla klientów Mytko" "\"$(D '+5 years')\""
  P "Przeprowadzka do domu z ogrodem" null; P "Certyfikat AWS" "\"$(D '+1 year')\""
fi
if [ -n "${CALENDAR:-}" ]; then
  # Connect the fake Google Calendar to Praca: the refresh token is sealed with the container's key, then one sync.
  SEALED=$(docker exec -e K="$TASKS_SECRET_KEY" tasks-ui-run node -e 'const s=require("/app/backend/secrets.js");process.stdout.write(s.encrypt(s.parseKey(process.env.K),"fake-refresh"))')
  [ -n "${TEST_MIGRATION_DATABASE_URL:-}" ] && psql "$TEST_MIGRATION_DATABASE_URL" -qc "INSERT INTO calendar_accounts (space_id, account_email, refresh_token_enc) VALUES ($WORK, 'hello@mytko.dev', '$SEALED')" >/dev/null
  ACC=$(curl -s $U/calendar/accounts | python3 -c "import json,sys;print(json.load(sys.stdin)['accounts'][0]['id'])")
  curl "${H[@]}" -X POST -d '{}' $U/calendar/accounts/$ACC/sync >/dev/null
fi
echo seeded
