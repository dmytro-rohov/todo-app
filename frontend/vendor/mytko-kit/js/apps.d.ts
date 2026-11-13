// Types of apps.js for apps in TypeScript (Mytko Workflow). Icon names are the kit's (icons.d.ts KitIconName).
import type { KitIconName } from "./icons.js";

export interface MytkoApp { readonly id: string; readonly name: string; readonly short: string; readonly url: string; readonly icon: KitIconName }
export const MYTKO_APPS: readonly MytkoApp[];
export function otherApps(current: string, apps?: readonly MytkoApp[]): MytkoApp[];
