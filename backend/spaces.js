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

// The key as the app shows it: a member's private space is "private" to them.
const publicKey = key => (key && key.startsWith("private:") ? "private" : key);

module.exports = { DEFAULT_SPACES, defaultSpaces, publicKey, memberKey, PRIVATE_SPACES };
