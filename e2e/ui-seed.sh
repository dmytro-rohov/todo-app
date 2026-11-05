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
echo seeded
