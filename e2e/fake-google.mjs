// A fake Google (OAuth token + Calendar API) for local UI checks: e2e/ui-run.sh starts it with CALENDAR=1.
// Serves meetings around today; never used in production (GOOGLE_DEV_BASE is ignored there).
import http from "node:http";
const port = Number(process.env.FAKE_GOOGLE_PORT || 3299);
const day = (offset, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(h, m, 0, 0); return d.toISOString(); };
const date = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
let seq = 100;
const events = [
  { id: "m1", summary: "Spotkanie z leadem: Kwiaciarnia Róża", start: { dateTime: day(0, 10) }, end: { dateTime: day(0, 11) }, hangoutLink: "https://meet.google.com/abc-defg-hij",
    attendees: [{ email: "roza@kwiaciarnia.pl", displayName: "Anna Róża", responseStatus: "accepted" }, { email: "hello@mytko.dev", self: true, responseStatus: "accepted" }], description: "Rezerwacja ze strony mytko.dev" },
  { id: "m2", summary: "ORHEA: przegląd makiety", start: { dateTime: day(1, 14, 30) }, end: { dateTime: day(1, 15, 30) }, hangoutLink: "https://meet.google.com/xyz-abcd-efg" },
  { id: "m3", summary: "Planowanie tygodnia", start: { dateTime: day(-1, 8) }, end: { dateTime: day(-1, 8, 45) } },
  { id: "m4", summary: "Konferencja WordCamp", start: { date: date(3) }, end: { date: date(5) } },
  { id: "m5", summary: "Made by Mary: odbiór strony", start: { dateTime: day(2, 9) }, end: { dateTime: day(2, 10, 30) }, hangoutLink: "https://meet.google.com/mmm-mary-odb" }
].map(e => ({ status: "confirmed", htmlLink: "https://calendar.google.com/", ...e }));
http.createServer((req, res) => {
  let body = "";
  req.on("data", c => { body += c; });
  req.on("end", () => {
    const send = (status, data) => { res.writeHead(status, { "content-type": "application/json" }); res.end(data === undefined ? "" : JSON.stringify(data)); };
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/token") return send(200, { access_token: "fake-access", refresh_token: "fake-refresh", expires_in: 3600,
      id_token: ["e30", Buffer.from(JSON.stringify({ email: "hello@mytko.dev" })).toString("base64url"), "x"].join(".") });
    const match = url.pathname.match(/^\/cal\/calendars\/[^/]+\/events(?:\/([^/]+))?$/);
    if (!match) return send(404, {});
    if (req.method === "GET") return send(200, { items: events });
    if (req.method === "POST") {
      const event = { id: `n${++seq}`, status: "confirmed", htmlLink: "https://calendar.google.com/", ...JSON.parse(body) };
      if (event.conferenceData) { event.hangoutLink = `https://meet.google.com/new-${seq}`; delete event.conferenceData; }
      events.push(event);
      return send(200, event);
    }
    const index = events.findIndex(e => e.id === decodeURIComponent(match[1] || ""));
    if (index < 0) return send(404, {});
    if (req.method === "PATCH") { Object.assign(events[index], JSON.parse(body)); delete events[index].conferenceData; return send(200, events[index]); }
    if (req.method === "DELETE") { events.splice(index, 1); res.writeHead(204); return res.end(); }
    send(405, {});
  });
}).listen(port, "127.0.0.1");
