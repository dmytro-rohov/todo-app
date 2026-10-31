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

  state.tasksArr = await getTasks();
  state.categoriesArr = await getCategories();

  renderAllTasks();
  renderCategoriesModal();
  renderCategories();

  initModalListeners();
  initListeners();
  initEasters();
}

init();



