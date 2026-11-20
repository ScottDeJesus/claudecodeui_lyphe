import { api, refusalSentence } from '@/shared/api';

/**
 * A change to `~/.claude/charters/hunts.toml`, in the field names of `PUT /api/kanban-dispatch/hunts/settings`: a write sends only the
 * fields it moves. The route checks each field's type and the dispatcher judges its value. Its shape is stated once, as the parameter of
 * `api.settings.saveBugHunters`; `order` is the hunts that take turns in turn order, `projects` every project's name in the new order.
 */
export type BugHuntsChange = Parameters<typeof api.settings.saveBugHunters>[0];

/** What the route answered: `hunt config --json` as it came, or the sentence for why there is none. */
export type BugHuntsAnswer = { ok: true; body: unknown } | { ok: false; sentence: string };

/** The dispatcher's own lead on a refused change: the command's word, not the operator's, so it is dropped from what he reads. */
const REFUSAL_LEAD = 'REFUSED hunt config: ';

/**
 * The reason inside a refusal line: `REFUSED hunt config: minutes must be ...` reads `Minutes must be ...`. A line that does not open
 * with the lead (the route's own 400 sentence, a fault) is kept as it came.
 */
export function reasonOf(sentence: string): string {
  if (!sentence.startsWith(REFUSAL_LEAD)) return sentence;
  const reason = sentence.slice(REFUSAL_LEAD.length).trim();
  return reason.charAt(0).toUpperCase() + reason.slice(1);
}

/** The settings as the dispatcher reads them off the file. Never throws. */
export function readHuntsSettings(): Promise<BugHuntsAnswer> {
  return answerOf(() => api.settings.bugHunters());
}

/** One change, written; the answer is the file as it stands after the write. Never throws. */
export function writeHuntsSettings(change: BugHuntsChange): Promise<BugHuntsAnswer> {
  return answerOf(() => api.settings.saveBugHunters(change));
}

/** A request's answer, sorted: a 2xx JSON body, or the server's own sentence (a 409 carries the dispatcher's), or what fetch said. */
async function answerOf(request: () => Promise<Response>): Promise<BugHuntsAnswer> {
  let response: Response;
  try {
    response = await request();
  } catch (failure) {
    return { ok: false, sentence: failure instanceof Error && failure.message ? failure.message : String(failure) };
  }
  if (!response.ok) {
    const said = await refusalSentence(response);
    return { ok: false, sentence: reasonOf(said ?? `The hunt settings could not be reached (HTTP ${response.status}).`) };
  }
  try {
    return { ok: true, body: await response.json() };
  } catch {
    return { ok: false, sentence: `The hunt settings answered with something that is not JSON (HTTP ${response.status}).` };
  }
}
