export const API_BASE = globalThis.MYTKO_API_BASE ?? "";
export class ApiError extends Error {
  constructor(message, status) { super(message); this.name = "ApiError"; this.status = status; }
}
export async function request(path, options = {}) {
  const { timeoutMs = 15000, ...init } = options;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) throw new TypeError('Invalid HTTP timeout');
  const deadline = AbortSignal.timeout(timeoutMs);
  init.signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  if (init.body !== undefined) { init.headers = { "Content-Type": "application/json", ...init.headers }; init.body = JSON.stringify(init.body); }
  try {
    const response = await fetch(API_BASE + path, init);
    const text = await response.text(); let data = null;
    if (text) { try { data = JSON.parse(text); } catch {} }
    if (!response.ok) throw new ApiError(data && typeof data.message === "string" ? data.message : "Błąd serwera (" + response.status + ")", response.status);
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(deadline.aborted ? 'Przekroczono czas oczekiwania. Odśwież dane przed ponownym zapisem — operacja mogła zostać wykonana.' : 'Brak połączenia z serwerem. Odśwież dane przed ponownym zapisem.', 0);
  }
}
