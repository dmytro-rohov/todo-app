import { addTask, getTasks } from "../api/tasks.js";

// Creates exactly one task and returns the refreshed task list.
// Kept free of DOM access so the flow can be tested in Node.
export async function createTask(newTask) {
  await addTask(newTask);
  return getTasks();
}
