const API_URL = "http://localhost:3000/categories";

export async function getCategories() {
  const response = await fetch(API_URL);
  const data = await response.json();
  return data;
}
 
export async function addCategory(category) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(category)
  });
  return await response.json();
}

export async function deleteCategory(id) {
  await fetch(`${API_URL}/${id}`, {
    method: "DELETE"
  });
}