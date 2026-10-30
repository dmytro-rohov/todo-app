import { request, jsonOptions } from "./request.js";

const API_URL = "/api/categories";

export async function getCategories() {
  return request(API_URL);
}

export async function addCategory(category) {
  return request(API_URL, jsonOptions("POST", category));
}

export async function deleteCategory(id) {
  return request(`${API_URL}/${id}`, { method: "DELETE" });
}
