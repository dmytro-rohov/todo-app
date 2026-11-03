# Task editing review fixes

Review base: `5b812762`. Both task-editing blockers are addressed:

- An unchanged submission resolves successfully without sending an empty PATCH.
- Creation and title replacement require 3–100 characters, matching the API.
  Unchanged historical titles remain available when saving other fields or
  closing an unchanged edit. Input validity is recalculated when opening the
  dialog and on title input; submission independently checks replacement titles.

Regression tests cover unchanged saves, creation and editing at lengths 2, 3,
100, 101 and 255, historical titles, and form validity. Browser QA's injected
save-error scenario now changes the description before saving so it still sends
a PATCH. The runner writes private console-desktop.json and console-mobile.json
artifacts, including failed requests, even when a viewport scenario fails.

Local validation:

| Check | Result |
|---|---|
| Backend npm ci and tests | PASS, 159/159 |
| Frontend npm ci, CSS build and tests | PASS, 57/57; none skipped |
| Package/runtime contracts | PASS, 34/34 |
| Browser runner syntax | PASS |
| git diff --check | PASS |
| Real PostgreSQL, Docker, browser acceptance | SKIPPED; no authorized isolated runtime used |

The frontend change alters application image inputs. Prior browser acceptance
of the old candidate does not validate this change; renewed release acceptance
remains an operator/Mytko action. No push, merge or deploy was performed.
