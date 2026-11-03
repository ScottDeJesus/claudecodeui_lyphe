import { FOLLOWUP_TEXT_MAX } from '@/modules/followups/index.js';

import { buildFlagSentences } from './dispatcher-build-flags.reader.js';
import type { DocumentPlan } from './dispatcher-plan.reader.js';

/**
 * What a finished feature's builders flagged, filed as gaps on the feature's chat — once, when the feature finishes.
 *
 * WHY. A builder has no `followups` door, so what it saw and did not change (a file over the ceiling, a probe it could
 * not run, a ruling it needs) stays in its report in the chain, which nobody opens once the feature is done. The chat that
 * designed the feature is where its person looks next, so the lines go there, as gaps, marked as a build's.
 *
 * WHICH CHAT. The plan's `session` (`plans.session`): the loader stamps it with the session that owns the plan's rows
 * (`store.owner_session`) — the chat of the design outing, or of the tell outing when a tell made the plan — and no later
 * tell moves it. The planner entries of the document carry no session, so this is the one chat the document names.
 *
 * WHICH LINES. For each builder stage, the first sentence of each top-level flag in its report (`dispatcher-build-flags.reader.ts`),
 * each as `[build] <feature>: <sentence>`, cut at a word end to fit the followups line ceiling. The marker is the smallest
 * thing that tells a reader the gap came from a build and not from the chat's own turns; the kind is `gap`, never `next`.
 *
 * ONCE, AND GOING FORWARD ONLY. A plan finishing is a `complete` event in its log, and the events carry one global sequence,
 * so the filer keeps the highest event id it has handled (`readMark`/`writeMark`, kept durably by the caller) exactly as the
 * endings notifier does. The first time it sees the store it writes the highest id the store holds and files NOTHING: the
 * features that finished before this existed are history, and filing them would flood each of their chats at once. A mark moves
 * only after its feature was handled, so a throw leaves the feature due on the next call. Past the mark, the lane's own rule
 * (`fileGapsForChat`) refuses to file a line the chat already holds in any state, which is what makes a second pass over the
 * same feature — a restart, the dev API's two servers side by side, a plan that finishes again — file nothing new.
 *
 * Consumed by `dispatcher-followups.module.ts` (`createBuildGapsFiler`, handed the store's plans on each poll), which supplies the
 * report reader, the chat lookup, the filing door and the mark.
 */

/** The marker every filed line starts with: it says "a build flagged this" and nothing else. */
const BUILD_GAP_MARKER = '[build]';

/** The parts of a plan this reads: its name, its chat, its phases' stages (for the reports) and its log (for the finish). */
type BuildGapsPlan = Pick<DocumentPlan, 'name' | 'session' | 'phases' | 'events'>;

type BuildGapsDependencies = {
  /** A stage report's text, or `null` when the file is gone. */
  readReport: (path: string) => string | null;
  /** The app session id of the chat the plan's `session` names, or `null` when this house holds no such chat. */
  chatOf: (session: string) => string | null;
  /** Files the lines as gaps on the chat and answers how many it wrote, or `null` when it could not name the chat's account and wrote nothing. */
  fileGaps: (appSessionId: string, lines: string[]) => number | null;
  /** One line to the journal. */
  journal: (line: string) => void;
};

/** What `fileBuildGaps` did: the lines it built, and how it ended — `filed` (with how many were new), `no-chat` or `no-account`. */
type BuildGapsFiling = { lines: string[]; outcome: 'filed' | 'no-chat' | 'no-account'; filed: number };

/**
 * One flag as the line says it: the marker, the feature, the sentence — cut to `FOLLOWUP_TEXT_MAX` at a word end, with an
 * ellipsis where it was cut. `null` when the feature's name leaves no room for a sentence.
 */
function gapLine(feature: string, sentence: string): string | null {
  const prefix = `${BUILD_GAP_MARKER} ${feature}: `;
  const room = FOLLOWUP_TEXT_MAX - prefix.length;
  if (room < 2) return null;
  if (sentence.length <= room) return prefix + sentence;

  // One character of the room is the ellipsis. Cut where a word ends: back to the last space unless the cut already falls on one.
  const kept = sentence.slice(0, room - 1);
  const wordEnd = sentence[room - 1] === ' ' ? kept.length : kept.lastIndexOf(' ');
  const whole = wordEnd > 0 ? kept.slice(0, wordEnd) : kept;
  // A hard cut (no space to cut at) must not leave half of a surrogate pair at the end.
  return `${prefix}${whole.replace(/[\uD800-\uDBFF]$/, '').replace(/[\s,;:(\-–—]+$/u, '')}…`;
}

/**
 * Files the flags of one finished feature's builders as gaps on its chat. It reads no mark and writes none — the caller decides
 * WHEN (`createBuildGapsFiler`); this decides what and where. A feature whose chat is gone files nothing and writes one journal
 * line, as one whose chat's account cannot be named does; neither is retried, because neither will be different next time.
 */
function fileBuildGaps(plan: BuildGapsPlan, dependencies: BuildGapsDependencies): BuildGapsFiling {
  const chat = plan.session === null ? null : dependencies.chatOf(plan.session);
  if (chat === null) {
    dependencies.journal(
      `[Dispatcher] ${plan.name} finished, but its chat (${plan.session ?? 'none named'}) is not in this house: its build flags were not filed`,
    );
    return { lines: [], outcome: 'no-chat', filed: 0 };
  }

  const lines = buildFlagSentences(plan.phases, dependencies.readReport).flatMap((sentence) => {
    const line = gapLine(plan.name, sentence);
    return line === null ? [] : [line];
  });
  if (lines.length === 0) return { lines, outcome: 'filed', filed: 0 };

  const filed = dependencies.fileGaps(chat, lines);
  if (filed === null) {
    dependencies.journal(`[Dispatcher] ${plan.name} finished, but the account of its chat ${chat} cannot be named: its ${lines.length} build flag(s) were not filed`);
    return { lines, outcome: 'no-account', filed: 0 };
  }

  if (filed > 0) dependencies.journal(`[Dispatcher] ${plan.name} finished: filed ${filed} build gap(s) on chat ${chat}`);
  return { lines, outcome: 'filed', filed };
}

/** What the filer keeps durably: the highest event id handled. `null` when none was ever stored. */
type BuildGapsMark = { readMark: () => number | null; writeMark: (eventId: number) => void };

type BuildGapsFiler = {
  /** Reads the store's plans: files the build gaps of every plan that finished since the mark, oldest finish first. Throws on a write that failed, leaving that plan due. */
  observe(plans: BuildGapsPlan[]): void;
};

/** The highest event id any plan's log holds — what a store never seen before is handled THROUGH. */
function highestEventId(plans: BuildGapsPlan[]): number {
  let highest = 0;
  for (const plan of plans) {
    for (const event of plan.events) {
      if (event.id > highest) highest = event.id;
    }
  }
  return highest;
}

/**
 * The filer: `observe` is called with the store's plans on each poll and files the build gaps of every plan that finished since the
 * mark. Consumed by `dispatcher-followups.module.ts`, which builds it once with the real report reader, chat lookup and filing door.
 */
export function createBuildGapsFiler(dependencies: BuildGapsDependencies & BuildGapsMark): BuildGapsFiler {
  /** The mark as this process last read or wrote it; `undefined` until the first look. */
  let known: number | null | undefined;

  return {
    observe(plans) {
      if (known === undefined) known = dependencies.readMark();
      if (known === null) {
        // First sight of the store on this database: what finished already is history, so nothing is filed for it.
        const highest = highestEventId(plans);
        dependencies.writeMark(highest);
        known = highest;
        return;
      }

      const mark = known;
      const finishes = plans
        .flatMap((plan) => plan.events.filter((event) => event.kind === 'complete' && event.id > mark).map((event) => ({ plan, eventId: event.id })))
        .sort((left, right) => left.eventId - right.eventId);

      for (const { plan, eventId } of finishes) {
        fileBuildGaps(plan, dependencies);
        // Moved after the feature was handled, never before: a throw above leaves it due on the next call.
        dependencies.writeMark(eventId);
        known = eventId;
      }
    },
  };
}
