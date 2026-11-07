const crypto = require("node:crypto");
const { SocketAddress } = require("node:net");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);

// ---- password hashing -------------------------------------------------------
// Format: scrypt:N:r:p:<salt base64>:<hash base64>
// (":" never occurs in base64 and, unlike "$", is not interpolated by shells
// or Docker Compose env files.)
const SCRYPT_DEFAULTS = { N: 32768, r: 8, p: 1, keyLength: 32 };
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

async function hashPassword(password, { N, r, p, keyLength } = SCRYPT_DEFAULTS) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, keyLength, { N, r, p, maxmem: SCRYPT_MAXMEM });
  return ["scrypt", N, r, p, salt.toString("base64"), hash.toString("base64")].join(":");
}

function parsePasswordHash(encoded) {
  const parts = String(encoded).split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    throw new Error("AUTH_PASSWORD_HASH must have the form scrypt:N:r:p:salt:hash");
  }
  const [, N, r, p, salt, hash] = parts;
  const parsed = {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    salt: Buffer.from(salt, "base64"),
    hash: Buffer.from(hash, "base64")
  };
  if (![parsed.N, parsed.r, parsed.p].every(n => Number.isInteger(n) && n > 0) ||
      parsed.salt.length === 0 || parsed.hash.length === 0) {
    throw new Error("AUTH_PASSWORD_HASH must have the form scrypt:N:r:p:salt:hash");
  }
  return parsed;
}

async function verifyPassword(password, parsed) {
  const candidate = await scrypt(password, parsed.salt, parsed.hash.length, {
    N: parsed.N, r: parsed.r, p: parsed.p, maxmem: SCRYPT_MAXMEM
  });
  return crypto.timingSafeEqual(candidate, parsed.hash);
}

// ---- rate limiting ----------------------------------------------------------
// In-memory fixed-window counter. Valid for the single-replica deployment this
// app is designed for; a multi-replica setup would need a shared store.
function createWindowCounter({ windowMs, maxEntries = 10000 }) {
  const entries = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (entry.resetAt <= now) entries.delete(key);
    }
  }, Math.max(windowMs, 1000));
  sweep.unref();

  function current(key) {
    const now = Date.now();
    let entry = entries.get(key);
    if (!entry || entry.resetAt <= now) {
      if (!entry && entries.size >= maxEntries) entries.clear();
      entry = { count: 0, resetAt: now + windowMs };
      entries.set(key, entry);
    }
    return entry;
  }

  return {
    hit(key) {
      const entry = current(key);
      entry.count += 1;
      return entry;
    },
    peek(key) {
      return current(key);
    },
    stop() {
      clearInterval(sweep);
    }
  };
}

// One bucket for equivalent IPv4 / IPv4-mapped IPv6 spellings. Node's parser
// also canonicalizes hex IPv6; malformed forwarded addresses fall back to peer.
function clientAddress(req) {
  const ip = req.ip;
  const parsed = SocketAddress.parse(ip.includes(":") ? `[${ip}]:0` : `${ip}:0`);
  if (!parsed) return req.socket.remoteAddress;
  const address = parsed.address;
  return address.startsWith("::ffff:") && address.includes(".") ? address.slice(7) : address;
}

function rateLimit({ windowMs, max }) {
  const counter = createWindowCounter({ windowMs });
  const middleware = (req, res, next) => {
    if (max === 0) return next();
    const entry = counter.hit(clientAddress(req));
    if (entry.count > max) {
      res.set("Retry-After", String(Math.ceil((entry.resetAt - Date.now()) / 1000)));
      return res.status(429).json({ message: "Too many requests" });
    }
    next();
  };
  middleware.stop = counter.stop;
  return middleware;
}

// ---- authentication ---------------------------------------------------------
// The single owner of this instance signs in with a browser session (login screen or "Zaloguj kontem Mytko", see
// routes/auth.js). HTTP Basic stays accepted for scripts and the release smoke test, but is never requested
// (no WWW-Authenticate), so browsers do not show their own password dialog. The app has no user model; every task
// belongs to whoever is authenticated. Must only be served over HTTPS (TLS terminated by Caddy).
function ownerCredentials({ username, passwordHash, failWindowMs, failMax }) {
  const parsedHash = parsePasswordHash(passwordHash);
  const expectedUser = sha256(username);
  const failures = createWindowCounter({ windowMs: failWindowMs });

  const matches = async (user, password) => {
    const userOk = crypto.timingSafeEqual(sha256(String(user)), expectedUser);
    const passwordOk = await verifyPassword(String(password), parsedHash);
    return userOk && passwordOk;
  };
  return {
    username,
    // Without counting a failure: the login screen tries member accounts before it counts one (fail()).
    matches,
    fail(req) {
      failures.hit(clientAddress(req));
    },
    // Returns the seconds to wait when this client is locked out after too many failures, else 0.
    lockedFor(req) {
      if (failMax === 0) return 0;
      const entry = failures.peek(clientAddress(req));
      return entry.count >= failMax ? Math.ceil((entry.resetAt - Date.now()) / 1000) : 0;
    },
    async check(req, user, password) {
      if (await matches(user, password)) return true;
      failures.hit(clientAddress(req));
      return false;
    },
    stop: failures.stop
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
      const session = await sessions.verify(readCookieValue(req, cookieName));
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

function readCookieValue(req, name) {
  return require("./sessions").readCookie(req, name);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest();
}

// ---- CSRF -------------------------------------------------------------------
// Browsers attach cookies (and Basic credentials) to some cross-site requests, so
// state-changing requests must prove they come from our own origin.
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function csrfProtection({ publicOrigin }) {
  return (req, res, next) => {
    if (!UNSAFE_METHODS.has(req.method)) return next();

    const fetchSite = req.get("sec-fetch-site");
    const origin = req.get("origin");
    if (fetchSite) {
      if (fetchSite !== "same-origin" && fetchSite !== "none") {
        return res.status(403).json({ message: "Cross-site request rejected" });
      }
    }
    if (origin && origin !== publicOrigin) {
      return res.status(403).json({ message: "Cross-site request rejected" });
    }

    // HTML forms cannot send application/json without a CORS preflight, which
    // this API never grants.
    if (req.method !== "DELETE" && !req.is("application/json")) {
      return res.status(415).json({ message: "Content-Type must be application/json" });
    }
    next();
  };
}

// ---- headers ----------------------------------------------------------------
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

function securityHeaders({ isProduction }) {
  return (req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "Content-Security-Policy": CONTENT_SECURITY_POLICY,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()"
    });
    if (isProduction) {
      res.set("Strict-Transport-Security", "max-age=31536000");
    }
    next();
  };
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
