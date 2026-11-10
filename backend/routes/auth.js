// Login screen API: session state, password login (the owner, then member accounts), logout and a member's own
// password change ("Zaloguj kontem Mytko" is added by routes/sso.js). Mounted before the authentication middleware;
// CSRF, JSON and rate limits apply as to the rest of /api.
const express = require("express");
const { readCookie } = require("../sessions");
const { ownerSession, hashPassword, parsePasswordHash, verifyPassword } = require("../security");
const { passwordProblem } = require("../users");
const { avatarVersion } = require("./avatars");

const MAX_LOGIN = 200;
const MAX_PASSWORD = 1024;

function createAuthRouter({ credentials, sessions, cookie, authDisabled = false, mytkoLogin = false, ssoLogin = "", workflowUp = null,
  users = null, pool = null }) {
  const router = express.Router();

  // mytkoLogin: configured; mytkoAvailable: Mytko Workflow answers right now (the button and the automatic
  // attempt are offered only then). user: who is signed in (role "owner" or "member", the member's name).
  function state(session, mytkoAvailable = false, user = null) {
    return {
      authenticated: Boolean(session),
      login: session ? session.login : null,
      method: session ? session.method : null,
      expiresAt: session ? session.expiresAt : null,
      ttlSeconds: Math.round(sessions.ttlMs / 1000),
      user: session ? { role: user ? user.role : "owner", name: user ? user.name : null } : null,
      mytkoLogin,
      mytkoAvailable
    };
  }

  async function startSession(req, res, { login, method, user = null }) {
    await sessions.revoke(readCookie(req, cookie.name)); // a new login replaces this browser's session
    const { token, expiresAt } = await sessions.create({ login, method, userId: user ? user.id : null });
    res.cookie(cookie.name, token, { httpOnly: true, secure: cookie.secure, sameSite: "strict", path: "/", expires: expiresAt });
    return state({ login, method, expiresAt }, false, user);
  }

  // The signed-in account's id (null: the owner) and picture version (the app shows it in the sidebar).
  async function withAvatar(body, user) {
    if (body.user) body.user.id = user ? user.id : null;
    if (body.user && pool) body.user.avatarAt = await avatarVersion(pool, user);
    return body;
  }

  async function signedIn(req) {
    const session = await sessions.verify(readCookie(req, cookie.name));
    if (ownerSession(session, { username: credentials.username, ssoLogin })) return { session, user: null };
    const member = users && await users.forSession(session);
    return member ? { session, user: member } : { session: null, user: null };
  }

  router.get("/session", async (req, res) => {
    if (authDisabled) return res.json(await withAvatar(state({ login: "dev", method: "password", expiresAt: null }), null));
    const { session, user } = await signedIn(req);
    res.json(await withAvatar(state(session, !session && mytkoLogin && workflowUp ? await workflowUp() : false, user), user));
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
    if (await credentials.matches(body.login.trim(), body.password)) {
      return res.json(await startSession(req, res, { login: credentials.username, method: "password" }));
    }
    const member = users && await users.verify(body.login, body.password);
    if (member) return res.json(await startSession(req, res, { login: member.login, method: "password", user: member }));
    credentials.fail(req);
    res.status(401).json({ message: "Invalid login or password" });
  });

  // A member changes their own password; the owner's is set on the server (AUTH_PASSWORD_HASH).
  router.post("/password", async (req, res) => {
    const { session, user } = authDisabled ? { session: null, user: null } : await signedIn(req);
    if (!session) return res.status(401).json({ message: "Authentication required" });
    if (!user) return res.status(400).json({ message: "The owner's password is set on the server" });
    const body = req.body || {};
    const problem = passwordProblem(body.next);
    if (problem) return res.status(400).json({ message: problem });
    const waitSeconds = credentials.lockedFor(req);
    if (waitSeconds) {
      res.set("Retry-After", String(waitSeconds));
      return res.status(429).json({ message: "Too many failed login attempts" });
    }
    const row = (await pool.query("SELECT password_hash FROM users WHERE id = $1", [user.id])).rows[0];
    if (typeof body.current !== "string" || body.current.length > MAX_PASSWORD || !(await verifyPassword(body.current, parsePasswordHash(row.password_hash)))) {
      credentials.fail(req);
      return res.status(400).json({ message: "The current password is wrong" });
    }
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [await hashPassword(body.next), user.id]);
    await sessions.revokeUser(user.id);
    res.json(await startSession(req, res, { login: user.login, method: "password", user }));
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
