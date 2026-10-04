import type { DispatcherArc, DispatcherEvent, DispatcherPlan } from '@/shared/types.js';

/**
 * Which dispatcher endings earn a notification, and the memory that makes each one push once.
 *
 * The dispatcher writes its endings into ONE log — the store's `events` table, whose ids come from a
 * single global sequence (`hooks/dispatcher/report.py`) — so every kind of push shares a single
 * watermark. The watermark is on the EVENT ID and not on a timestamp, for a reason that is concrete
 * rather than stylistic: the dispatcher's own events are stamped by the clock at whatever minute they
 * happened, and two events can share a second while a hand-edited or replayed row can carry an older
 * stamp than the one before it. An id is a total order the store itself guarantees.
 *
 * "Already announced" is held by the caller in durable storage rather than in this process, for a
 * measured reason: the dev server restarts on every edit through a handover that runs the old and the
 * new server side by side, so a set kept in memory would re-announce the last day's endings on each
 * boot, and one seeded silently at boot would lose the ending that landed during the restart. Read
 * again just before anything is sent, the mark also keeps the two servers of a handover from pushing
 * one ending twice. Every rule below that decides an ending is SILENT (the wall, a wave, an epic's
 * feature finishing) is therefore computed from the event history the picture carries and never
 * from what this process has already said.
 */

export type DispatcherEndingCode =
  | 'dispatcher.finished'
  | 'dispatcher.epic_finished'
  | 'dispatcher.paused'
  | 'dispatcher.limit_paused'
  | 'dispatcher.relaunched';

export type DispatcherEndingMeta = {
  /** The plan's name — what the notification's own header reads ("Feature finished · <name>"); the epic's on an epic ending. */
  sessionName: string;
  /** The epic the plan belongs to, or `null` for a plan in no epic; on an epic ending, the epic itself. The copy names it where it says further ones stay on the card. */
  epic: string | null;
  /** `dispatcher.epic_finished` only: how many features the epic holds, else `null`. */
  features: number | null;
  /**
   * `dispatcher.epic_finished` only: how many tasks those features hold — `null` when a feature has
   * left the lane (a plan completed more than a day ago is dropped from the picture,
   * `dispatcher-state.service.ts`) and its tasks can no longer be counted, which the copy leaves
   * out rather than understate.
   */
  tasks: number | null;
  /** How many phases the plan has, and how many of them are `done` — both 0 on an epic ending, which counts `features` and `tasks` instead. */
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
  /** `<name>:<event id>` — one line of one plan's log, and the store makes that pair unique; `epic:<epic>:<event id>` for an epic ending, keyed on the completion that finished it. */
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
  /**
   * Reads one picture of the lane — `GET /plans`' own picture, never a second read of the store: its
   * plans, and the epics (`arcs`) of the same document, whose `status` says when an epic is finished.
   */
  observe(plans: DispatcherPlan[], arcs: DispatcherArc[]): void;
};

/**
 * The three kinds of event that can earn a push, and what each is worth saying.
 *
 * `complete` is the plan's own end: the dispatcher stamps `completed_at` OUTSIDE the eligibility gate
 * (INV-188), so this is the one event that means the whole plan is over. `paused` is every way a
 * walk stops needing a hand — the pause verb, a halt on an API error, the storm guard — and it is a
 * stop-and-look rather than a fault; a pause for a USAGE LIMIT is the same event told apart by its
 * lift-time tail (`limitPause`) and earns its own code, one push per wall. `relaunched` is the only
 * one that reads as a warning: a phase the walk had left standing was taken up again, usually because
 * its build came back and said the work could continue, and that is news the operator wants whether
 * or not he asked for it.
 *
 * A plan in no epic pushes each of them as it happens. A FEATURE OF AN EPIC (`plan.arc` set) is read
 * as one piece of work with its siblings, and tells the operator less, and tells him once:
 * - its `complete` pushes nothing; the EPIC's finish does, once (`epicFinishes`,
 *   `dispatcher.epic_finished`);
 * - its `relaunched` and its `paused` push once per wave of trouble of that kind on that epic
 *   (`waveStarters`) — the rest stay on the card;
 * - a usage-limit pause keeps the wall rule, which is already one push per wall.
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
      epic: plan.arc,
      features: null,
      tasks: null,
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

/**
 * How long an epic's trouble of one kind stays ONE wave: an event with another of its kind on the
 * same epic inside this of it is the same wave. The window slides from the wave's LAST event and
 * never from its last push, so a long run of retries is one push and trouble that returns after a
 * quiet hour is a new wave. The copy promises "an hour" (`notification-copy.service.ts`).
 */
const WAVE_S = 3600;

/** What an epic's features say once per wave. Retries and stops are separate waves, so neither hides the other. */
const WAVE_KINDS: ReadonlySet<string> = new Set(['relaunched', 'paused']);

/**
 * The event ids that open a wave — the only `relaunched` and `paused` events of an epic's features
 * that push. An event opens one when no event of its kind on ANY feature of the same epic landed
 * within `WAVE_S` before it. A usage-limit pause belongs to the wall rule whether or not it speaks,
 * so it neither opens nor joins a wave: a run of wall pauses must not hide a halt behind it.
 */
function waveStarters(plans: DispatcherPlan[]): Set<number> {
  const starters = new Set<number>();
  const waves = new Map<string, { id: number; at: number }[]>();
  for (const plan of plans) {
    if (plan.arc === null) continue;
    for (const event of plan.events) {
      if (!WAVE_KINDS.has(event.kind) || limitPause(event) !== null) continue;
      const at = Date.parse(event.at) / 1000;
      // A stamp that does not parse cannot prove a quiet hour or a busy one; the conservative
      // direction is the one the operator can see, so it speaks.
      if (!Number.isFinite(at)) {
        starters.add(event.id);
        continue;
      }
      const key = `${plan.arc}\u0000${event.kind}`;
      waves.set(key, [...(waves.get(key) ?? []), { id: event.id, at }]);
    }
  }
  for (const events of waves.values()) {
    events.sort((left, right) => left.id - right.id);
    let latest = Number.NEGATIVE_INFINITY;
    for (const event of events) {
      if (event.at - latest > WAVE_S) starters.add(event.id);
      latest = Math.max(latest, event.at);
    }
  }
  return starters;
}

/** `hooks/dispatcher/store_arcs.py` `JUDGMENT_SUFFIX`: the judgment plan of an arc designed whole is `<arc>--judgment`. */
const JUDGMENT_SUFFIX = '--judgment';

/**
 * The epics that are finished, one ending each, keyed on the completion that finished them.
 *
 * An epic is finished when its own `status` reads `complete` — every feature carries its stamp, an
 * arc's judgment included, and the roadmap holds no feature still to be designed — so the arc's word
 * is the one reading of that, and the history cannot supply it (a roadmap idea has no plan on the
 * lane). The ending is keyed on the newest `complete` event of the epic's features, which is the
 * completion that left it complete: one finish gives one ending however many features completed in
 * the same picture, and a reopened epic that finishes again has a newer completion and so earns a
 * new one. An epic that is not yet complete says nothing, and says it when its status turns IF that
 * turn came with a new completion.
 *
 * THE LIMIT: a status that turns `complete` with NO new completion — the roadmap's `remove` deleting
 * the last idea an epic held writes no event — leaves nothing to key on. The watermark has usually
 * passed the epic's newest completion by then (pushes advance it, and a feature's own `complete` is
 * silent), so that finish is never announced. Curing it needs the dispatcher to log an event when an
 * arc becomes complete; until it does, the epic is complete on its card and silent on the phone.
 *
 * `features` and `tasks` are counted over the epic's features (its judgment is a review, not a
 * feature); the spend is the arc's own sum, which includes features the lane has already put away.
 */
function epicFinishes(plans: DispatcherPlan[], arcs: DispatcherArc[]): DispatcherEnding[] {
  const finishes: DispatcherEnding[] = [];
  for (const arc of arcs) {
    if (arc.status !== 'complete') continue;
    const onLane = new Map<string, DispatcherPlan>();
    let completedAt = 0;
    for (const plan of plans) {
      if (plan.arc !== arc.name) continue;
      onLane.set(plan.name, plan);
      for (const event of plan.events) {
        if (event.kind === 'complete' && event.id > completedAt) completedAt = event.id;
      }
    }
    if (completedAt === 0) continue;
    const featureNames = arc.plans.filter((name) => name !== `${arc.name}${JUDGMENT_SUFFIX}`);
    const countable = featureNames.every((name) => onLane.has(name));
    finishes.push({
      key: `epic:${arc.name}:${completedAt}`,
      eventId: completedAt,
      code: 'dispatcher.epic_finished',
      meta: {
        sessionName: arc.name,
        epic: arc.name,
        features: featureNames.length,
        tasks: countable
          ? featureNames.reduce((sum, name) => sum + (onLane.get(name)?.phases.length ?? 0), 0)
          : null,
        phases: 0,
        done: 0,
        costUsd: arc.cost_usd,
        tokens: arc.tokens,
        tokensIn: arc.tokens_in,
        tokensOut: arc.tokens_out,
        phase: null,
        detail: '',
        resetsAt: null,
        limitGuess: false,
      },
    });
  }
  return finishes;
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
  const dueEndings = (plans: DispatcherPlan[], arcs: DispatcherArc[], mark: number): DispatcherEnding[] => {
    const speaking = speakingLimitPauses(plans);
    const waveStart = waveStarters(plans);
    const due: DispatcherEnding[] = [];
    for (const plan of plans) {
      for (const event of plan.events) {
        const code = ENDING_CODES.get(event.kind);
        if (code === undefined || event.id <= mark) continue;
        const limit = limitPause(event);
        // ONE push per wall, whichever plan it paused and however many minutes apart: see
        // `speakingLimitPauses`.
        if (limit !== null && !speaking.has(event.id)) continue;
        // A feature of an epic speaks only for the event that opens a wave; its `complete` is never
        // one, because the epic's own finish (below) is what the operator is told: see `waveStarters`.
        if (limit === null && plan.arc !== null && !waveStart.has(event.id)) continue;
        due.push(endingOf(plan, event, limit === null ? code : 'dispatcher.limit_paused', limit));
      }
    }
    for (const finish of epicFinishes(plans, arcs)) {
      if (finish.eventId > mark) due.push(finish);
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
    observe(plans, arcs) {
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
      if (dueEndings(plans, arcs, cached).length === 0) return;

      const mark = dependencies.readMark() ?? cached;
      knownMark = mark;
      for (const ending of dueEndings(plans, arcs, mark)) {
        dependencies.announce(ending);
        // Advanced after each announcement, never before: a throw leaves the rest due on the next
        // change and never marks a push that did not go out.
        dependencies.writeMark(ending.eventId);
        knownMark = ending.eventId;
      }
    },
  };
}
