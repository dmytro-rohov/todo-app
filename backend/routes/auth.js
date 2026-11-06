// Login screen API: session state, password login and logout ("Zaloguj kontem Mytko" is added by routes/sso.js).
// Mounted before the authentication middleware; CSRF, JSON and rate limits apply as to the rest of /api.
const express = require("express");
const { readCookie } = require("../sessions");
const { ownerSession } = require("../security");

const MAX_LOGIN = 200;
const MAX_PASSWORD = 1024;

function createAuthRouter({ credentials, sessions, cookie, authDisabled = false, mytkoLogin = false, ssoLogin = "", workflowUp = null }) {
  const router = express.Router();

  // mytkoLogin: configured; mytkoAvailable: Mytko Workflow answers right now (the button and the automatic
  // attempt are offered only then).
  function state(session, mytkoAvailable = false) {
    return {
      authenticated: Boolean(session),
      login: session ? session.login : null,
      method: session ? session.method : null,
      expiresAt: session ? session.expiresAt : null,
      ttlSeconds: Math.round(sessions.ttlMs / 1000),
      mytkoLogin,
      mytkoAvailable
    };
  }

  async function startSession(req, res, { login, method }) {
    await sessions.revoke(readCookie(req, cookie.name)); // a new login replaces this browser's session
    const { token, expiresAt } = await sessions.create({ login, method });
    res.cookie(cookie.name, token, { httpOnly: true, secure: cookie.secure, sameSite: "strict", path: "/", expires: expiresAt });
    return state({ login, method, expiresAt });
  }

  router.get("/session", async (req, res) => {
    if (authDisabled) return res.json({ ...state({ login: "dev", method: "password", expiresAt: null }) });
    const session = await sessions.verify(readCookie(req, cookie.name));
    const owner = ownerSession(session, { username: credentials.username, ssoLogin });
    res.json(state(owner ? session : null, !owner && mytkoLogin && workflowUp ? await workflowUp() : false));
  });

  router.post("/login", async (req, res) => {
    const body = req.body;
    if (!body || typeof body.login !== "string" || typeof body.password !== "string" ||
        !body.login.trim() || !body.password || body.login.length > MAX_LOGIN || body.password.length > MAX_PASSWORD) {
      return res.status(400).json({ message: "Login and password are required" });
    }
    const waitSeconds = credentials.lockedFor(req);
    if (waitSeconds) {
      res.set("Retry-After", String(waitSeconds));
      return res.status(429).json({ message: "Too many failed login attempts" });
    }
    if (!(await credentials.check(req, body.login.trim(), body.password))) {
      return res.status(401).json({ message: "Invalid login or password" });
    }
    res.json(await startSession(req, res, { login: credentials.username, method: "password" }));
  });

  router.post("/logout", async (req, res) => {
    await sessions.revoke(readCookie(req, cookie.name));
    res.clearCookie(cookie.name, { httpOnly: true, secure: cookie.secure, sameSite: "strict", path: "/" });
    res.json(state(null));
  });

  router.startSession = startSession;
  return router;
}

module.exports = { createAuthRouter };
