// Who is asking and what they may see. The owner (AUTH_USERNAME / the Mytko login) has user id null: every row from
// before accounts existed is the owner's. Members (users.js) see their own rows plus everything in shared spaces;
// clients, calendars, booking and accounts are the owner's only.
const OWNER = Object.freeze({ id: null, role: "owner", login: null, name: null, actor: "owner" });

function memberUser(row) {
  return Object.freeze({ id: row.id, role: "member", login: row.login, name: row.name, actor: `user:${row.login}`.slice(0, 40) });
}

const isOwner = user => !user || user.role === "owner";
const userId = user => (user ? user.id : null);

// SQL fragments; `p` is the placeholder that holds the user's id (NULL for the owner).
const SHARED_SPACES = "(SELECT id FROM spaces WHERE shared)";
const own = (alias, p) => `${alias}.user_id IS NOT DISTINCT FROM ${p}`;
const visibleSpace = (alias, p) => `(${own(alias, p)} OR ${alias}.shared)`;
const visibleTask = (alias, p) => `(${own(alias, p)} OR ${alias}.space_id IN ${SHARED_SPACES})`;
const visibleProject = visibleTask;
// Labels and assignees: one's own, plus those on tasks in shared spaces (shown there, editable by their owner only).
const visibleLabel = (alias, p) => `(${own(alias, p)} OR ${alias}.id IN (SELECT category_id FROM tasks WHERE space_id IN ${SHARED_SPACES})
  OR ${alias}.id IN (SELECT l.category_id FROM task_labels l JOIN tasks t ON t.id = l.task_id WHERE t.space_id IN ${SHARED_SPACES}))`;
const visibleAssignee = (alias, p) => `(${own(alias, p)} OR ${alias}.id IN (SELECT assignee_id FROM tasks WHERE space_id IN ${SHARED_SPACES}))`;

// Express: refuses members (403) on owner-only APIs.
function ownerOnly(req, res, next) {
  if (isOwner(req.user)) return next();
  res.status(403).json({ message: "Not available for this account" });
}

async function canSeeTask(db, user, taskId) {
  return (await db.query(`SELECT 1 FROM tasks t WHERE t.id = $1 AND ${visibleTask("t", "$2::integer")}`, [taskId, userId(user)])).rowCount > 0;
}

module.exports = { OWNER, memberUser, isOwner, userId, own, visibleSpace, visibleTask, visibleProject, visibleLabel, visibleAssignee,
  ownerOnly, canSeeTask, SHARED_SPACES };
