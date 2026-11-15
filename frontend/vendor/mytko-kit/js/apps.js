// The Mytko apps a person can jump between (0.9.0): each its own address and sign-in; "Zaloguj kontem Mytko" signs in
// at once where it is set up. Only apps that are live are listed (a new one is added here when it goes live).
// No imports: an app in TypeScript (Mytko Workflow) takes this list alone (apps.d.ts).
export const MYTKO_APPS = Object.freeze([
  Object.freeze({ id: "workflow", name: "Mytko Workflow", short: "Workflow", url: "https://workflow.mytko.dev/", icon: "board" }),
  Object.freeze({ id: "tasks", name: "Mytko Tasks", short: "Tasks", url: "https://tasks.mytko.dev/", icon: "checkSquare" }),
  Object.freeze({ id: "finance", name: "Mytko Finance", short: "Finance", url: "https://finance.mytko.dev/", icon: "wallet" }),
  Object.freeze({ id: "fitness", name: "Mytko Fitness", short: "Fitness", url: "https://fitness.mytko.dev/", icon: "dumbbell" })
]);

// The other apps for the app with this id (its own left out); only https addresses.
export function otherApps(current, apps = MYTKO_APPS) {
  return apps.filter(app => app.id !== current && typeof app.url === "string" && app.url.startsWith("https://"));
}
