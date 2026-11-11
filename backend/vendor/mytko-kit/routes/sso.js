// "Zaloguj kontem Mytko": sign in with the operator's Mytko Workflow session, the same in every Mytko app
// (authorization code + PKCE S256; the provider side is mytko-workflow src/mytko/api/sso_provider.py). The one Workflow
// login allowed (MYTKO_SSO_LOGIN) signs in as this app's administrator.
//
//   GET /auth/mytko/start     -> 303 to Workflow /api/v1/auth/sso/authorize, remembering state + PKCE verifier in a
//                                short-lived HttpOnly cookie
//   GET /auth/mytko/callback  <- Workflow sends the browser back with ?code&state (or ?error&state); the code is
//                                exchanged server to server for the operator login, then a "mytko" session of the
//                                administrator's account starts
//
// Every outcome ends on "/" (the login screen explains failures through ?sso=<reason>).
const crypto = require("node:crypto");
// Express is the app's own dependency, loaded when a router is made (the kit itself loads with Node alone: an app's
// configuration check runs without node_modules).
const loadExpress = () => require("express");
const { readCookie } = require("../sessions");
const { createWindowCounter } = require("../security");

const PENDING_MS = 10 * 60000;
const HEALTH_TIMEOUT_MS = 2500;
const HEALTH_TTL_MS = 30000;
const TOKEN_TIMEOUT_MS = 5000;
const URLSAFE = /^[A-Za-z0-9_-]{16,256}$/;
// Workflow pauses a client after 10 failed code exchanges in 15 minutes, counted per calling server (the Mytko apps on one
// server share one). Anyone can start a sign-in and post a made-up code, so failed exchanges are limited here first: per
// visitor (the login guard) and in total, staying well below Workflow's limit.
const FAILED_EXCHANGES_MAX = 5;
const FAILED_EXCHANGES_WINDOW_MS = 15 * 60000;

function base64url(buffer) {
  return buffer.toString("base64url");
}

function equal(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// Workflow runs on the home server; when it is off, the browser must not be sent to an error page there. Its public
// /api/v1/health is checked (cached for 30 s) before every redirect and for the login screen's button.
function createWorkflowHealth(sso, fetchImpl = fetch) {
  let cached = { ok: false, at: 0 };
  let pending = null;
  return async function workflowUp() {
    if (Date.now() - cached.at < HEALTH_TTL_MS) return cached.ok;
    pending ??= fetchImpl(`${sso.origin}/api/v1/health`, { redirect: "error", signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })
      .then(response => response.ok, () => false)
      .then(ok => { cached = { ok, at: Date.now() }; pending = null; return ok; });
    return pending;
  };
}

// appId: the app's id ("finance"); the sign-in in progress is kept in the cookie "mytko-<appId>-sso".
function createSsoRouter({ appId, sso, publicOrigin, cookie, startSession, users, guard, fetchImpl = fetch, workflowUp = createWorkflowHealth(sso, fetchImpl) }) {
  if (typeof appId !== "string" || !/^[a-z][a-z0-9-]{1,31}$/.test(appId)) throw new Error("createSsoRouter needs the app id");
  const router = loadExpress().Router();
  const failedExchanges = createWindowCounter({ windowMs: FAILED_EXCHANGES_WINDOW_MS });
  // Exchanges sent to Workflow and not answered yet: they count against the limit until their outcome is known, so
  // parallel callbacks cannot all pass the check before the first failure is recorded.
  let inFlight = 0;
  const failed = req => { guard.fail(req); failedExchanges.hit("all"); };
  const pendingCookie = cookie.secure ? `__Host-mytko-${appId}-sso` : `mytko-${appId}-sso`;
  const pendingOptions = { httpOnly: true, secure: cookie.secure, sameSite: "lax", path: "/" };
  const redirectUri = `${publicOrigin}/auth/mytko/callback`;
  const done = (res, reason) => res.redirect(303, reason ? `/?sso=${reason}` : "/");

  router.get("/start", async (req, res) => {
    if (!(await workflowUp())) return done(res, "unavailable");
    const state = base64url(crypto.randomBytes(24));
    const verifier = base64url(crypto.randomBytes(48));
    const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
    res.cookie(pendingCookie, `${state}.${verifier}`, { ...pendingOptions, maxAge: PENDING_MS });
    const query = new URLSearchParams({
      client_id: sso.clientId, redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: "S256"
    });
    res.set("Referrer-Policy", "no-referrer").redirect(303, `${sso.origin}/api/v1/auth/sso/authorize?${query}`);
  });

  router.get("/callback", async (req, res) => {
    const pending = readCookie(req, pendingCookie);
    res.clearCookie(pendingCookie, pendingOptions); // one attempt per start
    const [state, verifier] = (pending || "").split(".");
    const { code, error } = req.query;
    if (!pending || !URLSAFE.test(state || "") || !URLSAFE.test(verifier || "") || !equal(state, req.query.state)) {
      return done(res, "failed");
    }
    if (error !== undefined) return done(res, error === "login_required" ? "login_required" : "failed");
    if (typeof code !== "string" || !URLSAFE.test(code) || code.length > 128) return done(res, "failed");
    // Checked and reserved in one synchronous step (no await in between).
    if (guard.lockedFor(req) || failedExchanges.peek("all").count + inFlight >= FAILED_EXCHANGES_MAX) return done(res, "unavailable");
    inFlight += 1;

    let response;
    let data;
    try {
      try {
        response = await fetchImpl(`${sso.origin}/api/v1/auth/sso/token`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            client_id: sso.clientId, client_secret: sso.clientSecret, code, code_verifier: verifier, redirect_uri: redirectUri
          }),
          redirect: "error",
          signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS)
        });
      } catch {
        console.error("Mytko sign-in: Workflow unreachable");
        return done(res, "unavailable");
      }
      data = await response.json().catch(() => null);
      if (!response.ok || !data || typeof data.login !== "string" || !data.login || data.login.length > 80) {
        console.error("Mytko sign-in: code exchange refused", response.status);
        if (response.status < 500) failed(req); // recorded before the reservation is released
        return done(res, response.status >= 500 ? "unavailable" : "failed");
      }
    } finally {
      inFlight -= 1;
    }
    if (!equal(sso.login, data.login)) return done(res, "denied");
    const admin = await users.admin();
    if (!admin) return done(res, "failed");
    await startSession(req, res, admin, "mytko", sso.login);
    await users.recordLogin(admin.id);
    return done(res, null);
  });

  router.stop = failedExchanges.stop;
  return router;
}

module.exports = { createSsoRouter, createWorkflowHealth };
