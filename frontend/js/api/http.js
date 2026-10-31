export const API_BASE = globalThis.MYTKO_API_BASE ?? "";
export class ApiError extends Error {
  constructor(message, status) { super(message); this.name = "ApiError"; this.status = status; }
}
export async function request(path, options = {}) {
  const init = { ...options };
  if (init.body !== undefined) { init.headers = { "Content-Type": "application/json", ...init.headers }; init.body = JSON.stringify(init.body); }
  let response;
  try { response = await fetch(API_BASE + path, init); } catch { throw new ApiError("Brak połączenia z serwerem", 0); }
  const text = await response.text(); let data = null;
  if (text) { try { data = JSON.parse(text); } catch {} }
  if (!response.ok) throw new ApiError(data && typeof data.message === "string" ? data.message : "Błąd serwera (" + response.status + ")", response.status);
  return data;
}
