import { createContext } from 'react';
import type { Context } from 'react';

/**
 * Makes a React context that keeps ONE identity across every copy of the module that declares it.
 * Used by every module that makes a context (the providers in `src/shared/context/` and each feature's
 * `context/` folder, plus the compound UI kits in `src/shared/ui/`); a bare `createContext` is refused by
 * the `stable-context/no-bare-create-context` lint rule.
 *
 * WHY. In dev, Vite stamps a module with a fresh `?t=` whenever anything in its import graph changes, and a
 * hot update then loads that module a second time next to the first. A context created at module level is
 * then two objects: React Refresh hands the mounted provider the second copy's component, which provides
 * the second object, while a consumer still running the first copy reads the first and finds nothing
 * ("useWebSocket must be used within a WebSocketProvider"). Every copy of a module shares the module's
 * `import.meta.hot.data`, so the context object is kept there and the second copy gets the first's back.
 * A production build has no `import.meta.hot` (Vite replaces it with `undefined`), so it is a plain
 * `createContext`, as before.
 *
 * USE. Pass the declaring module's own `import.meta.hot` (the helper cannot read it for the caller: its own
 * would key every context of the app together) and a key that is unique inside that module — the context's
 * name; a module that makes two contexts gives each its own key. A repeated key would be ONE context in dev
 * and two in a production build, so the `stable-context/no-duplicate-context-key` lint rule refuses it.
 *
 * KNOWN TRADE-OFF. A kept context also keeps the default value it was first made with, so editing a
 * context's default takes a page reload in dev. Only the default: the provider, the hooks and the value's
 * type are the module's code and hot-update as always.
 */
export function createStableContext<Value>(hot: ImportMeta['hot'], key: string, defaultValue: Value): Context<Value> {
  if (!hot) return createContext<Value>(defaultValue);
  const kept: Record<string, Context<Value>> = hot.data.stableContexts ?? (hot.data.stableContexts = {});
  return kept[key] ?? (kept[key] = createContext<Value>(defaultValue));
}
