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
    await owner.query(`DROP TABLE IF EXISTS public.calendar_events, public.calendar_accounts, public.auth_sessions, public.task_history,
      public.task_time_entries, public.task_subtasks, public.task_notes, public.task_labels, public.tasks, public.projects, public.spaces,
      public.assignees, public.categories CASCADE`);
    await owner.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await runMigrations(owner, { dir: MIGRATIONS_DIR, appRole: "tasks_app", log: () => {} });
    google = fakeGoogle();
    await new Promise(resolve => google.server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${google.server.address().port}`;
    ctx = await startApp({ pool: appPool, migrationVersions: VERSIONS,
      env: { GOOGLE_CLIENT_ID: "client-1", GOOGLE_CLIENT_SECRET: "secret-1", TASKS_SECRET_KEY: KEY },
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

  test("ranges are bounded and disconnecting removes the copies", async () => {
    assert.equal((await call("/api/calendar/events?from=2026-01-01&to=2026-12-31")).status, 400);
    assert.equal((await call("/api/calendar/events?from=bad&to=2026-12-31")).status, 400);
    const account = (await call("/api/calendar/accounts")).body.accounts[0];
    assert.equal((await call(`/api/calendar/accounts/${account.id}`, "DELETE")).status, 200);
    assert.equal((await owner.query("SELECT count(*)::int AS n FROM calendar_events")).rows[0].n, 0);
  });
});
