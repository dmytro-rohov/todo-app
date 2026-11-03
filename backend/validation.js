const MAX_INT = 2147483647;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function parseId(value) {
  if (!/^\d+$/.test(String(value))) return null;
  const id = Number(value);
  return id >= 1 && id <= MAX_INT ? id : null;
}

function isValidDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isBody(data) {
  return data !== null && typeof data === "object" && !Array.isArray(data);
}

// Returns { error } or { value } with a normalized task.
function validateTask(data) {
  if (!isBody(data)) return { error: "Invalid request body" };

  const { title, completed = false, date, categoryId = null } = data;

  if (typeof title !== "string" || !title.trim()) {
    return { error: "Title is required" };
  }
  if (title.trim().length < 3) {
    return { error: "Title too short" };
  }
  if (title.length > 100) {
    return { error: "Title too long" };
  }
  if (!date) {
    return { error: "Date is required" };
  }
  if (!isValidDate(date)) {
    return { error: "Date must be YYYY-MM-DD" };
  }
  if (typeof completed !== "boolean") {
    return { error: "Completed must be true or false" };
  }
  if (categoryId !== null && parseId(categoryId) === null) {
    return { error: "Invalid category" };
  }

  return {
    value: {
      title: title.trim(),
      completed,
      date,
      categoryId: categoryId === null ? null : Number(categoryId)
    }
  };
}

function validateCategory(data) {
  if (!isBody(data)) return { error: "Invalid request body" };

  const { name, color } = data;

  if (typeof name !== "string" || !name.trim()) {
    return { error: "Category name is required" };
  }
  if (name.trim().length < 2) {
    return { error: "Category name too short" };
  }
  if (name.length > 50) {
    return { error: "Category name too long" };
  }
  if (!color) {
    return { error: "Color is required" };
  }
  if (typeof color !== "string" || !COLOR_PATTERN.test(color)) {
    return { error: "Color must be a hex value like #4e45e4" };
  }

  return { value: { name: name.trim(), color: color.toLowerCase() } };
}

module.exports = { parseId, isValidDate, validateTask, validateCategory };
