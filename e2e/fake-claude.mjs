// A fake AI API on 127.0.0.1:3298 for browser tests (AI_DEV_BASE): tasks from an e-mail, a meeting brief or task
// routing, answered as the Anthropic Messages API (/v1/messages) or as an OpenAI-compatible one (/v1/chat/completions,
// AI_PROVIDER=openai).
import http from "node:http";
http.createServer((req, res) => {
  let body = "";
  req.on("data", c => { body += c; });
  req.on("end", () => {
    const openai = req.url === "/v1/chat/completions";
    res.writeHead(req.url === "/v1/messages" || openai ? 200 : 404, { "content-type": "application/json" });
    const request = JSON.parse(body || "{}");
    // one answer, in the shape of the API that was asked
    const realEnd = res.end.bind(res);
    if (openai) {
      res.end = json => {
        const call = JSON.parse(json).content[0];
        realEnd(JSON.stringify({ choices: [{ message: { role: "assistant", tool_calls: [{ id: "call_1", type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.input) } }] } }] }));
      };
      request.tool_choice = { name: request.tool_choice?.function?.name };
      request.messages = request.messages.filter(m => m.role === "user");
    }
    // task routing (workflow-ai.js): coding work when the task talks about code
    if (request.tool_choice?.name === "route_task") {
      const text = String(request.messages?.[0]?.content || "");
      const coding = /stron|formularz|kod|wdroż/i.test(text);
      return res.end(JSON.stringify({ content: [{ type: "tool_use", name: "route_task",
        input: { coding, confidence: 0.9, reason: coding ? "Zmiana w kodzie strony." : "To nie jest praca programistyczna." } }] }));
    }
    if (request.tool_choice?.name === "meeting_brief") {
      return res.end(JSON.stringify({ content: [{ type: "tool_use", name: "meeting_brief", input: {
        summary: "Kwiaciarnia chce sklepu internetowego z dostawą na terenie Krakowa.", decisions: ["Start z 30 produktami", "Płatności BLIK i karty"],
        openQuestions: ["Budżet", "Kto robi zdjęcia produktów"],
        siteBrief: { business: { name: "Kwiaciarnia Róża", industry: "kwiaciarnia", city: "Kraków" }, goal: "Zamówienia bukietów online",
          offer: [{ name: "Bukiety", price: "od 80 zł" }, { name: "Dekoracje ślubne" }], tone: ["ciepło"], style: { likes: "pastele" } },
        tasks: [{ title: "Przygotować makietę sklepu", priority: "P1", coding: true }, { title: "Wysłać wycenę", priority: "P1", coding: false }],
        nextMeeting: { needed: true, title: "Prezentacja makiety sklepu", date: null, durationMinutes: 45, agenda: "Makieta i wycena" } } }] }));
    }
    res.end(JSON.stringify({ content: [{ type: "tool_use", name: "propose_tasks", input: {
      summary: "Klientka prosi o wycenę sklepu internetowego do piątku.", needsReply: true,
      tasks: [{ title: "Przygotować wycenę sklepu", description: "Zakres: katalog, płatności, dostawa.", dueDate: null, priority: "P1", coding: false },
        { title: "Postawić demo sklepu na stagingu", priority: "P2", coding: true }] } }] }));
  });
}).listen(3298, "127.0.0.1");
