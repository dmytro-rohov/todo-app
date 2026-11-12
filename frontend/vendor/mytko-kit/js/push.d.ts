// Types of push.js for apps in TypeScript (Mytko Workflow). Kept by hand: test/frontend/push.test.mjs checks that it
// names exactly the functions push.js exports.
export type PushSupport = "ok" | "install" | "denied" | "unsupported";
export interface PushCategory { id: string; default: boolean }
export interface PushInfo { available: boolean; publicKey: string | null; categories: PushCategory[] }
export type PushPrefs = Record<string, boolean>;
export interface PushSubscriptionJson { endpoint: string; keys: { p256dh: string; auth: string } }
/** request(path, { method, body }) → the parsed JSON answer; it throws when the answer is an error. */
export type PushRequest = (path: string, init?: { method?: string; body?: unknown }) => Promise<any>;
export interface PushApi {
  info(): Promise<PushInfo>;
  save(subscription: PushSubscriptionJson, prefs?: PushPrefs | null): Promise<{ prefs: PushPrefs }>;
  remove(endpoint: string): Promise<unknown>;
  test(endpoint: string): Promise<{ sent: number }>;
}
export interface PushBlockState {
  support: PushSupport;
  available: boolean;
  subscribed: boolean;
  categories: PushCategory[];
  prefs: PushPrefs;
}

export function pushSupport(env?: unknown): PushSupport;
export function pushApi(options?: { base?: string; request?: PushRequest }): PushApi;
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer>;
export function subscriptionJson(subscription: PushSubscription): PushSubscriptionJson;
export function effectivePrefs(categories: PushCategory[], prefs?: PushPrefs): PushPrefs;
export function listenForPushOpen(open?: (url: string) => void, env?: unknown): void;
export function pushBlock(): string;
export function pushBlockBody(state: PushBlockState): string;
export function mountPushBlock(element: Element | null, options?: { base?: string; request?: PushRequest; env?: unknown }): Promise<void>;
