import { getCategories } from "../api/categories.js";

import { state } from "../state/state.js";

export function renderCategories() {
  const list = document.querySelector(".categories-list");
  list.innerHTML = state.categoriesArr.map(cat => {
    const count = state.tasksArr.filter(t => t.categoryId === cat.id).length;
    return `
      <li class="category-item">
        <div class="category-item__box">
          <span style="background-color: ${cat.color}" class='category-item__color'></span>
          <p>${cat.name}</p>
        </div>
        <span class="category-item__number">${count}</span>
      </li>
    `;
  }).join("");
}


export function renderCategoriesModal() {
  const list = document.querySelector(".modal-categories");
  list.innerHTML = state.categoriesArr.map(cat => `
    <li class='modal-category' data-id="${cat.id}">
      <span href="" class="category">${cat.name}</span>
      <button class="delete-one"></button>
    </li>
  `).join("");
}