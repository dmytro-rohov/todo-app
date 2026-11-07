// Booking slots (time zones, DST, notice, buffer, weekdays), the form's validation and the BOOKING_* settings.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { freeSlots, validateBooking, zonedInstant, zonedDay } = require("../booking");
const { loadConfig } = require("../config");

const SETTINGS = { timeZone: "Europe/Warsaw", hours: ["09:00", "11:00"], days: [1, 2, 3, 4, 5], slotMinutes: 30, noticeHours: 0, horizonDays: 60, bufferMinutes: 0 };
const NOW = Date.parse("2026-10-20T00:00:00Z");
const times = day => day.slots.map(s => s.slice(11, 16));

test("working hours follow the time zone across the DST change", () => {
  // Friday 23 October is CEST (UTC+2), Monday 26 October CET (UTC+1)
  const days = freeSlots(SETTINGS, [], { from: "2026-10-23", count: 4, now: NOW });
  assert.deepEqual(days.map(d => d.date), ["2026-10-23", "2026-10-26"]); // the weekend is skipped
  assert.deepEqual(times(days[0]), ["07:00", "07:30", "08:00", "08:30"]);
  assert.deepEqual(times(days[1]), ["08:00", "08:30", "09:00", "09:30"]);
  assert.equal(new Date(zonedInstant("2026-03-29", "09:00", "Europe/Warsaw")).toISOString(), "2026-03-29T07:00:00.000Z");
  assert.equal(zonedDay(Date.parse("2026-10-25T23:30:00Z"), "Europe/Warsaw"), "2026-10-26");
});

test("busy times block overlapping slots with the buffer; the notice and the horizon cut the rest", () => {
  const busy = [{ start: "2026-10-26T08:45:00Z", end: "2026-10-26T09:00:00Z" }]; // 09:45–10:00 local
  assert.deepEqual(times(freeSlots(SETTINGS, busy, { from: "2026-10-26", count: 1, now: NOW })[0]), ["08:00", "09:00", "09:30"]);
  assert.deepEqual(times(freeSlots({ ...SETTINGS, bufferMinutes: 15 }, busy, { from: "2026-10-26", count: 1, now: NOW })[0]), ["08:00", "09:30"]);
  const later = Date.parse("2026-10-25T08:00:00Z");
  assert.deepEqual(times(freeSlots({ ...SETTINGS, noticeHours: 25 }, [], { from: "2026-10-26", count: 1, now: later })[0]), ["09:00", "09:30"]);
  assert.deepEqual(freeSlots({ ...SETTINGS, horizonDays: 1 }, [], { from: "2026-10-26", count: 1, now: NOW }), []);
});

test("the booking form is validated; the honeypot marks spam", () => {
  const good = { start: "2026-10-26T08:00:00Z", name: "Anna Róża", email: "Anna@Kwiaciarnia.PL", consent: true, company: "Kwiaciarnia", phone: "+48 600 100 200", message: "Strona" };
  const { value } = validateBooking(good);
  assert.deepEqual([value.email, value.start], ["anna@kwiaciarnia.pl", "2026-10-26T08:00:00.000Z"]);
  assert.equal(validateBooking({ ...good, website: "http://spam" }).spam, true);
  for (const bad of [{ consent: false }, { email: "nope" }, { name: "A" }, { phone: "call me" }, { start: "soon" }, { message: "x".repeat(2001) }, { admin: true }]) {
    assert.ok(validateBooking({ ...good, ...bad }).error, JSON.stringify(bad));
  }
});

test("BOOKING_* settings: off by default, need the calendar, validated", () => {
  const base = { NODE_ENV: "development", DATABASE_URL: "postgres://x@127.0.0.1/x", AUTH_DISABLED: "true" };
  const calendar = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", TASKS_SECRET_KEY: crypto.randomBytes(32).toString("base64") };
  assert.equal(loadConfig({ ...base, ...calendar }).booking, null);
  assert.throws(() => loadConfig({ ...base, BOOKING_ORIGINS: "https://mytko.dev" }), /needs GOOGLE_CLIENT_ID/);
  const booking = loadConfig({ ...base, ...calendar, BOOKING_ORIGINS: "https://mytko.dev, https://www.mytko.dev", BOOKING_DAYS: "1-3,5" }).booking;
  assert.deepEqual([booking.origins, booking.days, booking.hours, booking.slotMinutes, booking.timeZone, booking.spaceKey],
    [["https://mytko.dev", "https://www.mytko.dev"], [1, 2, 3, 5], ["09:00", "17:00"], 30, "Europe/Warsaw", "work"]);
  for (const [name, value, message] of [["BOOKING_ORIGINS", "http://mytko.dev", /https origin/], ["BOOKING_ORIGINS", "https://mytko.dev/form", /https origin/],
    ["BOOKING_HOURS", "17:00-09:00", /BOOKING_HOURS/], ["BOOKING_DAYS", "0-8", /BOOKING_DAYS/], ["BOOKING_TIME_ZONE", "Mars/Olympus", /IANA/],
    ["BOOKING_SLOT_MINUTES", "5", /between/]]) {
    assert.throws(() => loadConfig({ ...base, ...calendar, BOOKING_ORIGINS: "https://mytko.dev", [name]: value }), message, `${name}=${value}`);
  }
});
