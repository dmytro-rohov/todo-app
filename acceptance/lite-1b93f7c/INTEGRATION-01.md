# Three real integration failures — acceptance-only correction

Application remains1b93f7c228cacc569915f00a3b1258da68cc0926; package base9f6bf123.
No branch created/switched, no Docker or old pilot resource access. Evidence basis:
operator failure descriptions plus exact candidate SQL/API/tests. No raw logs read.

1. completed column:002 makes NOT NULL;003 BEFORE INSERT trigger replaces legacy
NULL with status-derived false. PostgreSQL checks resulting row after BEFORE
trigger, so insert succeeds without violating constraint. Correct test checks
attnotnull plus normalization and genuine NULL title/date violations23502.
No migration/checksum or historical data changed, no integrity constraint weakened.
2. date/dueDate: legacy required date is not optional Kanban deadline.003 copies
historical date only during backfill; new POST defaults due_date NULL. PUT legacy
fields does not set deadline. pg int8 position is serialized as string to avoid
precision loss; board/ordering explicitly normalize supported numeric positions.
Correct acceptance expects String(id), optional null, and independently checks
PATCH set/clear dueDate while preserving date/description/priority through restart.
3. PostgreSQL DATE OID1082 parsed by pg into JS Date; String(Date) is not YYYY-MM-DD.
Correct backfill assertion SELECT uses TO_CHAR(due_date,'YYYY-MM-DD'), same stable
format as API. No JS local timezone conversion or migration alteration.

These are acceptance expectation/driver-mapping defects; no application fix/new
application candidate needed on this evidence. Numeric public position contract
would require separate explicit API change, not silently changed tests/code here.

Package integration.test.js is mounted over the candidate test file in disposable
helper container; actual image/application code unchanged. Limited-first retest:
from reviewed updated package and clean candidate SOURCE_DIR, with approved local
images and separate explicit stack execution approval, invoke main acceptance.sh
with INTEGRATION_FOCUS_ONLY=yes. This selects exactly three named PostgreSQL cases;
all other cases SKIP. It still builds/starts a NEW isolated stack. Never reuse
operator project tasks-validation-1793621505-465133-13800 without separate approval.
Source shell variables are exactly the existing package interface:

```bash
# First read-only preflight:
bash "$PACKAGE_DIR/acceptance.sh" preflight
# Only after approval for a fresh disposable stack:
TASKS_DISPOSABLE_APPROVED=yes INTEGRATION_FOCUS_ONLY=yes bash "$PACKAGE_DIR/acceptance.sh" run
# After focused result PASS, one full approved retest:
TASKS_DISPOSABLE_APPROVED=yes bash "$PACKAGE_DIR/acceptance.sh" run
```

Both commands require actual SOURCE_DIR set and approved local image references.
Focused success explicitly is NOT E2E success. Full smoke invokes Playwright
browser/run.cjs before final success; set-e/pipefail propagates browser failure.
No Chromium execution was performed here. Offline new3 contract checks +14 package
tests PASS; application frontend52/backend128 PASS; ci/Sass/audits/diff PASS.
Real three-case PG regression BLOCKED awaiting approved runner and package commit.
Proposed commit: TASKS-INT: align PostgreSQL regressions with Kanban data contract.
No commit authorized/created. READY FOR COMMIT; do not redeploy or cleanup old pilot.
