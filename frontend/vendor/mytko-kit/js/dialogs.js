// Modal dialogs on the native <dialog> (bottom sheets on phones): the shared helper, confirmations and the helpers of
// the forms inside them.
import { escapeHtml } from "./helpers.js";
import { t } from "./i18n.js";
import { icon } from "./icons.js";
import { paint } from "./paint.js";

let titleCount = 0;
export function dialog(className, html) {
  const element = document.createElement("dialog");
  element.className = `dialog ${className}`;
  element.innerHTML = html;
  // the title (dialogHead) is the dialog's accessible name
  const title = element.querySelector(".dialog__head h2");
  if (title && !element.hasAttribute("aria-labelledby")) {
    title.id = `dialog-title-${++titleCount}`;
    element.setAttribute("aria-labelledby", title.id);
  }
  document.body.append(element);
  element.addEventListener("close", () => element.remove());
  // The backdrop closes the dialog only when the press started there too: selecting text in a field and letting go
  // outside the dialog must not throw the typed data away.
  let pressedBackdrop = false;
  element.addEventListener("pointerdown", event => { pressedBackdrop = event.target === element; });
  element.addEventListener("click", event => {
    if ((event.target === element && pressedBackdrop) || event.target.closest("[data-close]")) element.close();
    pressedBackdrop = false;
  });
  paint(element);
  element.showModal();
  return element;
}

// Resolves true when confirmed; the cancel button has the focus, so Enter never confirms by accident. The question is
// the dialog's accessible name.
let confirmCount = 0;
export function confirmDialog(message, confirmLabel) {
  return new Promise(resolve => {
    const id = `confirm-${++confirmCount}`;
    const element = dialog("dialog--confirm", `<form method="dialog" class="dialog__body">
        <p class="dialog__message" id="${id}">${escapeHtml(message)}</p>
        <div class="dialog__actions">
          <button type="submit" value="cancel" class="btn btn--ghost">${escapeHtml(t("common.cancel"))}</button>
          <button type="submit" value="ok" class="btn btn--danger">${escapeHtml(confirmLabel)}</button>
        </div>
      </form>`);
    element.setAttribute("aria-labelledby", id);
    element.querySelector('[value="cancel"]').focus();
    // decided by the button pressed (the submit comes at once; a hidden page may hold the "close" event back), or by
    // closing the dialog any other way (Escape, the backdrop): not confirmed
    let settled = false;
    const settle = value => { if (!settled) { settled = true; resolve(value); } };
    element.querySelector("form").addEventListener("submit", event => settle(event.submitter?.value === "ok"));
    element.addEventListener("close", () => settle(element.returnValue === "ok"));
  });
}

// A dialog's title row with the close button.
export const dialogHead = title => `<header class="dialog__head"><h2>${escapeHtml(title)}</h2>
  <button type="button" class="icon-btn" data-close aria-label="${escapeHtml(t("common.close"))}">${icon("x")}</button></header>`;

// Runs one request for a form at a time: the submit button stays disabled until it ends (no double submit).
export async function busy(form, run) {
  const submit = form.querySelector("[type=submit]");
  if (submit.disabled) return;
  submit.disabled = true;
  try { await run(); } finally { submit.disabled = false; }
}

// The form's error box ([data-error]).
export function formError(form) {
  const box = form.querySelector("[data-error]");
  return {
    show(message) { box.textContent = message; box.hidden = false; },
    hide() { box.hidden = true; }
  };
}
