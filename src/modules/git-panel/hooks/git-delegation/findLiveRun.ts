import { api } from '@/shared/api';
import { GIT_DELEGATION_COMMAND } from '@/shared/constants';

/**
 * Whether a delegation run is going, asked of the SERVER.
 *
 * The store remembers a run for as long as one document lives, which is not long enough: a second
 * tab, a reload, or an HMR update that re-evaluates the store all produce a fresh, empty store while
 * the agent is still committing and pushing every repository in the checkpoint. Memory cannot be the
 * guard.
 *
 * This reads the running list FRESH rather than the 5-second poll behind the sidebar's activity
 * chip: a run appears there milliseconds after the press, and two tabs pressing inside one poll
 * interval is exactly the case the guard exists for.
 *
 * ⚠ It answers "I could not check" as its own state, and the caller must refuse on it. This is an
 * authorization, and the estate's own rule for those is that they fail CLOSED — an expired token, a
 * deleted row or a server hiccup must not read as "nothing is running" and start a second `/git`.
 * The floor it cannot reach: two presses inside the ~10ms before the gateway registers the first run
 * are indistinguishable from here. Only the server could refuse that one.
 */

/** A running session that turned out to BE a delegation run, wherever it was started from. */
type Delegation = { projectId: string | null; projectName: string | null; startedAt: number };

/** The running sessions that turned out to BE delegation runs. Only matches are kept — see below. */
const verdicts = new Map<string, Delegation>();

/** How many of the OLDEST rows to read. Two, so a leading non-user row cannot hide the command. */
const HEAD_ROWS = 2;

/**
 * Sessions this document has already drawn a receipt for — never adopted again as "running".
 *
 * It exists for ONE window: the server keeps listing a run for a few seconds after it ends, and
 * adopting it back there would put "● Claude is running" over the receipt just drawn. Both memories
 * are dropped the moment the server stops listing a session — see `forgetSessionsThatEnded`.
 */
const settled = new Set<string>();

/** The answer, including the one that is not an answer. */
export type LiveRunCheck =
  | { known: true; run: (Delegation & { sessionId: string }) | null }
  | { known: false };

/** True when the row's own title is the command. Cheap, cached, and usually enough. */
function titledWithCommand(summary: unknown): boolean {
  return typeof summary === 'string' && summary.trim() === GIT_DELEGATION_COMMAND.trim();
}

/** One page of a conversation, from the tail-paged messages route. */
async function readMessagePage(
  sessionId: string,
  limit: number,
  offset: number,
): Promise<{ total: number; messages: Array<{ role?: string; content?: string }> }> {
  const response = await api.providers.sessionMessages(sessionId, { limit, offset });
  if (!response.ok) {
    throw new Error(`session ${sessionId} messages could not be read (${response.status})`);
  }
  const body = (await response.json()) as {
    data?: { total?: number; messages?: Array<{ role?: string; content?: string }> };
  };
  return { total: body?.data?.total ?? 0, messages: body?.data?.messages ?? [] };
}

/**
 * True when the conversation OPENS with the command.
 *
 * The sturdier of the two tests, and the fallback for the weaker one: a session's title is
 * `custom_name` — the first few words of the first message — and every sidebar row carries a rename
 * control, including the delegation conversation while it runs. The first user row cannot be
 * renamed, and it carries the whole command however many words the operator's knob holds.
 */
async function opensWithCommand(sessionId: string): Promise<boolean> {
  // The route pages the TAIL — `sliceTailPage` computes `end = total - offset` — so a conversation's
  // OLDEST rows are its LAST page, and `limit: 1` alone answers the newest row (measured: on the one
  // real delegation run here it returned the assistant's closing text and no user row at all).
  //
  // Asked as two one-page reads — how many rows, then the oldest few — rather than as the whole
  // transcript. This runs on every press for every running session not titled with the command, and
  // the largest conversation on this host is 86 MB: a null limit would put that on the press path.
  const { total } = await readMessagePage(sessionId, 1, 0);
  if (total < 1) return false;
  const { messages } = await readMessagePage(sessionId, HEAD_ROWS, Math.max(0, total - HEAD_ROWS));
  const first = messages.find((message) => message.role === 'user');
  return typeof first?.content === 'string' && first.content.trim() === GIT_DELEGATION_COMMAND.trim();
}

/** A row that is gone answers 404 — nothing to classify, and nothing this panel could adopt. */
class SessionRowGone extends Error {}

/** The session row for one running session, or null when it is not a delegation run. */
async function classifySession(sessionId: string): Promise<Delegation | null> {
  const response = await api.sessionDetails(sessionId);
  if (response.status === 404) throw new SessionRowGone(sessionId);
  if (!response.ok) {
    throw new Error(`session ${sessionId} could not be read (${response.status})`);
  }

  const body = (await response.json()) as {
    data?: { summary?: string; createdAt?: string; project?: { projectId?: string; displayName?: string } };
  };
  const row = body?.data;
  if (!row) return null;
  // Asked of EVERY running session, whatever project it belongs to. `/git` checkpoints all four
  // repositories, so a run started from another project's panel is still the run a press here would
  // duplicate — it just cannot be adopted here, which is the caller's distinction to make.
  if (!titledWithCommand(row.summary) && !(await opensWithCommand(sessionId))) return null;

  // The row's own creation time is the press: the conversation is created by the press and by
  // nothing else. A row that cannot be dated is still a run — it just gets `0`, which the caller
  // turns into "from now", so the receipt under-claims rather than claiming commits it never wrote.
  const createdAt = Date.parse(row.createdAt ?? '');
  return {
    projectId: row.project?.projectId ?? null,
    projectName: row.project?.displayName ?? null,
    startedAt: Number.isFinite(createdAt) ? createdAt : 0,
  };
}

/** Remembers a reported run, so it is not adopted back while the server is still listing it. */
export function markRunSettled(sessionId: string): void {
  settled.add(sessionId);
}

/**
 * Drops what this document remembers about sessions the server no longer lists.
 *
 * Both memories are keyed on the session id alone, and a conversation outlives the run inside it:
 * open a settled one, send the command again, and that is a NEW run under an id already spoken for.
 * Remembering "already reported" for ever would hide it from the guard. The server's list is the
 * clock — and this is also the only thing that stops either memory growing for the document's life.
 */
function forgetSessionsThatEnded(live: Set<string>): void {
  // Deleting the current key from a `Set`/`Map` mid-iteration is defined behaviour in JS: the
  // iterator visits what remains, and a key already passed is not revisited. No copy needed.
  for (const sessionId of settled) if (!live.has(sessionId)) settled.delete(sessionId);
  for (const sessionId of verdicts.keys()) if (!live.has(sessionId)) verdicts.delete(sessionId);
}

/**
 * The delegation run going anywhere on this host right now — or the fact that it could not be told.
 *
 * NOT scoped to `projectId`: `/git` is one checkpoint across every repository in the estate, so a run
 * started from another project's panel is still the run a press here would duplicate. The project is
 * REPORTED rather than filtered on, because it decides what the caller may do with the answer —
 * a run in this project can be adopted and narrated from this panel's git; one elsewhere can only be
 * named and refused. A same-project run therefore wins when both are going.
 *
 * A classification that FAILS to read leaves the whole answer unknown: the session that could not be
 * read might be the very run a press would duplicate.
 */
export async function checkForLiveDelegationRun(projectId: string): Promise<LiveRunCheck> {
  let running: Array<{ sessionId?: unknown }> = [];
  try {
    const response = await api.runningSessions();
    if (!response.ok) return { known: false };
    const body = (await response.json()) as { data?: { sessions?: unknown } };
    // Checked, not asserted: an `as` is a promise to the compiler and not to the runtime, and a
    // `sessions` that is not an array would throw out of `.map` BELOW this catch — where two of the
    // three callers have no handler, so a malformed body would surface as an unhandled rejection
    // instead of the "I could not check" this function exists to answer. Falling back to an EMPTY
    // list would be worse than the throw: an empty list reads as "nothing is running", which is the
    // one answer an unreadable body may never produce.
    const sessions = body?.data?.sessions;
    if (!Array.isArray(sessions)) return { known: false };
    running = sessions;
  } catch (cause) {
    console.error('[GitDelegation] could not read the running sessions:', cause);
    return { known: false };
  }

  forgetSessionsThatEnded(new Set(
    running.map((session) => session?.sessionId).filter((id): id is string => typeof id === 'string' && id !== ''),
  ));

  // Up to three small reads per running conversation, sequentially: the row, and — only when its
  // title is not the command — two head pages. Bounded by how many runs the host has going at once,
  // and only paid on a press, on a dismiss, or on a change in what is running.
  let elsewhere: (Delegation & { sessionId: string }) | null = null;
  for (const session of running) {
    const sessionId = session?.sessionId;
    if (typeof sessionId !== 'string' || !sessionId || settled.has(sessionId)) continue;

    if (!verdicts.has(sessionId)) {
      try {
        const verdict = await classifySession(sessionId);
        // Only a MATCH is remembered: a session's identity cannot change, but a "no" may have been
        // answered by a row that had not caught up, and re-asking one running session is cheap.
        if (verdict) verdicts.set(sessionId, verdict);
      } catch (cause) {
        if (cause instanceof SessionRowGone) {
          // Deleting a conversation removes its row without stopping its run, so this id can linger
          // in the running list with nothing behind it. There is nothing here to name, adopt, or
          // place in a project, and blocking on it would take the panel's only verb out for the rest
          // of that run. ⚠ This one skip is the guard's only FAIL-OPEN: a delegation run whose row
          // the operator deleted mid-run is invisible here, and a press would start a second one.
          console.warn('[GitDelegation] a running session has no row any more:', sessionId);
          continue;
        }
        console.error('[GitDelegation] could not read a running session:', cause);
        return { known: false };
      }
    }

    const verdict = verdicts.get(sessionId);
    if (!verdict) continue;
    // A run whose row carried no readable date is followed from NOW: its receipt then claims only
    // what it writes from here on, which is the safe direction for a number on a receipt.
    const found = { ...verdict, sessionId, startedAt: verdict.startedAt || Date.now() };
    // This panel's own run ends the search — it is the one that can be adopted and narrated. A run
    // in another project is kept in case there is no run here, so the press can name it and refuse.
    if (found.projectId === projectId) return { known: true, run: found };
    elsewhere ??= found;
  }

  return { known: true, run: elsewhere };
}
