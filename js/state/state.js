import { getCategories } from "../api/categories.js";

export const input =
  document.querySelector(".add-task-input");

export const addBtn =
  document.querySelector(".add-btn");

export const modalOverlay =
  document.querySelector(".modal-overlay");

export const circularProgress =
  document.querySelectorAll(".circular-progress");

export const state = {
  tasksArr: [],
  categoriesArr: [],
  activeCategoryFilter: null,
  selectedCategoryId: null
};