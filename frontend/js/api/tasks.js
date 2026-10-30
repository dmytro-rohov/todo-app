import { request } from "./http.js";

const TASKS_PATH = "/tasks";

export async function getTasks() {
  return request(TASKS_PATH);
}

export async function addTask(task) {
  return request(TASKS_PATH, {
    method: "POST",
    body: task
  });
}

export async function updateTask(task) {
  return request(`${TASKS_PATH}/${encodeURIComponent(task.id)}`, {
    method: "PUT",
    body: task
  });
}

export async function deleteTask(id) {
  return request(`${TASKS_PATH}/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export async function deleteTaskByDate(date) {
  return request(`${TASKS_PATH}/date/${encodeURIComponent(date)}`, {
    method: "DELETE"
  });
}
