// Claude (Anthropic Messages API) for proposals: tasks from an e-mail (Poczta) and a meeting brief (C5). Proposals
// are only suggestions; the owner accepts each one. The answer is forced into a tool call, so it is always JSON
// of the given schema; it is validated again here.
const API_VERSION = "2023-06-01";
const TIMEOUT_MS = 90000;

class AiError extends Error {}

async function callTool(ai, { system, content, tool, maxTokens = 2000, fetchImpl = fetch }) {
  let response;
  try {
    response = await fetchImpl(`${ai.apiBase}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": ai.apiKey, "anthropic-version": API_VERSION, "content-type": "application/json" },
      body: JSON.stringify({ model: ai.model, max_tokens: maxTokens, system, tools: [tool], tool_choice: { type: "tool", name: tool.name },
        messages: [{ role: "user", content }] }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch {
    throw new AiError("Claude nie odpowiada. Spróbuj za chwilę.");
  }
  if (response.status === 401 || response.status === 403) throw new AiError("Klucz API Claude jest nieprawidłowy.");
  if (response.status === 429) throw new AiError("Limit zapytań do Claude: spróbuj za chwilę.");
  if (response.status === 400) {
    const body = await response.json().catch(() => ({}));
    if (/credit|billing/i.test(body?.error?.message || "")) throw new AiError("Brak środków na koncie Anthropic API.");
    throw new AiError("Claude odrzucił zapytanie.");
  }
  if (!response.ok) throw new AiError("Claude nie odpowiada. Spróbuj za chwilę.");
  const data = await response.json();
  const call = (data.content || []).find(block => block.type === "tool_use" && block.name === tool.name);
  if (!call) throw new AiError("Claude nie zwrócił propozycji.");
  return call.input;
}

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Proposed tasks, shared by mail and briefs: [{ title, description, dueDate|null, priority, coding }]
function cleanTasks(list) {
  return (Array.isArray(list) ? list : []).slice(0, 8).map(task => ({
    title: text(task?.title, 100),
    description: text(task?.description, 2000),
    dueDate: DATE.test(task?.dueDate || "") ? task.dueDate : null,
    priority: ["P0", "P1", "P2", "P3"].includes(task?.priority) ? task.priority : "P2",
    coding: task?.coding === true
  })).filter(task => task.title.length >= 3);
}

const TASKS_SCHEMA = {
  type: "array", maxItems: 8,
  items: { type: "object", required: ["title", "priority", "coding"], properties: {
    title: { type: "string", description: "Krótki tytuł zadania po polsku, w trybie rozkazującym, do 100 znaków" },
    description: { type: "string", description: "Co dokładnie zrobić, z potrzebnymi szczegółami z wiadomości" },
    dueDate: { type: ["string", "null"], description: "Termin YYYY-MM-DD, tylko jeśli wynika z treści" },
    priority: { type: "string", enum: ["P0", "P1", "P2", "P3"], description: "P0 pilne, P1 ważne, P2 zwykłe, P3 kiedyś" },
    coding: { type: "boolean", description: "true, jeśli to praca programistyczna (kod strony/aplikacji) do zlecenia w Mytko Workflow" }
  } }
};

async function proposeFromMail(ai, mail, { today, clientName = null, fetchImpl } = {}) {
  const input = await callTool(ai, {
    fetchImpl,
    system: "Jesteś asystentem studia webowego Mytko (strony i aplikacje dla klientów). Z e-maila wyciągasz konkretne zadania do " +
      "zrobienia dla właściciela studia. Nie wymyślaj zadań, których nie ma w treści. Newslettery, reklamy i powiadomienia " +
      "automatyczne nie wymagają zadań. Piszesz po polsku.",
    content: `Dzisiaj jest ${today}.${clientName ? ` Nadawca to klient: ${clientName}.` : ""}\n\nOd: ${mail.fromName} <${mail.fromAddress}>\n` +
      `Temat: ${mail.subject}\nData: ${mail.sentAt}\n\n${String(mail.bodyText).slice(0, 20000)}`,
    tool: { name: "propose_tasks", description: "Zwraca streszczenie e-maila i proponowane zadania",
      input_schema: { type: "object", required: ["summary", "tasks", "needsReply"], properties: {
        summary: { type: "string", description: "Streszczenie w 1–2 zdaniach" },
        needsReply: { type: "boolean", description: "Czy nadawca czeka na odpowiedź" },
        tasks: TASKS_SCHEMA
      } } }
  });
  return { summary: text(input.summary, 600), needsReply: input.needsReply === true, tasks: cleanTasks(input.tasks), at: new Date().toISOString() };
}

module.exports = { callTool, proposeFromMail, cleanTasks, TASKS_SCHEMA, AiError };
