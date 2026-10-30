import { state } from "../state/state.js";

import { escapeHtml, safeColor } from "../utils/helpers.js";

export function renderCategories() {
  const list = document.querySelector(".categories-list");
  list.innerHTML = state.categoriesArr.map(cat => {
    const count = state.tasksArr.filter(t => t.categoryId === cat.id).length;
    return `
      <li class="category-item">
        <div class="category-item__box">
          <span class='category-item__color'></span>
          <p>${escapeHtml(cat.name)}</p>
        </div>
        <span class="category-item__number">${count}</span>
      </li>
    `;
  }).join("");

  // set via CSSOM: inline style attributes are blocked by the CSP
  list.querySelectorAll(".category-item__color").forEach((el, index) => {
    el.style.backgroundColor = safeColor(state.categoriesArr[index].color);
  });
}


export function renderCategoriesModal() {
  const list = document.querySelector(".modal-categories");
  list.innerHTML = state.categoriesArr.map(cat => `
    <li class='modal-category' data-id="${Number(cat.id)}">
      <span class="category">${escapeHtml(cat.name)}</span>
      <button class="delete-one"></button>
    </li>
  `).join("");
}
