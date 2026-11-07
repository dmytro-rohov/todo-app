// Booking for the own form on mytko.dev (routes/booking.js): free slots within working hours in the booking time zone,
// minus busy times (with a buffer around them), the minimum notice and the horizon; and the form's validation.
const DAY_MS = 86400000;
const EMAIL = /^[^\s@<>()",;]{1,64}@[^\s@<>()",;]{1,190}\.[A-Za-z]{2,}$/;
const PHONE = /^[0-9 +()./-]{0,40}$/;

// Milliseconds the time zone is ahead of UTC at an instant.
function offsetMs(instant, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(instant)).map(p => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(instant / 1000) * 1000;
}

// The instant of a wall-clock time ("YYYY-MM-DD", "HH:MM") in a time zone; correct across DST changes.
function zonedInstant(day, time, timeZone) {
  const [y, m, d] = day.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  const first = wall - offsetMs(wall, timeZone);
  return wall - offsetMs(first, timeZone);
}

// "YYYY-MM-DD" of an instant in a time zone.
function zonedDay(instant, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
}

const addDay = (day, count) => new Date(Date.parse(`${day}T12:00:00Z`) + count * DAY_MS).toISOString().slice(0, 10);
const weekday = day => new Date(`${day}T12:00:00Z`).getUTCDay() || 7; // 1 = Monday … 7 = Sunday

// settings: { timeZone, hours: ["09:00", "17:00"], days: [1..7], slotMinutes, noticeHours, horizonDays, bufferMinutes }
// busy: [{ start, end }] as ISO strings. Returns [{ date, slots: [ISO start, …] }] for `count` days from `from`.
function freeSlots(settings, busy, { from, count, now = Date.now() }) {
  const slotMs = settings.slotMinutes * 60000;
  const buffer = settings.bufferMinutes * 60000;
  const earliest = now + settings.noticeHours * 3600000;
  const latest = now + settings.horizonDays * DAY_MS;
  const blocked = busy.map(b => [Date.parse(b.start) - buffer, Date.parse(b.end) + buffer]).filter(([a, b]) => a < b);
  const days = [];
  for (let i = 0; i < count; i++) {
    const date = addDay(from, i);
    if (!settings.days.includes(weekday(date))) continue;
    const open = zonedInstant(date, settings.hours[0], settings.timeZone);
    const close = zonedInstant(date, settings.hours[1], settings.timeZone);
    const slots = [];
    for (let start = open; start + slotMs <= close; start += slotMs) {
      if (start < earliest || start > latest) continue;
      if (blocked.some(([a, b]) => a < start + slotMs && b > start)) continue;
      slots.push(new Date(start).toISOString());
    }
    if (slots.length) days.push({ date, slots });
  }
  return days;
}

// The form's body. Returns { spam: true } for a filled honeypot, { error } or { value }.
function validateBooking(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Invalid request body" };
  const allowed = ["start", "name", "email", "company", "phone", "message", "consent", "website"];
  if (Object.keys(body).some(key => !allowed.includes(key))) return { error: "Unknown fields" };
  // "website" is hidden from people by the form; only bots fill it in.
  if (typeof body.website === "string" && body.website.trim()) return { spam: true };
  const text = (key, max) => (body[key] === undefined || body[key] === null ? "" : typeof body[key] === "string" && body[key].length <= max ? body[key].trim() : null);
  const value = { name: text("name", 120), email: text("email", 254), company: text("company", 160), phone: text("phone", 40), message: text("message", 2000) };
  if (Object.values(value).includes(null)) return { error: "Invalid field" };
  if (value.name.length < 2) return { error: "Name is required" };
  if (!EMAIL.test(value.email)) return { error: "Invalid email" };
  value.email = value.email.toLowerCase();
  if (!PHONE.test(value.phone)) return { error: "Invalid phone" };
  if (body.consent !== true) return { error: "Consent is required" };
  const start = typeof body.start === "string" ? Date.parse(body.start) : NaN;
  if (!Number.isFinite(start)) return { error: "Invalid start" };
  value.start = new Date(start).toISOString();
  return { value };
}

module.exports = { freeSlots, validateBooking, zonedInstant, zonedDay, offsetMs, addDay, DAY_MS };
