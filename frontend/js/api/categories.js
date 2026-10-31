import { request } from "./http.js";

const CATEGORIES_PATH = "/categories";

export async function getCategories() {
  return request(CATEGORIES_PATH);
}

export async function addCategory(category) {
  return request(CATEGORIES_PATH, {
    method: "POST",
    body: category
  });
}

export async function deleteCategory(id) {
  return request(`${CATEGORIES_PATH}/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}
