// Shared spaces: who is in one, adding the owner's accounts straight from the list (the owner alone sees it), inviting
// anybody with a one-time code or its link, joining with a code, leaving. Nobody else is shown which accounts exist.
import { api } from "../api/client.js";
import { escapeHtml } from "../utils/helpers.js";
import { icon } from "./icons.js";
import { confirmDialog, dialog } from "./dialogs.js";
import { isMember, paint, reload } from "./app.js";
import { avatarHtml } from "./avatar.js";
import { toast } from "./toast.js";
import { LANG, LOCALE } from "../i18n.js";

// "XXXX-XXXX-XXXX": how a code is shown and read out.
export const formatCode = code => (String(code).match(/.{1,4}/g) || []).join("-");
// The link that opens Tasks (signed in, or after signing in) at "join this space" with the code filled in.
export const joinLink = code => `${globalThis.location?.origin || ""}/#join=${code}`;
const day = iso => new Date(iso).toLocaleDateString(LOCALE, { day: "numeric", month: "long" });
const head = title => `<header class="dialog__head"><h2>${escapeHtml(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Zamknij">${icon("x")}</button></header>`;

// ---- the people of a space --------------------------------------------------------------------------------------
// space: from store.spaces (shared). Its creator takes people out and invites; the owner also ticks their accounts.
// onChange: after people changed or the account left (the data is loaded again first), e.g. to redraw Porządek.
export function openSpacePeople(space, onChange = null) {
  const element = dialog("dialog--manage dialog--people", `<div class="dialog__body" data-people-body>${head(`Osoby w „${space.name}”`)}<p class="muted" role="status">Wczytuję…</p></div>`);
  const body = element.querySelector("[data-people-body]");
  const picker = space.mine && !isMember();
  let people = [];
  let accounts = [];
  let failure = "";

  function personRow(person) {
    // the owner is not an account with a name: "Administrator" (translated, so not in .person__name)
    const name = person.name ?? "Administrator";
    const remove = space.mine && !person.creator
      ? `<button type="button" class="icon-btn" data-person-remove="${person.id === null ? "owner" : person.id}" aria-label="Usuń z przestrzeni: ${escapeHtml(name)}" title="Usuń z przestrzeni">${icon("x", 16)}</button>` : "";
    return `<li class="person">${avatarHtml({ ...person, name }, person.creator ? "avatar--lime" : "")}
      <span class="person__text"><strong${person.name === null ? "" : ' class="person__name"'}>${escapeHtml(name)}</strong><small class="muted">${person.creator ? "zarządza przestrzenią" : "w przestrzeni"}${person.me ? " · to Ty" : ""}</small></span>${remove}</li>`;
  }

  function draw() {
    const inside = new Set(people.filter(person => person.id !== null).map(person => person.id));
    body.innerHTML = `${head(`Osoby w „${space.name}”`)}
      <p class="manage__hint">${space.mine ? "Wspólną przestrzeń widzą i edytują tylko osoby z tej listy. Gdy ktoś odchodzi, jego zadania wracają do jego Prywatnych." : "Ta przestrzeń należy do innego konta. Widzisz i edytujesz ją razem z osobami z tej listy."}</p>
      ${failure ? `<p class="field-error" role="alert">${escapeHtml(failure)}</p>` : ""}
      <ul class="people">${people.map(personRow).join("")}</ul>
      ${picker ? `<section class="people__accounts"><h3>Twoje konta</h3>
        ${accounts.length ? `<div class="people__picks">${accounts.map(user => `<label class="check people__pick${user.disabledAt ? " is-disabled" : ""}">
          <input type="checkbox" data-account="${user.id}"${inside.has(user.id) ? " checked" : ""}${user.disabledAt && !inside.has(user.id) ? " disabled" : ""}>
          ${avatarHtml(user)}<span class="person__name">${escapeHtml(user.name)}</span></label>`).join("")}</div>`
          : '<p class="muted">Nie masz jeszcze innych kont. Dodasz je w Porządek → Konta albo zaprosisz kogoś kodem.</p>'}</section>` : ""}
      <div class="dialog__actions">
        ${space.mine ? `<button type="button" class="btn btn--primary" data-invite>${icon("plus", 18)}Zaproś kodem lub linkiem</button>`
          : '<button type="button" class="btn btn--danger" data-leave>Opuść przestrzeń</button>'}
      </div>`;
  }

  async function load() {
    try {
      [people, accounts] = await Promise.all([api.spaceMembers(space.id), picker ? api.list("users") : []]);
      failure = "";
    } catch (error) {
      failure = error.message;
    }
    draw();
  }
  const changed = async () => { await load(); await reload({ quiet: true }); onChange?.(); };

  element.addEventListener("click", async event => {
    if (event.target.closest("[data-close]")) return element.close();
    if (event.target.closest("[data-invite]")) return openInvite(space);
    if (event.target.closest("[data-leave]")) {
      if (!(await confirmDialog(`Opuścić „${space.name}”? Przestrzeń zniknie z Twojej tablicy, a Twoje zadania z niej wrócą do Twoich Prywatnych.`, "Opuść"))) return;
      try {
        await api.removeSpaceMember(space.id, "me");
        element.close();
        toast(`Opuszczono „${space.name}”.`);
        await reload({ quiet: true });
        return onChange?.();
      } catch (error) { failure = error.message; return draw(); }
    }
    const remove = event.target.closest("[data-person-remove]");
    if (remove) {
      const who = remove.dataset.personRemove;
      const name = people.find(person => String(person.id ?? "owner") === who)?.name ?? "Administrator";
      if (!(await confirmDialog(`Usunąć ${name} z „${space.name}”? Zadania tej osoby z tej przestrzeni wrócą do jej Prywatnych.`, "Usuń"))) return;
      try { await api.removeSpaceMember(space.id, who === "owner" ? null : Number(who)); } catch (error) { failure = error.message; }
      return changed();
    }
  });
  element.addEventListener("change", async event => {
    const box = event.target.closest("[data-account]");
    if (!box) return;
    const id = Number(box.dataset.account);
    box.disabled = true;
    try {
      if (box.checked) await api.addSpaceMember(space.id, id);
      else await api.removeSpaceMember(space.id, id);
    } catch (error) { failure = error.message; }
    return changed();
  });
  load();
}

// ---- inviting with a code ---------------------------------------------------------------------------------------
// A new code for the space: shown once (only its hash is kept), with its link to copy or share; the codes still
// waiting below, each to withdraw (also when no new one can be made, e.g. with 20 waiting).
export function openInvite(space) {
  const element = dialog("dialog--manage dialog--invite", `<div class="dialog__body" data-invite-body>${head(`Zaproszenie do „${space.name}”`)}<p class="muted" role="status">Wczytuję…</p></div>`);
  const body = element.querySelector("[data-invite-body]");
  let invite = null;
  let failure = null;
  let waiting = [];
  const copy = async (text, done) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch {
      toast("Nie udało się skopiować. Zaznacz i skopiuj ręcznie.", { tone: "error" });
    }
  };
  function draw() {
    const fresh = invite ? `<p>Przekaż ten kod albo link jednej osobie. Po wpisaniu kodu (lub otwarciu linku) od razu dołączy do przestrzeni. Kod widzisz tylko teraz.</p>
      <p class="invite-code" aria-label="Kod zaproszenia" translate="no">${escapeHtml(formatCode(invite.code))}</p>
      <p class="muted invite-note">Jednorazowy, ważny do ${escapeHtml(day(invite.expiresAt))}.</p>
      <div class="invite-actions">
        ${navigator.share ? `<button type="button" class="btn btn--primary" data-invite-share>${icon("users", 18)}Udostępnij</button>` : ""}
        <button type="button" class="btn ${navigator.share ? "btn--ghost" : "btn--primary"}" data-invite-copy-link>Kopiuj link</button>
        <button type="button" class="btn btn--ghost" data-invite-copy-code>Kopiuj kod</button>
      </div>
      <input class="invite-link" readonly value="${escapeHtml(joinLink(invite.code))}" aria-label="Link zaproszenia" translate="no">`
      : `<p class="field-error" role="alert">${escapeHtml(failure || "")}</p>`;
    body.innerHTML = `${head(`Zaproszenie do „${space.name}”`)}
      ${fresh}
      ${waiting.length ? `<section class="invite-waiting"><h3>Czekające kody</h3><ul class="people">${waiting.map(item => `<li class="person">
          <span class="person__text"><span>${escapeHtml(`Ważny do ${day(item.expiresAt)}`)}</span>${item.id === invite?.id ? '<small class="muted">ten powyżej</small>' : ""}</span>
          <button type="button" class="icon-btn" data-invite-withdraw="${item.id}" aria-label="Wycofaj kod" title="Wycofaj kod">${icon("x", 16)}</button></li>`).join("")}</ul></section>` : ""}`;
  }
  body.addEventListener("click", async event => {
    if (event.target.closest("[data-close]")) return element.close();
    const link = joinLink(invite?.code || "");
    if (event.target.closest("[data-invite-copy-link]")) return copy(link, "Link skopiowany.");
    if (event.target.closest("[data-invite-copy-code]")) return copy(formatCode(invite.code), "Kod skopiowany.");
    if (event.target.closest("[data-invite-share]")) {
      try {
        const text = LANG === "uk" ? `Приєднуйся до «${space.name}» у Mytko Tasks. Код: ${formatCode(invite.code)}`
          : `Dołącz do „${space.name}” w Mytko Tasks. Kod: ${formatCode(invite.code)}`;
        await navigator.share({ title: `Mytko Tasks: ${space.name}`, text, url: link });
      } catch { /* closed by the person */ }
      return;
    }
    const withdraw = event.target.closest("[data-invite-withdraw]");
    if (withdraw) {
      try {
        const id = Number(withdraw.dataset.inviteWithdraw);
        await api.withdrawInvite(space.id, id);
        if (id === invite?.id) { element.close(); return toast("Kod wycofany."); }
        waiting = await api.spaceInvites(space.id);
        draw();
      } catch (error) { toast(error.message, { tone: "error" }); }
    }
  });
  (async () => {
    try {
      invite = await api.createInvite(space.id);
    } catch (error) {
      failure = error.message; // no new code (e.g. 20 waiting): the waiting ones can still be withdrawn below
    }
    try {
      waiting = await api.spaceInvites(space.id);
    } catch (error) {
      if (!invite) { toast(error.message, { tone: "error" }); return element.close(); }
    }
    draw();
  })();
}

// ---- joining with a code ----------------------------------------------------------------------------------------
// "I have a code": typed (or brought by a link), what it leads to, then joining. onJoined(space) after.
export function openJoin(code = "", onJoined = null) {
  const clean = String(code).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const element = dialog("dialog--manage dialog--join", `<form class="dialog__body" novalidate>
    ${head("Dołącz do wspólnej przestrzeni")}
    <label class="field"><span>Kod zaproszenia</span>
      <input name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20" placeholder="ABCD-EFGH-2345" translate="no" value="${escapeHtml(clean ? formatCode(clean) : "")}"></label>
    <div data-join-preview></div>
    <p class="field-error" data-error role="alert" hidden></p>
    <div class="dialog__actions">
      <button type="button" class="btn btn--ghost" data-close>Anuluj</button>
      <button type="submit" class="btn btn--primary" data-join-submit>Sprawdź kod</button>
    </div>
  </form>`);
  const form = element.querySelector("form");
  const box = form.querySelector("[data-error]");
  const submit = form.querySelector("[data-join-submit]");
  const previewBox = form.querySelector("[data-join-preview]");
  let preview = null;
  const label = text => { submit.textContent = text; };
  element.addEventListener("click", event => { if (event.target.closest("[data-close]")) element.close(); });
  form.elements.code.addEventListener("input", () => { preview = null; previewBox.innerHTML = ""; label("Sprawdź kod"); });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    box.hidden = true;
    if (submit.disabled) return;
    if (preview?.alreadyMember) return element.close();
    submit.disabled = true;
    form.elements.code.readOnly = true; // the code checked is the code shown
    try {
      const typed = form.elements.code.value;
      if (!preview) {
        preview = await api.joinPreview(typed);
        previewBox.innerHTML = preview.alreadyMember
          ? `<p class="muted">Już jesteś w tej przestrzeni.</p>`
          : `<div class="join-space"><i class="dot" data-c="${escapeHtml(preview.color)}"></i><span><strong translate="no">${escapeHtml(preview.name)}</strong>
              <small class="muted">${escapeHtml(`Osób w przestrzeni: ${preview.people}`)}</small></span></div>`;
        paint(previewBox);
        label(preview.alreadyMember ? "Zamknij" : "Dołącz");
      } else {
        const space = await api.joinSpace(typed);
        element.close();
        toast(`Dołączono do „${space.name}”.`);
        await reload({ quiet: true });
        onJoined?.(space);
      }
    } catch (error) {
      box.textContent = error.message;
      box.hidden = false;
    } finally {
      submit.disabled = false;
      form.elements.code.readOnly = false;
    }
  });
  if (clean) form.requestSubmit(); else form.elements.code.focus(); // a broken link: just the field
}

// A link "…/#join=CODE": remembered for this tab (it survives signing in first), then opened once the app is up.
const JOIN_KEY = "mytko-tasks:join";
const JOIN_HASH = /^#join=([A-Za-z0-9-]{4,24})$/;
export function rememberJoinLink(hash = globalThis.location?.hash || "") {
  const match = JOIN_HASH.exec(hash);
  if (!match) return null;
  try {
    sessionStorage.setItem(JOIN_KEY, match[1]);
  } catch {
    return match[1]; // not kept for this tab: the code stays in the address (read again after signing in)
  }
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return match[1];
}
export function takeJoinLink() {
  try {
    const code = sessionStorage.getItem(JOIN_KEY);
    sessionStorage.removeItem(JOIN_KEY);
    if (code) return code;
  } catch { /* the address may still carry it */ }
  const kept = JOIN_HASH.exec(window.location.hash)?.[1] || null;
  if (kept) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return kept;
}
