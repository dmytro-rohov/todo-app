const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DAY_MS, retentionAction } = require('../retention-policy');
const completedAt = '2026-01-01T12:00:00Z';
const now = days => new Date(Date.parse(completedAt) + days * DAY_MS);
for (const days of [29,30,31]) test(`archive boundary ${days}`, () => assert.equal(retentionAction({status:'done',completedAt},now(days)),days<30?'keep':'archive'));
for (const days of [59,60,61]) test(`delete boundary ${days}`, () => assert.equal(retentionAction({status:'done',completedAt,archivedAt:now(30)},now(days)),days<60?'keep':'delete'));
test('protection blocks automatic deletion but not archival',()=>{
  assert.equal(retentionAction({status:'done',completedAt,protectedFromDeletion:true},now(31)),'archive');
  assert.equal(retentionAction({archivedAt:now(30),protectedFromDeletion:true},now(100)),'keep');
});
test('reopened tasks without archive are kept',()=>assert.equal(retentionAction({status:'todo',completedAt:null},now(100)),'keep'));
test('late archival gets its own full thirty days',()=>assert.equal(retentionAction({archivedAt:now(80)},now(100)),'keep'));
test('invalid timestamps never make a deletion eligible',()=>assert.equal(retentionAction({status:'done',completedAt:'invalid',archivedAt:'invalid'},now(100)),'keep'));
test('same input and clock produce same decision',()=>{const task={archivedAt:now(30)}; assert.equal(retentionAction(task,now(60)),retentionAction(task,now(60)));});
