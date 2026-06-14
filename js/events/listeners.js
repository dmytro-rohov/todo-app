import {
  input,
  addBtn,
  modalOverlay,
  circularProgress,
  state
} from "../state/state.js";

import {
  getTasks,
  addTask,
  updateTask,
  deleteTask,
  deleteTaskByDate
} from "../api/tasks.js";

import {
  getCategories,
  addCategory,
  deleteCategory
} from "../api/categories.js";

import {
  renderAllTasks
} from "../ui/renderTasks.js";

import {
  renderCategories,
  renderCategoriesModal
} from "../ui/renderCategories.js";

import {
  getTodayKey
} from "../utils/date.js";

import {
  lockScroll,
  unlockScroll
} from "../modals/modal.js";

import { getRandomColor } from "../utils/helpers.js";

export function initListeners() {

// input keybord
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    addBtn.click();
  }
});

// delete one
document.addEventListener("click", async (e) => {
  if (e.target.classList.contains("delete-one")) {
    const id = Number(e.target.dataset.id);
    await deleteTask(id);
    state.tasksArr = await getTasks();
    renderAllTasks();
  }
});

// delete all
document.addEventListener("click", async (e) => {
  if (e.target.classList.contains("delete-btn")) {
    const date = e.target.dataset.date;
    await deleteTaskByDate(date);
    state.tasksArr = await getTasks();
    renderAllTasks();
  }
});

// toggle checkbox
document.addEventListener("change", async (e) => {
  if (e.target.type === "checkbox") {
    const id = Number(e.target.dataset.id);
    const isChecked = e.target.checked;

    const updatedTask = state.tasksArr.find(task => task.id === id)
    if (!updatedTask) return;
    updatedTask.completed = isChecked;
    await updateTask(updatedTask);
    state.tasksArr = await getTasks();
    renderAllTasks();
  }
});

//add task from modal level
document.querySelector(".confirm-btn").addEventListener("click", async () => {
  const title = document.querySelector(".modal-input").value.trim();
  if (!title) return;

  if (!state.selectedCategoryId) {
    alert("Wybierz kategorię");
    return;
  }

  const todayKey = getTodayKey();

  modalOverlay.classList.add("hidden");
  unlockScroll();

  const newTask = {
    title,
    completed: false,
    categoryId: state.selectedCategoryId,
    date: todayKey
  }; try {

    await addTask(newTask);

    state.tasksArr = await getTasks();

    renderAllTasks();

  } catch(error) {

    alert(error.message);

  }

  await addTask(newTask);
  state.tasksArr = await getTasks();
  renderAllTasks();
  renderCategories();


  state.selectedCategoryId = null;
  document.querySelectorAll(".modal-categories li").forEach(el => {
    el.classList.remove("active");
  })
})

// categories

document.querySelector(".categories-list").addEventListener("click", (e) => {
  const li = e.target.closest(".category-item");
  if (!li) return;

  const index = [...li.parentElement.children].indexOf(li);
  const category = categories[index];

  // toggle click
  if (state.activeCategoryFilter == category.id) {
    state.activeCategoryFilter = null;
  } else {
    state.activeCategoryFilter = category.id;
  }
  renderAllTasks();
})


// show input to add category
document.querySelector(".add-category-btn").addEventListener("click", () => {
  document.querySelector(".new-category").classList.remove("hidden");
})

// add new category ENTER key
document.querySelector(".new-category-input").addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    const value = e.target.value.trim();
    if (!value) return;

    const newCategory = {
      name: value,
      color: getRandomColor()
    };

    await addCategory(newCategory);
    state.categoriesArr.length = 0;
    state.categoriesArr.push(...await getCategories());

    renderCategories();
    renderCategoriesModal();

    e.target.value = "";
    document.querySelector(".new-category").classList.add("hidden");
  }
});

// add button
addBtn.addEventListener("click", () => {
  const value = input.value.trim();
  if (!value) return;
  modalOverlay.classList.remove("hidden");
  document.querySelector(".modal-input").value = value;

  // easter author input
  if (input.value.toLowerCase() === "author") {
    alert("Ta piekna TO-DO lista stworzona przez Mytko01");
  }

  input.value = "";
  lockScroll();
});

document.querySelector(".modal-categories").addEventListener("click", async (e) => {
  const li = e.target.closest("li");
  if (!li) return;

  const id = Number(li.dataset.id);

  if (e.target.classList.contains("delete-one")) {
    await deleteCategory(id);

    state.categoriesArr = await getCategories();

    renderCategoriesModal();
    renderCategories();

    return;
  }

  state.selectedCategoryId = id;

  document.querySelectorAll(".modal-categories li").forEach(el =>
    el.classList.remove("active")
  );

  li.classList.add("active");
});

}