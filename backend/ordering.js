const crypto = require('node:crypto');
const { parseId } = require('./validation');
const { recordTaskChanges } = require('./task-history');
const { STATUSES: statuses, statusSql, statusAssignmentsSql } = require('./task-status');
const { userId, visibleTask } = require('./access');
function validateMove(body) {
  return body && parseId(body.id) !== null && statuses.includes(body.status) &&
    (body.beforeId === null || parseId(body.beforeId) !== null) &&
    ((typeof body.expected === 'string' && /^[a-f0-9]{64}$/.test(body.expected)) ||
      (Array.isArray(body.expected) && body.expected.every(t => t && parseId(t.id) !== null && statuses.includes(t.status) && Number.isSafeInteger(t.position)) &&
       new Set(body.expected.map(t => Number(t.id))).size === body.expected.length));
}
// The board (and its concurrency token) is the account's own view: its tasks and those in shared spaces.
async function moveTask(pool, body, user = null) {
  if (!validateMove(body)) return { status: 400, message: 'Invalid move' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Conflicts with all concurrent INSERT/UPDATE/DELETE writers, not just moves.
    await client.query('LOCK TABLE tasks IN SHARE ROW EXCLUSIVE MODE');
    const { rows } = await client.query(`SELECT id, ${statusSql()} AS status, position FROM tasks WHERE archived_at IS NULL AND ${visibleTask('tasks', '$1::integer')} ORDER BY position, id`, [userId(user)]);
    const canonical = list => JSON.stringify(list.map(t => [Number(t.id), t.status, Number(t.position)]).sort((a,b)=>a[0]-b[0]));
    const expected = typeof body.expected === 'string'
      ? crypto.createHash('sha256').update(canonical(rows)).digest('hex')
      : canonical(body.expected);
    const currentToken = crypto.createHash('sha256').update(canonical(rows)).digest('hex');
    if (typeof body.expected === 'string' ? body.expected !== currentToken : expected !== canonical(rows)) { await client.query('ROLLBACK'); return { status: 409, message: 'Board changed; refresh and retry' }; }
    const task = rows.find(t=>t.id===Number(body.id));
    if (!task || Number(body.beforeId)===task.id) { await client.query('ROLLBACK'); return { status: 400, message: 'Invalid move target' }; }
    const target = rows.filter(t=>t.status===body.status && t.id!==task.id);
    const index = body.beforeId===null ? target.length : target.findIndex(t=>t.id===Number(body.beforeId));
    if(index<0) { await client.query('ROLLBACK'); return { status: 400, message: 'Invalid move target' }; }
    target.splice(index,0,{...task,status:body.status});
    const source=rows.filter(t=>t.status===task.status && t.id!==task.id);
    const lists=task.status===body.status ? [target] : [source,target];
    const original = new Map(rows.map(r => [r.id, r]));
    // Positions are shared by every account's tasks: a list is reordered within the positions its tasks already
    // hold, so tasks the account does not see keep their places.
    const slots = list => list.map(t => Number(original.get(t.id).position)).sort((a, b) => a - b);
    for(const list of lists) { const held = slots(list); for(let index=0;index<list.length;index++) {
      const row=list[index];
      const position=held[index];
      // Unchanged rows keep their updated_at ("recently changed" stays meaningful).
      if (original.get(row.id).status === row.status && Number(original.get(row.id).position) === position) continue;
      await client.query(`UPDATE tasks SET ${statusAssignmentsSql('$1').join(', ')}, position=$2, updated_at=now() WHERE id=$3`,[row.status,position,row.id]);
    } }
    if (task.status !== body.status) {
      await recordTaskChanges(client, task.id, [{ field: 'status', oldValue: task.status, newValue: body.status }], user ? user.actor : 'owner');
      if (body.status !== 'in_progress') await client.query('UPDATE task_time_entries SET ended_at = now() WHERE task_id = $1 AND ended_at IS NULL', [task.id]);
    }
    await client.query('COMMIT'); return { status: 200, message: 'Task moved' };
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
module.exports = { moveTask, validateMove };
