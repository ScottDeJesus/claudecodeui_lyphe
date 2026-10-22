import type { AffectedAreasTrouble } from '@/shared/types';

/*
 * HOW A READ OF THE AFFECTED-AREAS LANE THAT BROUGHT NO ANSWER BECOMES A TROUBLE THE SCREENS SAY. The first two
 * functions are pure: the hooks hand them what `fetch` gave or threw, and draw what they return. `answerOfWrite`
 * below does the same for a press, and sends it.
 */

/**
 * The trouble a non-2xx answer stands for. The lane's own faults carry their status (`api.affectedAreas`'s note):
 * 502 is an answer that was not JSON, 503 is either the missing secret or a shadow-connector that did not answer,
 * told apart by the lane's sentence (it names the secret; the other never does). A 404 is the tour or pano gone;
 * anything else (a 422, a 500) is a refusal the screen can only call a failed read.
 */
export async function troubleOfResponse(response: Response): Promise<AffectedAreasTrouble> {
  if (response.status === 404) return 'gone';
  if (response.status === 502) return 'unreadable';
  if (response.status === 503) {
    const body: unknown = await response.json().catch(() => null);
    const sentence = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : null;
    return typeof sentence === 'string' && sentence.includes('secret') ? 'no_secret' : 'unreachable';
  }
  return 'failed';
}

/**
 * The trouble a thrown `fetch` or `.json()` stands for: a body that would not parse is an answer CloudCLI cannot
 * read; everything else (no connection, the client's own deadline) is no answer in time.
 */
export function troubleOfFailure(failure: unknown): AffectedAreasTrouble {
  return failure instanceof SyntaxError ? 'unreadable' : 'unreachable';
}

/** An engine refusal code (`not_a_person`, `bad_class`, …): lowercase words joined by underscores, never a sentence. */
const REFUSAL_CODE = /^[a-z][a-z_]{1,39}$/;

/**
 * Sends one write of the marks plan (a mark, a missed area, an understanding mark, a threshold) and says what came of
 * it: the engine's answer, or the one reason it was not kept. The reason is a word for the press to say, never a
 * guess: the marks routes' own refusal code (`not_a_person`, `bad_class`, … in the body's `error`), the lane's fault
 * (`no_secret`, `unreachable`, `unreadable`), or `failed` for an answer with no usable reason (a 404 for a path the
 * lane does not forward, a lane 422 that is a sentence, a body that would not parse, a 2xx that was not JSON).
 *
 * Read by the affected-areas module's presses: `MarkBar`, `MissedDraw`, `UnderstandingMark` and `TablesScreen`.
 */
export async function answerOfWrite<T>(send: () => Promise<Response>): Promise<{ answer: T } | { refusal: string }> {
  try {
    const response = await send();
    if (response.ok) return { answer: (await response.json()) as T };
    // The lane's own faults carry their status; the engine's refusals carry a code in the body.
    if (response.status === 502 || response.status === 503) return { refusal: await troubleOfResponse(response) };
    const body: unknown = await response.json().catch(() => null);
    const code = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : null;
    return { refusal: typeof code === 'string' && REFUSAL_CODE.test(code) ? code : 'failed' };
  } catch (failure) {
    // No answer in time, or an answer that would not parse: a mark that was not confirmed is told as not kept.
    return { refusal: troubleOfFailure(failure) };
  }
}
