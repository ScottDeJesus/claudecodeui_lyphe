import type { CompanionSettings } from '@/shared/companion-types.js';

import { CLOSING_LINES, closingPoint, noticeText, tidyNote } from './companion-notice.js';
import type { CompanionCli, CompanionContextReading } from './companion-process.js';

/**
 * Her own compaction for one account's conversation. Her CLI never summarizes her (`companion-launch.ts`); when her conversation nears full
 * she gets ONE last turn, keeps what matters with `recall` and `remember`, and writes a note to a fresh her; then the old conversation ends and
 * the next begins from that note as the fresh-start `<handover>` (`companion-message.ts`). The numbers and the words are `companion-notice.ts`;
 * this file is the machine, and `companion-session.ts` only calls into it.
 *
 * THE READING: at the end of every turn that left her process up, her CLI is asked for its own count of her context (`contextUsage`: a control
 * request, no API call). Her last turn begins only if, once the reading is back, the same launch is still live, no turn is in flight, no closing
 * is under way and the total is at or past `closingPoint`: she is never cut off mid-answer, and a word of his that started a turn meanwhile is
 * read again at that turn's end.
 *
 * HER LAST TURN is the notice, alone: it never goes through the assembler, so no roster, view, register, state or cut rides it. It is quiet to
 * the page (the session keeps it off while `inLastTurn`) and her tools open only `recall` and `remember`. From its start until the fresh start,
 * every push of his, every alert and every focus news waits (`holding`, `park`); his words are on disk already, and the first of them plans the
 * fresh launch. Its own bound, `COMPANION_CLOSING_WAIT_MS` (180,000, read at the call), interrupts the CLI and ends it `timed out`.
 *
 * THE END: her final text, tidied, is stored on her row as the handover; without one (the turn failed, ran out its bound, wrote under
 * `NOTE_MIN_CHARS`, or the store of it failed) the house summarizer writes it from the thread. THEN, whatever came of it, the old conversation ends, the panel and the
 * journal say so, and the waiting words are delivered. The handover is stored before the conversation is forgotten, as the refusal does
 * (`companion-refusal.ts`): a crash between the two leaves it held, and the next session reads it again and closes it. THE WALL: a turn answered
 * "Prompt is too long" means the CLI's own limit was reached and a last turn would be refused too: `full` writes the house's handover and ends it at once.
 *
 * `arm` and `afterTurn` are reached by a normal turn and never throw or reject: a fault of the closing is a journal line. Nothing polls.
 */

const DEFAULT_WAIT_MS = 180_000;

/** The bound on her last turn in milliseconds: `COMPANION_CLOSING_WAIT_MS` when a positive whole number a timer can hold (at most 2,147,483,647: Node makes a longer delay 1 ms; a probe's seam, read at the call), else the default. */
function waitMs(): number {
  const raw = process.env.COMPANION_CLOSING_WAIT_MS?.trim();
  const value = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : 0;
  return value > 0 && value <= 2_147_483_647 ? value : DEFAULT_WAIT_MS;
}

/** The slice of the session's launch the closing needs; launches are compared by identity with `live()`. */
type ClosingLaunch = { cli: CompanionCli };

/** What the closing asks of the session, each a closure over what the session holds. */
type ClosingHooks = {
  live(): ClosingLaunch | null;
  /** A turn is in the CLI: one in flight, or a stop still being answered. */
  turnInFlight(): boolean;
  /** Gives the notice, bare, to the live launch through the ledger and the tracker; answers its uuid. */
  sayNotice(text: string): string;
  /** Detaches the launch, forgets the held conversation and the assembler's memory of it, and closes the launch. */
  endConversation(launch: ClosingLaunch): void;
  writeHandover(text: string): void;
  /** The house summarizer's handover of the conversation, `null` when it could not be written. */
  makeHandover(sessionId: string, signal: AbortSignal): Promise<string | null>;
  conversationId(): string | null;
  say(line: string): void;
  readSettings(): Pick<CompanionSettings, 'operatorName' | 'name'>;
};

/** One closing, from its start until she has started fresh. `lastTurn`: the notice was given (a wall's refusal gives none). `ended`: the last turn's end was taken, so a later report of it (the aborted result after the bound) is ignored. */
type Attempt = {
  launch: ClosingLaunch;
  abort: AbortController;
  conversation: string | null;
  lastTurn: boolean;
  noticeUuid: string | null;
  startedAt: number;
  startTotal: number;
  deadline: NodeJS.Timeout | null;
  ended: boolean;
};

/** How a last turn ended: with its final text, or without a note. (His Stop and a cut leave it running; a close or Clear abandons it.) */
type LastTurnEnd = { answered: true; text: string | null } | { answered: false; why: 'failed' | 'timed out' };

const sizeOf = (text: string | null): string => (text === null ? 'none' : `${text.length} characters`);

/** Why there is no note, for the ends line. */
function whyNoNote(outcome: LastTurnEnd): string {
  if (!outcome.answered) return outcome.why === 'timed out' ? `it ran past its bound of ${Math.round(waitMs() / 1000)} s` : 'the turn failed';
  return outcome.text?.trim() ? 'it was under the least that counts as a note' : 'she wrote nothing';
}

/** Consumed by `companion-session.ts`: one call per account's conversation. */
export function createClosing(userId: number, hooks: ClosingHooks) {
  let attempt: Attempt | null = null;
  let parked: Array<() => void> = [];

  const journal = (line: string): void => console.log(`[Companion] account ${userId}: ${line}`);

  /** `work` with its failure a journal line, never a fault of her turn. `holds` is the closing the work concludes: failing with it still current, it is released, so no fault leaves her pushes waiting for ever. */
  function spawn(label: string, work: () => Promise<void>, holds?: Attempt): void {
    work().catch((error: unknown) => {
      console.error(`[Companion] account ${userId}: her closing failed (${label})`, error);
      if (holds !== undefined && attempt === holds) release();
    });
  }

  /** A step that may fail without stopping the closing: a failure is a journal line and the step answers `fallback`. */
  function attemptTo<T>(what: string, step: () => T, fallback: T): T {
    try {
      return step();
    } catch (error) {
      console.error(`[Companion] account ${userId}: her closing could not ${what}`, error);
      return fallback;
    }
  }

  /** Her CLI's reading, or `null` when it throws. */
  async function read(launch: ClosingLaunch): Promise<CompanionContextReading | null> {
    try {
      return await launch.cli.contextUsage();
    } catch (error) {
      console.warn(`[Companion] account ${userId}: her context could not be read`, error);
      return null;
    }
  }

  const newAttempt = (launch: ClosingLaunch, lastTurn: boolean, startTotal: number): Attempt => ({
    launch,
    abort: new AbortController(),
    conversation: attemptTo("read the held conversation's id", () => hooks.conversationId(), null),
    lastTurn,
    noticeUuid: null,
    startedAt: Date.now(),
    startTotal,
    deadline: null,
    ended: !lastTurn,
  });

  /** She has started fresh (or never needed to): holding ends first so nothing parks again, then what waited runs, in the order it came. */
  function release(): void {
    attempt = null;
    const waiting = parked;
    parked = [];
    for (const action of waiting) attemptTo('deliver a message that waited', action, undefined);
  }

  /** The house summarizer's handover for this closing's conversation, or `null`. */
  async function houseHandover(mine: Attempt): Promise<string | null> {
    if (mine.conversation === null) return null;
    try {
      return await hooks.makeHandover(mine.conversation, mine.abort.signal);
    } catch (error) {
      if (!mine.abort.signal.aborted) console.error(`[Companion] account ${userId}: the house's handover could not be made`, error);
      return null;
    }
  }

  /** Stores the handover and answers it, or `null` when the store failed: what is said and journaled is what the fresh start will carry. */
  function store(text: string | null): string | null {
    if (text === null) return null;
    return attemptTo(
      'store her handover',
      () => {
        hooks.writeHandover(text);
        return text;
      },
      null
    );
  }

  /** The handover is stored; the old conversation ends whatever came of it (holding for ever is worse than a conversation not ended cleanly). */
  function startFresh(mine: Attempt, line: string): void {
    attemptTo('end her old conversation cleanly', () => hooks.endConversation(mine.launch), undefined);
    attemptTo('put its line on her panel', () => hooks.say(line), undefined);
  }

  /** Her last turn is over: her note or the house's handover, stored; then the fresh start. Does nothing once abandoned. */
  async function conclude(mine: Attempt, outcome: LastTurnEnd): Promise<void> {
    const note = tidyNote(outcome.answered ? outcome.text : null);
    // The reading and the house's handover are independent: a slow CLI does not wait on the summarizer, or the reverse.
    const [after, house] = await Promise.all([read(mine.launch), note === null ? houseHandover(mine) : Promise.resolve(null)]);
    if (attempt !== mine) return;
    let kept = store(note ?? house);
    let byHouse = note === null;
    // Her note was finished but could not be stored: the house's handover is the next best, so a failed write does not lose the account of the conversation.
    if (kept === null && note !== null) {
      kept = store(await houseHandover(mine));
      if (attempt !== mine) return;
      byHouse = true;
    }
    startFresh(mine, kept === null ? CLOSING_LINES.neither : byHouse ? CLOSING_LINES.handedOver : CLOSING_LINES.noted);
    const noteSaid = byHouse ? `none (${note === null ? whyNoNote(outcome) : 'it could not be stored'})` : sizeOf(note);
    const seconds = Math.round((Date.now() - mine.startedAt) / 1000);
    const cost = after === null ? '?' : after.total - mine.startTotal;
    journal(
      `her last turn ended ${outcome.answered ? 'answered' : outcome.why} after ${seconds} s at ${after?.total ?? '?'} tokens (${cost} of it); her note: ${noteSaid}, the house wrote ${sizeOf(byHouse ? kept : null)}; she starts fresh`
    );
    release();
  }

  /** The last turn's end is taken once; the bound's timer goes with it. */
  function endLastTurn(mine: Attempt, outcome: LastTurnEnd): void {
    if (mine.ended) return;
    mine.ended = true;
    if (mine.deadline !== null) clearTimeout(mine.deadline);
    spawn('the end of her last turn', () => conclude(mine, outcome), mine);
  }

  /** The bound passed: her CLI is interrupted through its own handle (issued first, so the reading after the turn's end asks a CLI already told to stop) and the turn ends without a note. The aborted result that follows is ignored. */
  function timeOut(mine: Attempt): void {
    if (attempt !== mine || mine.ended) return;
    spawn('the interrupt at the bound', async () => {
      if (hooks.live() === mine.launch) await mine.launch.cli.interrupt();
    });
    endLastTurn(mine, { answered: false, why: 'timed out' });
  }

  /** Her last turn begins: holding and the quiet start first, then the notice. A notice that cannot be given ends the turn failed, so the closing is never left holding. */
  function begin(launch: ClosingLaunch, reading: CompanionContextReading, point: number): void {
    const mine = newAttempt(launch, true, reading.total);
    // Set before the notice is given: the tracker's turn start is already kept off the page, and every push already waits.
    attempt = mine;
    journal(`conversation ${mine.conversation ?? 'unknown'} is at ${reading.total} tokens (she closes at ${point}); her last turn begins`);
    attemptTo('put its line on her panel', () => hooks.say(CLOSING_LINES.begins), undefined);
    try {
      const { operatorName, name } = hooks.readSettings();
      mine.noticeUuid = hooks.sayNotice(noticeText({ operatorName, name }));
      mine.deadline = setTimeout(() => timeOut(mine), waitMs());
      mine.deadline.unref();
    } catch (error) {
      console.error(`[Companion] account ${userId}: her last turn's notice could not be given`, error);
      endLastTurn(mine, { answered: false, why: 'failed' });
    }
  }

  /** The reading at a turn's end, and the decision it feeds. */
  async function considerClosing(launch: ClosingLaunch): Promise<void> {
    if (attempt !== null) return;
    const reading = await read(launch);
    // Decided only now it is back: the launch may have ended, a word of his may have started a turn, another reading may have begun the closing.
    if (reading === null || attempt !== null || hooks.live() !== launch || hooks.turnInFlight()) return;
    const point = closingPoint(reading);
    if (reading.total >= point) begin(launch, reading, point);
  }

  /** The armed line: what her CLI says of its own compaction, once per launch. */
  async function announce(launch: ClosingLaunch): Promise<void> {
    const reading = await read(launch);
    if (hooks.live() !== launch) return;
    if (reading === null) return journal("her context could not be read at launch; each turn's end reads it again");
    journal(
      reading.cliCompacts
        ? `her CLI still compacts on its own at ${reading.window - reading.reserve}; DISABLE_COMPACT did not reach it; she closes herself first, at ${closingPoint(reading)}`
        : `armed: her CLI's own compaction is off, its window ${reading.window}; she closes herself at ${closingPoint(reading)}`
    );
  }

  /** The wall's refusal handled: the house's handover, the conversation ended, then what waited. */
  async function concludeFull(mine: Attempt): Promise<void> {
    const kept = store(await houseHandover(mine));
    if (attempt !== mine) return;
    startFresh(mine, kept === null ? CLOSING_LINES.fullNeither : CLOSING_LINES.fullHandedOver);
    journal(`conversation ${mine.conversation ?? 'unknown'} reached her CLI's limit (Prompt is too long); the house wrote ${sizeOf(kept)}; she starts fresh`);
    release();
  }

  return {
    /** At a launch's first `init`: reads her CLI once and journals the armed line. */
    arm(launch: ClosingLaunch): void {
      spawn('the armed line', () => announce(launch));
    },
    /** A turn ended with `launch` still hers: reads her context and, at or past `closingPoint` with no turn in flight, begins her last turn. Never rejects. */
    afterTurn(launch: ClosingLaunch): void {
      spawn("the reading at a turn's end", () => considerClosing(launch));
    },
    /** True while her last turn runs and until the old conversation has ended: her tools read it, and the session keeps that turn off the page. */
    get inLastTurn(): boolean {
      return attempt?.lastTurn === true;
    },
    /** True from her last turn's start (or the wall's refusal) until she has started fresh: a push, a warm and an alert wait. */
    holding(): boolean {
      return attempt !== null;
    },
    /** Runs `action` once she has started fresh, after every action parked before it; with no closing under way it runs at once. */
    park(action: () => void): void {
      if (attempt === null) action();
      else parked.push(action);
    },
    /** True when a result lists the notice, from the notice until the old conversation has ended. */
    isLastTurnResult(answered: readonly string[]): boolean {
      return attempt?.lastTurn === true && attempt.noticeUuid !== null && answered.includes(attempt.noticeUuid);
    },
    /** The CLI's result for the notice: answered with its final text, or not answered and why. A call after the turn's end was taken is ignored. */
    lastTurnEnded(outcome: LastTurnEnd): void {
      if (attempt?.lastTurn === true) endLastTurn(attempt, outcome);
    },
    /** A turn answered "Prompt is too long": the house's handover, the fresh start; his words of that turn are carried by the caller's parks. */
    full(launch: ClosingLaunch): void {
      if (attempt !== null) return;
      const mine = newAttempt(launch, false, 0);
      attempt = mine;
      spawn("the wall's refusal", () => concludeFull(mine), mine);
    },
    /** Clear or a close: the closing stops, nothing is stored, nothing parked runs; his parked words stay in the ledger. True when one was under way. */
    abandon(): boolean {
      const ending = attempt;
      if (ending?.deadline) clearTimeout(ending.deadline);
      ending?.abort.abort();
      attempt = null;
      parked = [];
      return ending !== null;
    },
  };
}
