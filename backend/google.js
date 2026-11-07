// Minimal Google client for calendars: OAuth 2.0 (authorization code, offline access) and Calendar API v3,
// with plain fetch. Base URLs are injectable for tests. Nothing here logs tokens or event contents.
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"];
const TIMEOUT_MS = 10000;

class GoogleError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

function createGoogle({ clientId, clientSecret, redirectUri, fetchImpl = fetch,
  authBase = "https://accounts.google.com", tokenUrl = "https://oauth2.googleapis.com/token",
  apiBase = "https://www.googleapis.com/calendar/v3" }) {
  const accessCache = new Map(); // refresh token digest -> { token, until }

  async function call(url, init = {}) {
    const response = await fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
    if (!response.ok) throw new GoogleError(data?.error?.message || data?.error_description || data?.error || `Google ${response.status}`, response.status);
    return data;
  }

  function form(params) {
    return { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() };
  }

  return {
    authUrl(state, challenge) {
      const query = new URLSearchParams({
        client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: SCOPES.join(" "), state,
        access_type: "offline", prompt: "consent", include_granted_scopes: "true",
        code_challenge: challenge, code_challenge_method: "S256"
      });
      return `${authBase}/o/oauth2/v2/auth?${query}`;
    },

    // Returns { refreshToken, email }. The id_token comes straight from Google's token endpoint over TLS,
    // so its payload is read without a signature check (it only names the connected account).
    async exchangeCode(code, verifier) {
      const data = await call(tokenUrl, form({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri,
        grant_type: "authorization_code", code_verifier: verifier }));
      if (!data?.refresh_token) throw new GoogleError("Google did not return a refresh token", 400);
      let email = "";
      try { email = JSON.parse(Buffer.from(String(data.id_token).split(".")[1], "base64url").toString("utf8")).email || ""; } catch { /* keep empty */ }
      return { refreshToken: data.refresh_token, email };
    },

    async accessToken(refreshToken) {
      const key = require("node:crypto").createHash("sha256").update(refreshToken).digest("hex");
      const cached = accessCache.get(key);
      if (cached && cached.until > Date.now()) return cached.token;
      const data = await call(tokenUrl, form({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" }));
      accessCache.set(key, { token: data.access_token, until: Date.now() + Math.max(0, (data.expires_in || 3600) - 120) * 1000 });
      return data.access_token;
    },

    async listEvents(token, calendarId, timeMin, timeMax) {
      const events = [];
      let pageToken = "";
      do {
        const query = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "2500", showDeleted: "false" });
        if (pageToken) query.set("pageToken", pageToken);
        const data = await call(`${apiBase}/calendars/${encodeURIComponent(calendarId)}/events?${query}`, { headers: { authorization: `Bearer ${token}` } });
        events.push(...(data.items || []));
        pageToken = data.nextPageToken || "";
      } while (pageToken && events.length < 10000);
      return events;
    },

    // sendUpdates=all: guests get Google's own invitation / update / cancellation e-mails.
    async insertEvent(token, calendarId, event, { meet = false } = {}) {
      const body = meet ? { ...event, conferenceData: { createRequest: { requestId: require("node:crypto").randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } } : event;
      return call(`${apiBase}/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`,
        { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    },

    async patchEvent(token, calendarId, eventId, patch, { meet = false } = {}) {
      const body = meet ? { ...patch, conferenceData: { createRequest: { requestId: require("node:crypto").randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } } : patch;
      return call(`${apiBase}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?conferenceDataVersion=1&sendUpdates=all`,
        { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    },

    async deleteEvent(token, calendarId, eventId) {
      const response = await fetchImpl(`${apiBase}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
        { method: "DELETE", headers: { authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok && response.status !== 404 && response.status !== 410) throw new GoogleError(`Google ${response.status}`, response.status);
    },

    // An invitation received by e-mail (Poczta): a copy with the organizer's iCalUID, without notifying anyone.
    async importEvent(token, calendarId, event) {
      return call(`${apiBase}/calendars/${encodeURIComponent(calendarId)}/events/import`,
        { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(event) });
    },

    // Busy intervals of the calendars, for the booking page (C3).
    async freeBusy(token, calendarIds, timeMin, timeMax) {
      const data = await call(`${apiBase}/freeBusy`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ timeMin, timeMax, items: calendarIds.map(id => ({ id })) }) });
      return Object.values(data.calendars || {}).flatMap(c => c.busy || []);
    }
  };
}

module.exports = { createGoogle, GoogleError, SCOPES };
