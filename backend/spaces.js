// Built-in spaces. Migrations may not insert data (Mytko's additive grammar), so the application creates the
// two built-in rows on first use. "work" may be shown to integrations and agents; "private" never is.
const DEFAULT_SPACES = [
  { key: "work", name: "Praca", color: "#84cc16", agentVisible: true, position: 0 },
  { key: "private", name: "Prywatne", color: "#22c55e", agentVisible: false, position: 1 }
];

async function readDefaults(db) {
  const result = await db.query("SELECT id, key FROM spaces WHERE key IN ('work', 'private')");
  return Object.fromEntries(result.rows.map(row => [row.key, row.id]));
}

// Returns { work: id, private: id }. Reads first, so sequence values are not burnt on every call.
async function defaultSpaces(db) {
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

module.exports = { DEFAULT_SPACES, defaultSpaces };
