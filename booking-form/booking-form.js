// Booking form for mytko.dev (no dependencies). Markup: booking-form.html; the API is Mytko Tasks /api/public/booking
// (data-api on the form). Times are shown in the booking time zone the API reports (Europe/Warsaw).
const form = document.querySelector("[data-booking]");
if (form) init(form);

function init(form) {
  const api = form.dataset.api;
  const daysBox = form.querySelector("[data-days]");
  const slotsBox = form.querySelector("[data-slots]");
  const status = form.querySelector("[data-status]");
  const submit = form.querySelector('[type="submit"]');
  const state = { from: null, days: [], day: null, start: null, timeZone: "Europe/Warsaw", loading: false };
  const say = (text, tone = "") => { status.textContent = text; status.dataset.tone = tone; };
  const fmt = (iso, options) => new Intl.DateTimeFormat("pl-PL", { timeZone: state.timeZone, ...options }).format(new Date(iso));
  const dayLabel = date => fmt(`${date}T12:00:00Z`, { weekday: "short", day: "numeric", month: "short" });
  const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

  async function load(from) {
    state.loading = true;
    say("Ładuję wolne terminy…");
    try {
      const res = await fetch(`${api}?days=14${from ? `&from=${from}` : ""}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      Object.assign(state, { timeZone: data.timeZone, days: data.days, from: from || null });
      state.day = data.days[0]?.date || null;
      state.start = null;
      say(data.days.length ? "" : "Brak wolnych terminów w tych dwóch tygodniach. Sprawdź kolejne.");
    } catch {
      say("Nie udało się pobrać terminów. Napisz do nas: hello@mytko.dev", "error");
    }
    state.loading = false;
    draw();
  }

  function draw() {
    daysBox.replaceChildren(...state.days.map(day => button(dayLabel(day.date), day.date === state.day, () => { state.day = day.date; state.start = null; draw(); }, "day")));
    const day = state.days.find(d => d.date === state.day);
    slotsBox.replaceChildren(...(day ? day.slots : []).map(start =>
      button(fmt(start, { hour: "2-digit", minute: "2-digit" }), start === state.start, () => { state.start = start; draw(); }, "slot")));
    submit.disabled = !state.start;
    form.querySelector("[data-picked]").textContent = state.start
      ? `Wybrany termin: ${fmt(state.start, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} (czas polski)` : "";
  }

  function button(label, active, onClick, kind) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `mb-${kind}${active ? " is-active" : ""}`;
    b.textContent = label;
    b.setAttribute("aria-pressed", String(active));
    b.addEventListener("click", onClick);
    return b;
  }

  form.querySelector("[data-next]").addEventListener("click", () => {
    const last = state.days.at(-1)?.date || state.from || new Date().toISOString().slice(0, 10);
    load(addDays(last, 1));
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!state.start || state.loading || !form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    submit.disabled = true;
    say("Rezerwuję…");
    try {
      const res = await fetch(api, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ start: state.start, name: data.name, email: data.email, company: data.company, phone: data.phone,
          message: data.message, website: data.website, consent: data.consent === "on" }) });
      const body = await res.json().catch(() => ({}));
      if (res.status === 201) {
        form.replaceChildren(Object.assign(document.createElement("p"), { className: "mb-done",
          textContent: `Dziękujemy! Spotkanie ${fmt(state.start, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} jest zarezerwowane. Zaproszenie z linkiem do Google Meet przyjdzie na Twój e-mail.` }));
        return;
      }
      const messages = { 409: body.message?.includes("already") ? "Masz już zarezerwowane spotkania. Napisz do nas, jeśli chcesz coś zmienić." : "Ten termin właśnie się zajął. Wybierz inny.",
        429: "Za dużo prób. Spróbuj później albo napisz do nas.", 400: "Sprawdź pola formularza i zgodę." };
      say(messages[res.status] || "Nie udało się zarezerwować. Napisz do nas: hello@mytko.dev", "error");
      if (res.status === 409) await load(state.from);
    } catch {
      say("Brak połączenia. Spróbuj ponownie.", "error");
    }
    submit.disabled = !state.start;
  });

  load(null);
}
