import type { Router } from 'express';

import { createAccountsRoutes } from './accounts.routes.js';

/**
 * Builds the accounts module's router for the server entrypoint, which mounts it at `/api` behind
 * `authenticateToken` — so the lane answers at `/api/accounts` (the door's picture), `/api/usage`
 * (the meter) and the door's three writes: `/api/accounts/use`, `/api/accounts/auto` and
 * `/api/accounts/remove`.
 *
 * The module's other halves are the live identity read and the usage meter beside this file: the
 * store answers only who the box is signed in as, the meter is the only thing in the server that
 * holds an access token, and both stay inside this directory. Building the router here rather than
 * in the entrypoint keeps the mount a single, named act — a URL prefix, a guard and a module, in
 * one place.
 *
 * ⚠ NO DEPENDENCIES ARE THREADED, and that is the shape rather than an omission. The door is
 * reached through its binary, read at CALL time (so a probe gets the scratch home it set), and the
 * usage meter takes nothing but the live credentials file. There is no base URL, no timeout and no
 * injected `fetch` here to bind, so a composition root would have nothing to hold and the routes
 * are constructed as they are.
 */
export function createAccountsModule(): Router {
  return createAccountsRoutes();
}
