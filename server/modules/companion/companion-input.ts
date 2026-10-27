import type { Request } from 'express';

import { isRecord, isText } from '@/shared/document-fields.js';
import { AppError } from '@/shared/utils.js';

/**
 * What a page may send her, and the one 400 every refusal is. The limits are the plan's interface 9 (`text`
 * 1-8000 for a typed message) and `update_draft`'s own (1-20000), written once here so the routes and her tools
 * cannot disagree about how long a brief may be. A refusal is `COMPANION_INPUT_INVALID` with a sentence that
 * names the field and its limit, which is all the panel shows.
 *
 * The reader of the page's client id is here as well: every route reads the `x-companion-client` header, because the
 * floor — the page she acts on — is whichever client id typed to her last or opened her panel.
 *
 * Consumers: `companion.routes.ts` (the body and header readers, both limits), `companion-settings.ts` (the 400
 * its saves refuse with) and the draft tool (`tools/draft-tools.ts`: `DRAFT_TEXT_MAX`, `characterCount`).
 */

/** The header every page sends: the id this page generated for itself, which names it on the floor. */
const COMPANION_CLIENT_HEADER = 'x-companion-client';

/** The longest typed message, in characters. Consumed by `companion.routes.ts`. */
export const MESSAGE_TEXT_MAX = 8000;

/** The longest draft, in characters. Consumed by `companion.routes.ts` (`PUT /draft`) and the draft tool. */
export const DRAFT_TEXT_MAX = 20_000;

/** What a client id may be: the page generates a UUID, so anything of this alphabet and length is its own and nothing wider is stored or echoed. */
const CLIENT_ID_SHAPE = /^[A-Za-z0-9._:-]{1,100}$/;

/**
 * The 400 every refusal of her input is: `sentence` names the field and its limit, `field` rides in `details`.
 * Consumed by `companion-settings.ts` (a setting past its limit) and `companion.routes.ts` (a note id that is not a
 * number); the readers below raise it too.
 */
export function inputInvalid(sentence: string, field?: string): AppError {
  return new AppError(sentence, {
    code: 'COMPANION_INPUT_INVALID',
    statusCode: 400,
    details: field === undefined ? undefined : { field },
  });
}

/**
 * The page that sent this request, or `null` for a request that names none (a script, `curl`). A header that is
 * there and is not an id of the allowed shape is refused rather than read as none, so a page with a broken id
 * hears of it. Consumed by `companion.routes.ts`.
 */
export function readClientId(request: Request): string | null {
  const header = request.header(COMPANION_CLIENT_HEADER);
  if (header === undefined) return null;
  if (!CLIENT_ID_SHAPE.test(header)) {
    throw inputInvalid(`${COMPANION_CLIENT_HEADER} must be 1-100 characters of letters, digits and . _ : -.`, COMPANION_CLIENT_HEADER);
  }
  return header;
}

/** The client id of a route that takes the floor, which has no meaning without one. Consumed by `companion.routes.ts` (`/messages`, `/floor`). */
export function requireClientId(request: Request): string {
  const client = readClientId(request);
  if (client === null) throw inputInvalid(`${COMPANION_CLIENT_HEADER} is required: it names the page she should act on.`, COMPANION_CLIENT_HEADER);
  return client;
}

/**
 * The JSON object a write carries, or the 400 that says the body must be one. A request that carries no JSON at
 * all (no body, or a `text/plain` one) is refused here rather than read as `{}`: `express.json()` leaves `{}`
 * for both, and a settings save that sent nothing must not answer 200 and tell every page it saved. An empty
 * JSON object sent as JSON is a real, empty patch and passes. Consumed by `companion.routes.ts`.
 */
export function readBodyObject(request: Request): Record<string, unknown> {
  const body: unknown = request.body;
  if (!request.is('application/json') || !isRecord(body)) {
    throw inputInvalid('The body must be a JSON object, sent with content-type application/json.');
  }
  return body;
}

/**
 * Characters as a person counts them: a code point is one, so an emoji does not use two of a limit. Consumed by
 * `readBodyText` below and by `tools/draft-tools.ts`, which counts the draft she writes the way `PUT /draft` counts the
 * one he edits.
 */
export function characterCount(text: string): number {
  return Array.from(text).length;
}

/**
 * One text field of a body, trimmed, of 1 to `max` characters — or the 400 naming the field and its limit. Trimmed
 * because a message of nothing but whitespace is no message, and what is stored is what she is shown. Consumed by
 * `companion.routes.ts` (`text` of `/messages` and of `PUT /draft`).
 */
export function readBodyText(body: Record<string, unknown>, field: string, max: number): string {
  const limit = `${field} must be 1-${max} characters`;
  const value = body[field];
  if (!isText(value)) throw inputInvalid(`${limit} (it is not text).`, field);
  const text = value.trim();
  const length = characterCount(text);
  if (length < 1 || length > max) throw inputInvalid(`${limit} (it has ${length}).`, field);
  return text;
}
