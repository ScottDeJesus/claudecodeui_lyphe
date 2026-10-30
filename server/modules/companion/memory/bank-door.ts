import { isCount, isList, isRecord, isText } from '@/shared/document-fields.js';

/**
 * HER SIDE OF THE DOCSTORE'S DOOR. Kaylee's memory is one docstore package, `kaylee:memory` (repo `kaylee`, path
 * `memory`), and nothing of it is stored in CloudCLI: every read and every write of it is a call through this file.
 * The docstore is a door, not a library, and `~/.claude/scripts/docstore` is only a wire to `POST <DOCSTORE_URL>/api/<verb>`;
 * ArchPulse already calls that wire from TypeScript the same way (`server/docstore_view.ts`, `askDoor`). This is
 * CloudCLI's FIRST docstore client, so it holds the whole of what a caller must know about the door:
 *   - every call carries her mark, `X-Docstore-Door: kaylee`. The mark is what this client SENDS: the running docstore does not
 *     act on it yet (its source records the header only as the usage door and knows one writer mark, `inbox`), so nothing refuses
 *     a call that lacks it and nothing keeps her repo out of an unscoped read. Each read names `package: BANK` so that it asks
 *     about her package alone;
 *   - every write and retire names `actor: 'kaylee'`, so the docstore's `history` records each as hers;
 *   - `DOCSTORE_URL` is read on EVERY call (a probe points it at a scratch door), trailing slashes dropped, default
 *     `http://127.0.0.1:8006`;
 *   - a call is bounded at 10 s, not ArchPulse's 1.5 s: a write embeds its text and refreshes its export before it answers.
 *
 * The door's answers, as this file reads them: 200 is the value; 400 bad arguments, 404 not found, 409 refused (its body
 * carries `refused: true`) and 503 database unreachable are each `{ error }`, the door's own sentence, which is handed on
 * whole. The one 404 that is an ANSWER is the package she has not made yet (`no package kaylee:memory …`, the door's
 * `packages.resolve`): an empty search and an empty list, because the bank's absence is an answer. A timeout or a refused
 * connection is the sentence "the docstore door at <url> did not answer". NOTHING HERE THROWS: every verb answers a `BankAnswer`.
 * "Did not answer" is the CLIENT giving up, not the door's word that it did nothing: the door keeps working a write it was
 * handed after this side stops waiting, so for `write` and `retire` it leaves the outcome unknown (see their docs).
 *
 * Consumers: `memory/memory-verbs.ts` (recall, remember, forget, `clearMemory`), `hands/action-recipe.ts` (the clear
 * recipe counts the bank with `list`), and `memory/memory-settings.ts` (Settings reads the count with `list`).
 */

/** Her one package, her door's mark, her actor in the docstore's history, and the DocSpace page kaylee--bank built for her bank. Consumed by `memory-verbs.ts`, `memory-settings.ts` and the hands' clear recipe. */
export const BANK = 'kaylee:memory';
export const BANK_DOOR = 'kaylee';
export const BANK_ACTOR = 'kaylee';
export const BANK_PAGE_ID = 'page-kaylee-memory';

/** The two halves of `BANK`, which is how `get` names the package a row lives in. */
const [BANK_REPO, BANK_PATH] = BANK.split(':');

/** The door's default address, and how long any one call waits for it, headers and body together. */
const DEFAULT_DOCSTORE_URL = 'http://127.0.0.1:8006';
const CALL_BOUND_MS = 10_000;

/**
 * One memory as the door gives it. `kind` is the memory's own kind (rule, gotcha or landmine) when the answer is `get`'s,
 * and `invariant` or `manual` when it is a search's row; `score` is the reranker's logit for a search's row, `null` for
 * `get`'s. Consumed by `memory-verbs.ts`.
 */
export type BankRow = { token: string; title: string; body: string; kind: string; score: number | null };

/** The shape of every answer here: the value, or the whole sentence that says why there is none. Consumed by `memory-verbs.ts`, `memory-settings.ts` and the hands' clear recipe. */
export type BankAnswer<T> = { ok: true; value: T } | { ok: false; sentence: string };

/** What one call to the door came back as: its JSON object (a 200), or the sentence for anything else; `missing` marks a 404. */
type Asked = { ok: true; payload: Record<string, unknown> } | { ok: false; sentence: string; missing: boolean };

/** `DOCSTORE_URL` as it stands now, without trailing slashes. */
const docstoreUrl = (): string => (process.env.DOCSTORE_URL?.trim() || DEFAULT_DOCSTORE_URL).replace(/\/+$/, '');

/** The sentence for a call the door did not answer (a timeout, a refused connection): written here and recognised by `isUnanswered`, so the two cannot drift apart. */
const unansweredSentence = (url: string): string => `the docstore door at ${url} did not answer`;

/**
 * Whether `sentence` is the one for a call the door did not answer. For `write` and `retire` it leaves the outcome UNKNOWN (the door keeps
 * working a call it was handed after this side stops waiting), so a caller must not tell her that the call did nothing. Consumed by
 * `memory-verbs.ts`, which says "may have been kept" or "may have been forgotten" for it, and "recall before asking again".
 */
export function isUnanswered(sentence: string): boolean {
  return sentence.startsWith('the docstore door at ') && sentence.endsWith(' did not answer');
}

/** What went wrong with a fetch, for the log: the bound, else the system's own code or message. */
function whyNot(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') return `no answer within ${CALL_BOUND_MS / 1000} seconds`;
  const cause = error instanceof Error ? error.cause : undefined;
  if (isRecord(cause) && isText(cause.code)) return cause.code;
  if (cause instanceof Error && cause.message !== '') return cause.message;
  return error instanceof Error && error.message !== '' ? error.message : 'the call failed';
}

/** One bounded call to the door. Its `fetch` and the body's read share one timeout, so a door that stalls mid-answer is a door that did not answer. */
async function askDoor(verb: string, body: Record<string, unknown>): Promise<Asked> {
  const url = docstoreUrl();
  let status: number;
  let text: string;
  try {
    const response = await fetch(`${url}/api/${verb}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Docstore-Door': BANK_DOOR },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CALL_BOUND_MS),
    });
    status = response.status;
    text = await response.text();
  } catch (error) {
    // The cause (timeout, refused connection, a blocked port) stays in the log as one line, not a stack: a door that is down is met on every verb, and she is told the one sentence.
    console.error(`[Companion] the docstore door at ${url} did not answer the ${verb} call: ${whyNot(error)}`);
    return { ok: false, sentence: unansweredSentence(url), missing: false };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = undefined; // not JSON: the status below still decides what this is
  }
  if (status === 200) {
    return isRecord(payload) ? { ok: true, payload } : { ok: false, sentence: `the docstore door at ${url} answered with something that is not a JSON object`, missing: false };
  }
  const sentence = isRecord(payload) && isText(payload.error) && payload.error !== '' ? payload.error : `the docstore door at ${url} answered ${status}`;
  return { ok: false, sentence, missing: status === 404 };
}

/** The sentence for a 200 whose rows are not in the shape the door sends (a different build, or something else on the port). */
const unreadable = (verb: string): { ok: false; sentence: string } => ({ ok: false, sentence: `the docstore door's ${verb} answer was not in the shape it sends` });

/** Whether a 404 says she has not made her package yet; any other 404 (a token nothing answers to) is the door's sentence. */
const isBankAbsent = (asked: { sentence: string }): boolean => asked.sentence.startsWith(`no package ${BANK}`);

/** A search row as a `BankRow`, or `null` for one that lacks what a memory must have. */
function searchRowOf(raw: unknown): BankRow | null {
  if (!isRecord(raw) || !isText(raw.token) || !isText(raw.title) || !isText(raw.body) || !isText(raw.kind)) return null;
  return { token: raw.token, title: raw.title, body: raw.body, kind: raw.kind, score: isCount(raw.score) ? raw.score : null };
}

/** `get`'s row as a `BankRow` with `mine`; its `kind` is the invariant's own (`invariant_kind`) or, for a manual, `manual`. */
function gotRowOf(raw: unknown): (BankRow & { mine: boolean }) | null {
  if (!isRecord(raw) || !isText(raw.token) || !isText(raw.title) || !isText(raw.body) || !isText(raw.kind)) return null;
  const kind = isText(raw.invariant_kind) ? raw.invariant_kind : raw.kind;
  const home = raw.package;
  const mine = isRecord(home) && home.repo === BANK_REPO && home.path === BANK_PATH;
  return { token: raw.token, title: raw.title, body: raw.body, kind, score: null, mine };
}

/**
 * The five verbs of her door. Each answers `{ ok: true, value }` or `{ ok: false, sentence }` and none throws.
 * Consumed by `memory-verbs.ts`, the hands' clear recipe (`list`) and `memory-settings.ts` (`list`).
 */
export const bankDoor = {
  /**
   * Her memories closest in meaning to `q`, best first, at most `limit`: the door's `search` scoped to `BANK`, in `symptom`
   * mode (the house's prompt floor, applied inside the door). No `session_id` goes with it, so nothing is recorded as
   * injected and no row is held back as already served. A bank not made yet is an empty list. NEVER send a token-shaped
   * `q` (`MAN-12`, `INV-3`, with or without whitespace around it): the door answers that row whatever its package
   * (`verbs/reflex.py`), so a token is read with `get` and its `mine` checked.
   *
   * AN EMPTY ANSWER IS NOT PROOF THAT NOTHING IS KEPT. `search` is a reflex verb and fails open (`server.py`, statement cap
   * 300 ms): a database that is down, or a statement that runs past the cap, answers `{ rows: [] }` with HTTP 200, while `list`,
   * `get` and `write` answer 503. So a check that must hold (a twin check before a write) cannot rest on this alone; `list` and
   * `get` are the verbs that say when the door could not read.
   */
  async search(q: string, limit: number): Promise<BankAnswer<BankRow[]>> {
    const asked = await askDoor('search', { q, package: BANK, mode: 'symptom', limit });
    if (!asked.ok) return asked.missing && isBankAbsent(asked) ? { ok: true, value: [] } : { ok: false, sentence: asked.sentence };
    if (!isList(asked.payload.rows)) return unreadable('search');
    const rows = asked.payload.rows.map(searchRowOf);
    return rows.every((row) => row !== null) ? { ok: true, value: rows } : unreadable('search');
  },

  /** One row, whole, by its token, with `mine`: whether it lives in her package (a house row, `MAN-9084`, does not). */
  async get(token: string): Promise<BankAnswer<BankRow & { mine: boolean }>> {
    const asked = await askDoor('get', { token });
    if (!asked.ok) return { ok: false, sentence: asked.sentence };
    const row = gotRowOf(asked.payload.row);
    return row === null ? unreadable('get') : { ok: true, value: row };
  },

  /** Every memory she keeps, as tokens and titles (the door's `list` never carries bodies). A bank not made yet is an empty list. */
  async list(): Promise<BankAnswer<Array<{ token: string; title: string }>>> {
    const asked = await askDoor('list', { package: BANK });
    if (!asked.ok) return asked.missing && isBankAbsent(asked) ? { ok: true, value: [] } : { ok: false, sentence: asked.sentence };
    if (!isList(asked.payload.rows)) return unreadable('list');
    const rows = asked.payload.rows.map((raw) => (isRecord(raw) && isText(raw.token) && isText(raw.title) ? { token: raw.token, title: raw.title } : null));
    return rows.every((row) => row !== null) ? { ok: true, value: rows } : unreadable('list');
  },

  /**
   * Keeps one memory in her package: a new row, or, with `token`, the rewrite of the row that token names (a kind of the
   * other table is the door's refusal, handed on as its sentence). The answer is the row's token and what the door did
   * with it (`action`). The "did not answer" sentence leaves the outcome UNKNOWN: a write embeds its text and refreshes its
   * export before it answers, and the door does not cancel it when this side stops waiting, so the row may be kept. Read the
   * bank (`search`, `list`) before writing the same words again, or a twin gets in.
   */
  async write(row: { kind: string; title: string; body: string } | { token: string; kind: string; title: string; body: string }): Promise<BankAnswer<{ token: string; action: string }>> {
    const asked = await askDoor('write', 'token' in row
      ? { token: row.token, kind: row.kind, title: row.title, body: row.body, actor: BANK_ACTOR }
      : { kind: row.kind, package: BANK, title: row.title, body: row.body, actor: BANK_ACTOR });
    if (!asked.ok) return { ok: false, sentence: asked.sentence };
    const { token, action } = asked.payload;
    return isText(token) && isText(action) ? { ok: true, value: { token, action } } : unreadable('write');
  },

  /**
   * Retires one memory; the docstore's `history` keeps its text and `reason`. As with `write`, the "did not answer" sentence
   * leaves the outcome unknown: the memory may already be retired.
   */
  async retire(token: string, reason: string): Promise<BankAnswer<true>> {
    const asked = await askDoor('retire', { token, actor: BANK_ACTOR, reason });
    if (!asked.ok) return { ok: false, sentence: asked.sentence };
    return asked.payload.deleted === true ? { ok: true, value: true } : unreadable('retire');
  },
};
