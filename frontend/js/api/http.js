// Shared fetch wrapper. The UI is served by the backend, so API paths are
// same-origin by default; set window.MYTKO_API_BASE to point elsewhere.
export const API_BASE = globalThis.MYTKO_API_BASE ?? "";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function request(path, options = {}) {
  const init = { ...options };

  if (init.body !== undefined) {
    init.headers = { "Content-Type": "application/json", ...init.headers };
    init.body = JSON.stringify(init.body);
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError("Brak połączenia z serwerem", 0);
  }

  let data = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const message = data && typeof data.message === "string"
      ? data.message
      : `Błąd serwera (${response.status})`;
    throw new ApiError(message, response.status);
  }

  return data;
}
