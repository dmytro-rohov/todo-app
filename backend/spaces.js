// Built-in spaces. Migrations may not insert data (Mytko's additive grammar), so the application creates the
// built-in rows on first use. The owner has "work" (may be shown to integrations and agents) and "private" (never).
// A member account has only its own private space, key "private:<user id>" (shown to that member as "private").
const DEFAULT_SPACES = [
  { key: "work", name: "Praca", color: "#84cc16", agentVisible: true, position: 0 },
  { key: "private", name: "Prywatne", color: "#22c55e", agentVisible: false, position: 1 }
];

const memberKey = id => `private:${id}`;
// SQL: the ids of every private space (the owner's and the members'); their archived tasks follow the private retention.
const PRIVATE_SPACES = "(SELECT id FROM spaces WHERE key = 'private' OR key LIKE 'private:%')";

async function readDefaults(db) {
  const result = await db.query("SELECT id, key FROM spaces WHERE key IN ('work', 'private')");
  return Object.fromEntries(result.rows.map(row => [row.key, row.id]));
}

// Returns { work: id, private: id } for the owner, { work: null, private: id } for a member (user from access.js).
// Reads first, so sequence values are not burnt on every call.
async function defaultSpaces(db, user = null) {
  if (user && user.id) {
    const key = memberKey(user.id);
    const read = async () => (await db.query("SELECT id FROM spaces WHERE key = $1", [key])).rows[0]?.id;
    let id = await read();
    if (!id) {
      await db.query(
        `INSERT INTO spaces (key, name, color, agent_visible, position, user_id) VALUES ($1, 'Prywatne', '#22c55e', false, 0, $2)
         ON CONFLICT (key) WHERE key IS NOT NULL DO NOTHING`, [key, user.id]);
      id = await read();
    }
    return { work: null, private: id };
  }
  const ids = await readDefaults(db);
  if (ids.work && ids.private) return ids;
  for (const space of DEFAULT_SPACES) {
    if (ids[space.key]) continue;
    await db.query(
      `INSERT INTO spaces (key, name, color, agent_visible, position) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key) WHERE key IS NOT NULL DO NOTHING`,
      [space.key, space.name, space.color, space.agentVisible, space.position]
    );
  }
  return readDefaults(db);
}

// Tasks back in their creator's private space keep only what the creator can see there: their own labels and assignee
// (another account's, seen through a shared space, would be dangling ids). Each change is the task's history.
async function keepOwnReferences(db, taskIds, actor, record) {
  if (!taskIds.length) return;
  const labelLists = async () => new Map((await db.query(
    "SELECT task_id, string_agg(category_id::text, ',' ORDER BY category_id) AS ids FROM task_labels WHERE task_id = ANY($1::int[]) GROUP BY task_id",
    [taskIds])).rows.map(row => [row.task_id, row.ids]));
  const labelsBefore = await labelLists();
  const dropped = await db.query(
    `DELETE FROM task_labels l USING tasks t, categories c
     WHERE l.task_id = ANY($1::int[]) AND t.id = l.task_id AND c.id = l.category_id AND c.user_id IS DISTINCT FROM t.user_id
     RETURNING l.task_id`, [taskIds]);
  const labelsAfter = dropped.rowCount ? await labelLists() : labelsBefore;
  const main = await db.query(
    `UPDATE tasks t SET category_id = NULL FROM categories c, tasks old
     WHERE t.id = ANY($1::int[]) AND old.id = t.id AND c.id = old.category_id AND c.user_id IS DISTINCT FROM t.user_id
     RETURNING t.id, old.category_id AS was`, [taskIds]);
  const assignee = await db.query(
    `UPDATE tasks t SET assignee_id = NULL FROM assignees a, tasks old
     WHERE t.id = ANY($1::int[]) AND old.id = t.id AND a.id = old.assignee_id AND a.user_id IS DISTINCT FROM t.user_id
     RETURNING t.id, old.assignee_id AS was`, [taskIds]);
  for (const id of new Set(dropped.rows.map(row => row.task_id))) {
    await record(db, id, [{ field: "labels", oldValue: labelsBefore.get(id) ?? null, newValue: labelsAfter.get(id) ?? null }], actor);
  }
  for (const row of main.rows) await record(db, row.id, [{ field: "category_id", oldValue: String(row.was), newValue: null }], actor);
  for (const row of assignee.rows) await record(db, row.id, [{ field: "assignee_id", oldValue: String(row.was), newValue: null }], actor);
}

// The key as the app shows it: a member's private space is "private" to them.
const publicKey = key => (key && key.startsWith("private:") ? "private" : key);

module.exports = { DEFAULT_SPACES, defaultSpaces, publicKey, memberKey, PRIVATE_SPACES, keepOwnReferences };
