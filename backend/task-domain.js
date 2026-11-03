const { isValidDate, parseId } = require('./validation');
const STATUSES = ['todo', 'in_progress', 'needs_review', 'done'];
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
function validateTaskPatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid request body' };
  const allowed = ['title','description','status','priority','categoryId','dueDate','position','projectId','assigneeId','labelIds'];
  if (!Object.keys(body).length || Object.keys(body).some(k => !allowed.includes(k))) return { error: 'Unknown or empty task fields' };
  if ('title' in body && (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length < 3 || body.title.length > 100)) return { error: 'Invalid title' };
  if ('labelIds' in body && (!Array.isArray(body.labelIds) || body.labelIds.length > 50 || body.labelIds.some(id => !Number.isSafeInteger(id) || parseId(id) === null) || new Set(body.labelIds).size !== body.labelIds.length)) return { error: 'Invalid labels' };
  if ('labelIds' in body && 'categoryId' in body && body.categoryId !== (body.labelIds[0] ?? null)) return { error: 'Primary label must match categoryId' };
  if ('description' in body && (typeof body.description !== 'string' || body.description.length > 5000)) return { error: 'Invalid description' };
  if ('status' in body && !STATUSES.includes(body.status)) return { error: 'Invalid status' };
  if ('priority' in body && !PRIORITIES.includes(body.priority)) return { error: 'Invalid priority' };
  if ('dueDate' in body && body.dueDate !== null && !isValidDate(body.dueDate)) return { error: 'Invalid due date' };
  if ('categoryId' in body && body.categoryId !== null && parseId(body.categoryId) === null) return { error: 'Invalid category' };
  for (const key of ['projectId', 'assigneeId']) {
    if (key in body && body[key] !== null && parseId(body[key]) === null) return { error: 'Invalid ' + key };
  }
  if ('position' in body && (!Number.isSafeInteger(body.position) || body.position < 0)) return { error: 'Invalid position' };
  return { value: { ...body, ...('labelIds' in body ? { categoryId: body.labelIds[0] ?? null } : {}), ...('title' in body ? { title: body.title.trim() } : {}) } };
}
module.exports = { STATUSES, PRIORITIES, validateTaskPatch };
