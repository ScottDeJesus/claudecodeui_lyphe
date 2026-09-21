import express from 'express';
import type { NextFunction, Response } from 'express';

import type { ClaudeAccounts } from '@/shared/types.js';

import {
  AccountRefusal,
  activeSlug,
  captureLive,
  install,
  setActiveSlug,
  stateSummary,
} from './account-store.service.js';
import { readUsage } from './usage.service.js';

/**
 * The account switcher's four routes, mounted at `/api` by `accounts.module.ts`. They answer the SAME
 * camelCase bodies the panel is built on, so no component changes: its branches on `reachable`, on
 * `unreadable` and on a window's `percent` hold as they are, and the route layer is free to move
 * without the client noticing.
 *
 * THE `{ reachable }` ENVELOPE IS KEPT because the client is built on it. On a READ it is `true`
 * with the picture, or `false` with a one-word reason — never a 5xx, and never a 503. A read that
 * cannot be computed still answers 200 and says so, and the panel draws its calm unknown rather
 * than an error wall.
 *
 * ⚠ A READ NEVER FAILS. That is the whole contract: this is the poll that rides the status chip, and
 * a store that cannot be read is a FACT this module reports rather than a fault it raises. The one
 * `catch` below is a belt over code documented as total — it exists because "total by construction"
 * is a claim about today's store, and the panel must not go down if that claim stops holding.
 *
 * `stateSummary()` answering `null` is the one account state with no picture in it: nothing captured
 * and no readable live login. That is the unreadable envelope (`slots: []`, every label `null`,
 * `unreadable: true`) and not the `{ reachable: false }` branch — the panel says "answered, but it
 * could not read its saved accounts" for the first and hides the meters behind "not reachable" for
 * the second. Only the first is true here: this module always answers.
 *
 * A WRITE'S VERDICT IS ITS OWN BODY. The client reads a refusal out of `error` as a STRING — the
 * store's plain English, which is the most useful thing an operator can be told — so a refusal
 * answers `{ error: "<words>" }` with the store's 422, never the global handler's nested shape. A
 * genuine fault on a WRITE (a full disk on a path the store did not wrap) belongs to `next`: unlike
 * the reads, a write that did not happen must not read as one that did.
 */

/**
 * What a read answers when it could not be computed at all, in the words the client already has.
 *
 * ⚠ It reuses the word the client already maps rather than inventing one: `unreachableReasonInWords` maps
 * `timeout` and `bad-response` to their sentences and everything else to the plain "not reachable",
 * so a fourth word would be flattened anyway. This shape exists for a fault nobody has seen, and the
 * reader is owed calm English, not a new vocabulary in a corner they cannot reach.
 */
function notComputed(): { reachable: false; reason: string } {
  return { reachable: false, reason: 'unreachable' };
}

/**
 * The picture when the store has nothing to show — the unreadable envelope, field for field.
 * `liveSessions: 0` rides along because it is not a fact about the store either way.
 */
function unreadablePicture(): ClaudeAccounts {
  return {
    reachable: true,
    active: null,
    activeLabel: null,
    slots: [],
    liveLabel: null,
    liveExpiresAt: null,
    drift: false,
    liveSessions: 0,
    unreadable: true,
  };
}

/**
 * How many Claude sessions are running on this box, for the switch confirm's soft gate.
 *
 * ⚠ THIS SERVER HAS NO SESSION REGISTRY IT CAN COUNT. CloudCLI keeps chat sessions in a database and
 * spawned CLIs in a keepalive host, and neither is a number this lane may reach for — an app row can
 * be idle for hours, so a non-zero here would claim an account is in use while it is not.
 *
 * So the route states the soft fact, `0`, which the panel words as "none proven running" — an
 * understatement that never blocks a switch, and never a gate. `drift` is the real check on whether
 * the live login matches its saved copy, and it is read from the files themselves.
 */
const LIVE_SESSIONS_UNKNOWN = 0;

/**
 * One slug is a NAME, so only a non-empty string is one. A number, a `null`, a blank or a missing
 * key is a malformed request refused HERE — before the store is asked anything, so a bad body cannot
 * move a credential file even as far as a validation read.
 */
function requestedSlug(body: unknown): string | null {
  const slug = (body as { slug?: unknown } | undefined)?.slug;
  return typeof slug === 'string' && slug.trim() ? slug.trim() : null;
}

/**
 * Run one write and answer with its verdict.
 *
 * Three outcomes and no fourth: a refusal the operator can act on (422, the store's own words), a
 * verdict (the status the verb named), or a fault that belongs to `next`. `AccountRefusal` is caught
 * by CLASS, so a new refusal message in the store needs no change here.
 */
function sendWrite(
  response: Response,
  next: NextFunction,
  runWrite: () => { status: number; body: unknown },
): void {
  try {
    const result = runWrite();
    response.status(result.status).json(result.body);
  } catch (error) {
    if (error instanceof AccountRefusal) {
      response.status(422).json({ error: error.message });
      return;
    }
    next(error);
  }
}

/** Creates the lane's router for `accounts.module.ts`, which the server entrypoint mounts. */
export function createAccountsRoutes(): express.Router {
  const router = express.Router();

  router.get('/accounts', (_request, response) => {
    let picture: ClaudeAccounts;
    try {
      const summary = stateSummary(activeSlug());
      // The spread is the whole mapping: `AccountStateSummary` is the accounts body minus `reachable`
      // and minus `liveSessions`, which this route adds — so the two shapes cannot drift apart
      // without the compiler saying so.
      picture = summary === null
        ? unreadablePicture()
        : { reachable: true, ...summary, liveSessions: LIVE_SESSIONS_UNKNOWN, unreadable: false };
    } catch {
      picture = notComputed();
    }
    response.json(picture);
  });

  router.get('/usage', async (_request, response) => {
    // Computed BEFORE anything is sent, so a fault cannot arrive after the headers are out.
    let usage: Awaited<ReturnType<typeof readUsage>>;
    try {
      usage = await readUsage();
    } catch {
      usage = notComputed();
    }
    response.json(usage);
  });

  router.post('/accounts/switch', (request, response, next) => {
    const slug = requestedSlug(request.body);
    if (slug === null) {
      response.status(422).json({ error: 'slug is required' });
      return;
    }

    sendWrite(response, next, () => {
      const result = install(slug);
      // Recording which slot is now live is the CALLER's act, and it comes AFTER the files moved:
      // the store's own doc says so, and a mark written first would name an account the box is not
      // switched to if the copy then failed.
      setActiveSlug(result.installed);
      return { status: 200, body: result };
    });
  });

  router.post('/accounts/capture', (_request, response, next) => {
    sendWrite(response, next, () => {
      const captured = captureLive();
      // A capture records what is LIVE right now, so the active mark follows it — which is what keeps
      // the mark true after a `claude /login` outside this board's knowledge.
      setActiveSlug(captured);
      return { status: 201, body: { captured } };
    });
  });

  return router;
}
