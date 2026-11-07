// A fake Anthropic Messages API on 127.0.0.1:3298 for browser tests (ANTHROPIC_DEV_BASE): always proposes two tasks.
import http from "node:http";
http.createServer((req, res) => {
  let body = "";
  req.on("data", c => { body += c; });
  req.on("end", () => {
    res.writeHead(req.url === "/v1/messages" ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify({ content: [{ type: "tool_use", name: "propose_tasks", input: {
      summary: "Klientka prosi o wycenę sklepu internetowego do piątku.", needsReply: true,
      tasks: [{ title: "Przygotować wycenę sklepu", description: "Zakres: katalog, płatności, dostawa.", dueDate: null, priority: "P1", coding: false },
        { title: "Postawić demo sklepu na stagingu", priority: "P2", coding: true }] } }] }));
  });
}).listen(3298, "127.0.0.1");
