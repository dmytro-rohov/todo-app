// frontend/vendor/mytko-kit is a copy of Mytko Kit made by the kit's tools/sync.mjs: never edited here. A file changed,
// added or removed by hand makes this fail (change the kit and sync again). Also: Tasks' texts for the kit's components
// exist in both languages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { checkVendored } from "../vendor/mytko-kit/kit-check.mjs";
import uk from "../js/locales/uk.js";
import pl from "../js/locales/pl.js";

test("the vendored Mytko Kit is exactly what the kit's sync wrote", () => {
  const { problems, manifest } = checkVendored(fileURLToPath(new URL("../vendor/mytko-kit", import.meta.url)));
  assert.deepEqual(problems, []);
  assert.equal(manifest.part, "frontend");
  assert.equal(manifest.dirty, false, "synced from a kit tree with uncommitted changes");
});

test("Tasks' texts of the kit's components: the same keys in Ukrainian and Polish", () => {
  assert.deepEqual(Object.keys(pl).sort(), Object.keys(uk).sort());
});
