import type { CompanionDraft, CompanionSessionRef, CompanionSettings, CompanionWalk } from '@/shared/companion-types.js';

import { cutEnvelope, handoverEnvelope, registerEnvelope, sessionsEnvelope, stateEnvelope, viewEnvelope, type ViewShown } from './companion-envelopes.js';
import { fillRegister } from './companion-prompt.js';

/**
 * Every message she is pushed is assembled at the moment it is pushed, in this order, and nothing is
 * pushed silently — whatever she is told reaches her inside a message she answers:
 *   1. `<state>`, owed once after her conversation was compacted (the conversation that held the focus, the
 *      draft and the walk is gone, so they are restated);
 *   2. `<handover>`, once after a fresh start that dropped a conversation: the stored account of it (`readHandover`). The row keeps it
 *      until the launch that was handed the message reports `init` (the session empties it then, `handoverInFlight`/`releaseHandover`);
 *      meanwhile at most one message carries it, and a launch that ends first leaves it for the next one;
 *   3. `<cut>`, owed once after he cut her off (`oweCut`, set by the companion's speech cut);
 *   4. `<sessions>`, on a wake, then only when its text differs from the last one sent;
 *   5. `<view>`, on the same rule (it names what is on his screen, so a press on the station changes the text and rides the next message he sends: it never pushes or wakes);
 *   6. the body — an `<operator>`, one or more `<alert>`s, or a `<session>`;
 *   7. `<register>`, read from his settings EVERY time: he edits it, so it is never stale. The sounds it lists are
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
 * `<state>` restates, the roster body, what is on his screen, the sounds she may make and the handover she is owed. Each is read when a
 * message is assembled and never earlier, so what she is told is how things stand as it reaches her.
 * `readSoundTags` is the account's one sound-tag list: the register teaches exactly the list the parse keeps
 * (the turn tracker reads the same reader when a turn begins). `readHandover` is the stored account of a dropped conversation (`null`
 * for none), kept on her row until the launch that was handed it is up (`companion-session.ts` empties it). Consumed by
 * `companion-session-types.ts`, whose `CompanionSessionDeps` carries the six.
 */
export type MessageReaders = {
  readSettings(): CompanionSettings;
  readState(): { focus: CompanionSessionRef | null; draft: CompanionDraft | null; walk: CompanionWalk | null };
  readRoster(): string;
  readView(): ViewShown | null;
  readSoundTags(): readonly string[];
  readHandover(): string | null;
};

/** What `createMessageAssembler` answers; the session holds one per account. */
type MessageAssembler = {
  /** Her conversation was compacted: the next message restates the focus, the draft and the walk. */
  oweState(): void;
  /** He cut her off: the next message opens with `<cut>`, naming the last sentence he heard to its end and the one playing at the press (`null` for none). A later cut replaces one no message has carried yet. */
  oweCut(heard: string | null, interrupted: string | null): void;
  /** The cut the next message will open with (`''` for no such sentence), or `null` when none is owed. Read before `assemble`, which carries it. */
  owedCut(): { heard: string; interrupted: string } | null;
  /** The text of one message: the owed parts, the roster and view when due, `body`, and the register. */
  assemble(body: string, woke: boolean): string;
  /** Is a message that carries the stored handover out with a launch that has not reported `init` yet? */
  handoverInFlight(): boolean;
  /** The in-flight handover is no longer in flight: the launch that had it is up (the caller empties the row) or is gone (the row keeps it, and the next message carries it). */
  releaseHandover(): void;
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
  // The stored handover a message has carried to a launch that has not confirmed it: no second message carries the same text meanwhile.
  let handoverCarried: string | null = null;

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
      // Read at every assembly, carried by one message until the launch confirms it: a launch that dies first leaves it for the next one.
      const stored = readers.readHandover();
      const handover = stored !== null && stored.trim() !== '' && stored !== handoverCarried ? stored : null;
      if (handover !== null) parts.push(handoverEnvelope(handover));
      if (cutOwed !== null) parts.push(cutEnvelope(cutOwed.heard, cutOwed.interrupted));
      const roster = readers.readRoster();
      if (woke || roster !== lastRoster) parts.push(sessionsEnvelope(now(), roster));
      const view = viewEnvelope(readers.readView());
      if (woke || view !== lastView) parts.push(view);
      parts.push(body, registerEnvelope(fillRegister(readers.readSettings(), readers.readSoundTags())));
      if (handover !== null) handoverCarried = handover;
      stateOwed = false;
      cutOwed = null;
      lastRoster = roster;
      lastView = view;
      return parts.join('\n');
    },
    handoverInFlight: () => handoverCarried !== null,
    releaseHandover() {
      handoverCarried = null;
    },
    forget() {
      stateOwed = false;
      cutOwed = null;
      lastRoster = null;
      lastView = null;
      handoverCarried = null;
    },
  };
}
