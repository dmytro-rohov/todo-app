import test from "node:test";
import assert from "node:assert/strict";

const { clampPan, coverScale, fitSize, placement } = await import("../js/app/avatar.js");

test("a photo just covers the circle at zoom 1 and cannot be pulled out of it", () => {
  assert.equal(coverScale(1000, 500, 250), 0.5);
  assert.deepEqual(clampPan({ x: 0, y: 40 }, { width: 1000, height: 500, zoom: 1, side: 250 }), { x: 0, y: 0 });
  assert.deepEqual(clampPan({ x: 999, y: -999 }, { width: 1000, height: 500, zoom: 2, side: 250 }), { x: 375, y: -125 });
});

test("the saved square is the editor's circle, at its own size", () => {
  const view = placement({ width: 1000, height: 500, zoom: 1, x: 20, y: 0 }, 280);
  const saved = placement({ width: 1000, height: 500, zoom: 1, x: 20, y: 0 }, 256, 280);
  assert.ok(Math.abs(view.left / 280 - saved.left / 256) < 1e-9);
  assert.equal(saved.height, 256);
});

test("large photos are worked on at most 1024 px", () => {
  assert.deepEqual(fitSize(4032, 3024, 1024), { width: 1024, height: 768 });
  assert.deepEqual(fitSize(300, 200, 1024), { width: 300, height: 200 });
});
