# Booking form on mytko.dev

Visitors book a call through Mytko's own form (no Calendly / Cal.com). The form calls the public Tasks API; Tasks
reads free time from the Praca Google Calendar and books into it.

## What a booking does

1. Checks again, live, that the slot is still free (Google free/busy of the booking space + timed events of the other
   connected calendars, e.g. the private one; all-day events there do not block).
2. Creates the Google event `Rozmowa: <name> (<company>)` with a Google Meet link and the visitor as guest. Google
   sends the invitation e-mail from hello@mytko.dev.
3. Finds the client by e-mail or creates a **lead** (`source: booking`) in Klienci and links the meeting to it.
4. Adds a P1 task `Przygotować się do rozmowy: <name>` in Praca → ToDo, due on the meeting day, linked to the client
   and the meeting. Its history shows `booking` as the actor.

## API

| Call | Purpose |
| --- | --- |
| `GET /api/public/booking?from=YYYY-MM-DD&days=7` | `{ timeZone, slotMinutes, days: [{ date, slots: [ISO start] }] }` (max 14 days, cached 60 s) |
| `POST /api/public/booking` | body `{ start, name, email, company?, phone?, message?, consent: true, website: "" }` → `201 { status, start, end, meetUrl }` |

Errors: `400` invalid form, `403` origin not allowed, `409` slot taken / the e-mail already has two upcoming
meetings, `429` too many bookings, `503` booking not available (no calendar connected, Google unreachable).

Protection: CORS only for `BOOKING_ORIGINS`; a hidden honeypot field (`website`) — filled in, the API answers like a
success and books nothing; per-IP limit per hour; a daily cap; at most two upcoming meetings per e-mail; the slot is
re-checked with Google before booking.

## Settings (Tasks environment)

| Variable | Default | Meaning |
| --- | --- | --- |
| `BOOKING_ORIGINS` | — (off) | Sites allowed to call the API, e.g. `https://mytko.dev,https://www.mytko.dev`. Needs the Google settings. |
| `BOOKING_SPACE` | `work` | Space whose calendar is booked (Praca). |
| `BOOKING_TIME_ZONE` | `Europe/Warsaw` | Working hours are in this zone. |
| `BOOKING_HOURS` | `09:00-17:00` | Working hours. |
| `BOOKING_DAYS` | `1-5` | Weekdays, 1 = Monday … 7 = Sunday (`1-3,5`). |
| `BOOKING_SLOT_MINUTES` | `30` | Meeting length (15–240). |
| `BOOKING_BUFFER_MINUTES` | `15` | Free time kept around other meetings. |
| `BOOKING_NOTICE_HOURS` | `24` | Earliest booking from now. |
| `BOOKING_HORIZON_DAYS` | `28` | Latest booking from now. |
| `BOOKING_IP_HOURLY_MAX` | `5` | Bookings per IP per hour. |
| `BOOKING_DAILY_MAX` | `20` | Bookings per day in total. |

## The form

`booking-form/` holds a ready form (`booking-form.html`, `.css`, `.js`, no dependencies, Mytko's palette). For
mytko.dev copy the markup into the page (Astro component), load `booking-form.js` as a module and keep the `data-*`
hooks; set `data-api="https://tasks.mytko.dev/api/public/booking"`. If the site has a CSP, add
`connect-src https://tasks.mytko.dev`.

Tests: `backend/test/booking.test.js` (slots, DST, validation, settings), the booking case in
`calendar.integration.test.js`, and `CALENDAR=1 TEST=e2e/ui-booking.mjs e2e/ui-run.sh …` (the form served from another
origin books through a real browser).
