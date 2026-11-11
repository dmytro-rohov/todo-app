// Login screen API: session state, password login, logout and a member's own password change ("Zaloguj kontem Mytko"
// is added by routes/sso.js). Mounted before the authentication middleware; CSRF, JSON and rate limits apply as to the
// rest of /api.
// Express is the app's own dependency, loaded when a router is made (the kit itself loads with Node alone: an app's
// configuration check runs without node_modules).
const loadExpress = () => require("express");
const { readCookie } = require("../sessions");
const { passwordProblem } = require("../users");

const MAX_LOGIN = 200;
const MAX_PASSWORD = 1024;

// The account as the login screen and the app see it (an app with more account fields passes its own publicUser).
const publicUser = user => ({ id: user.id, login: user.login, name: user.name, role: user.role, lang: user.lang });

// mytkoLogin: "Zaloguj kontem Mytko" is configured; workflowUp(): Mytko Workflow answers right now (the button and the
// automatic attempt are offered only then).
function createAuthRouter({ sessions, users, guard, cookie, mytkoLogin = false, workflowUp = null, present = publicUser }) {
  const router = loadExpress().Router();

  function state(session = null, user = null, mytkoAvailable = false) {
    return {
      authenticated: Boolean(session && user),
      method: session && user ? session.method : null,
      expiresAt: session ? session.expiresAt : null,
      ttlSeconds: Math.round(sessions.ttlMs / 1000),
      user: user ? present(user) : null,
      mytkoLogin,
      mytkoAvailable
    };
  }

  function setCookie(res, { token, expiresAt }) {
    res.cookie(cookie.name, token, { httpOnly: true, secure: cookie.secure, sameSite: "strict", path: "/", expires: expiresAt });
  }

  async function startSession(req, res, user, method = "password", ssoLogin = null) {
    await sessions.revoke(readCookie(req, cookie.name)); // a new login replaces this browser's session
    const created = await sessions.create({ userId: user.id, login: user.login, method, ssoLogin });
    setCookie(res, created);
    return state({ expiresAt: created.expiresAt, method }, user);
  }

  // The session and account behind this browser's cookie (the administrator's row is synchronised first, users.js).
  const signedIn = req => users.fromToken(readCookie(req, cookie.name));

  router.get("/session", async (req, res) => {
    const { session, user } = await signedIn(req);
    if (user) return res.json(state(session, user));
    res.json(state(null, null, mytkoLogin && workflowUp ? await workflowUp() : false));
  });

  router.post("/login", async (req, res) => {
    const body = req.body;
    if (!body || typeof body.login !== "string" || typeof body.password !== "string" ||
        !body.login.trim() || !body.password || body.login.length > MAX_LOGIN || body.password.length > MAX_PASSWORD) {
      return res.status(400).json({ message: "Login and password are required" });
    }
    const waitSeconds = guard.lockedFor(req, body.login);
    if (waitSeconds) {
      res.set("Retry-After", String(waitSeconds));
      return res.status(429).json({ message: "Too many failed login attempts" });
    }
    const end = guard.begin(req, body.login); // reserved in the same step as the check above (no await in between)
    let signedInNow;
    try {
      signedInNow = await users.login(body.login, body.password); // checked and granted together (users.js)
      if (!signedInNow) guard.fail(req, body.login);
    } finally {
      end();
    }
    if (!signedInNow) return res.status(401).json({ message: "Invalid login or password" });
    await sessions.revoke(readCookie(req, cookie.name)); // a new login replaces this browser's session
    setCookie(res, signedInNow.session);
    res.json(state({ expiresAt: signedInNow.session.expiresAt, method: "password" }, signedInNow.user));
  });

  // A member changes their own password (the current one is required); the other sessions of the account end. The
  // administrator's password is set on the server (ADMIN_PASSWORD_HASH).
  router.post("/password", async (req, res) => {
    const { user } = await signedIn(req);
    if (!user) return res.status(401).json({ message: "Authentication required" });
    if (user.role === "admin") return res.status(400).json({ message: "The administrator's password is set on the server" });
    const body = req.body || {};
    const problem = passwordProblem(body.next);
    if (problem) return res.status(400).json({ message: problem });
    const waitSeconds = guard.lockedFor(req, user.login);
    if (waitSeconds) {
      res.set("Retry-After", String(waitSeconds));
      return res.status(429).json({ message: "Too many failed login attempts" });
    }
    // checked, replaced, every session ended and the new one created in one transaction (users.js)
    const end = guard.begin(req, user.login);
    let created;
    try {
      created = await users.changeOwnPassword(user.id, body.current, body.next);
      if (!created) guard.fail(req, user.login);
    } finally {
      end();
    }
    if (!created) return res.status(400).json({ message: "The current password is wrong" });
    setCookie(res, created);
    res.json(state({ expiresAt: created.expiresAt, method: "password" }, user));
  });

  router.post("/logout", async (req, res) => {
    await sessions.revoke(readCookie(req, cookie.name));
    res.clearCookie(cookie.name, { httpOnly: true, secure: cookie.secure, sameSite: "strict", path: "/" });
    res.json(state(null, null, mytkoLogin && workflowUp ? await workflowUp() : false));
  });

  router.startSession = startSession;
  return router;
}

module.exports = { createAuthRouter, publicUser };
