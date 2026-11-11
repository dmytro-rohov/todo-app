import test from "node:test";
import assert from "node:assert/strict";

globalThis.location ??= { origin: "https://tasks.mytko.dev", hash: "" };
const { formatCode, joinLink } = await import("../js/app/sharing.js");

test("codes are read out in groups of four and travel in a link", () => {
  assert.equal(formatCode("ABCDEFGH2345"), "ABCD-EFGH-2345");
  assert.equal(formatCode(""), "");
  assert.equal(joinLink("ABCDEFGH2345"), "https://tasks.mytko.dev/#join=ABCDEFGH2345");
});
