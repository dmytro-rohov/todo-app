// The first VEVENT of a calendar invitation (text/calendar in an e-mail), enough to show it and add it to Google
// Calendar: title, start/end (UTC ISO, or dates for all-day events), place, organizer, Meet/Teams/Zoom link, method.
const { zonedInstant } = require("./booking");

// Outlook names for the time zones our clients use; anything unknown is read as Europe/Warsaw.
const WINDOWS_ZONES = { "Central European Standard Time": "Europe/Warsaw", "W. Europe Standard Time": "Europe/Berlin",
  "GMT Standard Time": "Europe/London", "Romance Standard Time": "Europe/Paris", "FLE Standard Time": "Europe/Kyiv",
  "Eastern Standard Time": "America/New_York", "Pacific Standard Time": "America/Los_Angeles", "UTC": "UTC" };
const LINK = /https:\/\/(?:meet\.google\.com|teams\.microsoft\.com|[a-z0-9-]+\.zoom\.us)\/[^\s"<>\\]+/i;

function zoneOf(tzid) {
  if (!tzid) return "Europe/Warsaw";
  const name = tzid.replace(/^"|"$/g, "");
  if (WINDOWS_ZONES[name]) return WINDOWS_ZONES[name];
  try { new Intl.DateTimeFormat("en-US", { timeZone: name }); return name; } catch { return "Europe/Warsaw"; }
}

const unescape = value => value.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

// "20261112T100000Z" | "20261112T100000" (+TZID) | "20261112" (VALUE=DATE)
function toTime(value, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value || "");
  if (!m) return null;
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4]) return { date: day };
  if (m[7]) return { dateTime: new Date(`${day}T${m[4]}:${m[5]}:${m[6]}Z`).toISOString() };
  return { dateTime: new Date(zonedInstant(day, `${m[4]}:${m[5]}`, zoneOf(params.TZID))).toISOString() };
}

function parseInvite(text) {
  if (!text || !/BEGIN:VEVENT/i.test(text)) return null;
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const method = (lines.find(line => /^METHOD:/i.test(line)) || "").split(":")[1]?.trim().toUpperCase() || "REQUEST";
  const event = {};
  let inside = false;
  for (const line of lines) {
    if (/^BEGIN:VEVENT/i.test(line)) { inside = true; continue; }
    if (/^END:VEVENT/i.test(line)) break;
    if (!inside) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const [name, ...rest] = line.slice(0, colon).split(";");
    const params = Object.fromEntries(rest.map(p => p.split("=")).map(([k, v]) => [k.toUpperCase(), v]));
    const key = name.toUpperCase();
    const value = line.slice(colon + 1);
    if (key === "ATTENDEE") (event.attendees ||= []).push(value.replace(/^mailto:/i, "").toLowerCase());
    else if (!(key in event)) event[key] = { value, params };
  }
  const start = toTime(event.DTSTART?.value, event.DTSTART?.params || {});
  if (!start) return null;
  let end = toTime(event.DTEND?.value, event.DTEND?.params || {});
  if (!end) end = start.date ? { date: start.date } : { dateTime: new Date(Date.parse(start.dateTime) + 3600000).toISOString() };
  const description = unescape(event.DESCRIPTION?.value || "");
  const location = unescape(event.LOCATION?.value || "");
  return {
    method,
    uid: (event.UID?.value || "").slice(0, 300),
    title: unescape(event.SUMMARY?.value || "(bez tytułu)").slice(0, 500),
    start, end,
    location: location.slice(0, 500),
    description: description.slice(0, 8000),
    organizer: (event.ORGANIZER?.value || "").replace(/^mailto:/i, "").toLowerCase().slice(0, 254),
    attendees: (event.attendees || []).slice(0, 50),
    link: (`${location} ${description} ${event.URL?.value || ""} ${event["X-GOOGLE-CONFERENCE"]?.value || ""}`.match(LINK) || [null])[0]
  };
}

module.exports = { parseInvite };
