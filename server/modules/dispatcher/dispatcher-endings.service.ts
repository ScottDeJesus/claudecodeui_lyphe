import type { DispatcherEvent, DispatcherPlan } from '@/shared/types.js';

/**
 * Which dispatcher endings earn a notification, and the memory that makes each one push once.
 *
 * The dispatcher writes its endings into ONE log — the store's `events` table, whose ids come from a
 * single global sequence (`hooks/dispatcher/report.py`) — so three kinds of push share a single
 * watermark. The
 * watermark is on the EVENT ID and not on a timestamp, for a reason that is concrete rather than
 * stylistic: the dispatcher's own events are stamped by the clock at whatever minute they happened,
 * and two events can share a second while a hand-edited or replayed row can carry an older stamp
 * than the one before it. An id is a total order the store itself guarantees.
 *
 * "Already announced" is held by the caller in durable storage rather than in this process, for a
 * measured reason: the dev server restarts on every edit through a handover that runs the old and the
 * new server side by side, so a set kept in memory would re-announce the last day's endings on each
 * boot, and one seeded silently at boot would lose the ending that landed during the restart. Read again just before anything is sent, the mark also
 * keeps the two servers of a handover from pushing one ending twice.
 */

export type DispatcherEndingCode =
  | 'dispatcher.finished'
  | 'dispatcher.paused'
  | 'dispatcher.limit_paused'
  | 'dispatcher.relaunched';

export type DispatcherEndingMeta = {
  /** The plan's name — what the notification's own header reads ("Feature finished · <name>"). */
  sessionName: string;
  /** How many phases the plan has, and how many of them are `done`. */
  phases: number;
  done: number;
  /**
   * The plan's PAID spend over every stage of it (`plan.cost_usd`) — the counter the operator asked
   * never to reset, and 0 on a plan walked on the operator's Claude subscription, whose `tokens*`
   * below are then the whole of what it spent. The copy draws `$` only when this is > 0.
   */
  costUsd: number;
  /** The same plan's tokens, all of them, and the split beside it — what the copy says instead of `$0.00`. */
  tokens: number;
  tokensIn: number;
  tokensOut: number;
  /** The phase the event names, by its KEY, or `null` for a plan-level event (INV-183). */
  phase: string | null;
  /** The event's own sentence — for a relaunch, what was taken up again and by whom; for a pause the daemon held, its cause. `''` when it carries none. */
  detail: string;
  /** Epoch SECONDS a usage-limit pause lifts at (`dispatcher.limit_paused` only), else `null`. */
  resetsAt: number | null;
  /** True when that time is the dispatcher's own GUESS — the limit named none — and so not a time to promise. */
  limitGuess: boolean;
};

export type DispatcherEnding = {
  /** `<name>:<event id>` — one line of one plan's log, and the store makes that pair unique. */
  key: string;
  /** The event's own id: the watermark this ending advances. */
  eventId: number;
  code: DispatcherEndingCode;
  meta: DispatcherEndingMeta;
};

export type DispatcherEndingsDependencies = {
  /** The highest event id already announced, or `null` when none was ever stored. */
  readMark: () => number | null;
  writeMark: (eventId: number) => void;
  /** Tells the users about one ending. Synchronous; a throw leaves that ending and the ones after it due. */
  announce: (ending: DispatcherEnding) => void;
};

export type DispatcherEndingsNotifier = {
  /** Reads one picture of the lane — `GET /plans`' own picture, never a second read of the store. */
  observe(plans: DispatcherPlan[]): void;
};

/**
 * The three endings, and what each is worth saying.
 *
 * `complete` is the plan's own end: the dispatcher stamps `completed_at` OUTSIDE the eligibility gate
 * (INV-188), so this is the one event that means the whole plan is over. `paused` is every way a
 * walk stops needing a hand — the pause verb, a halt on an API error, the storm guard — and it is a
 * stop-and-look rather than a fault; a pause for a USAGE LIMIT is the same event told apart by its
 * lift-time tail (`limitPause`) and earns its own code, one push per wall. `relaunched` is the only one that reads as a warning: a phase the walk had
 * left standing was taken up again, usually because its build came back and said the work could
 * continue, and that is news the operator wants whether or not he asked for it.
 *
 * Everything else the dispatcher logs — a phase starting, a verb refused, a plan parked, a stamp
 * written — is either already on the card or a thing nobody is owed a phone buzz for.
 */
const ENDING_CODES = new Map<string, DispatcherEndingCode>([
  ['complete', 'dispatcher.finished'],
  ['paused', 'dispatcher.paused'],
  ['relaunched', 'dispatcher.relaunched'],
]);

/**
 * The tail the dispatcher writes after a usage limit's cause in a `paused` event's detail
 * (`hooks/dispatcher/backoff.py` `tail`): ` (until <UTC stamp>)` for a time the API named, and
 * ` (retry at <UTC stamp>)` for the dispatcher's own guess when the limit named none. Absent on every
 * pause that is not a usage limit — the operator's own Stop, a halt, the storm guard.
 */
const LIMIT_TAIL = / \((until|retry at) (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\)$/;

type LimitPause = { id: number; at: number; resetsAt: number; guess: boolean };

function limitPause(event: DispatcherEvent): LimitPause | null {
  if (event.kind !== 'paused') return null;
  const found = LIMIT_TAIL.exec(event.detail ?? '');
  const resetsAt = found === null ? Number.NaN : Date.parse(found[2]) / 1000;
  const at = Date.parse(event.at) / 1000;
  return Number.isFinite(resetsAt) && Number.isFinite(at)
    ? { id: event.id, at, resetsAt, guess: found?.[1] === 'retry at' }
    : null;
}

/**
 * How long an unnamed wall stays ONE wall: a guessed pause within this of the last guessed pause,
 * on any plan, is the same standing limit and stays silent. The dispatcher's flat backoff is 16
 * minutes and it stops guessing after three (`backoff.GUESS_LIMIT`), so one wall's pauses always
 * land inside it.
 */
const GUESS_WALL_S = 3600;

/** One event, as the notification it earns. `limit` is set only on a usage-limit pause. */
function endingOf(
  plan: DispatcherPlan,
  event: DispatcherEvent,
  code: DispatcherEndingCode,
  limit: LimitPause | null,
): DispatcherEnding {
  return {
    key: `${plan.name}:${event.id}`,
    eventId: event.id,
    code,
    meta: {
      sessionName: plan.name,
      phases: plan.phases.length,
      done: plan.phases.filter((phase) => phase.status === 'done').length,
      costUsd: plan.cost_usd,
      tokens: plan.tokens,
      tokensIn: plan.tokens_in,
      tokensOut: plan.tokens_out,
      phase: event.phase,
      detail: event.detail ?? '',
      resetsAt: limit?.resetsAt ?? null,
      limitGuess: limit?.guess ?? false,
    },
  };
}

/**
 * The usage-limit pauses that SPEAK — one push per wall, read off the log itself and never a memory
 * of this process (the log is the durable fact across the dev server's restarts):
 *
 * - a wall that NAMED its reset speaks once per lift time: only the lowest event id of each epoch.
 * - a wall that named none has no time to key on — the dispatcher's guess is per soul, so two plans
 *   capped ten seconds apart carry two epochs — so it speaks once, and stays silent while its pauses
 *   keep coming inside `GUESS_WALL_S` of one another.
 */
function speakingLimitPauses(plans: DispatcherPlan[]): Set<number> {
  const pauses: LimitPause[] = [];
  for (const plan of plans) {
    for (const event of plan.events) {
      const pause = limitPause(event);
      if (pause !== null) pauses.push(pause);
    }
  }
  pauses.sort((left, right) => left.id - right.id);
  const speaking = new Set<number>();
  const named = new Set<number>();
  let lastGuess: number | null = null;
  for (const pause of pauses) {
    if (pause.guess) {
      if (lastGuess === null || pause.at - lastGuess > GUESS_WALL_S) speaking.add(pause.id);
      lastGuess = pause.at;
    } else if (!named.has(pause.resetsAt)) {
      named.add(pause.resetsAt);
      speaking.add(pause.id);
    }
  }
  return speaking;
}

export function createDispatcherEndingsNotifier(
  dependencies: DispatcherEndingsDependencies,
): DispatcherEndingsNotifier {
  /** The mark as this process last read or wrote it; `undefined` until the first picture loads it. */
  let knownMark: number | null | undefined;

  /**
   * Every ending past the mark, oldest id first.
   *
   * Ordered because the pushes are read in order by whoever receives them: a plan that paused and
   * then completed while the server was down must not arrive as "finished" and then "paused". The
   * store's ids give that order across plans as well as within one, which is the second thing a
   * single global sequence buys.
   */
  const dueEndings = (plans: DispatcherPlan[], mark: number): DispatcherEnding[] => {
    const speaking = speakingLimitPauses(plans);
    const due: DispatcherEnding[] = [];
    for (const plan of plans) {
      for (const event of plan.events) {
        const code = ENDING_CODES.get(event.kind);
        if (code === undefined || event.id <= mark) continue;
        const limit = limitPause(event);
        // ONE push per wall, whichever plan it paused and however many minutes apart: see
        // `speakingLimitPauses`.
        if (limit !== null && !speaking.has(event.id)) continue;
        due.push(endingOf(plan, event, limit === null ? code : 'dispatcher.limit_paused', limit));
      }
    }
    return due.sort((left, right) => left.eventId - right.eventId);
  };

  /** The highest id in this picture — what a store never announced before is finished THROUGH. */
  const highestEventId = (plans: DispatcherPlan[]): number => {
    let highest = 0;
    for (const plan of plans) {
      for (const event of plan.events) {
        if (event.id > highest) highest = event.id;
      }
    }
    return highest;
  };

  return {
    observe(plans) {
      if (knownMark === undefined) knownMark = dependencies.readMark();
      if (knownMark === null) {
        // First sight of the dispatcher's store on this database: the events already in it are
        // HISTORY. This lane writes the highest id the store already holds — announce nothing that
        // was already there, and leave everything written after this moment due.
        const highest = highestEventId(plans);
        dependencies.writeMark(highest);
        knownMark = highest;
        return;
      }

      const cached = knownMark;
      if (dueEndings(plans, cached).length === 0) return;

      const mark = dependencies.readMark() ?? cached;
      knownMark = mark;
      for (const ending of dueEndings(plans, mark)) {
        dependencies.announce(ending);
        // Advanced after each announcement, never before: a throw leaves the rest due on the next
        // change and never marks a push that did not go out.
        dependencies.writeMark(ending.eventId);
        knownMark = ending.eventId;
      }
    },
  };
}
