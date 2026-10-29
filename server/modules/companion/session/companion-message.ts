import type { CompanionDraft, CompanionSessionRef, CompanionSettings, CompanionWalk } from '@/shared/companion-types.js';

import { cutEnvelope, registerEnvelope, sessionsEnvelope, stateEnvelope, viewEnvelope } from './companion-envelopes.js';
import { fillRegister } from './companion-prompt.js';

/**
 * Every message she is pushed is assembled at the moment it is pushed, in this order, and nothing is
 * pushed silently — whatever she is told reaches her inside a message she answers:
 *   1. `<state>`, owed once after her memory was compacted (the conversation that held the focus, the
 *      draft and the walk is gone, so they are restated);
 *   2. `<cut>`, owed once after he cut her off (`oweCut`, set by the companion's speech cut);
 *   3. `<sessions>`, on a wake, then only when its text differs from the last one sent;
 *   4. `<view>`, on the same rule;
 *   5. the body — an `<operator>`, one or more `<alert>`s, or a `<session>`;
 *   6. `<register>`, read from his settings EVERY time: he edits it, so it is never stale. The sounds it lists are
 *      the account's sound-tag list, read at the same moment.
 * The roster and the view are compared by their TEXT, not by the envelope: `<sessions at="HH:MM">`
 * carries the clock, which changes every minute whether or not a chat did. A message pushed to a
 * process that was asleep (`woke`) always carries both, because a resumed conversation's memory of the
 * roster is hours old.
 *
 * Consumers: `session/companion-session.ts`, which owns one assembler per account's conversation.
 */

/**
 * What the assembler reads at push time: his settings (the register is filled from them), the facts
 * `<state>` restates, the roster body, the chat on his screen and the sounds she may make. Each is read when a
 * message is assembled and never earlier, so what she is told is how things stand as it reaches her.
 * `readSoundTags` is the account's one sound-tag list: the register teaches exactly the list the parse keeps
 * (the turn tracker reads the same reader when a turn begins). Consumed by `companion-session-types.ts`,
 * whose `CompanionSessionDeps` carries the five.
 */
export type MessageReaders = {
  readSettings(): CompanionSettings;
  readState(): { focus: CompanionSessionRef | null; draft: CompanionDraft | null; walk: CompanionWalk | null };
  readRoster(): string;
  readView(): Pick<CompanionSessionRef, 'sessionId' | 'name'> | null;
  readSoundTags(): readonly string[];
};

/** What `createMessageAssembler` answers; the session holds one per account. */
type MessageAssembler = {
  /** Her memory was compacted: the next message restates the focus, the draft and the walk. */
  oweState(): void;
  /** He cut her off: the next message opens with `<cut>`, naming the last sentence he heard to its end and the one playing at the press (`null` for none). A later cut replaces one no message has carried yet. */
  oweCut(heard: string | null, interrupted: string | null): void;
  /** The cut the next message will open with (`''` for no such sentence), or `null` when none is owed. Read before `assemble`, which carries it. */
  owedCut(): { heard: string; interrupted: string } | null;
  /** The text of one message: the owed parts, the roster and view when due, `body`, and the register. */
  assemble(body: string, woke: boolean): string;
  /** Her conversation was cleared: nothing is owed and nothing is remembered as sent. */
  forget(): void;
};

/** Consumed by `companion-session.ts`; `now` is the clock `<sessions>` is stamped from. */
export function createMessageAssembler(readers: MessageReaders, now: () => Date = () => new Date()): MessageAssembler {
  let stateOwed = false;
  // An empty `heard` or `interrupted` is a cut with no such sentence (`<cut heard="" interrupted="…"/>`); `null` is no cut owed.
  let cutOwed: { heard: string; interrupted: string } | null = null;
  let lastRoster: string | null = null;
  let lastView: string | null = null;

  return {
    oweState() {
      stateOwed = true;
    },
    oweCut(heard, interrupted) {
      cutOwed = { heard: heard ?? '', interrupted: interrupted ?? '' };
    },
    owedCut: () => cutOwed,
    assemble(body, woke) {
      // Everything is READ first and the bookkeeping committed last: a reader that throws leaves the owed
      // state and cut owed and the roster unsent, so the next message carries what this one never did.
      const parts: string[] = [];
      // `<state>` is empty when nothing is held; an owed state with nothing to say sends nothing.
      const state = stateOwed ? stateEnvelope(readers.readState()) : '';
      if (state !== '') parts.push(state);
      if (cutOwed !== null) parts.push(cutEnvelope(cutOwed.heard, cutOwed.interrupted));
      const roster = readers.readRoster();
      if (woke || roster !== lastRoster) parts.push(sessionsEnvelope(now(), roster));
      const view = viewEnvelope(readers.readView());
      if (woke || view !== lastView) parts.push(view);
      parts.push(body, registerEnvelope(fillRegister(readers.readSettings(), readers.readSoundTags())));
      stateOwed = false;
      cutOwed = null;
      lastRoster = roster;
      lastView = view;
      return parts.join('\n');
    },
    forget() {
      stateOwed = false;
      cutOwed = null;
      lastRoster = null;
      lastView = null;
    },
  };
}
