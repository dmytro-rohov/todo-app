const { isValidDate, parseId } = require('./validation');
const { STATUSES } = require('./task-status');
const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
function validateTaskPatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid request body' };
  const allowed = ['title','description','status','priority','categoryId','dueDate','position','spaceId','projectId','labelIds','assigneeId','clientId','meetingId','mailId','workflow'];
  if (!Object.keys(body).length || Object.keys(body).some(k => !allowed.includes(k))) return { error: 'Unknown or empty task fields' };
  if ('title' in body && (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length < 3 || body.title.length > 100)) return { error: 'Invalid title' };
  if ('description' in body && (typeof body.description !== 'string' || body.description.length > 5000)) return { error: 'Invalid description' };
  if ('status' in body && !STATUSES.includes(body.status)) return { error: 'Invalid status' };
  if ('priority' in body && !PRIORITIES.includes(body.priority)) return { error: 'Invalid priority' };
  if ('dueDate' in body && body.dueDate !== null && !isValidDate(body.dueDate)) return { error: 'Invalid due date' };
  if ('categoryId' in body && body.categoryId !== null && parseId(body.categoryId) === null) return { error: 'Invalid category' };
  if ('position' in body && (!Number.isSafeInteger(body.position) || body.position < 0)) return { error: 'Invalid position' };
  if ('spaceId' in body && body.spaceId !== null && parseId(body.spaceId) === null) return { error: 'Invalid space' };
  if ('projectId' in body && body.projectId !== null && parseId(body.projectId) === null) return { error: 'Invalid project' };
  if ('assigneeId' in body && body.assigneeId !== null && parseId(body.assigneeId) === null) return { error: 'Invalid assignee' };
  if ('clientId' in body && body.clientId !== null && parseId(body.clientId) === null) return { error: 'Invalid client' };
  if ('meetingId' in body && body.meetingId !== null && parseId(body.meetingId) === null) return { error: 'Invalid meeting' };
  if ('mailId' in body && body.mailId !== null && parseId(body.mailId) === null) return { error: 'Invalid e-mail' };
  if ('labelIds' in body && !isLabelList(body.labelIds)) return { error: 'Invalid labels' };
  if ('workflow' in body && typeof body.workflow !== 'boolean') return { error: 'Invalid workflow' };
  const value = { ...body, ...('title' in body ? { title: body.title.trim() } : {}) };
  for (const key of ['categoryId', 'spaceId', 'projectId', 'assigneeId', 'clientId', 'meetingId', 'mailId']) if (value[key] != null) value[key] = Number(value[key]);
  if (value.labelIds) value.labelIds = value.labelIds.map(Number);
  return { value };
}
// Up to MAX_LABELS distinct ids; the first one is the task's primary label (category_id).
const MAX_LABELS = 10;
function isLabelList(value) {
  return Array.isArray(value) && value.length <= MAX_LABELS && value.every(id => parseId(id) !== null) &&
    new Set(value.map(Number)).size === value.length;
}
module.exports = { STATUSES, PRIORITIES, MAX_LABELS, validateTaskPatch };
