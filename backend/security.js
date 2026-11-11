// Tasks' access on the kit's security primitives (backend/vendor/mytko-kit/security.js: scrypt, rate limits, the login
// guard, CSRF, security headers). The single owner of this instance is configured on the server (ADMIN_LOGIN /
// ADMIN_PASSWORD_HASH, or AUTH_USERNAME / AUTH_PASSWORD_HASH) and is not a row: its sessions have user id null
// (access.js OWNER). It signs in with a browser session (login screen or "Zaloguj kontem Mytko", routes/auth.js);
// HTTP Basic stays accepted for scripts and the release smoke test, but is never requested (no WWW-Authenticate), so
// browsers do not show their own password dialog. Must only be served over HTTPS (TLS terminated by Caddy).
const crypto = require("node:crypto");
const kit = require("./kit");

const { parsePasswordHash, verifyPassword, rateLimit, createWindowCounter, clientAddress, csrfProtection, loginGuard, readCookie } = kit;
// New hashes keep Tasks' parameters (kit.js SCRYPT: p=1).
const hashPassword = kit.hashPassword;
// Tasks shows no blob: images (no photo previews before sending).
const CONTENT_SECURITY_POLICY = kit.contentSecurityPolicy({ imgBlob: false });
const securityHeaders = ({ isProduction }) => kit.securityHeaders({ isProduction, imgBlob: false });

// The owner's credentials, and the failed sign-ins (the kit's login guard: per client address — an IPv6 /64 is one —
// and per login from anywhere; checks still running count until their outcome is known).
function ownerCredentials({ username, passwordHash, failWindowMs, failMax }) {
  const parsedHash = parsePasswordHash(passwordHash);
  const expectedUser = sha256(username);
  const guard = loginGuard({ windowMs: failWindowMs, max: failMax });

  const matches = async (user, password) => {
    const userOk = crypto.timingSafeEqual(sha256(String(user)), expectedUser);
    const passwordOk = await verifyPassword(String(password), parsedHash);
    return userOk && passwordOk;
  };

  return {
    username,
    // the owner's parsed hash: unknown member logins cost a check with the same scrypt parameters (users.js)
    passwordHash: parsedHash,
    // Without counting a failure: the login screen tries member accounts before it counts one (fail()).
    matches,
    fail(req, login) {
      guard.fail(req, login);
    },
    // Seconds to wait when this client (or this login) is locked out after too many failures, else 0.
    lockedFor(req, login) {
      return guard.lockedFor(req, login);
    },
    // A check about to run, reserved in the same synchronous step as lockedFor() (loginGuard.begin).
    begin(req, login) {
      return guard.begin(req, login);
    },
    async check(req, user, password) {
      const end = guard.begin(req, user);
      try {
        if (await matches(user, password)) return true;
        guard.fail(req, user);
        return false;
      } finally {
        end();
      }
    },
    stop: guard.stop
  };
}

// A session belongs to the owner only while it still matches the configuration: password sessions the owner login,
// Mytko sessions the one allowed Workflow login (so changing either cuts older sessions).
function ownerSession(session, { username, ssoLogin }) {
  if (!session || session.userId) return false;
  if (session.method === "password") return session.login === username;
  return session.method === "mytko" && Boolean(ssoLogin) && session.login === ssoLogin;
}

// Sets req.user: the owner (OWNER in access.js) or a member account (users.js) whose session is still valid.
function ownerAuth({ credentials, sessions, cookieName, ssoLogin = "", users = null }) {
  const { OWNER } = require("./access");
  // Successful Basic credentials are remembered (as a keyed digest, never in plain
  // text) so each request does not cost a full scrypt run.
  const cacheKey = crypto.randomBytes(32);
  const verified = new Map();
  const VERIFIED_TTL_MS = 10 * 60000;

  const deny = res => res.status(401).json({ message: "Authentication required" });

  const middleware = async (req, res, next) => {
    // A valid session works even while this address is locked out (e.g. failed guesses from the same NAT).
    try {
      const session = await sessions.verify(readCookie(req, cookieName));
      if (ownerSession(session, { username: credentials.username, ssoLogin })) {
        req.auth = session;
        req.user = OWNER;
        return next();
      }
      const member = users && await users.forSession(session);
      if (member) {
        req.auth = session;
        req.user = member;
        return next();
      }
    } catch (error) {
      return next(error);
    }

    const waitSeconds = credentials.lockedFor(req);
    if (waitSeconds) {
      res.set("Retry-After", String(waitSeconds));
      return res.status(429).json({ message: "Too many failed login attempts" });
    }

    const match = /^Basic ([A-Za-z0-9+/=]+)$/.exec(req.get("authorization") || "");
    if (!match) return deny(res);

    const digest = crypto.createHmac("sha256", cacheKey).update(match[1]).digest("base64");
    const cachedUntil = verified.get(digest);
    if (cachedUntil && cachedUntil > Date.now()) {
      req.auth = { login: credentials.username, method: "basic" };
      req.user = OWNER;
      return next();
    }

    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator === -1) return deny(res);

    try {
      if (await credentials.check(req, decoded.slice(0, separator), decoded.slice(separator + 1))) {
        if (verified.size > 1000) verified.clear();
        verified.set(digest, Date.now() + VERIFIED_TTL_MS);
        req.auth = { login: credentials.username, method: "basic" };
        req.user = OWNER;
        return next();
      }
    } catch (error) {
      return next(error);
    }
    return deny(res);
  };
  middleware.stop = () => {};
  return middleware;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest();
}

module.exports = {
  hashPassword,
  parsePasswordHash,
  verifyPassword,
  rateLimit,
  createWindowCounter,
  clientAddress,
  ownerCredentials,
  ownerAuth,
  ownerSession,
  csrfProtection,
  securityHeaders,
  CONTENT_SECURITY_POLICY
};
