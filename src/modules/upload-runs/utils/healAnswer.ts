import type { HealSessionsAnswer } from '@/modules/heal';
import type { UploadRunSummary } from '@/shared/upload-runs-types';

/** How many session ids one read of the heal worker may carry: the relay refuses a list longer than this. */
const SESSIONS_PER_READ = 200;

/** The CLI's own session id, which is the one spelling the relay accepts: a lowercase uuid. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type AnswerItem = HealSessionsAnswer['items'][number];
type AnswerHeal = HealSessionsAnswer['heals'][number];

/** What a read with nothing to ask for answers: no rows and no heals, which is a fact and not a failure. */
export const NO_SESSIONS_ANSWER: HealSessionsAnswer = { sessions: [], items: [], heals: [] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const isNumbers = (value: unknown): value is number[] => Array.isArray(value) && value.every((entry) => typeof entry === 'number');

const isText = (value: unknown): value is string => typeof value === 'string';

/** The returning shape a row carries, whole: the sheet names the heal and the shape and counts the days since `since`, so all three must be there to be drawn. */
function isRegression(value: unknown): boolean {
  return isRecord(value) && typeof value.heal_id === 'string' && typeof value.signature === 'string' && typeof value.since === 'number';
}

/** A row as the view reads it: the keys it joins and sorts on, and the ones the shared row and the sheet draw without a guard. */
function isAnswerItem(value: unknown): value is AnswerItem {
  return isRecord(value)
    && typeof value.id === 'number'
    && typeof value.ts === 'number'
    && typeof value.session === 'string'
    && (value.claimed_by === null || typeof value.claimed_by === 'string')
    && (value.regression === null || isRegression(value.regression));
}

/** A heal as the view reads it: the keys it joins on, and the ones the shared card walks without a guard. */
function isAnswerHeal(value: unknown): value is AnswerHeal {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.status === 'string'
    && typeof value.started_at === 'number'
    && Array.isArray(value.signatures_claimed)
    && value.athena !== undefined
    && isNumbers(value.claimed_here)
    && (value.cured_here === null || isNumbers(value.cured_here));
}

/**
 * The heal worker's answer, read where it enters: the arrays the view walks and the keys it joins on, or a throw naming
 * what was wrong. A wrong shape thrown while the sheet draws would blank the workspace's whole main region, so it is
 * refused here and the view says the ledger could not be read.
 */
export function readSessionsAnswer(body: unknown): HealSessionsAnswer {
  if (!isRecord(body) || !Array.isArray(body.sessions) || !Array.isArray(body.items) || !Array.isArray(body.heals)) {
    throw new Error('the heal worker did not answer with the rows of those sessions');
  }
  if (!body.items.every(isAnswerItem) || !body.heals.every(isAnswerHeal)) {
    throw new Error('the heal worker answered a row or a heal this build cannot read');
  }
  return { sessions: body.sessions.filter(isText), items: body.items, heals: body.heals };
}

/** The ids to ask the worker for: the Claude session of each run, once, in the runs' order, leaving out any that is not a lowercase uuid. */
export function sessionIdsOf(runs: readonly UploadRunSummary[]): string[] {
  const ids = new Set<string>();
  for (const run of runs) {
    if (run.claude_session_id !== null && SESSION_ID.test(run.claude_session_id)) ids.add(run.claude_session_id);
  }
  return [...ids];
}

/** The ids cut into reads of at most `SESSIONS_PER_READ`, order kept so the newest runs' sessions are in the first read. */
export function chunkSessionIds(ids: readonly string[]): string[][] {
  const reads: string[][] = [];
  for (let at = 0; at < ids.length; at += SESSIONS_PER_READ) reads.push(ids.slice(at, at + SESSIONS_PER_READ));
  return reads;
}

const union = (first: number[], second: number[]): number[] => [...new Set([...first, ...second])];

/**
 * The answers of several reads as one. A row belongs to one session, so it is in one read; a heal can have claimed rows
 * of sessions in two, so its two cards are made one, with the row ids of both. Rows stay newest first.
 */
export function mergeAnswers(parts: readonly HealSessionsAnswer[]): HealSessionsAnswer {
  if (parts.length === 1) return parts[0];
  const heals = new Map<string, AnswerHeal>();
  for (const heal of parts.flatMap((part) => part.heals)) {
    const seen = heals.get(heal.id);
    heals.set(heal.id, seen === undefined ? heal : {
      ...seen,
      claimed_here: union(seen.claimed_here, heal.claimed_here),
      // The same heal says the same of its cure in every read (it is one column), so a silence in either is a silence.
      cured_here: seen.cured_here === null || heal.cured_here === null ? null : union(seen.cured_here, heal.cured_here),
    });
  }
  return {
    sessions: parts.flatMap((part) => part.sessions),
    items: parts.flatMap((part) => part.items).sort((first, second) => second.ts - first.ts),
    heals: [...heals.values()],
  };
}
