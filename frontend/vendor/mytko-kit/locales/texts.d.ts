// Types of texts.js for apps in TypeScript (Mytko Workflow takes the kit's Polish words, e.g. push.*). A plural value
// is an object keyed by Intl.PluralRules categories.
export type KitText = string | Record<string, string>;
export const uk: Record<string, KitText>;
export const pl: Record<string, KitText>;
