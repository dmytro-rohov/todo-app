// Encryption of stored third-party credentials (calendar refresh tokens) with AES-256-GCM.
// The key is TASKS_SECRET_KEY: 32 random bytes, base64 (openssl rand -base64 32). Format: v1.<iv>.<tag>.<data>.
const crypto = require("node:crypto");

function parseKey(encoded) {
  const key = Buffer.from(String(encoded || ""), "base64");
  if (key.length !== 32) throw new Error("TASKS_SECRET_KEY must be 32 bytes, base64 (openssl rand -base64 32)");
  return key;
}

function encrypt(key, plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

function decrypt(key, sealed) {
  const [version, iv, tag, data] = String(sealed).split(".");
  if (version !== "v1" || !iv || !tag || data === undefined) throw new Error("unsupported secret format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

module.exports = { parseKey, encrypt, decrypt };
