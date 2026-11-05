// Task change log. Written by the application in the same transaction as the change it records (formerly a
// trigger); the history records THAT a field changed, so long text is truncated rather than copied.
const TRACKED = {
  title: "title",
  description: "description",
  status: "status",
  priority: "priority",
  date: "date",
  dueDate: "due_date",
  categoryId: "category_id",
  labelIds: "labels",
  spaceId: "space_id",
  projectId: "project_id",
  archivedAt: "archived_at"
};
const MAX_VALUE = 200;

function show(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.join(",");
  if (value instanceof Date) return value.toISOString();
  return String(value).slice(0, MAX_VALUE);
}

// before: the task as read before the change (null for a new task); after: the task as read after it.
function taskChanges(before, after) {
  if (!before) return [{ field: "created", oldValue: null, newValue: show(after.title) }];
  return Object.entries(TRACKED)
    .filter(([key]) => show(before[key]) !== show(after[key]))
    .map(([key, field]) => ({ field, oldValue: show(before[key]), newValue: show(after[key]) }));
}

async function recordTaskChanges(client, taskId, changes, actor = "owner") {
  if (!changes.length) return;
  await client.query(
    `INSERT INTO task_history (task_id, field, old_value, new_value, actor)
     SELECT $1, c.field, c.old_value, c.new_value, $5
     FROM unnest($2::text[], $3::text[], $4::text[]) AS c(field, old_value, new_value)`,
    [taskId, changes.map(c => c.field), changes.map(c => c.oldValue), changes.map(c => c.newValue), actor]
  );
}

module.exports = { TRACKED, taskChanges, recordTaskChanges };
