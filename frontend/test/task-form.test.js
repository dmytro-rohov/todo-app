import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submitTaskForm, validateTitleInput } from '../js/board.js';

const original = { id: 7, title: 'Original', description: '', status: 'todo', priority: 'P2', categoryId: null, dueDate: null, position: 0 };
async function submit(fields, editing, send) {
  const NativeFormData = globalThis.FormData;
  globalThis.FormData = class { entries() { return Object.entries(fields); } };
  try { return await submitTaskForm({}, editing, send); }
  finally { globalThis.FormData = NativeFormData; }
}
function fields(task) {
  const { id, ...values } = task;
  return { ...values, categoryId: '', dueDate: '', position: String(values.position) };
}

test('unchanged edit succeeds without PATCH, including historical titles', async () => {
  for (const title of ['Original', 'x', 'x'.repeat(255)]) {
    const task = { ...original, title };
    const result = await submit(fields(task), task, () => assert.fail('unchanged edit must not send HTTP'));
    assert.equal(result, task);
  }
});

test('create and rename enforce API title boundaries before sending', async () => {
  for (const editing of [null, original]) {
    for (const length of [2, 3, 100, 101, 255]) {
      const calls = [];
      const data = { ...fields(original), title: 'x'.repeat(length) };
      const run = () => submit(data, editing, async (...args) => calls.push(args));
      if (length < 3 || length > 100) {
        await assert.rejects(run, /3 do 100/);
        assert.equal(calls.length, 0);
      } else {
        await run();
        assert.equal(calls.length, 1);
        assert.equal(calls[0][1].method, editing ? 'PATCH' : 'POST');
        assert.equal(calls[0][1].body.title, data.title);
      }
    }
  }
});

test('historical title remains intact when another field changes; replacements obey limits', async () => {
  const task = { ...original, title: 'x'.repeat(255) };
  const calls = [];
  await submit({ ...fields(task), status: 'done' }, task, async (...args) => calls.push(args));
  assert.deepEqual(calls[0][1].body, { status: 'done' });
  await assert.rejects(() => submit({ ...fields(task), title: 'y'.repeat(101) }, task, () => assert.fail()), /3 do 100/);
  await submit({ ...fields(task), title: 'y'.repeat(100) }, task, async (...args) => calls.push(args));
  assert.deepEqual(calls[1][1].body, { title: 'y'.repeat(100) });
});

test('form validity permits unchanged historical titles and rejects invalid replacements', () => {
  for (const oldTitle of [null, 'Original', 'x', 'x'.repeat(255)]) {
    const input = { setCustomValidity(message) { this.error = message; } };
    for (const value of ['xx', 'xxx', 'x'.repeat(100), 'y'.repeat(101), 'y'.repeat(255), ...(oldTitle === null ? [] : [oldTitle])]) {
      input.value = value;
      validateTitleInput(input, oldTitle);
      assert.equal(input.error === '', value === oldTitle || (value.trim().length >= 3 && value.length <= 100));
    }
    assert.equal(input.maxLength, Math.max(100, oldTitle?.length || 0));
  }
});
