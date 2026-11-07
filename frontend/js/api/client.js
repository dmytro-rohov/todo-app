// Every call the app makes. All go through request() (http.js): JSON, timeouts, ApiError, session-ended event.
import { request } from "./http.js";

const json = (method, body) => ({ method, body });

export const api = {
  tasks: () => request("/api/tasks"),
  createTask: body => request("/api/tasks", json("POST", body)),
  updateTask: (id, body) => request(`/api/tasks/${id}`, json("PATCH", body)),
  deleteTask: id => request(`/api/tasks/${id}`, { method: "DELETE" }),
  moveTask: body => request("/api/tasks/move", json("POST", body)),
  history: id => request(`/api/tasks/${id}/history`),
  archive: () => request("/api/archive"),
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

  list: kind => request(`/api/${kind}`),
  create: (kind, body) => request(`/api/${kind}`, json("POST", body)),
  update: (kind, id, body) => request(`/api/${kind}/${id}`, json(kind === "categories" ? "PUT" : "PATCH", body)),
  remove: (kind, id) => request(`/api/${kind}/${id}`, { method: "DELETE" })
};

// sha256 hex of a string (the board's optimistic-concurrency token).
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
