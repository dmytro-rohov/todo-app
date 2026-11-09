// Meeting briefs without a database: recognising Gemini's notes e-mails and cleaning Claude's brief.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { isGeminiNotes } = require("../briefs");
const { proposeBrief } = require("../ai/proposals");

test("Gemini's notes e-mails are recognised; look-alikes are not", () => {
  const gemini = { fromAddress: "gemini-notes@google.com", fromName: "Gemini", subject: "Notes: “Omówienie sklepu” Nov 7, 2026" };
  assert.equal(isGeminiNotes(gemini), true);
  assert.equal(isGeminiNotes({ ...gemini, subject: "Notatki: „Omówienie sklepu” 7 lis 2026" }), true);
  assert.equal(isGeminiNotes({ ...gemini, fromAddress: "gemini-notes@g00gle.com" }), false);
  assert.equal(isGeminiNotes({ ...gemini, fromAddress: "calendar-notification@google.com", fromName: "Google Calendar" }), false);
  assert.equal(isGeminiNotes({ ...gemini, subject: "Invitation: Omówienie sklepu" }), false);
});

test("Claude's brief is cleaned: Factory-style site brief, tasks, next meeting", async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "tool_use", name: "meeting_brief", input: {
      summary: "Kwiaciarnia chce sklepu z dostawą w Krakowie.", decisions: ["Sklep na start z 30 produktami", ""], openQuestions: ["Budżet?"],
      siteBrief: { business: { name: "Kwiaciarnia Róża", city: "Kraków", fax: "x" }, goal: "Zamówienia online", offer: [{ name: "Bukiety", price: "od 80 zł" }, { price: "?" }],
        tone: ["ciepło"], style: { likes: "pastele" }, about: "" },
      tasks: [{ title: "Przygotować makietę sklepu", priority: "P1", coding: true }],
      nextMeeting: { needed: true, title: "Prezentacja makiety", date: "2026-11-14", durationMinutes: 45, agenda: "Makieta i wycena" } } }] }) };
  };
  const brief = await proposeBrief({ apiKey: "k", model: "m", apiBase: "https://x" },
    { notes: "Notatki…", meeting: { title: "Omówienie sklepu", startAt: "2026-11-07T09:00:00Z" }, clientName: "Kwiaciarnia Róża", today: "2026-11-07", fetchImpl });
  assert.equal(request.tool_choice.name, "meeting_brief");
  assert.match(request.messages[0].content, /Spotkanie: „Omówienie sklepu”/);
  assert.deepEqual(brief.decisions, ["Sklep na start z 30 produktami"]);
  assert.deepEqual(brief.siteBrief, { business: { name: "Kwiaciarnia Róża", city: "Kraków" }, goal: "Zamówienia online",
    offer: [{ name: "Bukiety", price: "od 80 zł" }], tone: ["ciepło"], style: { likes: "pastele" } });
  assert.deepEqual(brief.tasks.map(t => [t.title, t.coding]), [["Przygotować makietę sklepu", true]]);
  assert.deepEqual(brief.nextMeeting, { needed: true, title: "Prezentacja makiety", date: "2026-11-14", durationMinutes: 45, agenda: "Makieta i wycena" });
  assert.equal(brief.briefVersion, 1);
});
