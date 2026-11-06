export const API_BASE = globalThis.MYTKO_API_BASE ?? "";
// Server messages (English, stable) shown to the owner in Polish.
const MESSAGES = {
  "Space still has projects": "Ta przestrzeń ma jeszcze projekty. Usuń je albo przenieś do innej przestrzeni.",
  "Built-in spaces cannot be deleted": "Wbudowanych przestrzeni (Praca, Prywatne) nie można usunąć.",
  "The private space is never visible to agents": "Przestrzeń prywatna nigdy nie jest widoczna dla agentów.",
  "Project belongs to another space": "Ten projekt należy do innej przestrzeni.",
  "Project does not exist": "Ten projekt już nie istnieje albo jest w archiwum.",
  "Space does not exist": "Ta przestrzeń już nie istnieje.",
  "Assignee does not exist": "Ten wykonawca już nie istnieje.",
  "Category does not exist": "Ta etykieta już nie istnieje.",
  "Name too short": "Nazwa musi mieć co najmniej 2 znaki.",
  "Name too long": "Nazwa jest za długa.",
  "Category name too short": "Nazwa musi mieć co najmniej 2 znaki.",
  "Category name too long": "Nazwa jest za długa.",
  "Color must be a hex value like #4e45e4": "Wybierz kolor.",
  "Invalid title": "Tytuł musi mieć od 3 do 100 znaków.",
  "Too many subtasks": "Zadanie może mieć najwyżej 100 podzadań.",
  "Only open tasks can be timed": "Licznik działa tylko dla otwartych zadań.",
  "Board changed; refresh and retry": "Tablica zmieniła się w międzyczasie. Spróbuj ponownie.",
  "Task not found": "To zadanie już nie istnieje.",
  "Invalid labels": "Zadanie może mieć najwyżej 10 różnych etykiet."
};

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
    // Any API call answered "not signed in" (session ended, expired or logged out elsewhere) returns to the login screen.
    if (response.status === 401 && !path.startsWith("/api/auth/")) globalThis.dispatchEvent?.(new Event("mytko:session-ended"));
    if (!response.ok) throw new ApiError(data && typeof data.message === "string" ? MESSAGES[data.message] || data.message : "Błąd serwera (" + response.status + ")", response.status);
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(deadline.aborted ? 'Przekroczono czas oczekiwania. Odśwież dane przed ponownym zapisem — operacja mogła zostać wykonana.' : 'Brak połączenia z serwerem. Odśwież dane przed ponownym zapisem.', 0);
  }
}
