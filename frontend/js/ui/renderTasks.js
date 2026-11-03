import { state }
  from "../state/state.js";

import {
  groupTasksByDate,
  formatDateLabel
} from "../utils/date.js";

import {
  updateProgressBar
} from "./progressBar.js";

import { escapeHtml, safeColor } from "../utils/helpers.js";

export function renderAllTasks() {
  const container = document.querySelector(".tasks-wrapper");
  container.innerHTML = "";

  const grouped = groupTasksByDate(state.tasksArr);

  // date sorted
  const sortedDates = Object.keys(grouped).sort((a,b) => b.localeCompare(a));
  if (sortedDates.length === 0) {
  container.innerHTML = "<p>Dodaj swoje pierwsze zadanie klikając przycisk „Dodaj”</p>";
  updateProgressBar();
  return;
}

  sortedDates.forEach(date => {
    const tasksForDay = grouped[date];
    const tasksDiv = document.createElement("div");
    tasksDiv.classList.add("tasks");
    tasksDiv.setAttribute("data-date", date);

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
        <button class="btn third-btn delete-btn" data-date="${escapeHtml(date)}">Wyczyść wszystko</button>
      </div>`;

      const list = tasksDiv.querySelector(".tasks-container");
      tasksForDay.forEach(task => {
        const li = document.createElement("li");
        const isActive = state.activeCategoryFilter === task.categoryId;
        const category = state.categoriesArr.find(c => c.id === task.categoryId);
        const color = safeColor(category?.color);
        const id = Number(task.id);
        li.classList.add("task-item");
        if (isActive) li.classList.add("highlight");
        li.innerHTML = `
        <div class="checkbox-wrapper">
          <input
            id="${id}"
            type="checkbox"
            ${task.completed ? "checked" : ""}
            data-id="${id}"
          />
          <label class="cbx" for="${id}"></label>
          <div class="task-item__title-box">
            <label class="lbl ${task.completed ? "done" : ""}" for="${id}">
              ${escapeHtml(task.title)}
            </label>
            <div class="task-item__categories-box">
              <div class="task-item__categories">
                <span class="task-item__indicator"></span>
                <span class=" task-item__category">
                 ${escapeHtml(category?.name || "Brak")}
                </span>
              </div>
            </div>
          </div>
          <button class="btn delete-one" data-id="${id}"></button>
        </div>`;
        // set via CSSOM: inline style attributes are blocked by the CSP
        li.querySelector(".task-item__indicator").style.backgroundColor = color;
        li.querySelector(".task-item__category").style.color = color;
        list.appendChild(li);
      });
      container.appendChild(tasksDiv);
  });
  updateProgressBar();
}
