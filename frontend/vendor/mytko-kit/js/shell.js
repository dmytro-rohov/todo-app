// The app shell shared by the Mytko apps (Finance is the reference, Mytko Workflow draws the same): the sidebar on
// computers (brand, the views, the profile view and the account at the foot, collapsible to a rail of icons), the tab
// bar on phones, page heads and "soon" cards. Only markup: the app keeps its views, its state and its click handling
// (data-view="<name>", data-collapse, data-logout, data-add, data-more).
//
// A view is { icon: "<kit icon name>", label: "<text key>" } (more fields are the app's own).
import { escapeHtml, initials } from "./helpers.js";
import { t } from "./i18n.js";
import { icon } from "./icons.js";
import { appInfo } from "./config.js";
import { dialog, dialogHead } from "./dialogs.js";

const LOGO = "./icons/icon-192.png";

// A view's title row: its icon tile, the name and a lead line; actions: buttons on the right (raw HTML).
export function pageHead(view, lead, actions = "") {
  return `<header class="page-head">
    <div class="page-head__title"><span class="page-head__icon">${icon(view.icon, 26)}</span><div>
      <h1>${escapeHtml(t(view.label))}</h1><p>${escapeHtml(lead)}</p></div></div>
    ${actions ? `<div class="page-head__actions">${actions}</div>` : ""}
  </header>`;
}

// A view that arrives in a later stage: "page.<name>.lead" and "page.<name>.soon" are the app's texts, view.stage the
// plan's stage.
export function renderSoon(name, view) {
  return `${pageHead(view, t(`page.${name}.lead`))}
    <section class="soon">
      <span class="soon__icon">${icon(view.icon, 30)}</span>
      <div class="soon__text">
        <p class="soon__title">${escapeHtml(t("soon.title"))} <span class="chip chip--stage">${escapeHtml(t("soon.stage", { stage: view.stage }))}</span></p>
        <p>${escapeHtml(t(`page.${name}.soon`))}</p>
      </div>
    </section>`;
}

export function navItem(name, view, active) {
  const on = name === active;
  return `<button type="button" class="nav-item${on ? " is-active" : ""}" data-view="${name}"${on ? ' aria-current="page"' : ""} title="${escapeHtml(t(view.label))}">
    ${icon(view.icon)}<span>${escapeHtml(t(view.label))}</span></button>`;
}

// The account's round badge: its initials (an app with photos passes its own avatar HTML to sidebar()).
export function initialsAvatar(user, className = "avatar--lime") {
  return `<span class="avatar${className ? ` ${className}` : ""}">${escapeHtml(initials(user.name))}</span>`;
}

// views: [[name, view], …] in the main list; foot: [name, view] above the account (the settings / profile view).
// avatar: HTML of the account's badge (default: initials on lime).
export function sidebar({ views, foot, active, collapsed = false, user, avatar = null }) {
  const app = appInfo();
  return `<aside class="sidebar" aria-label="${escapeHtml(t("nav.main"))}">
    <div class="sidebar__brand">
      <img src="${LOGO}" alt="" width="44" height="44">
      <span><strong>Mytko</strong><small>${escapeHtml(app.short)}</small></span>
      <button type="button" class="icon-btn sidebar__collapse" data-collapse aria-label="${escapeHtml(t(collapsed ? "nav.expand" : "nav.collapse"))}"
        aria-pressed="${collapsed}">${icon("sidebar")}</button>
    </div>
    <nav class="sidebar__nav">${views.map(([name, view]) => navItem(name, view, active)).join("")}</nav>
    <div class="sidebar__foot">
      ${foot ? navItem(foot[0], foot[1], active) : ""}
      <div class="profile">
        ${avatar ?? initialsAvatar(user)}
        <span class="profile__text"><strong>${escapeHtml(user.name)}</strong><small>${escapeHtml(t(`role.${user.role}`))}</small></span>
        <button type="button" class="icon-btn" data-logout aria-label="${escapeHtml(t("nav.logout"))}" title="${escapeHtml(t("nav.logout"))}">${icon("logout")}</button>
      </div>
    </div>
  </aside>`;
}

export function tabItem(name, view, active, iconSize = 24) {
  const on = name === active;
  return `<button type="button" class="tabbar__item${on ? " is-active" : ""}" data-view="${name}"${on ? ' aria-current="page"' : ""}>
      ${icon(view.icon, iconSize)}<span>${escapeHtml(t(view.label))}</span></button>`;
}

// The phone tab bar: items [[name, view], …]. add: { label, after } puts the big "+" (data-add) after that many items;
// more: { active } ends the bar with "more" (data-more; openMore() shows the rest).
export function tabBar({ items, active, iconSize = 24, add = null, more = null }) {
  const tabs = items.map(([name, view]) => tabItem(name, view, active, iconSize));
  if (add) tabs.splice(add.after, 0, `<button type="button" class="tabbar__add" data-add aria-label="${escapeHtml(add.label)}">${icon("plus", 28)}</button>`);
  if (more) tabs.push(`<button type="button" class="tabbar__item${more.active ? " is-active" : ""}" data-more aria-haspopup="dialog">${icon("more", iconSize)}<span>${escapeHtml(t("nav.more"))}</span></button>`);
  return `<nav class="tabbar" aria-label="${escapeHtml(t("nav.main"))}">${tabs.join("")}</nav>`;
}

// The phone's "more" sheet: the views that do not fit the tab bar, then signing out.
export function openMore({ views, active, onPick, onLogout }) {
  const element = dialog("dialog--sheet", `<div class="dialog__body">
    ${dialogHead(t("nav.more"))}
    <nav class="sheet-nav" aria-label="${escapeHtml(t("nav.more"))}">
      ${views.map(([name, view]) => `<button type="button" class="nav-item${name === active ? " is-active" : ""}" data-view="${name}"${name === active ? ' aria-current="page"' : ""}>
        ${icon(view.icon)}<span>${escapeHtml(t(view.label))}</span></button>`).join("")}
      <button type="button" class="nav-item nav-item--danger" data-logout>${icon("logout")}<span>${escapeHtml(t("nav.logout"))}</span></button>
    </nav>
  </div>`);
  element.addEventListener("click", event => {
    const view = event.target.closest("[data-view]")?.dataset.view;
    if (view) { element.close(); onPick(view); }
    if (event.target.closest("[data-logout]")) { element.close(); onLogout(); }
  });
  return element;
}
