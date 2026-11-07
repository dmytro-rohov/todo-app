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

// Shared shape of spaces and projects: a name and a #rrggbb colour, both optional on update.
function validateNamed(data, { partial, maxName, extra = {} }) {
  if (!isBody(data)) return { error: "Invalid request body" };
  const allowed = ["name", "color", "position", ...Object.keys(extra)];
  const keys = Object.keys(data);
  if (keys.some(key => !allowed.includes(key)) || (partial && !keys.length)) return { error: "Unknown or empty fields" };
  const value = {};
  if (!partial || "name" in data) {
    if (typeof data.name !== "string" || data.name.trim().length < 2) return { error: "Name too short" };
    if (data.name.length > maxName) return { error: "Name too long" };
    value.name = data.name.trim();
  }
  if (!partial || "color" in data) {
    if (typeof data.color !== "string" || !COLOR_PATTERN.test(data.color)) return { error: "Color must be a hex value like #4e45e4" };
    value.color = data.color.toLowerCase();
  }
  if ("position" in data) {
    if (!Number.isSafeInteger(data.position) || data.position < 0 || data.position > MAX_INT) return { error: "Invalid position" };
    value.position = data.position;
  }
  for (const [key, check] of Object.entries(extra)) {
    if (!(key in data)) continue;
    const result = check(data[key]);
    if (result === undefined) return { error: `Invalid ${key}` };
    value[key] = result;
  }
  return { value };
}

const asBoolean = value => (typeof value === "boolean" ? value : undefined);
const asId = value => (parseId(value) === null ? undefined : Number(value));

function validateSpace(data, { partial = false } = {}) {
  return validateNamed(data, { partial, maxName: 50, extra: { agentVisible: asBoolean } });
}

function validateProject(data, { partial = false } = {}) {
  const result = validateNamed(data, { partial, maxName: 80, extra: { spaceId: asId, archived: asBoolean, clientId: value => (value === null ? null : asId(value)) } });
  if (!result.error && !partial && result.value.spaceId === undefined) return { error: "Space is required" };
  return result;
}

function validateAssignee(data, { partial = false } = {}) {
  if (isBody(data) && "position" in data) return { error: "Unknown or empty fields" };
  return validateNamed(data, { partial, maxName: 80 });
}

function validateText(value, { min = 1, max }) {
  return typeof value === "string" && value.trim().length >= min && value.length <= max;
}

module.exports = {
  parseId, isValidDate, validateTask, validateCategory, validateSpace, validateProject, validateAssignee, validateText
};
