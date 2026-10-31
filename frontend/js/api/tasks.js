import { request, jsonOptions } from "./request.js";

const API_URL = "/api/tasks";

export async function getTasks() {
  return request(API_URL);
}

export async function addTask(task) {
  return request(API_URL, jsonOptions("POST", task));
}

export async function updateTask(task) {
  return request(`${API_URL}/${task.id}`, jsonOptions("PUT", task));
}

export async function deleteTask(id) {
  return request(`${API_URL}/${id}`, { method: "DELETE" });
}

export async function deleteTaskByDate(date) {
  return request(`${API_URL}/date/${encodeURIComponent(date)}`, { method: "DELETE" });
}
