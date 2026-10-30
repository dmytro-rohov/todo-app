import {
  input,
  addBtn,
  modalOverlay,
  circularProgress,
  state
} from "../state/state.js";

import {
  getTasks,
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

import { createTask } from "../actions/tasks.js";

export function initListeners() {

// input keybord
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    addBtn.click();
  }
});

// delete one
document.addEventListener("click", async (e) => {
  if (e.target.classList.contains("delete-one") && e.target.closest(".task-item")) {
    const id = Number(e.target.dataset.id);
    try {
      await deleteTask(id);
      state.tasksArr = await getTasks();
      renderAllTasks();
      renderCategories();
    } catch(error) {
      alert(error.message);
    }
  }
});

// delete all
document.addEventListener("click", async (e) => {
  if (e.target.classList.contains("delete-btn")) {
    const date = e.target.dataset.date;
    if (!date) return;
    try {
      await deleteTaskByDate(date);
      state.tasksArr = await getTasks();
      renderAllTasks();
      renderCategories();
    } catch(error) {
      alert(error.message);
    }
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
    try {
      await updateTask({ id, completed: isChecked });
    } catch(error) {
      alert(error.message);
    }
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
  };

  try {
    state.tasksArr = await createTask(newTask);
    renderAllTasks();
    renderCategories();
  } catch(error) {
    alert(error.message);
  }


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
  const category = state.categoriesArr[index];
  if (!category) return;

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

    try {
      await addCategory(newCategory);
      state.categoriesArr = await getCategories();
    } catch(error) {
      alert(error.message);
      return;
    }

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
    try {
      await deleteCategory(id);
      state.categoriesArr = await getCategories();
      state.tasksArr = await getTasks();
    } catch(error) {
      alert(error.message);
      return;
    }

    renderCategoriesModal();
    renderCategories();
    renderAllTasks();

    return;
  }

  state.selectedCategoryId = id;

  document.querySelectorAll(".modal-categories li").forEach(el =>
    el.classList.remove("active")
  );

  li.classList.add("active");
});

}