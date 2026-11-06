// "Zaloguj kontem Mytko": sign in with the operator's Mytko Workflow session (authorization code + PKCE S256;
// the provider side is mytko-workflow src/mytko/api/sso_provider.py).
//
//   GET /auth/mytko/start     -> 303 to Workflow /api/v1/auth/sso/authorize, remembering state + PKCE verifier in a
//                                short-lived HttpOnly cookie
//   GET /auth/mytko/callback  <- Workflow sends the browser back with ?code&state (or ?error&state); the code is
//                                exchanged server to server for the operator login, then a "mytko" session starts
//
// Every outcome ends on "/" (the login screen explains failures through ?sso=<reason>).
const crypto = require("node:crypto");
const express = require("express");
const { readCookie } = require("../sessions");

const PENDING_MS = 10 * 60000;
const HEALTH_TIMEOUT_MS = 2500;
const HEALTH_TTL_MS = 30000;
const TOKEN_TIMEOUT_MS = 5000;
const URLSAFE = /^[A-Za-z0-9_-]{16,256}$/;

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

function createSsoRouter({ sso, publicOrigin, cookie, startSession, fetchImpl = fetch, workflowUp = createWorkflowHealth(sso, fetchImpl) }) {
  const router = express.Router();
  const pendingCookie = cookie.secure ? "__Host-mytko-tasks-sso" : "mytko-tasks-sso";
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

    let response;
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
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || typeof data.login !== "string" || !data.login || data.login.length > 80) {
      console.error("Mytko sign-in: code exchange refused", response.status);
      return done(res, response.status >= 500 ? "unavailable" : "failed");
    }
    if (!equal(sso.login, data.login)) return done(res, "denied");
    await startSession(req, res, { login: data.login, method: "mytko" });
    return done(res, null);
  });

  return router;
}

module.exports = { createSsoRouter, createWorkflowHealth };
