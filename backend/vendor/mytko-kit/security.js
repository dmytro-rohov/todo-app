// Mytko Kit: passwords (scrypt), rate limits, the login guard, the session check, CSRF and security headers. The same in
// every Mytko app; nothing here knows which app it runs in.
const crypto = require("node:crypto");
const { SocketAddress } = require("node:net");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);

// ---- password hashing -------------------------------------------------------
// Format: scrypt:N:r:p:<salt base64>:<hash base64>
// (":" never occurs in base64 and, unlike "$", is not interpolated by shells or Docker Compose env files.)
// N=2^15, r=8, p=3: an OWASP minimum (32 MiB, p rounds one after another). Stored hashes carry their own parameters.
const SCRYPT_DEFAULTS = { N: 32768, r: 8, p: 3, keyLength: 32 };
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

async function hashPassword(password, { N, r, p, keyLength } = SCRYPT_DEFAULTS) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, keyLength, { N, r, p, maxmem: SCRYPT_MAXMEM });
  return ["scrypt", N, r, p, salt.toString("base64"), hash.toString("base64")].join(":");
}

function parsePasswordHash(encoded) {
  const parts = String(encoded).split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    throw new Error("ADMIN_PASSWORD_HASH must have the form scrypt:N:r:p:salt:hash");
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
    throw new Error("ADMIN_PASSWORD_HASH must have the form scrypt:N:r:p:salt:hash");
  }
  return parsed;
}

async function verifyPassword(password, parsed) {
  const candidate = await scrypt(password, parsed.salt, parsed.hash.length, {
    N: parsed.N, r: parsed.r, p: parsed.p, maxmem: SCRYPT_MAXMEM
  });
  return crypto.timingSafeEqual(candidate, parsed.hash);
}

// Unknown logins cost a password check too, so the answer time does not reveal which logins exist. The dummy hash is
// made with the same scrypt parameters (N, r, p, key length) as `like`: the configured administrator's / owner's parsed
// hash (production hashes may be p=1, e.g. converted from Mytko Workflow), or parameters { N, r, p, keyLength }; the
// kit's defaults without one. One dummy hash per parameter set, made once.
const dummies = new Map();
function dummyParams(like) {
  if (!like) return SCRYPT_DEFAULTS;
  const keyLength = Buffer.isBuffer(like.hash) ? like.hash.length : like.keyLength;
  const params = { N: like.N, r: like.r, p: like.p, keyLength };
  if (![params.N, params.r, params.p, params.keyLength].every(n => Number.isInteger(n) && n > 0)) throw new Error("dummy check needs scrypt parameters");
  return params;
}
function dummyHashFor(like = null) {
  const params = dummyParams(like);
  const key = `${params.N}:${params.r}:${params.p}:${params.keyLength}`;
  if (!dummies.has(key)) {
    const made = hashPassword("not-a-real-password", params);
    made.catch(() => dummies.delete(key));
    dummies.set(key, made);
  }
  return dummies.get(key);
}
// Always false; takes as long as checking a password against a hash like `like`.
async function dummyPasswordCheck(password, like = null) {
  await verifyPassword(String(password), parsePasswordHash(await dummyHashFor(like)));
  return false;
}

// ---- rate limiting ----------------------------------------------------------
// In-memory fixed-window counter. Valid for the single-replica deployment the Mytko apps are designed for; a multi-replica
// setup would need a shared store.
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
      // full: the oldest window goes (a Map keeps insertion order), never everybody's count at once
      if (!entry && entries.size >= maxEntries) entries.delete(entries.keys().next().value);
      entry = { count: 0, resetAt: now + windowMs };
      entries.delete(key);
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
    // the count without counting (and without keeping an entry for a key never hit)
    peek(key) {
      const entry = entries.get(key);
      return entry && entry.resetAt > Date.now() ? entry : { count: 0, resetAt: Date.now() + windowMs };
    },
    stop() {
      clearInterval(sweep);
    }
  };
}

// One bucket for equivalent IPv4 / IPv4-mapped IPv6 spellings, and one per IPv6 /64: a single host usually has a whole
// /64, so counting its addresses one by one would let it rotate through them. Node's parser canonicalizes hex IPv6;
// malformed forwarded addresses fall back to the peer.
function clientAddress(req) {
  const ip = req.ip;
  const parsed = SocketAddress.parse(ip.includes(":") ? `[${ip}]:0` : `${ip}:0`);
  if (!parsed) return req.socket.remoteAddress;
  const address = parsed.address;
  if (address.startsWith("::ffff:") && address.includes(".")) return address.slice(7);
  return address.includes(":") && !address.includes(".") ? `${ipv6Prefix64(address)}::/64` : address;
}

// The first four groups of a canonical IPv6 address ("2001:db8::1" -> "2001:db8:0:0").
function ipv6Prefix64(address) {
  const [head, tail] = address.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  return groups.slice(0, 4).join(":");
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

// The paths the per-address request limit counts: the app's API (/api — also /api/auth, the Workflow agent, public
// booking) and its sign-in round trips (/auth — "Zaloguj kontem Mytko", Google). A page load is dozens of static files
// (the shell, its modules, styles, icons): they hold no data and are not counted, so reloading the app never runs into
// the limit. Health checks are mounted before it (the proxy's and the container's probes never compete with visitors).
const LIMITED_PATHS = Object.freeze(["/api", "/auth"]);

// Mounts a rateLimit() middleware on those paths only. Express matches them the way it matches the routers mounted
// there (case-insensitive, whole path segments: /API/x and /api/ count, /apix does not), so no route under them escapes
// the limit. Call it where a global app.use(limiter) would go: before the routes.
function limitDynamicRoutes(app, limiter, paths = LIMITED_PATHS) {
  if (typeof limiter !== "function") throw new Error("limitDynamicRoutes needs the rateLimit() middleware");
  app.use([...paths], limiter);
  return limiter;
}

// Failed sign-ins, counted per client address and per login. After `max` failures within the window an address waits,
// whatever login it tries; after `max * PER_LOGIN` failures from anywhere a login waits, so addresses spread over many
// networks cannot keep guessing one password. A valid session keeps working; "Zaloguj kontem Mytko" counts per address
// only (it has no login before the exchange).
const PER_LOGIN = 5;
const loginKey = login => (typeof login === "string" && login.trim() ? login.trim().toLowerCase().slice(0, 200) : null);
function loginGuard({ windowMs, max }) {
  const byAddress = createWindowCounter({ windowMs });
  const byLogin = createWindowCounter({ windowMs });
  // Password checks still running count as failures until their outcome is known: parallel attempts cannot all pass
  // the check before the first failure is recorded (each check is a costly scrypt run, too).
  const running = new Map();
  const add = (key, n) => {
    const value = (running.get(key) ?? 0) + n;
    if (value > 0) running.set(key, value);
    else running.delete(key);
  };
  const wait = entry => Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000));
  return {
    fail(req, login) {
      byAddress.hit(clientAddress(req));
      const key = loginKey(login);
      if (key) byLogin.hit(key);
    },
    // Seconds to wait when this client (or this login) is locked out, else 0.
    lockedFor(req, login) {
      if (max === 0) return 0;
      const address = clientAddress(req);
      const byThisAddress = byAddress.peek(address);
      if (byThisAddress.count + (running.get(`a:${address}`) ?? 0) >= max) return wait(byThisAddress);
      const key = loginKey(login);
      const entry = key ? byLogin.peek(key) : null;
      return entry && entry.count + (running.get(`l:${key}`) ?? 0) >= max * PER_LOGIN ? wait(entry) : 0;
    },
    // A check about to run, reserved in the same synchronous step as lockedFor(); the returned function gives the
    // place back (call it in finally, after fail() when it failed).
    begin(req, login) {
      const keys = [`a:${clientAddress(req)}`];
      const key = loginKey(login);
      if (key) keys.push(`l:${key}`);
      keys.forEach(item => add(item, 1));
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        keys.forEach(item => add(item, -1));
      };
    },
    stop() {
      byAddress.stop();
      byLogin.stop();
    }
  };
}

// ---- authentication ---------------------------------------------------------
// Every API call after the login screen needs a browser session of an active account (sessions.js, users.js).
// Sets req.user and req.auth; anonymous requests are refused before any other processing.
function requireUser({ users, cookieName }) {
  return async (req, res, next) => {
    try {
      const { session, user } = await users.fromToken(require("./sessions").readCookie(req, cookieName));
      if (!user) return res.status(401).json({ message: "Authentication required" });
      req.auth = session;
      req.user = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

// Express: refuses member accounts (403) on administrator-only APIs.
function adminOnly(req, res, next) {
  if (req.user && req.user.role === "admin") return next();
  res.status(403).json({ message: "Not available for this account" });
}

// ---- CSRF -------------------------------------------------------------------
// Browsers attach cookies to some cross-site requests, so state-changing requests must prove they come from our own
// origin.
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

    // HTML forms cannot send application/json without a CORS preflight, which this API never grants.
    if (req.method !== "DELETE" && !req.is("application/json")) {
      return res.status(415).json({ message: "Content-Type must be application/json" });
    }
    next();
  };
}

// ---- headers ----------------------------------------------------------------
// imgBlob: images may come from blob: URLs (a photo's preview before it is sent: Finance); an app without such previews
// (Tasks) leaves it out.
function contentSecurityPolicy({ imgBlob = true } = {}) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    imgBlob ? "img-src 'self' data: blob:" : "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; ");
}
const CONTENT_SECURITY_POLICY = contentSecurityPolicy();

function securityHeaders({ isProduction, imgBlob = true }) {
  const policy = contentSecurityPolicy({ imgBlob });
  return (req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "Content-Security-Policy": policy,
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
  LIMITED_PATHS,
  limitDynamicRoutes,
  SCRYPT_DEFAULTS,
  hashPassword,
  parsePasswordHash,
  verifyPassword,
  dummyHashFor,
  dummyPasswordCheck,
  rateLimit,
  loginGuard,
  createWindowCounter,
  clientAddress,
  requireUser,
  adminOnly,
  csrfProtection,
  securityHeaders,
  contentSecurityPolicy,
  CONTENT_SECURITY_POLICY
};
