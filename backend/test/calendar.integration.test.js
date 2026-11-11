// Google Calendars per space against a fake Google (OAuth + Calendar API) on loopback and a disposable PostgreSQL.
const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const path = require("node:path");

const { createPool } = require("../db");
const { runMigrations, listMigrations } = require("../migrations");
const { startApp, SAME_ORIGIN_JSON, USERNAME, PASSWORD } = require("./support");
const { encrypt, decrypt, parseKey } = require("../secrets");
const { syncAll } = require("../calendar-sync");
const { zonedDay, zonedInstant } = require("../booking");

const OWNER_URL = process.env.TEST_MIGRATION_DATABASE_URL;
const APP_URL = process.env.TEST_DATABASE_URL;
const MIGRATIONS_DIR = path.join(__dirname, "..", "drizzle");
const VERSIONS = listMigrations(MIGRATIONS_DIR).map(m => m.hash);
const KEY = crypto.randomBytes(32).toString("base64");
const skip = !OWNER_URL || !APP_URL ? "TEST_MIGRATION_DATABASE_URL / TEST_DATABASE_URL not set" : false;

test("secrets: AES-256-GCM round trip; tampering and wrong keys fail", () => {
  const key = parseKey(KEY);
  const sealed = encrypt(key, "refresh-token-xyz");
  assert.match(sealed, /^v1\./);
  assert.equal(decrypt(key, sealed), "refresh-token-xyz");
  assert.throws(() => decrypt(key, sealed.slice(0, -2) + (sealed.endsWith("A") ? "BB" : "AA")));
  assert.throws(() => decrypt(parseKey(crypto.randomBytes(32).toString("base64")), sealed));
  assert.throws(() => parseKey("short"), /32 bytes/);
});

function fakeGoogle() {
  const state = { events: [], verifiers: [], seq: 0, fail: 0 };
  const idToken = ["e30", Buffer.from(JSON.stringify({ email: "hello@mytko.dev" })).toString("base64url"), "sig"].join(".");
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      const send = (status, data) => { res.writeHead(status, { "content-type": "application/json" }); res.end(data === undefined ? "" : JSON.stringify(data)); };
      if (state.fail) { state.fail--; return send(401, { error: "invalid_grant" }); }
      if (url.pathname === "/token") {
        const form = new URLSearchParams(body);
        if (form.get("grant_type") === "authorization_code") {
          state.verifiers.push(form.get("code_verifier"));
          return form.get("code") === "good-code" ? send(200, { access_token: "at-1", refresh_token: "refresh-1", expires_in: 3600, id_token: idToken }) : send(400, { error: "invalid_grant" });
        }
        return form.get("refresh_token") === "refresh-1" ? send(200, { access_token: "at-2", expires_in: 3600 }) : send(400, { error: "invalid_grant" });
      }
      if (req.headers.authorization !== "Bearer at-2" && req.headers.authorization !== "Bearer at-1") return send(401, { error: { message: "unauthorized" } });
      if (url.pathname === "/cal/freeBusy") {
        const { timeMin, timeMax } = JSON.parse(body);
        state.freeBusyCalls = (state.freeBusyCalls || 0) + 1;
        const busy = state.events.filter(e => e.start?.dateTime && e.transparency !== "transparent" && e.status !== "cancelled"
          && e.end.dateTime > timeMin && e.start.dateTime < timeMax).map(e => ({ start: e.start.dateTime, end: e.end.dateTime }));
        return send(200, { calendars: { primary: { busy } } });
      }
      const match = url.pathname.match(/^\/cal\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
      if (!match) return send(404, {});
      const id = match[2] && decodeURIComponent(match[2]);
      if (req.method === "GET") return send(200, { items: state.events });
      if (req.method === "POST") {
        const event = { id: `ev${++state.seq}`, status: "confirmed", htmlLink: "https://calendar.google.com/e", ...JSON.parse(body) };
        if (event.conferenceData?.createRequest) event.hangoutLink = "https://meet.google.com/abc-defg-hij";
        delete event.conferenceData;
        state.events.push(event);
        return send(200, event);
      }
      const index = state.events.findIndex(e => e.id === id);
      if (index === -1) return send(404, {});
      if (req.method === "PATCH") { Object.assign(state.events[index], JSON.parse(body)); return send(200, state.events[index]); }
      if (req.method === "DELETE") { state.events.splice(index, 1); res.writeHead(204); return res.end(); }
      return send(405, {});
    });
  });
  return { server, state };
}

describe("Google Calendars per space", { skip, concurrency: false }, () => {
  let owner;
  let appPool;
  let google;
  let ctx;
  let cookie;
  let base;

  before(async () => {
    owner = createPool({ connectionString: OWNER_URL, max: 2, statementTimeoutMs: 0 });
    appPool = createPool({ connectionString: APP_URL, max: 5 });
    await owner.query(`DROP TABLE IF EXISTS public.avatars, public.space_invites, public.space_members, public.app_settings, public.goals, public.meeting_briefs, public.mail_messages, public.users, public.clients, public.calendar_events, public.calendar_accounts, public.auth_sessions, public.task_history,
      public.task_time_entries, public.task_subtasks, public.task_notes, public.task_labels, public.tasks, public.projects, public.spaces,
      public.assignees, public.categories CASCADE`);
    await owner.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await runMigrations(owner, { dir: MIGRATIONS_DIR, appRole: "tasks_app", log: () => {} });
    google = fakeGoogle();
    await new Promise(resolve => google.server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${google.server.address().port}`;
    ctx = await startApp({ pool: appPool, migrationVersions: VERSIONS,
      env: { GOOGLE_CLIENT_ID: "client-1", GOOGLE_CLIENT_SECRET: "secret-1", TASKS_SECRET_KEY: KEY,
        BOOKING_ORIGINS: "https://mytko.dev", BOOKING_DAYS: "1-7", BOOKING_HOURS: "08:00-20:00", BOOKING_NOTICE_HOURS: "0", BOOKING_IP_HOURLY_MAX: "20" },
      appOptions: { googleUrls: { authBase: base, tokenUrl: `${base}/token`, apiBase: `${base}/cal` } } });
    const login = await ctx.request("/api/auth/login", { method: "POST", auth: null, headers: SAME_ORIGIN_JSON, body: JSON.stringify({ login: USERNAME, password: PASSWORD }) });
    cookie = login.headers.get("set-cookie").split(";")[0];
  });

  after(async () => {
    await ctx.close();
    await new Promise(resolve => google.server.close(resolve));
    await appPool.end();
    await owner.query("DELETE FROM spaces").catch(() => {});
    await owner.end();
  });

  const call = async (url, method = "GET", body, extra = {}) => {
    const res = await ctx.request(url, { auth: null, method, redirect: "manual",
      headers: { ...(method === "GET" ? {} : SAME_ORIGIN_JSON), cookie, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    const json = (res.headers.get("content-type") || "").includes("json");
    return { status: res.status, headers: res.headers, body: text && json ? JSON.parse(text) : null };
  };

  test("connecting a space: consent URL with PKCE, callback stores an encrypted token and syncs", async () => {
    const spaces = (await call("/api/spaces")).body;
    const work = spaces.find(s => s.key === "work");
    assert.deepEqual((await call("/api/calendar/accounts")).body, { configured: true, accounts: [] });
    const start = await call("/api/calendar/connect", "POST", { spaceId: work.id });
    const consent = new URL(start.body.url);
    assert.equal(`${consent.origin}${consent.pathname}`, `${base}/o/oauth2/v2/auth`);
    assert.equal(consent.searchParams.get("redirect_uri"), "https://task.mytko.dev/auth/google/callback");
    assert.equal(consent.searchParams.get("access_type"), "offline");
    assert.equal(consent.searchParams.get("code_challenge_method"), "S256");
    const pending = start.headers.get("set-cookie").split(";")[0];
    google.state.events.push({ id: "g1", summary: "Spotkanie z leadem", status: "confirmed",
      start: { dateTime: new Date(Date.now() + 86400000).toISOString() }, end: { dateTime: new Date(Date.now() + 90000000).toISOString() },
      attendees: [{ email: "klient@firma.pl", displayName: "Klient", responseStatus: "accepted" }], hangoutLink: "https://meet.google.com/xyz" },
      { id: "g2", summary: "Urlop", status: "confirmed", start: { date: "2026-12-24" }, end: { date: "2026-12-27" } });

    // without this browser's session the callback refuses
    const anonymous = await ctx.request(`/auth/google/callback?code=good-code&state=${consent.searchParams.get("state")}`, { auth: null, redirect: "manual", headers: { cookie: pending } });
    assert.equal(anonymous.headers.get("location"), "/?calendar=login#manage-spaces");
    const back = await call(`/auth/google/callback?code=good-code&state=${consent.searchParams.get("state")}`, "GET", undefined, { cookie: `${cookie}; ${pending}` });
    assert.equal(back.headers.get("location"), "/?calendar=connected#manage-spaces");
    // the verifier sent to Google matches the challenge
    assert.equal(crypto.createHash("sha256").update(google.state.verifiers.at(-1)).digest("base64url"), consent.searchParams.get("code_challenge"));

    const stored = (await owner.query("SELECT refresh_token_enc, account_email FROM calendar_accounts")).rows[0];
    assert.equal(stored.account_email, "hello@mytko.dev");
    assert.doesNotMatch(stored.refresh_token_enc, /refresh-1/);
    assert.equal(decrypt(parseKey(KEY), stored.refresh_token_enc), "refresh-1");

    await new Promise(resolve => setTimeout(resolve, 300)); // the first sync runs right after connecting
    const accounts = (await call("/api/calendar/accounts")).body.accounts;
    assert.deepEqual([accounts[0].spaceId, accounts[0].accountEmail, accounts[0].lastError], [work.id, "hello@mytko.dev", null]);
    const today = new Date().toISOString().slice(0, 10);
    const events = (await call(`/api/calendar/events?from=${today}&to=2026-12-31`)).body;
    const meeting = events.find(e => e.title === "Spotkanie z leadem");
    assert.deepEqual([meeting.spaceId, meeting.meetUrl, meeting.attendees[0].email], [work.id, "https://meet.google.com/xyz", "klient@firma.pl"]);
    const holiday = events.find(e => e.title === "Urlop");
    assert.deepEqual([holiday.allDay, new Date(holiday.startAt).toISOString()], [true, "2026-12-24T00:00:00.000Z"]);
  });

  test("a replayed or forged callback is refused", async () => {
    const back = await call("/auth/google/callback?code=good-code&state=forged", "GET");
    assert.equal(back.headers.get("location"), "/?calendar=failed#manage-spaces");
  });

  test("events are created with a Meet link, edited and deleted in Google and mirrored locally", async () => {
    const work = (await call("/api/spaces")).body.find(s => s.key === "work");
    const priv = (await call("/api/spaces")).body.find(s => s.key === "private");
    const start = new Date(Date.now() + 3 * 86400000);
    const body = { spaceId: work.id, title: "Warsztat z klientem", start: start.toISOString(), end: new Date(start.getTime() + 3600000).toISOString(),
      attendees: ["klient@firma.pl"], meet: true, description: "Agenda" };
    assert.equal((await call("/api/calendar/events", "POST", { ...body, spaceId: priv.id })).status, 400); // no calendar there
    assert.equal((await call("/api/calendar/events", "POST", { ...body, end: body.start })).status, 400);
    assert.equal((await call("/api/calendar/events", "POST", { ...body, attendees: ["not an email"] })).status, 400);
    const created = await call("/api/calendar/events", "POST", body);
    assert.equal(created.status, 201);
    assert.deepEqual([created.body.title, created.body.meetUrl, created.body.spaceId], ["Warsztat z klientem", "https://meet.google.com/abc-defg-hij", work.id]);
    const sent = google.state.events.at(-1);
    assert.deepEqual(sent.attendees, [{ email: "klient@firma.pl" }]);

    const moved = await call(`/api/calendar/events/${created.body.id}`, "PATCH", { title: "Warsztat (przeniesiony)" });
    assert.equal(moved.body.title, "Warsztat (przeniesiony)");
    assert.equal(google.state.events.at(-1).summary, "Warsztat (przeniesiony)");
    assert.equal((await call(`/api/calendar/events/${created.body.id}`, "DELETE")).status, 200);
    assert.equal(google.state.events.some(e => e.id === sent.id), false);
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM calendar_events WHERE id = $1", [created.body.id])).rows[0].n, 0);
  });

  test("sync removes events deleted in Google and reports a revoked connection", async () => {
    google.state.events = google.state.events.filter(e => e.id !== "g2");
    await syncAll(appPool, { google: require("../google").createGoogle({ clientId: "client-1", clientSecret: "secret-1", redirectUri: "x",
      authBase: base, tokenUrl: `${base}/token`, apiBase: `${base}/cal` }), key: parseKey(KEY) });
    const titles = (await call("/api/calendar/events?from=2026-11-01&to=2026-12-31")).body.map(e => e.title);
    assert.equal(titles.includes("Urlop"), false);
    google.state.fail = 2;
    const account = (await call("/api/calendar/accounts")).body.accounts[0];
    const result = (await call(`/api/calendar/accounts/${account.id}/sync`, "POST", {})).body;
    assert.equal(result.ok, false);
    assert.match((await call("/api/calendar/accounts")).body.accounts[0].lastError, /połącz go ponownie|ponownie/);
  });

  test("clients: CRUD, company domain, task filter through projects, meetings matched by guest, tasks per meeting", async () => {
    google.state.fail = 0; // the previous test simulates a revoked connection
    const work = (await call("/api/spaces")).body.find(s => s.key === "work");
    assert.equal((await call("/api/clients", "POST", { name: "K", color: "#22c55e" })).status, 400);
    assert.equal((await call("/api/clients", "POST", { name: "Kwiaciarnia", color: "#22c55e", email: "not-mail" })).status, 400);
    const lead = (await call("/api/clients", "POST", { name: "Kwiaciarnia Róża", color: "#22c55e", email: "Anna@Kwiaciarnia.pl" })).body;
    assert.deepEqual([lead.status, lead.email, lead.domain, lead.openTasks], ["lead", "anna@kwiaciarnia.pl", "kwiaciarnia.pl", 0]);
    const gmail = (await call("/api/clients", "POST", { name: "Jan z Gmaila", color: "#22c55e", email: "jan@gmail.com" })).body;
    assert.equal(gmail.domain, null); // a public mailbox never identifies a company
    // "_" in an address is an ordinary character, not a wildcard
    const underscore = (await call("/api/clients", "POST", { name: "Jan K", email: "jan_k@gmail.com" })).body;
    google.state.events.push({ id: "g-us", summary: "Inny Jan", status: "confirmed", start: { dateTime: new Date(Date.now() + 5 * 86400000).toISOString() },
      end: { dateTime: new Date(Date.now() + 5 * 86400000 + 3600000).toISOString() }, attendees: [{ email: "janXk@gmail.com" }] });
    const uncoloured = (await call("/api/clients", "POST", { name: "Lead bez koloru", email: "x@lead.pl" })).body;
    assert.match(uncoloured.color, /^#[0-9a-f]{6}$/); // booking and mail leads get a palette colour
    assert.equal((await call(`/api/clients/${uncoloured.id}`, "PATCH", { color: "red" })).status, 400);
    assert.equal((await call(`/api/clients/${uncoloured.id}`, "DELETE")).status, 200);

    const project = (await call("/api/projects", "POST", { name: "Strona Róży", color: "#22c55e", spaceId: work.id, clientId: lead.id })).body;
    assert.equal(project.clientId, lead.id);
    const viaProject = (await call("/api/tasks", "POST", { title: "Makieta", date: "2026-11-07", projectId: project.id })).body;
    const direct = (await call("/api/tasks", "POST", { title: "Wycena", date: "2026-11-07", clientId: lead.id })).body;
    await call("/api/tasks", "POST", { title: "Inne", date: "2026-11-07" });
    assert.deepEqual((await call(`/api/tasks?clientId=${lead.id}`)).body.map(t => t.id).sort(), [viaProject.id, direct.id].sort());
    assert.equal((await call(`/api/clients/${lead.id}`)).body.openTasks, 2);
    assert.equal((await call("/api/tasks", "POST", { title: "Zła", date: "2026-11-07", clientId: 999999 })).body.message, "Client does not exist");

    // a guest from the client's domain links the meeting at the next sync
    google.state.events.push({ id: "g9", summary: "Druga rozmowa", status: "confirmed", start: { dateTime: new Date(Date.now() + 2 * 86400000).toISOString() },
      end: { dateTime: new Date(Date.now() + 2 * 86400000 + 3600000).toISOString() }, attendees: [{ email: "szef@kwiaciarnia.pl" }] });
    const account = (await call("/api/calendar/accounts")).body.accounts[0];
    await call(`/api/calendar/accounts/${account.id}/sync`, "POST", {});
    const today = new Date().toISOString().slice(0, 10);
    const meeting = (await call(`/api/calendar/events?from=${today}&to=${new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10)}`)).body.find(e => e.title === "Druga rozmowa");
    assert.equal(meeting.clientId, lead.id);
    assert.ok((await call(`/api/clients/${lead.id}`)).body.nextMeetingAt);
    const other = (await call(`/api/calendar/events?from=${today}&to=${new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10)}`)).body.find(e => e.title === "Inny Jan");
    assert.equal(other.clientId, null); // janXk@ is not jan_k@
    const range = `from=${today}&to=${new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10)}`;
    assert.deepEqual((await call(`/api/calendar/events?${range}&clientId=${lead.id}`)).body.map(e => e.id), [meeting.id]); // the client card
    assert.equal((await call(`/api/calendar/events?${range}&clientId=x`)).status, 400);
    // preparation task attached to the meeting
    const prep = (await call("/api/tasks", "POST", { title: "Przygotować się", date: "2026-11-07", meetingId: meeting.id, clientId: lead.id })).body;
    assert.deepEqual((await call(`/api/tasks?meetingId=${meeting.id}`)).body.map(t => t.id), [prep.id]);
    assert.equal((await call(`/api/calendar/events?from=${today}&to=${new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10)}`)).body.find(e => e.id === meeting.id).taskCount, 1);
    // manual link / unlink
    assert.equal((await call(`/api/calendar/events/${meeting.id}/client`, "PUT", { clientId: gmail.id })).body.clientId, gmail.id);
    assert.equal((await call(`/api/calendar/events/${meeting.id}/client`, "PUT", { clientId: null })).body.clientId, null);

    const promoted = (await call(`/api/clients/${lead.id}`, "PATCH", { status: "client", phone: "+48 600 000 000" })).body;
    assert.deepEqual([promoted.status, promoted.phone], ["client", "+48 600 000 000"]);
    assert.equal((await call(`/api/clients/${lead.id}`, "DELETE")).status, 200);
    assert.equal((await call("/api/tasks")).body.find(t => t.id === direct.id).clientId, null);
    assert.equal((await call("/api/projects")).body.find(p => p.id === project.id).clientId, null);
  });

  test("booking: CORS for mytko.dev, free slots around busy times, a booking makes a Meet event, a lead and a prep task", async () => {
    const TZ = "Europe/Warsaw";
    const day = zonedDay(Date.now() + 6 * 86400000, TZ);
    const at = time => new Date(zonedInstant(day, time, TZ)).toISOString();
    const pub = async (url, method = "GET", body, origin = "https://mytko.dev") => {
      const res = await ctx.request(url, { auth: null, method, headers: { ...(origin ? { origin } : {}), ...(body ? { "content-type": "application/json" } : {}) },
        body: body && JSON.stringify(body) });
      const text = await res.text();
      return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
    };
    assert.equal((await pub("/api/public/booking", "GET", undefined, "https://evil.example")).status, 403);
    const preflight = await pub("/api/public/booking", "OPTIONS");
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://mytko.dev");
    assert.match(preflight.headers.get("access-control-allow-headers"), /content-type/);

    // Praca is busy 10:00–11:00 in Google; the private calendar has a timed 14:00–15:00 and an all-day event
    google.state.events.push({ id: "busy1", summary: "Zajęte", status: "confirmed", start: { dateTime: at("10:00") }, end: { dateTime: at("11:00") } });
    const privateSpace = (await call("/api/spaces")).body.find(s => s.key === "private");
    const privateAccount = (await owner.query("INSERT INTO calendar_accounts (space_id, account_email, refresh_token_enc) VALUES ($1, 'me@gmail.com', 'x') RETURNING id", [privateSpace.id])).rows[0].id;
    await owner.query(`INSERT INTO calendar_events (account_id, external_id, title, start_at, end_at, all_day) VALUES
      ($1, 'p1', 'Dentysta', $2, $3, false), ($1, 'p2', 'Urodziny', $4, $5, true)`, [privateAccount, at("14:00"), at("15:00"), `${day}T00:00:00Z`, `${day}T23:59:00Z`]);
    try {
      const slots = await pub(`/api/public/booking?from=${day}&days=1`);
      assert.equal(slots.status, 200);
      assert.equal(slots.headers.get("access-control-allow-origin"), "https://mytko.dev");
      assert.deepEqual([slots.body.timeZone, slots.body.slotMinutes, slots.body.days[0].date], [TZ, 30, day]);
      const free = slots.body.days[0].slots;
      for (const time of ["09:00", "11:30", "13:00", "15:30"]) assert.ok(free.includes(at(time)), `${time} should be free`);
      for (const time of ["09:30", "10:00", "11:00", "13:30", "14:00", "15:00"]) assert.ok(!free.includes(at(time)), `${time} should be busy`);

      const form = { start: at("09:00"), name: "Anna Nowak", email: "anna_n@piekarnia.pl", company: "Piekarnia Nowak", phone: "+48 600 100 200",
        message: "Potrzebujemy nowej strony.", consent: true };
      assert.equal((await pub("/api/public/booking", "POST", { ...form, consent: false })).status, 400);
      const eventsBefore = google.state.events.length;
      assert.equal((await pub("/api/public/booking", "POST", { ...form, website: "http://spam.example" })).status, 201);
      assert.equal(google.state.events.length, eventsBefore); // the honeypot books nothing
      assert.equal((await pub("/api/public/booking", "POST", { ...form, start: at("09:10") })).status, 409); // not a slot

      // two visitors at once for one slot: exactly one gets it
      const race = await Promise.all([
        pub("/api/public/booking", "POST", { ...form, start: at("12:00"), email: "pierwszy@firma.pl" }),
        pub("/api/public/booking", "POST", { ...form, start: at("12:00"), email: "drugi@firma.pl" })]);
      assert.deepEqual(race.map(r => r.status).sort(), [201, 409]);
      const booked = await pub("/api/public/booking", "POST", form);
      assert.equal(booked.status, 201);
      assert.deepEqual([booked.body.start, booked.body.end], [at("09:00"), at("09:30")]);
      assert.match(booked.body.meetUrl, /^https:\/\/meet\.google\.com\//);
      const sent = google.state.events.at(-1);
      assert.deepEqual(sent.attendees, [{ email: "anna_n@piekarnia.pl", displayName: "Anna Nowak" }]);
      assert.match(sent.description, /Potrzebujemy nowej strony\.[\s\S]*Rezerwacja przez formularz na mytko\.dev/);

      const lead = (await call("/api/clients")).body.find(c => c.email === "anna_n@piekarnia.pl");
      assert.deepEqual([lead.name, lead.status, lead.source, lead.domain, lead.openTasks], ["Piekarnia Nowak", "lead", "booking", "piekarnia.pl", 1]);
      const meeting = (await call(`/api/calendar/events?from=${day}&to=${day}&clientId=${lead.id}`)).body[0];
      assert.equal(meeting.title, "Rozmowa: Anna Nowak (Piekarnia Nowak)");
      const prep = (await call(`/api/tasks?meetingId=${meeting.id}`)).body[0];
      assert.deepEqual([prep.title, prep.clientId, prep.dueDate, prep.priority, prep.status], ["Przygotować się do rozmowy: Anna Nowak", lead.id, day, "P1", "todo"]);
      assert.equal((await owner.query("SELECT actor FROM task_history WHERE task_id = $1 LIMIT 1", [prep.id])).rows[0].actor, "booking");

      // the slot is taken now; the same person may hold two upcoming meetings, not three; the lead is reused
      assert.equal((await pub("/api/public/booking", "POST", { ...form, email: "inna@firma.pl" })).status, 409);
      assert.equal((await pub("/api/public/booking", "POST", { ...form, start: at("16:00") })).status, 201);
      assert.equal((await pub("/api/public/booking", "POST", { ...form, start: at("17:00") })).status, 409);
      assert.equal((await call("/api/clients")).body.filter(c => c.email === "anna_n@piekarnia.pl").length, 1);
      // without an Origin (not a browser) the API answers too, without CORS headers
      const plain = await pub(`/api/public/booking?from=${day}&days=1`, "GET", undefined, null);
      assert.equal(plain.status, 200);
      assert.equal(plain.headers.get("access-control-allow-origin"), null);
    } finally {
      await owner.query("DELETE FROM calendar_accounts WHERE id = $1", [privateAccount]);
    }
  });

  test("a space with a connected calendar is not deleted; calendars belong to the owner's spaces", async () => {
    const custom = (await call("/api/spaces", "POST", { name: "Projekty B2B", color: "#38bdf8" })).body;
    await owner.query("INSERT INTO calendar_accounts (space_id, account_email, refresh_token_enc) VALUES ($1, 'b2b@mytko.dev', 'x')", [custom.id]);
    const refused = await call(`/api/spaces/${custom.id}`, "DELETE");
    assert.deepEqual([refused.status, refused.body.message], [409, "Disconnect the space's Google Calendar first"]);
    await owner.query("DELETE FROM calendar_accounts WHERE space_id = $1", [custom.id]);
    assert.equal((await call(`/api/spaces/${custom.id}`, "DELETE")).status, 200);
  });

  test("ranges are bounded and disconnecting removes the copies", async () => {
    assert.equal((await call("/api/calendar/events?from=2026-01-01&to=2026-12-31")).status, 400);
    assert.equal((await call("/api/calendar/events?from=bad&to=2026-12-31")).status, 400);
    const account = (await call("/api/calendar/accounts")).body.accounts[0];
    assert.equal((await call(`/api/calendar/accounts/${account.id}`, "DELETE")).status, 200);
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM calendar_events")).rows[0].n, 0);
  });
});
