// Input validation shared by the routes. Each validator returns an error
// message (string) or null when the payload is valid.

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function isValidDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function parseId(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return null;
  }
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

function isOptionalId(value) {
  return value === undefined || value === null ||
    (Number.isInteger(value) && value > 0 && value <= 2147483647);
}

function validateTask(data) {
  if (!data || typeof data !== "object") {
    return "Invalid request body";
  }

  if (data.title === undefined || data.title === null || data.title === "") {
    return "Title is required";
  }

  if (typeof data.title !== "string") {
    return "Title must be a string";
  }

  if (data.title.trim().length < 3) {
    return "Title too short";
  }

  if (data.title.length > 100) {
    return "Title too long";
  }

  if (!data.date) {
    return "Date is required";
  }

  if (!isValidDate(data.date)) {
    return "Date must be in YYYY-MM-DD format";
  }

  if (data.completed !== undefined && typeof data.completed !== "boolean") {
    return "Completed must be a boolean";
  }

  if (!isOptionalId(data.categoryId)) {
    return "Invalid category id";
  }

  return null;
}

function validateCategory(data) {
  if (!data || typeof data !== "object") {
    return "Invalid request body";
  }

  if (data.name === undefined || data.name === null || data.name === "") {
    return "Category name is required";
  }

  if (typeof data.name !== "string") {
    return "Category name must be a string";
  }

  if (data.name.trim().length < 2) {
    return "Category name too short";
  }

  if (data.name.length > 50) {
    return "Category name too long";
  }

  if (!data.color) {
    return "Color is required";
  }

  if (typeof data.color !== "string" || !COLOR_PATTERN.test(data.color)) {
    return "Color must be a hex value like #4e45e4";
  }

  return null;
}

module.exports = {
  validateTask,
  validateCategory,
  isValidDate,
  parseId
};
