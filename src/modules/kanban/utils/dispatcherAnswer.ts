/**
 * THE BUGS VIEW'S ONE READER OF A DISPATCHER PRESS: every press that relays one dispatcher verb (`bug proposal promote`,
 * `hunt reopen`, and the rest) reads its answer here, so the view draws one shape for a success, a refusal, a fault,
 * and no answer at all.
 *
 * THE ROUTE ANSWERS IN THREE SHAPES. HTTP 200 with `{ line }` is the verb's first line. HTTP 409 with `{ error }` is a
 * refusal, and its text is the dispatcher's own line. HTTP 400 or 502 with `{ error }` is a fault. A network throw, or a
 * body that is not JSON, is no answer.
 *
 * THE LEAD COMES OFF BEFORE A PERSON READS IT. The person pressed the button. The verb's name is the machine's; the
 * reason is theirs. So `REFUSED bug proposal promote: "X" is already promoted` reads as `"X" is already promoted`.
 */

/** What one press of a dispatcher verb came back with. `sentence` is null when the server gave no sentence of its own (no answer, a body with no `error`), and the caller says its own. */
export type DispatcherAnswer = { ok: true; line: string } | { ok: false; sentence: string | null };

export async function readDispatcherAnswer(request: Promise<Response>): Promise<DispatcherAnswer> {
  let response: Response;
  try {
    response = await request;
  } catch (error) {
    // Logged here: the caller gets `sentence: null` and cannot see the network error itself.
    console.error('Error asking the dispatcher:', error);
    return { ok: false, sentence: null };
  }

  const body = await readBody(response);
  const line = isRecord(body) ? body.line : undefined;
  // The status is the route's verdict: a `line` on a refusal is still a refusal, whatever the body carries.
  if (response.ok && typeof line === 'string') return { ok: true, line };

  // A blank error would draw an empty sentence over the caller's own wording, so it counts as no sentence.
  const serverError = isRecord(body) ? body.error : undefined;
  if (typeof serverError === 'string' && serverError.trim() !== '') {
    return { ok: false, sentence: plainSentence(serverError) };
  }
  return { ok: false, sentence: null };
}

/**
 * A body that does not parse (a proxy's HTML error page, say) is no answer, not a throw: the press still comes back
 * with its outcome, and the caller words the rest.
 */
async function readBody(response: Response): Promise<unknown> {
  try {
    const body: unknown = await response.json();
    return body;
  } catch {
    return undefined;
  }
}

// Anchored to the start: a verb's name in the middle of a reason is part of the reason, and stays.
const REFUSED_TAG = /^REFUSED\s+/;
const VERB_LEAD = /^(?:hunt|bug)(?: [a-z-]+){1,2}: /;

/**
 * The dispatcher's line as a person reads it: the machine's tag and verb name come off, and the sentence starts with
 * a capital.
 */
export function plainSentence(line: string): string {
  const reason = line.replace(REFUSED_TAG, '').replace(VERB_LEAD, '');
  // A line that was only a tag or only a verb name has no reason to show, so the line itself stands in for it.
  if (reason.trim() === '') return line.trim();
  return reason.charAt(0).toUpperCase() + reason.slice(1);
}

/** A JSON object: not null, not an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
