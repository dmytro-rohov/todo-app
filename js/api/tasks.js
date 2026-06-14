const API_URL = "http://localhost:3000/tasks";

export async function getTasks() {
  const response = await fetch(API_URL);
  const data = await response.json();
  return data;
}
 
export async function addTask(task) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(task)
  });
  
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message);
  }

  return data;
}

export async function updateTask(task) {
  await fetch(`${API_URL}/${task.id}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(task)
  });
}

export async function deleteTask(id) {
  await fetch(`${API_URL}/${id}`, {
    method: "DELETE"
  });
}

export async function deleteTaskByDate(date) {
  await fetch(`${API_URL}/date/${date}`, {
    method: "DELETE"
  });
}