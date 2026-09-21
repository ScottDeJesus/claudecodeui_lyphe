import type { Router } from 'express';

import { createAccountsRoutes } from './accounts.routes.js';

/**
 * Builds the accounts module's router for the server entrypoint, which mounts it at `/api` behind
 * `authenticateToken` — so the switcher answers at `/api/accounts`, `/api/usage`,
 * `/api/accounts/switch` and `/api/accounts/capture`.
 *
 * The module's two other halves are the slot store and the usage meter beside this file: the store
 * owns every credential byte on disk, the meter is the only thing in the server that holds an access
 * token, and both stay inside this directory. Building the router here rather than in the entrypoint
 * keeps the mount a single, named act — a URL prefix, a guard and a module, in one place.
 *
 * ⚠ NO DEPENDENCIES ARE THREADED, and that is the shape rather than an omission. The account store
 * reads its root from the environment at CALL time (so a probe gets the scratch root it set), and the
 * usage meter takes nothing but the live credentials file. There is no base URL, no timeout and no
 * injected `fetch` here to bind, so a composition root would have nothing to hold and the routes are
 * constructed as they are.
 */
export function createAccountsModule(): Router {
  return createAccountsRoutes();
}
