// Spaces. Each account has its own; one it marks shared is seen and edited by the accounts in it too: the owner picks
// them from the accounts list (the owner alone sees that list), and anybody can be let in with a one-time invitation
// code (or its link) the space's creator made. Nobody else is ever shown which accounts exist.
const crypto = require("node:crypto");
const express = require("express");
const { withTransaction } = require("../kit");
const { defaultSpaces, publicKey, keepOwnReferences } = require("../spaces");
const { recordTaskChanges } = require("../task-history");
const { isOwner, userId, own, visibleSpace, inSpace } = require("../access");
const { createWindowCounter } = require("../security");
const { parseId, validateSpace } = require("../validation");

const SPACE_COLUMNS = `s.id, s.key, s.name, s.color, s.agent_visible AS "agentVisible", s.position, s.created_at AS "createdAt",
  s.shared, (s.user_id IS NOT DISTINCT FROM $1::integer) AS "mine",
  CASE WHEN s.shared THEN (SELECT count(*)::int FROM space_members m WHERE m.space_id = s.id) + 1 ELSE 1 END AS "people"`;
const FOREIGN_KEY_VIOLATION = "23503";
const shown = row => ({ ...row, key: publicKey(row.key) });

const MAX_MEMBERS = 25; // besides the creator
// Invitation codes: 12 characters people can read out and type (no 0/O, 1/I/L): 31^12 (about 2^59), so even a stored
// hash cannot be searched through within the 7 days a code lives. One use.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 12;
const INVITE_DAYS = 7;
const MAX_ACTIVE_INVITES = 20; // per space
const CODE_TRIES = 10; // wrong codes per account in 15 minutes
const newCode = () => Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join("");
const codeHash = code => crypto.createHash("sha256").update(code).digest("hex");
// What a person typed or the link carried: letters and digits only, upper case (the dash and spaces are for reading).
const cleanCode = value => (typeof value === "string" ? value.toUpperCase().replace(/[^A-Z0-9]/g, "") : "");
const accountKey = user => (userId(user) === null ? "owner" : `user:${userId(user)}`);
const isBody = body => Boolean(body) && typeof body === "object" && !Array.isArray(body);

class Refused extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function refusal(res, failure) {
  if (failure instanceof Refused) return res.status(failure.status).json({ message: failure.message });
  throw failure;
}

// Tasks leaving a space go to their creator's private space (the owner's or the member's), without another account's
// project, labels or assignee. which: {} all of them (the space is deleted), { othersOf: id } every account's but that
// one's (unsharing), { of: id } one account's (left, taken out). Leaving accounts take their projects in the space with
// them (to their private spaces); the others' tasks in those projects stay in the space, without the project.
async function sendTasksHome(db, spaceId, actor, which = {}) {
  const ownerPrivate = (await defaultSpaces(db)).private;
  const home = who => `COALESCE((SELECT s.id FROM spaces s WHERE s.key = 'private:' || ${who}), $2)`;
  let account = null;
  let only = "";
  if ("othersOf" in which) { account = which.othersOf; only = "IS DISTINCT FROM $3::integer"; }
  if ("of" in which) { account = which.of; only = "IS NOT DISTINCT FROM $3::integer"; }
  if (only) {
    const freed = await db.query(
      `UPDATE tasks t SET project_id = NULL, updated_at = now() FROM projects p
       WHERE p.id = t.project_id AND p.space_id = $1 AND p.user_id ${only.replace("$3", "$2")} AND t.user_id IS DISTINCT FROM p.user_id
         AND NOT (t.user_id ${only.replace("$3", "$2")})
       RETURNING t.id, p.id AS project`, [spaceId, account]);
    for (const row of freed.rows) await recordTaskChanges(db, row.id, [{ field: "project_id", oldValue: String(row.project), newValue: null }], actor);
  }
  // a task keeps its project only when the project is its creator's and goes along
  const keep = only ? `CASE WHEN EXISTS (SELECT 1 FROM projects p WHERE p.id = t.project_id AND p.user_id IS NOT DISTINCT FROM t.user_id) THEN t.project_id END` : "NULL";
  const moved = await db.query(
    `WITH old AS (SELECT id, project_id FROM tasks WHERE space_id = $1${only ? ` AND user_id ${only}` : ""} FOR UPDATE)
     UPDATE tasks t SET space_id = ${home("t.user_id")}, project_id = ${keep}, updated_at = now() FROM old
     WHERE t.id = old.id RETURNING t.id, t.space_id, t.project_id, old.project_id AS "oldProject"`,
    only ? [spaceId, ownerPrivate, account] : [spaceId, ownerPrivate]);
  for (const row of moved.rows) {
    const changes = [{ field: "space_id", oldValue: String(spaceId), newValue: String(row.space_id) }];
    if (row.oldProject !== row.project_id) changes.push({ field: "project_id", oldValue: String(row.oldProject), newValue: null });
    await recordTaskChanges(db, row.id, changes, actor);
  }
  await keepOwnReferences(db, moved.rows.map(row => row.id), actor, recordTaskChanges);
  if (only) {
    await db.query(`UPDATE projects p SET space_id = ${home("p.user_id")} WHERE p.space_id = $1 AND p.user_id ${only}`, [spaceId, ownerPrivate, account]);
  }
}

// Spaces shared before members existed were seen by every account: once, everybody becomes a member of them, so nobody
// loses a space with this release. Run by the server at start (again until it succeeds); later runs do nothing.
const ADOPTED = "spaces.members";
async function adoptSharedSpaces(pool) {
  return withTransaction(pool, async db => {
    await db.query("SELECT pg_advisory_xact_lock(7244, 0)");
    if ((await db.query("SELECT 1 FROM app_settings WHERE key = $1", [ADOPTED])).rowCount) return 0;
    const added = await db.query(
      `INSERT INTO space_members (space_id, user_id)
         SELECT s.id, u.id FROM spaces s CROSS JOIN users u WHERE s.shared AND u.id IS DISTINCT FROM s.user_id
         UNION ALL SELECT s.id, NULL FROM spaces s WHERE s.shared AND s.user_id IS NOT NULL
       ON CONFLICT DO NOTHING`);
    await db.query("INSERT INTO app_settings (key, value) VALUES ($1, 'v1') ON CONFLICT (key) DO NOTHING", [ADOPTED]);
    return added.rowCount;
  });
}

// The accounts the owner picked for a new shared space (ids, no repeats), or null.
function parseMemberIds(value) {
  if (value === undefined) return [];
  const ids = Array.isArray(value) ? value.map(parseId) : null;
  if (!ids || ids.length > MAX_MEMBERS || ids.includes(null) || new Set(ids).size !== ids.length) return null;
  return ids;
}

function createSpacesRouter(pool) {
  const router = express.Router();
  const mine = async (db, req, id, lock = "") =>
    (await db.query(`SELECT key, shared FROM spaces s WHERE s.id = $1 AND ${own("s", "$2::integer")}${lock}`, [id, userId(req.user)])).rows[0] || null;
  const read = async (db, req, id) =>
    shown((await db.query(`SELECT ${SPACE_COLUMNS} FROM spaces s WHERE s.id = $2`, [userId(req.user), id])).rows[0]);
  const memberCount = async (db, id) => (await db.query("SELECT count(*)::int AS n FROM space_members WHERE space_id = $1", [id])).rows[0].n;

  // Adds accounts (by id) to a space: active ones only (the owner is never on that list).
  async function addAccounts(db, spaceId, ids) {
    if (!ids.length) return;
    const found = (await db.query("SELECT id FROM users WHERE id = ANY($1::int[]) AND disabled_at IS NULL", [ids])).rows;
    if (found.length !== ids.length) throw new Refused(400, "Invalid member");
    if ((await memberCount(db, spaceId)) + ids.length > MAX_MEMBERS) throw new Refused(409, "Too many members");
    for (const id of ids) {
      await db.query("INSERT INTO space_members (space_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [spaceId, id]);
    }
  }

  router.get("/", async (req, res) => {
    await defaultSpaces(pool, req.user);
    const result = await pool.query(
      `SELECT ${SPACE_COLUMNS} FROM spaces s WHERE ${visibleSpace("s", "$1::integer")} ORDER BY s.position ASC, s.id ASC`, [userId(req.user)]);
    res.json(result.rows.map(shown));
  });

  // { name, color, shared?, agentVisible?, memberIds? (the owner only: accounts put in the new shared space) }
  router.post("/", async (req, res) => {
    const { memberIds: rawIds, ...fields } = isBody(req.body) ? req.body : {};
    const { error, value } = validateSpace(isBody(req.body) ? fields : req.body);
    if (error) return res.status(400).json({ message: error });
    const memberIds = parseMemberIds(rawIds);
    if (!memberIds || (memberIds.length && (!isOwner(req.user) || !value.shared))) return res.status(400).json({ message: "Invalid member" });
    if (value.agentVisible && !isOwner(req.user)) return res.status(400).json({ message: "Only the owner's spaces can be visible to agents" });
    try {
      const space = await withTransaction(pool, async db => {
        const id = (await db.query(
          "INSERT INTO spaces (name, color, agent_visible, position, shared, user_id) VALUES ($2, $3, $4, $5, $6, $1) RETURNING id",
          [userId(req.user), value.name, value.color, value.agentVisible ?? false, value.position ?? 0, value.shared ?? false])).rows[0].id;
        await addAccounts(db, id, memberIds);
        return read(db, req, id);
      });
      res.status(201).json(space);
    } catch (failure) {
      refusal(res, failure);
    }
  });

  // ---- joining with a code ------------------------------------------------------------------------------------------
  // Wrong codes are counted per account (CODE_TRIES in 15 minutes), so codes cannot be guessed.
  const tries = createWindowCounter({ windowMs: 15 * 60000 });
  const tooManyTries = user => tries.peek(accountKey(user)).count >= CODE_TRIES;
  // The waiting invitation of a code, or null (a wrong code counts as a try).
  async function findInvite(db, user, code) {
    const invite = code.length === CODE_LENGTH ? (await db.query(
      `SELECT id, space_id AS "spaceId" FROM space_invites WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now()`, [codeHash(code)])).rows[0] : null;
    if (!invite) tries.hit(accountKey(user));
    return invite || null;
  }
  const codeOnly = body => isBody(body) && Object.keys(body).every(key => key === "code");

  // { code } -> what the code leads to, before joining: the space's name and colour, how many are in it.
  router.post("/join/preview", async (req, res) => {
    if (!codeOnly(req.body)) return res.status(400).json({ message: "Invalid request body" });
    if (tooManyTries(req.user)) return res.status(429).json({ message: "Too many attempts" });
    const invite = await findInvite(pool, req.user, cleanCode(req.body.code));
    if (!invite) return res.status(404).json({ message: "Invalid code" });
    const space = (await pool.query(
      `SELECT s.name, s.color, s.shared, (SELECT count(*)::int FROM space_members m WHERE m.space_id = s.id) + 1 AS people,
         ${visibleSpace("s", "$2::integer")} AS "alreadyMember"
       FROM spaces s WHERE s.id = $1`, [invite.spaceId, userId(req.user)])).rows[0];
    if (!space || !space.shared) return res.status(404).json({ message: "Invalid code" });
    res.json({ name: space.name, color: space.color, people: space.people, alreadyMember: space.alreadyMember });
  });

  // { code } -> the account is in the space at once (the code was its invitation); the code is used up.
  router.post("/join", async (req, res) => {
    if (!codeOnly(req.body)) return res.status(400).json({ message: "Invalid request body" });
    if (tooManyTries(req.user)) return res.status(429).json({ message: "Too many attempts" });
    const code = cleanCode(req.body.code);
    try {
      const space = await withTransaction(pool, async db => {
        const found = await findInvite(db, req.user, code);
        if (!found) throw new Refused(404, "Invalid code");
        // the space first, then its invitation (the order withdrawing one takes), and the code checked again under both
        const target = (await db.query("SELECT id, shared FROM spaces WHERE id = $1 FOR UPDATE", [found.spaceId])).rows[0];
        const invite = (await db.query("SELECT id FROM space_invites WHERE id = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE", [found.id])).rows[0];
        if (!target || !invite || !target.shared) throw new Refused(404, "Invalid code");
        if ((await db.query(`SELECT 1 FROM spaces s WHERE s.id = $1 AND ${inSpace("s", "$2::integer")}`, [target.id, userId(req.user)])).rowCount) {
          throw new Refused(409, "Already a member");
        }
        if ((await memberCount(db, target.id)) >= MAX_MEMBERS) throw new Refused(409, "Too many members");
        await db.query("INSERT INTO space_members (space_id, user_id) VALUES ($1, $2)", [target.id, userId(req.user)]);
        await db.query("UPDATE space_invites SET used_at = now(), used_by = $2 WHERE id = $1", [invite.id, userId(req.user)]);
        return read(db, req, target.id);
      });
      res.json(space);
    } catch (failure) {
      refusal(res, failure);
    }
  });

  // One's own spaces only. Built-in spaces (Praca, Prywatne) can be renamed and recoloured, never shared; private
  // spaces are never visible to agents. Unsharing sends the other accounts' tasks in the space back to their private
  // spaces; its people and waiting codes go.
  router.patch("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid space id" });
    const { error, value } = validateSpace(req.body, { partial: true });
    if (error) return res.status(400).json({ message: error });
    const outcome = await withTransaction(pool, async db => {
      const current = await mine(db, req, id, " FOR UPDATE");
      if (!current) return { status: 404, message: "Space not found" };
      const isPrivate = publicKey(current.key) === "private";
      if (isPrivate && value.agentVisible === true) return { status: 400, message: "The private space is never visible to agents" };
      if (current.key !== null && value.shared === true) return { status: 400, message: "Built-in spaces cannot be shared" };
      if (value.agentVisible === true && !isOwner(req.user)) return { status: 400, message: "Only the owner's spaces can be visible to agents" };
      if (current.shared && value.shared === false) {
        await sendTasksHome(db, id, req.user.actor, { othersOf: userId(req.user) });
        await db.query("DELETE FROM space_members WHERE space_id = $1", [id]);
        await db.query("DELETE FROM space_invites WHERE space_id = $1 AND used_at IS NULL", [id]);
      }
      const columns = { name: "name", color: "color", position: "position", agentVisible: "agent_visible", shared: "shared" };
      const params = [];
      const assignments = Object.entries(value).map(([key, val]) => { params.push(val); return `${columns[key]} = $${params.length}`; });
      params.push(id);
      await db.query(`UPDATE spaces SET ${assignments.join(", ")} WHERE id = $${params.length}`, params);
      return { status: 200, body: await read(db, req, id) };
    });
    if (outcome.status !== 200) return res.status(outcome.status).json({ message: outcome.message });
    res.json(outcome.body);
  });

  // One's own, not built-in spaces. Their tasks go back to their creators' private spaces. A space that still has
  // projects is refused.
  router.delete("/:id", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid space id" });
    try {
      const outcome = await withTransaction(pool, async db => {
        const current = await mine(db, req, id, " FOR UPDATE");
        if (!current) return 404;
        if (current.key !== null) return 409;
        if ((await db.query("SELECT 1 FROM calendar_accounts WHERE space_id = $1", [id])).rowCount) return 423;
        await sendTasksHome(db, id, req.user.actor);
        await db.query("DELETE FROM spaces WHERE id = $1", [id]);
        return 200;
      });
      if (outcome === 404) return res.status(404).json({ message: "Space not found" });
      if (outcome === 409) return res.status(409).json({ message: "Built-in spaces cannot be deleted" });
      if (outcome === 423) return res.status(409).json({ message: "Disconnect the space's Google Calendar first" });
      res.json({ message: "Space deleted" });
    } catch (error) {
      if (error.code === FOREIGN_KEY_VIOLATION) return res.status(409).json({ message: "Space still has projects" });
      throw error;
    }
  });

  // ---- the people of a shared space ---------------------------------------------------------------------------------
  // Everyone in it sees who else is: [{ id (null = the owner), name (null = the owner), avatarAt, creator, me }].
  async function people(db, req, spaceId) {
    const rows = (await db.query(
      `WITH people AS (
         SELECT s.user_id, true AS creator, 0 AS id FROM spaces s WHERE s.id = $1
         UNION ALL SELECT m.user_id, false, m.id FROM space_members m WHERE m.space_id = $1)
       SELECT p.user_id AS id, u.name, p.creator, (p.user_id IS NOT DISTINCT FROM $2::integer) AS me,
         floor(extract(epoch FROM a.updated_at) * 1000)::bigint AS "avatarAt"
       FROM people p LEFT JOIN users u ON u.id = p.user_id
       LEFT JOIN avatars a ON a.account = CASE WHEN p.user_id IS NULL THEN 'owner' ELSE 'user:' || p.user_id END
       ORDER BY p.creator DESC, p.id`, [spaceId, userId(req.user)])).rows;
    return rows.map(row => ({ ...row, avatarAt: row.avatarAt === null ? null : Number(row.avatarAt) }));
  }
  // The shared space, locked, when the account is in it; with whether the account made it.
  async function lockShared(db, req, id) {
    const space = (await db.query(`SELECT s.id, (s.user_id IS NOT DISTINCT FROM $2::integer) AS creator, ${inSpace("s", "$2::integer")} AS seen
      FROM spaces s WHERE s.id = $1 FOR UPDATE`, [id, userId(req.user)])).rows[0];
    return space && space.seen ? space : null;
  }

  router.get("/:id/members", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid space id" });
    if (!(await pool.query(`SELECT 1 FROM spaces s WHERE s.id = $1 AND ${inSpace("s", "$2::integer")}`, [id, userId(req.user)])).rowCount) {
      return res.status(404).json({ message: "Space not found" });
    }
    res.json(await people(pool, req, id));
  });

  // { userId } -> the owner puts one of the accounts in their shared space.
  router.post("/:id/members", async (req, res) => {
    const id = parseId(req.params.id);
    const memberId = isBody(req.body) && Object.keys(req.body).length === 1 ? parseId(req.body.userId) : null;
    if (id === null || memberId === null) return res.status(400).json({ message: "Invalid member" });
    if (!isOwner(req.user)) return res.status(403).json({ message: "Not available for this account" });
    try {
      const list = await withTransaction(pool, async db => {
        const space = await lockShared(db, req, id);
        if (!space || !space.creator) throw new Refused(404, "Space not found");
        if ((await db.query("SELECT 1 FROM space_members WHERE space_id = $1 AND user_id = $2", [id, memberId])).rowCount) throw new Refused(409, "Already a member");
        await addAccounts(db, id, [memberId]);
        return people(db, req, id);
      });
      res.status(201).json(list);
    } catch (failure) {
      refusal(res, failure);
    }
  });

  // The creator takes somebody out ("owner" or an account's id), or an account leaves ("me"). Their tasks in the space
  // go back to their private space.
  router.delete("/:id/members/:who", async (req, res) => {
    const id = parseId(req.params.id);
    const who = req.params.who;
    const target = who === "me" ? userId(req.user) : who === "owner" ? null : parseId(who);
    if (id === null || (who !== "me" && who !== "owner" && target === null)) return res.status(400).json({ message: "Invalid member" });
    try {
      await withTransaction(pool, async db => {
        const space = await lockShared(db, req, id);
        if (!space) throw new Refused(404, "Space not found");
        if (who === "me" ? space.creator : !space.creator) throw new Refused(403, "Not available for this account");
        const removed = await db.query("DELETE FROM space_members WHERE space_id = $1 AND user_id IS NOT DISTINCT FROM $2::integer", [id, target]);
        if (!removed.rowCount) throw new Refused(404, "Member not found");
        await sendTasksHome(db, id, req.user.actor, { of: target });
      });
      res.json({ message: "Member removed" });
    } catch (failure) {
      refusal(res, failure);
    }
  });

  // ---- invitation codes ---------------------------------------------------------------------------------------------
  // The creator of a shared space makes a code for one person (shown once: only its hash is kept).
  router.post("/:id/invites", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid space id" });
    try {
      const made = await withTransaction(pool, async db => {
        const space = await lockShared(db, req, id);
        if (!space || !space.creator) throw new Refused(404, "Space not found");
        if ((await memberCount(db, id)) >= MAX_MEMBERS) throw new Refused(409, "Too many members");
        if ((await db.query("SELECT count(*)::int AS n FROM space_invites WHERE space_id = $1 AND used_at IS NULL AND expires_at > now()", [id])).rows[0].n
          >= MAX_ACTIVE_INVITES) throw new Refused(409, "Too many invitations");
        for (;;) { // a code already taken (about one in 10^17) is simply drawn again
          const code = newCode();
          const row = (await db.query(
            `INSERT INTO space_invites (space_id, code_hash, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))
             ON CONFLICT (code_hash) DO NOTHING RETURNING id, expires_at AS "expiresAt"`, [id, codeHash(code), INVITE_DAYS])).rows[0];
          if (row) return { ...row, code };
        }
      });
      res.status(201).json(made);
    } catch (failure) {
      refusal(res, failure);
    }
  });

  // The space's codes still waiting (not used, not expired), for its creator.
  router.get("/:id/invites", async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: "Invalid space id" });
    if (!(await pool.query(`SELECT 1 FROM spaces s WHERE s.id = $1 AND s.shared AND ${own("s", "$2::integer")}`, [id, userId(req.user)])).rowCount) {
      return res.status(404).json({ message: "Space not found" });
    }
    const rows = await pool.query(
      `SELECT id, created_at AS "createdAt", expires_at AS "expiresAt" FROM space_invites
       WHERE space_id = $1 AND used_at IS NULL AND expires_at > now() ORDER BY id`, [id]);
    res.json(rows.rows);
  });

  // A code withdrawn by the creator (it no longer lets anybody in).
  router.delete("/:id/invites/:inviteId", async (req, res) => {
    const id = parseId(req.params.id);
    const inviteId = parseId(req.params.inviteId);
    if (id === null || inviteId === null) return res.status(400).json({ message: "Invalid space id" });
    try {
      await withTransaction(pool, async db => {
        const space = await lockShared(db, req, id);
        if (!space || !space.creator) throw new Refused(404, "Space not found");
        if (!(await db.query("DELETE FROM space_invites WHERE id = $1 AND space_id = $2 AND used_at IS NULL", [inviteId, id])).rowCount) {
          throw new Refused(404, "Invitation not found");
        }
      });
      res.json({ message: "Invitation withdrawn" });
    } catch (failure) {
      refusal(res, failure);
    }
  });

  return router;
}

module.exports = createSpacesRouter;
module.exports.adoptSharedSpaces = adoptSharedSpaces;
module.exports.cleanCode = cleanCode;
