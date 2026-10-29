import type { Request } from 'express';

import { isRecord, isText } from '@/shared/document-fields.js';
import { AppError } from '@/shared/utils.js';

/**
 * What a page may send her, and the one 400 every refusal is. The limits are the plan's interface 9 (`text`
 * 1-8000 for a typed message) and the draft's own (at most 20000, `DRAFT_TEXT_MAX`: `PUT /draft` refuses a blank one, while
 * `update_draft` takes an empty text as a clear), written once here so the routes and her tools cannot disagree about how
 * long a brief may be. A refusal is `COMPANION_INPUT_INVALID` with a sentence that
 * names the field and its limit, which is all the panel shows.
 *
 * The reader of the page's client id is here as well: every route reads the `x-companion-client` header, because the
 * floor — the page she acts on — is whichever client id typed to her last or opened her panel.
 *
 * Consumers: `companion.routes.ts` (the body, header and path readers, all limits), `companion-settings.ts` (the 400
 * its saves refuse with) and the draft tool (`tools/draft-tools.ts`: `DRAFT_TEXT_MAX`, `characterCount`).
 */

/** The header every page sends: the id this page generated for itself, which names it on the floor. */
const COMPANION_CLIENT_HEADER = 'x-companion-client';

/** The longest typed message, in characters. Consumed by `companion.routes.ts`, and by `companion-press.ts`, which holds a spoken line to the same limit. */
export const MESSAGE_TEXT_MAX = 8000;

/** The longest draft, in characters. Consumed by `companion.routes.ts` (`PUT /draft`) and the draft tool. */
export const DRAFT_TEXT_MAX = 20_000;

/** What a client id may be: the page generates a UUID, so anything of this alphabet and length is its own and nothing wider is stored or echoed. */
const CLIENT_ID_SHAPE = /^[A-Za-z0-9._:-]{1,100}$/;

/**
 * The 400 every refusal of her input is: `sentence` names the field and its limit, `field` rides in `details`.
 * Consumed by `companion-settings.ts` (a setting past its limit), `companion.routes.ts` (a note id that is not a
 * number) and `companion-press.ts` (a transcript past a typed line's limit); the readers below raise it too.
 */
export function inputInvalid(sentence: string, field?: string): AppError {
  return new AppError(sentence, {
    code: 'COMPANION_INPUT_INVALID',
    statusCode: 400,
    details: field === undefined ? undefined : { field },
  });
}

/**
 * The refusal a Gemini call that came to nothing answers, from the voice module's `{ reason, sentence }`: 409
 * `COMPANION_SPEECH_REFUSED` for a key that is missing or refused, 502 `COMPANION_SPEECH_FAILED` for a call that failed,
 * with the sentence as the message the panel shows. Consumed by `companion-press.ts` (a clip that could not be heard) and
 * `companion-speech.ts` (a sentence that could not be spoken).
 */
export function geminiRefusal(answer: { reason: 'no_key' | 'refused' | 'failed'; sentence: string }): AppError {
  const failed = answer.reason === 'failed';
  return new AppError(answer.sentence, {
    code: failed ? 'COMPANION_SPEECH_FAILED' : 'COMPANION_SPEECH_REFUSED',
    statusCode: failed ? 502 : 409,
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
 * `readBodyText` below, by `tools/draft-tools.ts`, which counts the draft she writes the way `PUT /draft` counts the
 * one he edits, and by `companion-press.ts`, which counts a transcript the way a typed line is counted.
 */
export function characterCount(text: string): number {
  return Array.from(text).length;
}

/**
 * One whole-number field of a body, from `min` to `max`, or the 400 naming the field and its range. A multipart field
 * arrives as text, so a string of digits (no sign, no point, no leading zero) is read as the number it spells, and a JSON
 * number must already be whole. Consumed by `companion.routes.ts` (`durationMs` of `POST /press`).
 */
export function readBodyWholeNumber(body: Record<string, unknown>, field: string, min: number, max: number): number {
  const value = body[field];
  const spelled = typeof value === 'string' && /^(0|[1-9]\d{0,15})$/.test(value) ? Number(value) : value;
  if (typeof spelled !== 'number' || !Number.isSafeInteger(spelled)) throw inputInvalid(`${field} must be a whole number from ${min} to ${max}.`, field);
  if (spelled < min || spelled > max) throw inputInvalid(`${field} must be a whole number from ${min} to ${max} (it is ${spelled}).`, field);
  return spelled;
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

/** What a turn id may be: she makes it with `randomUUID`, so anything of this alphabet and length is a turn's name and nothing wider is looked up or echoed into a log line. */
const TURN_ID_SHAPE = /^[A-Za-z0-9_-]{1,100}$/;

/** The largest sentence index a request may name: far past any turn she could say, and still an index, not a number to overflow. */
const SENTENCE_INDEX_MAX = 100_000;

const turnIdInvalid = (field: string): AppError => inputInvalid(`${field} must be 1-100 characters of letters, digits, _ and -.`, field);
const indexInvalid = (field: string, nullable: boolean): AppError =>
  inputInvalid(`${field} must be a whole number from 0 to ${SENTENCE_INDEX_MAX}${nullable ? ', or null' : ''}.`, field);

/** A turn id from the path of the speech door, or the 400 naming `turnId`. Consumed by `companion.routes.ts`. */
export function readTurnIdParam(raw: string): string {
  if (!TURN_ID_SHAPE.test(raw)) throw turnIdInvalid('turnId');
  return raw;
}

/** The sentence index in the path of the speech door: digits only, no sign and no leading zero. Consumed by `companion.routes.ts`. */
export function readSentenceIndexParam(raw: string): number {
  if (!/^(0|[1-9]\d{0,5})$/.test(raw) || Number(raw) > SENTENCE_INDEX_MAX) throw indexInvalid('index', false);
  return Number(raw);
}

/** A turn id carried by a JSON body, or the 400 naming the field. Consumed by `companion.routes.ts` (`turnId` of `POST /cut`). */
export function readBodyTurnId(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || !TURN_ID_SHAPE.test(value)) throw turnIdInvalid(field);
  return value;
}

/**
 * A sentence index of a JSON body, `null` when the page says none (nothing had ended, nothing was playing), or the 400
 * naming the field. The field must be present: a cut that leaves one out is malformed, not "none". A digit string is not
 * a number here, as it is for a multipart field. Consumed by `companion.routes.ts` (`heard` and `interrupted` of `POST /cut`).
 */
export function readBodySentenceIndex(body: Record<string, unknown>, field: string): number | null {
  const value = body[field];
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > SENTENCE_INDEX_MAX) throw indexInvalid(field, true);
  return value;
}
