import { state } from "./state/state.js";
import { getTasks } from "./api/tasks.js";
import { getCategories  } from "./api/categories.js";

import { renderAllTasks } from "./ui/renderTasks.js";
import { renderCategories } from "./ui/renderCategories.js";
import { renderCategoriesModal } from "./ui/renderCategories.js";

import { initModalListeners } from "./modals/modal.js";
import { initListeners } from "./events/listeners.js";
import { initEasters } from "./events/easterEggs.js";

async function init() {

  try {
    state.tasksArr = await getTasks();
    state.categoriesArr = await getCategories();
  } catch(error) {
    console.error(error);
    document.querySelector(".tasks-wrapper").textContent =
      `Nie udało się pobrać danych: ${error.message}`;
  }

  renderAllTasks();
  renderCategoriesModal();
  renderCategories();

  initModalListeners();
  initListeners();
  initEasters();
}

init();



