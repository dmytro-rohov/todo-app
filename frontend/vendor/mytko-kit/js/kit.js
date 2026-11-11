// Mytko Kit, frontend: one call sets the kit up for an app, made by the app's js/i18n.js before anything is drawn:
//
//   import { setupKit } from "../vendor/mytko-kit/js/kit.js";
//   import uk from "./locales/uk.js";
//   import pl from "./locales/pl.js";
//   setupKit({ id: "finance", name: "Mytko Finance", features: [...], locales: { uk, pl }, messages: { ... } });
//   export * from "../vendor/mytko-kit/js/i18n.js";
//
// Kit modules never import app code; the app imports them (../vendor/mytko-kit/js/<module>.js) and passes what they
// need (views, the account, callbacks).
import { configureApp } from "./config.js";
import { useTranslations } from "./i18n.js";
import { addMessages } from "./http.js";

export const KIT_VERSION = "0.3.0";

// id, name, short, features, contact: config.js configureApp. locales: { uk, pl } (the app's texts). messages: the
// app's server messages -> text keys (http.js addMessages).
export function setupKit({ locales = {}, messages = {}, ...app }) {
  const info = configureApp(app);
  useTranslations(locales);
  addMessages(messages);
  return info;
}
