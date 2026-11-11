// Which app the kit runs in: its id ("finance": storage keys "mytko-finance:…", cookies on the server), its name
// ("Mytko Finance": the {app} placeholder of every text) and short name ("Finance": the brand next to the logo, the
// {appShort} placeholder), and the login screen's three features. Set once by the app (js/i18n.js → setupKit) before
// anything is drawn; until then the kit runs as a neutral "Mytko" app (unit tests of single modules).
const APP_ID = /^[a-z][a-z0-9-]{1,31}$/;
let current = Object.freeze({ id: "app", name: "Mytko", short: "", features: [], contact: null });

// features: [{ icon: "<kit icon name>", key: "hero.f1" }, …] — each key has .title and .text in the app's texts.
// contact: an e-mail address the login screen's help offers to people without an account (optional).
export function configureApp({ id, name, short, features = [], contact = null }) {
  if (typeof id !== "string" || !APP_ID.test(id) || typeof name !== "string" || !name) throw new Error("configureApp needs { id, name }");
  current = Object.freeze({ id, name, short: short ?? name.replace(/^Mytko\s+/, ""), features: Object.freeze([...features]), contact });
  return current;
}

export function appInfo() {
  return current;
}

// A key in localStorage / sessionStorage of this app: "mytko-<id>:<name>" (lang, ui-scale, welcome, prefs, …).
export function storageKey(name) {
  return `mytko-${current.id}:${name}`;
}
