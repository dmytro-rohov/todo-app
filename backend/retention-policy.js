// Pure policy only: does not connect to a database or touch files.
const DAY_MS = 24 * 60 * 60 * 1000;
function timestamp(value) {
  if (value === null || value === undefined) return null;
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : null;
}
function retentionAction(task, now = new Date()) {
  const current = timestamp(now);
  if (current === null) throw new TypeError('Invalid retention clock');
  const archived = timestamp(task.archivedAt);
  if (archived !== null) {
    return !task.protectedFromDeletion && current - archived >= 30 * DAY_MS ? 'delete' : 'keep';
  }
  const completed = timestamp(task.completedAt);
  return task.status === 'done' && completed !== null && current - completed >= 30 * DAY_MS ? 'archive' : 'keep';
}
module.exports = { DAY_MS, retentionAction };
