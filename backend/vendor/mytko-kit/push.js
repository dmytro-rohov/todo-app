// Web Push for the Mytko apps (docs/push.md): notifications on the account's devices, also on an iPhone with the app on
// the Home Screen (iOS 16.4+). No dependency: node:crypto does the message encryption (RFC 8291, aes128gcm) and the
// VAPID signature (RFC 8292), fetch posts to the browser's push service.
//
// - Keys: PUSH_VAPID_PUBLIC_KEY / PUSH_VAPID_PRIVATE_KEY (npm run vapid-keys, scripts.js), PUSH_VAPID_SUBJECT (mailto:
//   or https:, the contact push services see). Without them push is off: the API says so, nothing is sent.
// - Devices: the app's push_subscriptions table (the SQL is in docs/push.md), one row per browser, with its own choice
//   of categories (prefs). A device is the account's that last saved it (a browser that signs in with another account).
// - Categories: the app declares them ({ id, default }); a device that never chose keeps the default.
// - send() never logs a user's data and never fails because of a device or a push service: a notification that cannot
//   be sent never breaks the action that caused it (only a malformed message, the app's own mistake, throws).
const crypto = require("node:crypto");

const loadExpress = () => require("express");

const CATEGORY = /^[a-z][a-z0-9-]{1,31}$/;
const KEY = /^[A-Za-z0-9_-]+$/;
const TOPIC = /^[A-Za-z0-9_-]{1,32}$/;
const MAX_DEVICES = 10;
const MAX_ENDPOINT = 1024;
// The JSON of one notification. Push services take 4096 bytes including the encryption's 103.
const MAX_PAYLOAD = 3000;
const RECORD_SIZE = 4096;
const DEFAULT_SUBJECT = "mailto:hello@mytko.dev";
// The push services of the browsers the apps run on. A device's endpoint comes from the browser, so any signed-in
// account could send its own: the server only ever posts to these hosts over https, never to an address of its network.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge on Android, Samsung Internet
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^web\.push\.apple\.com$/, /^[a-z0-9-]+\.push\.apple\.com$/, // Safari, iPhone apps on the Home Screen
  /^[a-z0-9-]+\.notify\.windows\.com$/ // Edge on Windows
];
// The test notification, in the account's language (the app's other notifications bring their own texts).
const TEST_TEXT = {
  uk: { title: "Сповіщення працюють", body: "Так виглядатимуть сповіщення {app} на цьому пристрої." },
  pl: { title: "Powiadomienia działają", body: "Tak będą wyglądać powiadomienia {app} na tym urządzeniu." }
};

const fromBase64url = value => Buffer.from(value, "base64url");

// ---- keys -------------------------------------------------------------------------------------------------------------

function generateVapidKeys() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: ecdh.getPublicKey().toString("base64url"), privateKey: pad32(ecdh.getPrivateKey()).toString("base64url") };
}

function pad32(buffer) {
  return buffer.length >= 32 ? buffer : Buffer.concat([Buffer.alloc(32 - buffer.length), buffer]);
}

// The configuration (config.js calls it): null when push is not set up. The private key stays a KeyObject (it never
// serializes into logs or JSON).
function loadPush(env, errors) {
  const publicKey = env.PUSH_VAPID_PUBLIC_KEY || "";
  const privateKey = env.PUSH_VAPID_PRIVATE_KEY || "";
  if (!publicKey && !privateKey) return null;
  if (!publicKey || !privateKey) {
    errors.push("PUSH_VAPID_PUBLIC_KEY and PUSH_VAPID_PRIVATE_KEY must be set together (npm run vapid-keys)");
    return null;
  }
  const subject = env.PUSH_VAPID_SUBJECT || DEFAULT_SUBJECT;
  if (!/^mailto:[^\s@]+@[^\s@]+$/.test(subject) && !/^https:\/\/[^\s]+$/.test(subject)) {
    errors.push("PUSH_VAPID_SUBJECT must be a mailto: address or an https: URL");
  }
  try {
    return vapidKeys(publicKey, privateKey, subject);
  } catch {
    errors.push("PUSH_VAPID_PUBLIC_KEY / PUSH_VAPID_PRIVATE_KEY are not a P-256 key pair (npm run vapid-keys)");
    return null;
  }
}

function vapidKeys(publicKey, privateKey, subject = DEFAULT_SUBJECT) {
  if (!KEY.test(publicKey) || !KEY.test(privateKey)) throw new Error("not base64url");
  const pub = fromBase64url(publicKey);
  const priv = fromBase64url(privateKey);
  if (pub.length !== 65 || pub[0] !== 4 || priv.length !== 32) throw new Error("wrong length");
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(priv);
  if (!ecdh.getPublicKey().equals(pub)) throw new Error("the keys are not a pair");
  const key = crypto.createPrivateKey({ format: "jwk", key: { kty: "EC", crv: "P-256", d: privateKey,
    x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") } });
  return Object.freeze({ publicKey, subject, key });
}

// ---- RFC 8292: the VAPID header ---------------------------------------------------------------------------------------

function vapidAuthorization(endpoint, vapid, now = Date.now()) {
  const part = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  // at most 24 hours (Apple refuses longer); 12 leaves room for clock skew
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: vapid.subject })}`;
  const signature = crypto.sign("sha256", Buffer.from(unsigned), { key: vapid.key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${signature.toString("base64url")}, k=${vapid.publicKey}`;
}

// ---- RFC 8291: the encrypted message (one aes128gcm record) -----------------------------------------------------------

// keys: the device's { p256dh, auth }. salt and ecdh are fixed only by tests (RFC 8291's example).
function encryptPayload(keys, plaintext, { salt = crypto.randomBytes(16), ecdh = null } = {}) {
  const receiver = fromBase64url(keys.p256dh);
  const secret = fromBase64url(keys.auth);
  if (receiver.length !== 65 || receiver[0] !== 4 || secret.length !== 16) throw new Error("Invalid subscription keys");
  const local = ecdh || crypto.createECDH("prime256v1");
  if (!ecdh) local.generateKeys();
  const sender = local.getPublicKey();
  const shared = local.computeSecret(receiver);
  const hkdf = (ikm, salt, info, length) => Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, length));
  const ikm = hkdf(shared, secret, Buffer.concat([Buffer.from("WebPush: info\0"), receiver, sender]), 32);
  const cek = hkdf(ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  // the padding delimiter 2: this is the last (and only) record
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header[20] = sender.length;
  return Buffer.concat([header, sender, body]);
}

// ---- devices ----------------------------------------------------------------------------------------------------------

// The endpoint a browser gave: https, on a known push service, no credentials, a sane length.
function allowedEndpoint(endpoint, hosts = PUSH_HOSTS) {
  if (typeof endpoint !== "string" || endpoint.length > MAX_ENDPOINT) return false;
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === "https:" && !url.username && !url.password && !url.port && hosts.some(host => host.test(url.hostname));
}

// A browser's PushSubscription (its toJSON()): { endpoint, keys: { p256dh, auth } }, or null when it is not one.
function parseSubscription(value, hosts = PUSH_HOSTS) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).some(key => !["endpoint", "keys", "expirationTime"].includes(key))) return null;
  const keys = value.keys;
  if (!keys || typeof keys !== "object" || Array.isArray(keys) || Object.keys(keys).length !== 2) return null;
  if (typeof keys.p256dh !== "string" || typeof keys.auth !== "string" || !KEY.test(keys.p256dh) || !KEY.test(keys.auth)) return null;
  const receiver = fromBase64url(keys.p256dh);
  if (receiver.length !== 65 || receiver[0] !== 4 || fromBase64url(keys.auth).length !== 16) return null;
  try {
    // a point on the curve, or encrypting would fail later
    const probe = crypto.createECDH("prime256v1");
    probe.generateKeys();
    probe.computeSecret(receiver);
  } catch {
    return null;
  }
  if (!allowedEndpoint(value.endpoint, hosts)) return null;
  return { endpoint: value.endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

// userId: the account's id; null for an owner without a row (Tasks), compared with IS NOT DISTINCT FROM.
function createPushStore(pool, { maxDevices = MAX_DEVICES } = {}) {
  return {
    // prefs: the device's choice, or null to keep what it had (a device that changes account starts from the defaults).
    async save(userId, device, prefs = null) {
      const result = await pool.query(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, prefs) VALUES ($1, $2, $3, $4, COALESCE($5::jsonb, '{}'::jsonb))
         ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
           prefs = CASE WHEN $5::jsonb IS NOT NULL THEN $5::jsonb
                        WHEN push_subscriptions.user_id IS NOT DISTINCT FROM EXCLUDED.user_id THEN push_subscriptions.prefs
                        ELSE '{}'::jsonb END
         RETURNING id, prefs`,
        [userId ?? null, device.endpoint, device.p256dh, device.auth, prefs === null ? null : JSON.stringify(prefs)]);
      // the account's oldest devices beyond the cap are forgotten (an old phone, a cleared browser); the device just saved
      // always stays, also an old one turned on again (its row keeps its first id)
      const saved = result.rows[0]?.id ?? null;
      await pool.query(`DELETE FROM push_subscriptions WHERE id IN (SELECT id FROM push_subscriptions
        WHERE user_id IS NOT DISTINCT FROM $1::integer AND id IS DISTINCT FROM $2::integer ORDER BY id DESC OFFSET ${Number(maxDevices) - 1})`, [userId ?? null, saved]);
      return result.rows[0] || null;
    },

    async devices(userId) {
      const result = await pool.query(`SELECT id, endpoint, p256dh, auth, prefs FROM push_subscriptions
        WHERE user_id IS NOT DISTINCT FROM $1::integer ORDER BY id`, [userId ?? null]);
      return result.rows;
    },

    async remove(userId, endpoint) {
      await pool.query("DELETE FROM push_subscriptions WHERE user_id IS NOT DISTINCT FROM $1::integer AND endpoint = $2", [userId ?? null, endpoint]);
    },

    // The push service says the device is gone (404/410): the browser unsubscribed or the app was removed.
    async drop(id) {
      await pool.query("DELETE FROM push_subscriptions WHERE id = $1", [id]);
    },

    async delivered(id) {
      await pool.query("UPDATE push_subscriptions SET last_ok_at = now() WHERE id = $1", [id]);
    }
  };
}

// ---- sending ----------------------------------------------------------------------------------------------------------

// One message to one device: { ok } | { gone } | { retryable, after } | { failed }. Never throws.
async function deliver(device, payload, vapid, { fetchImpl = fetch, ttl = 86400, urgency = "normal", topic = null, timeoutMs = 10000, now = Date.now() } = {}) {
  try {
    const headers = {
      TTL: String(ttl),
      Urgency: urgency,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      Authorization: vapidAuthorization(device.endpoint, vapid, now)
    };
    if (topic && TOPIC.test(topic)) headers.Topic = topic;
    const response = await fetchImpl(device.endpoint, { method: "POST", headers, body: encryptPayload(device, payload),
      redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    await response.arrayBuffer().catch(() => undefined);
    if (response.status >= 200 && response.status < 300) return { ok: true };
    if (response.status === 404 || response.status === 410) return { gone: true };
    if (response.status === 429 || response.status >= 500) {
      const after = Number(response.headers.get("retry-after"));
      return { retryable: true, after: Number.isFinite(after) && after > 0 ? Math.min(after, 30) * 1000 : null, status: response.status };
    }
    return { failed: true, status: response.status };
  } catch {
    return { retryable: true, after: null, status: 0 };
  }
}

// app: { name } (the test text); categories: [{ id, default }]; vapid: config.push (null = push is off).
// retries: of a device the push service could not take right now (429, 5xx, network), within this call only.
function createPush({ pool, vapid, categories = [], app = { name: "Mytko" }, store = createPushStore(pool), fetchImpl = fetch,
  retries = 2, retryDelayMs = 1000, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const list = categories.map(category => {
    if (!category || !CATEGORY.test(category.id) || typeof category.default !== "boolean") {
      throw new Error("A push category is { id: \"lower-case-id\", default: true | false }");
    }
    return Object.freeze({ id: category.id, default: category.default });
  });
  if (new Set(list.map(category => category.id)).size !== list.length) throw new Error("Push categories must have different ids");
  const known = new Map(list.map(category => [category.id, category]));

  const wants = (device, category) => {
    const choice = device.prefs && typeof device.prefs === "object" ? device.prefs[category] : undefined;
    return typeof choice === "boolean" ? choice : known.get(category).default;
  };

  async function toDevice(device, payload, options) {
    for (let attempt = 0; ; attempt += 1) {
      const result = await deliver(device, payload, vapid, { fetchImpl, ...options });
      if (result.ok) {
        await store.delivered(device.id).catch(() => undefined);
        return "sent";
      }
      if (result.gone) {
        await store.drop(device.id).catch(() => undefined);
        return "gone";
      }
      if (!result.retryable || attempt >= retries) return "failed";
      await wait(result.after ?? retryDelayMs * 2 ** attempt);
    }
  }

  async function sendTo(devices, message) {
    const payload = JSON.stringify(message.body);
    const results = await Promise.all(devices.map(device => toDevice(device, payload, message.options)));
    return { sent: results.filter(r => r === "sent").length, gone: results.filter(r => r === "gone").length, failed: results.filter(r => r === "failed").length };
  }

  return {
    available: Boolean(vapid),
    publicKey: vapid ? vapid.publicKey : null,
    categories: list,
    store,

    // message: { category, title, body?, url? ("/…" of this app), tag? (a newer one replaces the older), badge? (the
    // number on the app's icon), urgency? ("very-low" | "low" | "normal" | "high"), ttl? (seconds) }.
    // → { sent, gone, failed, skipped }; push off → { sent: 0, …, off: true }.
    // A malformed message or an unknown category throws (the app's own mistake: its tests see it); nothing about the
    // devices or the push services ever does.
    async send(userId, message) {
      const body = notification(message);
      if (!known.has(message.category)) throw new Error(`Unknown push category "${message.category}"`);
      const empty = { sent: 0, gone: 0, failed: 0, skipped: 0 };
      if (!vapid) return { ...empty, off: true };
      try {
        const devices = await store.devices(userId);
        const chosen = devices.filter(device => wants(device, message.category));
        const result = await sendTo(chosen, { body, options: options(message) });
        return { ...result, skipped: devices.length - chosen.length };
      } catch {
        return { ...empty, failed: 1 };
      }
    },

    // The "send a test" button: this device only, whatever it chose.
    async test(user, endpoint) {
      if (!vapid) return { sent: 0, gone: 0, failed: 0, off: true };
      const device = (await store.devices(user.id)).find(row => row.endpoint === endpoint);
      if (!device) return { sent: 0, gone: 0, failed: 0, missing: true };
      const text = TEST_TEXT[user.lang] || TEST_TEXT.uk;
      return sendTo([device], { body: { title: text.title, body: text.body.replace("{app}", app.name), url: "/", tag: "mytko-test" }, options: { urgency: "high", ttl: 600 } });
    }
  };
}

// The message as the device gets it, checked (push-cli.js uses it too). Throws on a malformed one.
function notification(message) {
  if (!message || typeof message !== "object") throw new Error("A push message is an object");
  const { title, body = "", url = "/", tag = null, badge = null } = message;
  if (typeof title !== "string" || !title.trim() || title.length > 120) throw new Error("A push message needs a title of at most 120 characters");
  if (typeof body !== "string" || body.length > 600) throw new Error("A push message's body is at most 600 characters");
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//") || url.includes("\\")) throw new Error("A push message's url is a path of this app (\"/…\")");
  if (tag !== null && (typeof tag !== "string" || !TOPIC.test(tag))) throw new Error("A push message's tag is 1–32 letters, digits, - or _");
  if (badge !== null && (!Number.isInteger(badge) || badge < 0)) throw new Error("A push message's badge is a whole number ≥ 0");
  const out = { title: title.trim(), body, url };
  if (tag) out.tag = tag;
  if (badge !== null) out.badge = badge;
  if (Buffer.byteLength(JSON.stringify(out)) > MAX_PAYLOAD) throw new Error("A push message is at most 3000 bytes");
  return out;
}

function options(message) {
  const urgency = ["very-low", "low", "normal", "high"].includes(message.urgency) ? message.urgency : "normal";
  const ttl = Number.isInteger(message.ttl) && message.ttl >= 0 && message.ttl <= 2419200 ? message.ttl : 86400;
  return { urgency, ttl, topic: message.tag || null };
}

// ---- API: /api/push (after requireUser, csrf and express.json, like every app router) --------------------------------
//   GET  /                → { available, publicKey, categories: [{ id, default }] }
//   PUT  /subscription    { subscription, prefs? } → { prefs }   (this device: saved, or its choice changed)
//   POST /unsubscribe     { endpoint } → 204
//   POST /test            { endpoint } → { sent }
function createPushRouter({ push, hosts = PUSH_HOSTS }) {
  const router = loadExpress().Router();
  const body = (req, allowed) => {
    const value = req.body;
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) return null;
    return value;
  };
  const endpointOf = req => {
    const value = body(req, ["endpoint"]);
    return value && typeof value.endpoint === "string" && value.endpoint.length <= MAX_ENDPOINT ? value.endpoint : null;
  };

  router.get("/", (req, res) => {
    res.json({ available: push.available, publicKey: push.publicKey, categories: push.categories });
  });

  router.put("/subscription", async (req, res) => {
    if (!push.available) return res.status(409).json({ message: "Push notifications are not configured" });
    const value = body(req, ["subscription", "prefs"]);
    if (!value) return res.status(400).json({ message: "Invalid request" });
    const device = parseSubscription(value.subscription, hosts);
    if (!device) return res.status(400).json({ message: "This push service is not supported" });
    let prefs = null;
    if (value.prefs !== undefined) {
      const known = new Set(push.categories.map(category => category.id));
      const entries = value.prefs && typeof value.prefs === "object" && !Array.isArray(value.prefs) ? Object.entries(value.prefs) : null;
      if (!entries || entries.some(([key, on]) => !known.has(key) || typeof on !== "boolean")) return res.status(400).json({ message: "Invalid request" });
      prefs = Object.fromEntries(entries);
    }
    const saved = await push.store.save(req.user.id ?? null, device, prefs);
    res.json({ prefs: saved && saved.prefs && typeof saved.prefs === "object" ? saved.prefs : {} });
  });

  router.post("/unsubscribe", async (req, res) => {
    const endpoint = endpointOf(req);
    if (!endpoint) return res.status(400).json({ message: "Invalid request" });
    await push.store.remove(req.user.id ?? null, endpoint);
    res.status(204).end();
  });

  router.post("/test", async (req, res) => {
    if (!push.available) return res.status(409).json({ message: "Push notifications are not configured" });
    const endpoint = endpointOf(req);
    if (!endpoint) return res.status(400).json({ message: "Invalid request" });
    const result = await push.test({ id: req.user.id ?? null, lang: req.user.lang }, endpoint);
    if (result.missing || result.gone) return res.status(404).json({ message: "This device is not subscribed" });
    if (!result.sent) return res.status(502).json({ message: "The notification could not be sent" });
    res.json({ sent: result.sent });
  });

  return router;
}

module.exports = {
  generateVapidKeys, loadPush, vapidKeys, vapidAuthorization, encryptPayload, allowedEndpoint, parseSubscription,
  createPushStore, createPush, createPushRouter, deliver, pushMessage: notification, PUSH_HOSTS, MAX_DEVICES
};
