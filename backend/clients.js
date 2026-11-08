// CRM-lite helpers: validation, the domain used to match meetings and mail, and the matching itself.
const COLOR = /^#[0-9a-fA-F]{6}$/;
const EMAIL = /^[^\s@<>()",;]{1,64}@([^\s@<>()",;]{1,190}\.[A-Za-z]{2,})$/;
const STATUSES = ["lead", "client", "archived"];
const SOURCES = ["manual", "booking", "mail", "meeting"];
// Leads created by booking, mail or a meeting have no colour picked; they get a stable one from the palette.
const PALETTE = ["#b7e34d", "#84cc16", "#22c55e", "#14b8a6", "#38bdf8", "#818cf8", "#f2c463", "#fb923c", "#f87171", "#e879f9"];
const colorFor = name => PALETTE[[...name].reduce((sum, ch) => (sum * 31 + ch.codePointAt(0)) % 9973, 7) % PALETTE.length];
// Public mailbox providers (and our own domain) never identify a company.
const PUBLIC_DOMAINS = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com",
  "icloud.com", "me.com", "aol.com", "gmx.com", "gmx.de", "proton.me", "protonmail.com", "wp.pl", "o2.pl", "onet.pl", "op.pl",
  "interia.pl", "interia.eu", "gazeta.pl", "tlen.pl", "poczta.fm", "vp.pl", "mytko.dev"]);

function companyDomain(email) {
  const match = EMAIL.exec(String(email || "").trim().toLowerCase());
  return match && !PUBLIC_DOMAINS.has(match[1]) ? match[1] : null;
}

// Returns { error } or { value } (partial for PATCH). Empty strings clear optional fields.
function validateClient(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Invalid request body" };
  const allowed = ["name", "status", "company", "email", "phone", "website", "domain", "color", "notes", "source"];
  if (Object.keys(body).some(key => !allowed.includes(key)) || (partial && !Object.keys(body).length)) return { error: "Unknown or empty fields" };
  const value = {};
  if (!partial || "name" in body) {
    if (typeof body.name !== "string" || body.name.trim().length < 2 || body.name.length > 120) return { error: "Name too short" };
    value.name = body.name.trim();
  }
  if (!partial && !("color" in body)) value.color = colorFor(value.name);
  else if ("color" in body) {
    if (typeof body.color !== "string" || !COLOR.test(body.color)) return { error: "Color must be a hex value like #4e45e4" };
    value.color = body.color.toLowerCase();
  }
  if ("status" in body) { if (!STATUSES.includes(body.status)) return { error: "Invalid status" }; value.status = body.status; }
  if ("source" in body) { if (!SOURCES.includes(body.source)) return { error: "Invalid source" }; value.source = body.source; }
  for (const [key, max] of [["company", 160], ["phone", 40], ["website", 300], ["notes", 8000]]) {
    if (key in body) { if (typeof body[key] !== "string" || body[key].length > max) return { error: `Invalid ${key}` }; value[key] = body[key].trim(); }
  }
  if ("email" in body) {
    if (body.email !== null && body.email !== "" && (typeof body.email !== "string" || !EMAIL.test(body.email.trim()))) return { error: "Invalid email" };
    value.email = body.email ? body.email.trim().toLowerCase() : null;
    if (!("domain" in body)) value.domain = companyDomain(value.email);
  }
  if ("domain" in body) {
    if (body.domain !== null && body.domain !== "" && (typeof body.domain !== "string" || !/^[a-z0-9.-]{3,120}\.[a-z]{2,}$/i.test(body.domain.trim()))) return { error: "Invalid domain" };
    value.domain = body.domain ? body.domain.trim().toLowerCase() : null;
  }
  return { value };
}

// Links unassigned meetings to clients: a guest with the client's e-mail, else a guest from the client's domain.
// Compared on the parsed guest list (exact, case-insensitive): "_" or "%" in an address is never a wildcard.
const GUESTS = "json_array_elements(NULLIF(e.attendees, '')::json)";
async function matchMeetings(db) {
  await db.query(
    `UPDATE calendar_events e SET client_id = c.id FROM clients c
     WHERE e.client_id IS NULL AND c.status <> 'archived' AND c.email IS NOT NULL
       AND EXISTS (SELECT 1 FROM ${GUESTS} g WHERE lower(g->>'email') = c.email)`);
  await db.query(
    `UPDATE calendar_events e SET client_id = c.id FROM clients c
     WHERE e.client_id IS NULL AND c.status <> 'archived' AND c.domain IS NOT NULL
       AND EXISTS (SELECT 1 FROM ${GUESTS} g WHERE split_part(lower(g->>'email'), '@', 2) = c.domain)`);
}

module.exports = { validateClient, companyDomain, matchMeetings, PUBLIC_DOMAINS, STATUSES };
