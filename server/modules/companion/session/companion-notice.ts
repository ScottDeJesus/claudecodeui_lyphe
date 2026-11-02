import { escapeText } from './companion-envelopes.js';
import { cutAtSentence } from './companion-handover.js';
import type { CompanionContextReading } from './companion-process.js';

/**
 * The words and the numbers of her own compaction, pure: where she closes, where her window ends in her CLI's reading, the notice she is told in her last
 * turn, her note tidied, and every line the panel shows. Her CLI's own compaction is off (`companion-launch.ts`), so when her
 * conversation nears full she gets ONE last turn of her own: she is told plainly that the conversation closes after it, she can
 * recall and remember, and her final text is a note to a fresh her, which the next conversation begins from as the `<handover>`
 * envelope. Nothing else is pushed in that turn. The machine that runs it is `companion-closing.ts`; this file only knows the numbers
 * and the words.
 *
 * THE POINT, from what was measured 2026-11-01 over every transcript of both accounts:
 * - Her window ends, in the CLI's own reading, at its window less its reserve: 497,000 at her 500,000 window with its compaction off (`wallOf`).
 *   The CLI does NOT refuse there: with its compaction off it sent messages read past its window (measured 2026-11-01, `companion-launch.ts`) and
 *   refuses only at the model's own limit, so her closing is the only bound under her window and the room below is counted back from this figure.
 * - Her last turn begins at the first turn's end at or past the point, so at most one stretch of growth past it: 58,609 at the
 *   largest measured (account 2, four pushes he cut off in a row).
 * - Her last turn's budget is 30,000, from her worst measured costs. 1,942 and 681 are the most one recall and one remember added to
 *   her context in those transcripts; the turn allows six recalls (11,652) and ten remembers (6,810), the note at its 8,000-character cap
 *   (about 2,300 tokens), the notice (allowed 900; its 1,683 characters are nearer 480 tokens) and her thinking (about 2,000): 23,662,
 *   about 23,700 in all. The rest of the 30,000 is margin, and the whole-run proof (`.verify/kaylee-closing-real.mjs`) measures her
 *   real last turn against it.
 * - So the room is 117,000 and the point 380,000: 380,000 + 58,609 + 30,000 = 468,609 leaves 28,391 under her window's end (497,000).
 * The ROOM is the constant. The point is read off the CLI's own reading (its window less its reserve less the room), so it follows
 * the window if it is ever moved; on a CLI that still compacts (reserve 33,000) it is 350,000, under that CLI's own 467,000.
 *
 * THE NOTE's bounds: the notice asks for at most about a thousand words; the harness keeps at most 8,000 characters, cut at a
 * sentence end, and a note under 80 characters is no note (the house summarizer's handover is written instead). The summarizer's own
 * handover is capped at 2,000 characters (`companion-handover.ts`); hers carries seven kinds of content, so it gets more room.
 *
 * PURE in its own body: no I/O but the one environment read `closingPoint` makes at the call. Importing it is not free: it takes
 * `cutAtSentence` from `companion-handover.ts`, whose imports reach CloudCLI's database connection (`companion-launch.ts`, the providers
 * and the compaction barrel), which creates the database on first use; a probe that imports this file sets a scratch `DATABASE_PATH` first.
 * Consumed by `companion-closing.ts`.
 */

/**
 * How far under her window's end (`wallOf`) she closes: the largest growth measured between two of her answered turns (58,609) plus her last
 * turn's budget (30,000) and 28,391 to spare. Consumed by `companion-closing.ts` through `closingPoint`; raised by the difference when
 * the whole-run proof (`.verify/kaylee-closing-real.mjs`) measures a last turn over `LAST_TURN_BUDGET_TOKENS`.
 */
export const CLOSING_ROOM_TOKENS = 117_000;

/** Her last turn's budget in tokens: what the builder's measured last turn must stay under. Consumed by the whole-run proof (`.verify/kaylee-closing-real.mjs`), which reads the measured last turn against it. */
export const LAST_TURN_BUDGET_TOKENS = 30_000;

/** The most of her note that is kept, cut at the end of a sentence; and the least that counts as a note. Consumed by `companion-closing.ts` (through `tidyNote`) and the proofs that read the stored note against them. */
export const NOTE_MAX_CHARS = 8_000;
export const NOTE_MIN_CHARS = 80;

/** The probe's seam, read at the call as the chats' `CUSTOM_COMPACTION_*` are. */
const CLOSING_AT_ENV = 'COMPANION_CLOSING_AT_TOKENS';

/**
 * `COMPANION_CLOSING_AT_TOKENS` as a point: a positive whole number, or `null` for anything else (unset, blank, `0`, `-3`, `1.5`,
 * `1e3`, words), in which case the derived point stands.
 */
function closingPointFromEnv(): number | null {
  const raw = process.env[CLOSING_AT_ENV]?.trim();
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Where her window ends in the CLI's own reading: its window less its reserve (497,000 at her window). Not a refusal point (with its compaction off the CLI
 * sends past it: `companion-launch.ts`); it is the figure `closingPoint` counts back from. Consumed by `closingPoint` below and by the notice's showing
 * (`.verify/kaylee-closing-notice.mjs`).
 */
export function wallOf(reading: CompanionContextReading): number {
  return reading.window - reading.reserve;
}

/**
 * Where she closes for this reading: `COMPANION_CLOSING_AT_TOKENS` when set (a probe's seam, read at the call, as the chats'
 * `CUSTOM_COMPACTION_*` are), else the CLI's window less its reserve less the room: 380,000 at her window. Consumed by
 * `companion-closing.ts` at a turn's end and at a launch's first `init`.
 */
export function closingPoint(reading: CompanionContextReading): number {
  return closingPointFromEnv() ?? wallOf(reading) - CLOSING_ROOM_TOKENS;
}

/**
 * The notice, whole: `<compaction>` and the text below, his name filled in (escaped, so it cannot close the tag). The text names him
 * only, so `name` (hers) is taken for the call's shape and fills nothing. A blank name is "the operator", as the handover's is. Consumed
 * by `companion-closing.ts`, which pushes it bare as the only message of her last turn.
 */
export function noticeText(names: { operatorName: string; name: string }): string {
  const he = escapeText(names.operatorName.trim() || 'the operator');
  return [
    '<compaction>',
    "This conversation is nearly full, so it closes after this turn, and a fresh you begins in a new one. She will have your memory, the panel's state (the focus, the draft and its target, the walkthrough) and anything he says meanwhile, and of this conversation only the note you write now.",
    '',
    'First keep what should outlive it. Recall what your memory already holds, and remember, in his own words, the standing rulings and preferences he gave and the names he gave things. Your rule for what to keep: not small details or things that could be looked up as part of the project, but the assistant side of things, the overarching full-picture view, like the soft release of Restorly in January.',
    '',
    'Then write the note, as the last thing you write in this turn. Nothing in this turn is spoken or shown to him; the note goes to her alone, first thing. Your whole final message is the note, so begin it with the note itself, with nothing before it about what you kept. Write it to her as "you", in your own voice, one of you to the other, not a digest of the transcript:',
    `- what ${he} decided in this conversation;`,
    '- each session that matters: what it was doing, and what it still owes him;',
    '- which session is in focus, and why;',
    '- the draft and where it is going, and where the walkthrough stands;',
    '- what you promised to tell him or to do;',
    '- what was open between you: a question of his you had not answered, an offer of yours he had not taken up.',
    "Leave out what she will be told anyway: the roster of his sessions, the draft's words, what your memory holds. Plain sentences, no headings, at most about a thousand words.",
    '',
    'Only recall and remember are open in this turn.',
    '</compaction>',
  ].join('\n');
}

/**
 * Her final text as a note: trimmed, cut at a sentence end under `NOTE_MAX_CHARS` (`cutAtSentence`, `companion-handover.ts`), or `null` when
 * under `NOTE_MIN_CHARS` or when she wrote nothing. The cut is made one character short of the bound: a cut at a word, with no sentence end
 * in the second half, adds an ellipsis, and the note must still be at most `NOTE_MAX_CHARS`. Consumed by `companion-closing.ts`, which stores
 * the result on her row for the fresh start's `<handover>` and falls back to the house's handover on `null`.
 */
export function tidyNote(text: string | null): string | null {
  const note = text?.trim() ?? '';
  if (note.length < NOTE_MIN_CHARS) return null;
  return cutAtSentence(note, NOTE_MAX_CHARS - 1);
}

/**
 * The panel's seven lines of her closing, word for word, one per way it can go: it begins; it ends on her note; on the house's handover
 * (she could not finish her note); on neither; and the three ways the wall's own refusal ("Prompt is too long") ends, on the house's
 * handover, on neither, or on a first message too long by itself (`fullAlone`: nothing was written and what was refused was dropped). The journal's lines are built from the numbers of the moment and are `companion-closing.ts`'s own. Consumed by
 * `companion-closing.ts`, which gives each to the panel through its `say`.
 */
export const CLOSING_LINES = {
  begins: 'Her conversation is nearly full, so she is writing herself a note to start fresh from; she keeps her memory.',
  noted: 'She starts fresh from the note she wrote herself; she keeps her memory.',
  handedOver: 'She could not finish her note, so she starts fresh from a handover of what you were discussing; she keeps her memory.',
  neither: 'She could not finish her note and the handover could not be written, so she starts fresh; she keeps her memory.',
  fullHandedOver: 'Her conversation was full, so she starts fresh from a handover of what you were discussing; she keeps her memory.',
  fullNeither: 'Her conversation was full and the handover could not be written, so she starts fresh; she keeps her memory.',
  fullAlone: 'What she was just sent was too long for her to read, so it was dropped; she starts fresh; she keeps her memory.',
} as const satisfies Record<string, string>;
