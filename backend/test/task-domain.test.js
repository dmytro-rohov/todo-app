const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateTaskPatch, STATUSES, PRIORITIES } = require('../task-domain');
for (const status of STATUSES) test(`accepts ${status}`, () => assert.deepEqual(validateTaskPatch({ status }).value, { status }));
for (const priority of PRIORITIES) test(`accepts ${priority}`, () => assert.deepEqual(validateTaskPatch({ priority }).value, { priority }));
test('partial status leaves legacy title untouched', () => assert.equal(validateTaskPatch({ status: 'done' }).error, undefined));
test('title uses the same three-to-one-hundred-character contract as creation', () => {
  assert.equal(validateTaskPatch({ title: 'ab' }).error, 'Invalid title');
  assert.equal(validateTaskPatch({ title: 'a'.repeat(101) }).error, 'Invalid title');
  assert.equal(validateTaskPatch({ title: ' abc ' }).value.title, 'abc');
});
test('due date can be cleared and rejects impossible dates', () => { assert.deepEqual(validateTaskPatch({ dueDate: null }).value, { dueDate: null }); assert.ok(validateTaskPatch({ dueDate: '2026-02-30' }).error); });
test('rejects invalid enums, ordering and unknown fields', () => { for (const body of [{ status: 'closed' }, { priority: 'P9' }, { position: -1 }, { archived_at: 'x' }, {}]) assert.ok(validateTaskPatch(body).error); });
