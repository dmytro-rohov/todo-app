// Account pictures: every account (the owner too) sets or removes its own: a small square, WebP or JPEG, made round in
// the app; the browser turns any photo into one of at most ~110 KB before sending. A picture is seen by its account, by
// the owner (the accounts list) and by those it shares a shared space with, nobody else. Its version (updated_at) is in
// the address, so a browser keeps it and asks again only when it changes.
const express = require("express");
const { isOwner, userId, inSpace } = require("../access");
const { parseId } = require("../validation");

const MAX_BYTES = 120 * 1024;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const accountKey = id => (id === null ? "owner" : `user:${id}`);

function imageType(bytes) {
  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

// The version of an account's picture (ms), or null without one. user: from access.js.
async function avatarVersion(db, user) {
  const row = (await db.query("SELECT updated_at FROM avatars WHERE account = $1", [accountKey(userId(user))])).rows[0];
  return row ? row.updated_at.getTime() : null;
}

function createAvatarsRouter(pool) {
  const router = express.Router();

  // { image: base64 } -> { avatarAt }
  router.put("/me", async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.image !== "string"
      || !body.image || body.image.length > Math.ceil(MAX_BYTES / 3) * 4 || body.image.length % 4 || !BASE64.test(body.image)) {
      return res.status(400).json({ message: "Invalid photo" });
    }
    const bytes = Buffer.from(body.image, "base64");
    const mime = imageType(bytes);
    if (!mime || bytes.length > MAX_BYTES) return res.status(400).json({ message: "Invalid photo" });
    const id = userId(req.user);
    const row = (await pool.query(
      `INSERT INTO avatars (account, user_id, mime, data, updated_at) VALUES ($1, $2, $3, $4, clock_timestamp())
       ON CONFLICT (account) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at RETURNING updated_at`,
      [accountKey(id), id, mime, body.image])).rows[0];
    res.json({ avatarAt: row.updated_at.getTime() });
  });

  router.delete("/me", async (req, res) => {
    await pool.query("DELETE FROM avatars WHERE account = $1", [accountKey(userId(req.user))]);
    res.json({ avatarAt: null });
  });

  // "owner" or an account's id.
  router.get("/:who", async (req, res) => {
    const who = req.params.who === "owner" ? null : parseId(req.params.who);
    if (req.params.who !== "owner" && who === null) return res.status(400).json({ message: "Invalid id" });
    const me = userId(req.user);
    const visible = who === me || isOwner(req.user) || (await pool.query(
      `SELECT 1 FROM spaces s WHERE ${inSpace("s", "$1::integer")} AND ${inSpace("s", "$2::integer")} LIMIT 1`, [me, who])).rowCount > 0;
    // version, type and picture read together: the bytes always belong to the ETag sent
    const row = visible ? (await pool.query("SELECT updated_at, mime, data FROM avatars WHERE account = $1", [accountKey(who)])).rows[0] : null;
    if (!row) return res.status(404).json({ message: "Photo not found" });
    const etag = `"avatar-${accountKey(who)}-${row.updated_at.getTime()}"`;
    res.set({ "Cache-Control": "private, no-cache", ETag: etag });
    if (req.headers["if-none-match"]?.split(",").some(tag => tag.trim() === etag)) return res.status(304).end();
    res.type(row.mime).send(Buffer.from(row.data, "base64"));
  });

  return router;
}

module.exports = { createAvatarsRouter, avatarVersion, imageType, MAX_BYTES };
