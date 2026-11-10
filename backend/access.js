// Who is asking and what they may see. The owner (AUTH_USERNAME / the Mytko login) has user id null: every row from
// before accounts existed is the owner's. Every account sees its own rows plus everything in the shared spaces it is in
// (made by it, or it was added to / joined with a code); clients, calendars, booking and accounts are the owner's only.
const OWNER = Object.freeze({ id: null, role: "owner", login: null, name: null, actor: "owner" });

function memberUser(row) {
  return Object.freeze({ id: row.id, role: "member", login: row.login, name: row.name, actor: `user:${row.login}`.slice(0, 40) });
}

const isOwner = user => !user || user.role === "owner";
const userId = user => (user ? user.id : null);

// SQL fragments; `p` is the placeholder that holds the user's id (NULL for the owner).
const own = (alias, p) => `${alias}.user_id IS NOT DISTINCT FROM ${p}`;
// In a shared space: its creator, and the accounts in space_members (the owner as user_id NULL).
const inSpace = (alias, p) => `(${alias}.shared AND (${own(alias, p)} OR EXISTS (SELECT 1 FROM space_members m WHERE m.space_id = ${alias}.id AND m.user_id IS NOT DISTINCT FROM ${p})))`;
// The ids of the shared spaces the account is in.
const sharedSpaces = p => `(SELECT s.id FROM spaces s WHERE ${inSpace("s", p)})`;
const visibleSpace = (alias, p) => `(${own(alias, p)} OR ${inSpace(alias, p)})`;
const visibleTask = (alias, p) => `(${own(alias, p)} OR ${alias}.space_id IN ${sharedSpaces(p)})`;
const visibleProject = visibleTask;
// Labels and assignees: one's own, plus those on tasks in one's shared spaces (shown there, editable by their owner only).
const visibleLabel = (alias, p) => `(${own(alias, p)} OR ${alias}.id IN (SELECT category_id FROM tasks WHERE space_id IN ${sharedSpaces(p)})
  OR ${alias}.id IN (SELECT l.category_id FROM task_labels l JOIN tasks t ON t.id = l.task_id WHERE t.space_id IN ${sharedSpaces(p)}))`;
const visibleAssignee = (alias, p) => `(${own(alias, p)} OR ${alias}.id IN (SELECT assignee_id FROM tasks WHERE space_id IN ${sharedSpaces(p)}))`;

// Express: refuses members (403) on owner-only APIs.
function ownerOnly(req, res, next) {
  if (isOwner(req.user)) return next();
  res.status(403).json({ message: "Not available for this account" });
}

async function canSeeTask(db, user, taskId) {
  return (await db.query(`SELECT 1 FROM tasks t WHERE t.id = $1 AND ${visibleTask("t", "$2::integer")}`, [taskId, userId(user)])).rowCount > 0;
}

module.exports = { OWNER, memberUser, isOwner, userId, own, visibleSpace, visibleTask, visibleProject, visibleLabel, visibleAssignee,
  ownerOnly, canSeeTask, inSpace, sharedSpaces };
