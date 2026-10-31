import { state }
  from "../state/state.js";

import { getCategories }
  from "../api/categories.js";

import {
  groupTasksByDate,
  formatDateLabel
} from "../utils/date.js";

import {
  updateProgressBar
} from "./progressBar.js";

import {
  escapeHtml,
  safeColor
} from "../utils/helpers.js";

export function renderAllTasks() {
  const container = document.querySelector(".tasks-wrapper");
  container.innerHTML = "";

  const grouped = groupTasksByDate(state.tasksArr);

  // date sorted
  const sortedDates = Object.keys(grouped).sort((a,b) => b.localeCompare(a));
  if (sortedDates.length === 0) {
  container.innerHTML = "<p>Dodaj swoje pierwsze zadanie klikając przycisk „Dodaj”</p>";
  return;
}

  sortedDates.forEach(date => {
    const tasksForDay = grouped[date];
    const tasksDiv = document.createElement("div");
    tasksDiv.classList.add("tasks");
    tasksDiv.setAttribute("data-date", date);
    const safeDate = escapeHtml(date);

    tasksDiv.innerHTML = `<div class="tasks-top">
        <div class="task-top__date">
          <div class="label date">${escapeHtml(formatDateLabel(date))}</div>
          <span>Moje zadania:</span>
        </div>
        <div class="counter">
          <span>Liczba zadan:</span>
          <span class="how-many">${tasksForDay.length}</span>
        </div>
      </div>
      <ul class="tasks-container"></ul>
      <div class="tasks-bottom">
        <button class="btn third-btn delete-btn" data-date="${safeDate}">Wyczyść wszystko</button>
      </div>`;

      const list = tasksDiv.querySelector(".tasks-container");
      tasksForDay.forEach(task => {
        const li = document.createElement("li");
        const isActive = state.activeCategoryFilter === task.categoryId;
        li.classList.add("task-item");
        if (isActive) li.classList.add("highlight");
        const category = state.categoriesArr.find(c => c.id === task.categoryId);
        const categoryColor = escapeHtml(safeColor(category?.color));
        const taskId = escapeHtml(task.id);
        li.innerHTML = `
        <div class="checkbox-wrapper">
          <input
            id="${taskId}"
            type="checkbox"
            ${task.completed ? "checked" : ""}
            data-id="${taskId}"
          />
          <label class="cbx" for="${taskId}"></label>
          <div class="task-item__title-box">
            <label class="lbl ${task.completed ? "done" : ""}" for="${taskId}">
              ${escapeHtml(task.title)}
            </label>
            <div class="task-item__categories-box">
              <div class="task-item__categories">
                <span class="task-item__indicator" style="background-color:${categoryColor}"></span>
                <span class=" task-item__category" style="color: ${categoryColor}">
                 ${escapeHtml(category?.name || "Brak")}
                </span>
              </div>
            </div>
          </div>
          <button class="btn delete-one" data-id="${taskId}"></button>
        </div>`;
        list.appendChild(li);
      });
      container.appendChild(tasksDiv);
  });
  updateProgressBar();
}