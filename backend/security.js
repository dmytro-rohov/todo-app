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
// HTTP Basic authentication for the single owner of this instance. The app has
// no user model; every task and category belongs to whoever holds the
// credentials. Must only be served over HTTPS (TLS terminated by Caddy).
function basicAuth({ username, passwordHash, failWindowMs, failMax }) {
  const parsedHash = parsePasswordHash(passwordHash);
  const expectedUser = sha256(username);
  const failures = createWindowCounter({ windowMs: failWindowMs });

  // Successful credentials are remembered (as a keyed digest, never in plain
  // text) so each static asset/API request does not cost a full scrypt run.
  const cacheKey = crypto.randomBytes(32);
  const verified = new Map();
  const VERIFIED_TTL_MS = 10 * 60000;

  function challenge(res) {
    res.set("WWW-Authenticate", 'Basic realm="Mytko Tasks", charset="UTF-8"');
    return res.status(401).json({ message: "Authentication required" });
  }

  const middleware = async (req, res, next) => {
    if (failMax > 0 && failures.peek(clientAddress(req)).count >= failMax) {
      const entry = failures.peek(clientAddress(req));
      res.set("Retry-After", String(Math.ceil((entry.resetAt - Date.now()) / 1000)));
      return res.status(429).json({ message: "Too many failed login attempts" });
    }

    const header = req.get("authorization") || "";
    const match = /^Basic ([A-Za-z0-9+/=]+)$/.exec(header);
    if (!match) return challenge(res);

    const digest = crypto.createHmac("sha256", cacheKey).update(match[1]).digest("base64");
    const cachedUntil = verified.get(digest);
    if (cachedUntil && cachedUntil > Date.now()) return next();

    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator === -1) return challenge(res);
    const user = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);

    try {
      const userOk = crypto.timingSafeEqual(sha256(user), expectedUser);
      const passwordOk = await verifyPassword(password, parsedHash);
      if (userOk && passwordOk) {
        if (verified.size > 1000) verified.clear();
        verified.set(digest, Date.now() + VERIFIED_TTL_MS);
        return next();
      }
    } catch (error) {
      return next(error);
    }

    failures.hit(clientAddress(req));
    return challenge(res);
  };
  middleware.stop = failures.stop;
  return middleware;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest();
}

// ---- CSRF -------------------------------------------------------------------
// Browsers attach Basic credentials to cross-site requests automatically, so
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
    } else if (origin && origin !== publicOrigin) {
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
  basicAuth,
  csrfProtection,
  securityHeaders,
  CONTENT_SECURITY_POLICY
};
