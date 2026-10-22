import express from 'express';
import type { NextFunction, Response } from 'express';

import type { ClaudeAccounts, ClaudeAccountsPicture } from '@/shared/types.js';

import {
  AccountDoorRefusal,
  accountsPicture,
  removeAccount,
  setAuto,
  useAccount,
} from './account-door.js';
import { readUsage } from './usage.service.js';

/**
 * The account lane's routes, mounted at `/api` by `accounts.module.ts`: the picture at
 * `GET /api/accounts`, the usage meter at `GET /api/usage`, and the door's three writes —
 * `POST /api/accounts/use|auto|remove`.
 *
 * THE PICTURE IS THE DOOR'S OWN — `claude-account status --json`, relayed as `claude-api-keys.ts`
 * relays the API keys' door, with every key-shaped string redacted. The route adds the one word the
 * panel branches on: `reachable: true` over the picture, or the calm `{ reachable: false, reason }`
 * when the door cannot answer. A read never fails and never 5xx: this is the status chip's poll,
 * and a store nobody can read is a FACT this module reports rather than a fault it raises. The
 * catches below are belts over code documented as total — they exist because "total by construction"
 * is a claim about today's door, and the panel must not go down if it stops holding.
 *
 * A REFUSED DOOR WRITE IS A VERDICT, not a fault: `use`, `auto` and `remove` answer the door's own
 * line (200) or its own sentence (422 `{ error }`), and a malformed body is refused HERE before the
 * door is asked anything. The door's `use` and `remove` kick the dispatcher themselves (INV-187), so
 * these routes add no kick.
 *
 * A WRITE'S VERDICT IS ITS OWN BODY. The client reads a refusal out of `error` as a STRING — the
 * door's plain English, which is the most useful thing an operator can be told — so a refusal
 * answers `{ error: "<words>" }` with 422, never the global handler's nested shape. A genuine fault
 * on a WRITE (a full disk on a path the door did not wrap) belongs to `next`: unlike the reads, a
 * write that did not happen must not read as one that did.
 */

/** What a read answers when it could not be computed at all, in the words the client already has.
 *
 * ⚠ It reuses the word the client already maps rather than inventing one: `unreachableReasonInWords`
 * maps `timeout` and `bad-response` to their sentences and everything else to the plain "not
 * reachable", so a fourth word would be flattened anyway. This shape exists for a fault nobody has
 * seen, and the reader is owed calm English, not a new vocabulary in a corner they cannot reach. */
function notComputed(): { reachable: false; reason: string } {
  return { reachable: false, reason: 'unreachable' };
}

/** The door's picture, or its calm reason — the shape `account-door-relay.ts` answers a read with. */
type DoorPicture = ClaudeAccountsPicture | { reachable: false; reason: string };

/** The wire answer: the door's picture under the lane's `reachable: true`, or the calm reason. The
 *  tag is what the panel branches on, and adding it is this route's whole mapping. */
function accountsBody(picture: DoorPicture): ClaudeAccounts {
  return 'reachable' in picture ? picture : { reachable: true, ...picture };
}

/**
 * One slug is a NAME, so only a non-empty string is one. A number, a `null`, a blank or a missing
 * key is a malformed request refused HERE — before the door is asked anything, so a bad body cannot
 * move a credential file even as far as a validation read.
 *
 * A LEADING `-` IS NOT REFUSED HERE. A slug is a name, and the door's own parser accepts a slot
 * named `-foo`; what must never happen is argparse reading a name as an option, so the relay puts
 * `--` before the slug. Refusing it here would make such a slot unusable from the panel while
 * closing nothing the separator does not.
 */
function requestedSlug(body: unknown): string | null {
  const slug = (body as { slug?: unknown } | undefined)?.slug;
  return typeof slug === 'string' && slug.trim() ? slug.trim() : null;
}

/** `on` is a boolean or the body is malformed — refused HERE, before the door is asked anything. */
function requestedAuto(body: unknown): boolean | null {
  const on = (body as { on?: unknown } | undefined)?.on;
  return typeof on === 'boolean' ? on : null;
}

/**
 * Run one door write and answer its verdict.
 *
 * Two outcomes and no third for a refusal: the door's own line (200) or the door's own words (422),
 * the shape the panel already reads out of `error`. `AccountDoorRefusal` is caught by CLASS, so a new
 * refusal sentence in the door needs no change here; every other failure is a fault that belongs to
 * `next`, because a write that did not land must not read as one that did.
 */
async function sendDoorWrite(
  response: Response,
  next: NextFunction,
  runWrite: () => Promise<string>,
): Promise<void> {
  try {
    const line = await runWrite();
    response.status(200).json({ line });
  } catch (error) {
    if (error instanceof AccountDoorRefusal) {
      response.status(422).json({ error: error.message });
      return;
    }
    next(error);
  }
}

/** Creates the lane's router for `accounts.module.ts`, which the server entrypoint mounts. */
export function createAccountsRoutes(): express.Router {
  const router = express.Router();

  router.get('/accounts', async (_request, response) => {
    // The door's read is total by construction, so it stands outside the belt; a rejection here is
    // still the calm reason rather than an unhandled one, because this poll must never 5xx.
    const picture = await accountsPicture()
      .catch((): DoorPicture => notComputed());
    response.json(accountsBody(picture));
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

  // The door's three writes. Each refuses a malformed body before the door is asked, so a bad
  // request cannot move a credential file even as far as a validation read.
  router.post('/accounts/use', async (request, response, next) => {
    const slug = requestedSlug(request.body);
    if (slug === null) {
      response.status(422).json({ error: 'slug is required' });
      return;
    }
    await sendDoorWrite(response, next, () => useAccount(slug));
  });

  router.post('/accounts/auto', async (request, response, next) => {
    const on = requestedAuto(request.body);
    if (on === null) {
      response.status(422).json({ error: 'on must be true or false' });
      return;
    }
    await sendDoorWrite(response, next, () => setAuto(on));
  });

  router.post('/accounts/remove', async (request, response, next) => {
    const slug = requestedSlug(request.body);
    if (slug === null) {
      response.status(422).json({ error: 'slug is required' });
      return;
    }
    await sendDoorWrite(response, next, () => removeAccount(slug));
  });

  return router;
}
