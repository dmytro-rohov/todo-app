// Every call the app makes. All go through request() (http.js): JSON, timeouts, ApiError, session-ended event.
import { API_BASE, request } from "./http.js";

const json = (method, body) => ({ method, body });

export const api = {
  tasks: () => request("/api/tasks"),
  createTask: body => request("/api/tasks", json("POST", body)),
  updateTask: (id, body) => request(`/api/tasks/${id}`, json("PATCH", body)),
  deleteTask: id => request(`/api/tasks/${id}`, { method: "DELETE" }),
  moveTask: body => request("/api/tasks/move", json("POST", body)),
  history: id => request(`/api/tasks/${id}/history`),
  archive: () => request("/api/archive"),
  settings: () => request("/api/settings"),
  updateSettings: body => request("/api/settings", json("PATCH", body)),
  scanTasks: () => request("/api/settings/ai/scan", json("POST", {})),
  goals: (year, month) => request(`/api/goals?year=${year}${month ? `&month=${month}` : ""}`),
  goalPeriods: () => request("/api/goals/periods"),
  createGoal: body => request("/api/goals", json("POST", body)),
  updateGoal: (id, body) => request(`/api/goals/${id}`, json("PATCH", body)),
  deleteGoal: id => request(`/api/goals/${id}`, { method: "DELETE" }),
  orderGoals: body => request("/api/goals/order", json("PUT", body)),
  restore: id => request(`/api/archive/${id}/restore`, json("POST", {})),
  timer: (id, action) => request(`/api/tasks/${id}/timer/${action}`, json("POST", {})),

  notes: id => request(`/api/tasks/${id}/notes`),
  addNote: (id, body) => request(`/api/tasks/${id}/notes`, json("POST", { body })),
  updateNote: (id, noteId, body) => request(`/api/tasks/${id}/notes/${noteId}`, json("PATCH", { body })),
  deleteNote: (id, noteId) => request(`/api/tasks/${id}/notes/${noteId}`, { method: "DELETE" }),

  subtasks: id => request(`/api/tasks/${id}/subtasks`),
  addSubtask: (id, title) => request(`/api/tasks/${id}/subtasks`, json("POST", { title })),
  updateSubtask: (id, subId, body) => request(`/api/tasks/${id}/subtasks/${subId}`, json("PATCH", body)),
  deleteSubtask: (id, subId) => request(`/api/tasks/${id}/subtasks/${subId}`, { method: "DELETE" }),

  calendarAccounts: () => request("/api/calendar/accounts"),
  calendarConnect: spaceId => request("/api/calendar/connect", json("POST", { spaceId })),
  calendarSync: id => request(`/api/calendar/accounts/${id}/sync`, json("POST", {})),
  calendarDisconnect: id => request(`/api/calendar/accounts/${id}`, { method: "DELETE" }),
  events: (from, to, clientId) => request(`/api/calendar/events?from=${from}&to=${to}${clientId ? `&clientId=${clientId}` : ""}`),
  createEvent: body => request("/api/calendar/events", json("POST", body)),
  updateEvent: (id, body) => request(`/api/calendar/events/${id}`, json("PATCH", body)),
  deleteEvent: id => request(`/api/calendar/events/${id}`, { method: "DELETE" }),
  setEventClient: (id, clientId) => request(`/api/calendar/events/${id}/client`, json("PUT", { clientId })),

  mail: (view, q) => request(`/api/mail?view=${encodeURIComponent(view)}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  mailMessage: id => request(`/api/mail/${id}`),
  mailSeen: id => request(`/api/mail/${id}/seen`, json("POST", {})),
  mailUpdate: (id, body) => request(`/api/mail/${id}`, json("PATCH", body)),
  mailSync: () => request("/api/mail/sync", json("POST", {})),
  mailLead: id => request(`/api/mail/${id}/lead`, json("POST", {})),
  mailSuggest: id => request(`/api/mail/${id}/suggest`, json("POST", {})),
  mailInvite: id => request(`/api/mail/${id}/invite`, json("POST", {})),

  briefs: ({ eventId, clientId, unassigned } = {}) => request(`/api/briefs?${new URLSearchParams(Object.entries({ eventId, clientId, unassigned }).filter(([, v]) => v != null))}`),
  brief: id => request(`/api/briefs/${id}`),
  createBrief: body => request("/api/briefs", json("POST", body)),
  runBrief: id => request(`/api/briefs/${id}/run`, json("POST", {})),
  assignBrief: (id, eventId) => request(`/api/briefs/${id}`, json("PATCH", { eventId })),

  changePassword: (current, next) => request("/api/auth/password", json("POST", { current, next })),
  // account pictures: one's own set or removed; anyone's (who may see it) by id (null = the owner), its version in the address
  setAvatar: image => request("/api/avatars/me", { ...json("PUT", { image }), timeoutMs: 30000 }),
  deleteAvatar: () => request("/api/avatars/me", { method: "DELETE" }),
  avatarUrl: (id, version) => `${API_BASE}/api/avatars/${id === null || id === undefined ? "owner" : Number(id)}?v=${Number(version)}`,
  // a shared space's people, the owner adding an account, taking out / leaving ("me"), invitation codes, joining
  spaceMembers: id => request(`/api/spaces/${Number(id)}/members`),
  addSpaceMember: (id, userId) => request(`/api/spaces/${Number(id)}/members`, json("POST", { userId })),
  removeSpaceMember: (id, who) => request(`/api/spaces/${Number(id)}/members/${who === "me" || who === null ? (who ?? "owner") : Number(who)}`, { method: "DELETE" }),
  createInvite: id => request(`/api/spaces/${Number(id)}/invites`, json("POST", {})),
  spaceInvites: id => request(`/api/spaces/${Number(id)}/invites`),
  withdrawInvite: (id, inviteId) => request(`/api/spaces/${Number(id)}/invites/${Number(inviteId)}`, { method: "DELETE" }),
  joinPreview: code => request("/api/spaces/join/preview", json("POST", { code })),
  joinSpace: code => request("/api/spaces/join", json("POST", { code })),

  list: kind => request(`/api/${kind}`),
  create: (kind, body) => request(`/api/${kind}`, json("POST", body)),
  update: (kind, id, body) => request(`/api/${kind}/${id}`, json(kind === "categories" ? "PUT" : "PATCH", body)),
  remove: (kind, id) => request(`/api/${kind}/${id}`, { method: "DELETE" }),
  // "To ja": an assignee someone made for themselves; its tasks go to the account's own entry and it is deleted
  assigneeIntoSelf: id => request(`/api/assignees/${Number(id)}/into-self`, json("POST", {}))
};

// sha256 hex of a string (the board's optimistic-concurrency token).
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
