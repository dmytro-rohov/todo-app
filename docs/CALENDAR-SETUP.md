# Connecting Google Calendars to Mytko Tasks

Each space (Praca, Prywatne, your own) can have its own Google Calendar. Tasks shows its meetings next to the tasks
(month, week, agenda on phones), counts today's meetings in the bell, and creates or edits meetings (with a Google
Meet link and guests, who get Google's invitation e-mails).

## Once: an OAuth client in Google Cloud (about 10 minutes)

1. https://console.cloud.google.com → create a project, e.g. "Mytko Tasks".
2. *APIs & Services → Library*: enable **Google Calendar API**.
3. *APIs & Services → OAuth consent screen* (Google Auth Platform):
   - user type **External** (or **Internal** if both accounts are in one Google Workspace);
   - app name "Mytko Tasks", support e-mail, the `mytko.dev` domain;
   - scopes: `…/auth/calendar.events`, `…/auth/calendar.readonly`, `openid`, `email`;
   - **Publish the app ("In production")**. In "Testing", Google's refresh tokens expire after 7 days and the
     calendars would disconnect every week. Unverified is fine for your own accounts: Google shows a warning screen
     once ("Google hasn't verified this app" → Advanced → continue).
4. *Credentials → Create credentials → OAuth client ID*: type **Web application**, authorised redirect URI
   `https://tasks.mytko.dev/auth/google/callback`. Copy the client ID and secret.

## Once: the server (mary-vps, `deploy/app.env`)

```
GOOGLE_CLIENT_ID=<client id>
GOOGLE_CLIENT_SECRET=<client secret>
TASKS_SECRET_KEY=<openssl rand -base64 32>
```

For the booking form on mytko.dev also `BOOKING_ORIGINS=https://mytko.dev,https://www.mytko.dev` (more settings in
[BOOKING.md](BOOKING.md)).

Check with `node check-env.cjs app.env migrate.env`, then recreate the `app` container (or release as usual).

## Each space: connect

Tasks → *Porządek → Przestrzenie* → **Podłącz Kalendarz Google** next to the space → choose the Google account
(Praca: the account of hello@mytko.dev; Prywatne: your private Google account) → allow. Back in Tasks the space shows
the account and the last sync. "Zmień konto" switches accounts, × disconnects (events stay in Google).
