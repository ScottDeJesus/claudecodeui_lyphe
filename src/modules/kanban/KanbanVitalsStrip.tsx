import { useTranslation } from 'react-i18next';

import type { KanbanVitals } from '@/shared/kanban-types';
import type { Tone } from '@/shared/types';
import { Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * The board's six counts, in the header, where the reader is already looking.
 *
 * SIX REGISTERS, ONE FIXED ORDER — Descent's own, left to right, with the claimable count last:
 * a register that moved with its value would have to be re-found on every glance. Each is a glyph
 * and a number and nothing else; the words ride in a tooltip (hover, or a long-press on a phone)
 * and in the accessible name, because six labels would cost the board's name its width.
 *
 * THREE VOICES, NEVER SIX COLOURS. Amber is for the two registers that mean A BUILD IS PARKED ON A
 * PERSON — a question unanswered, a plan unapproved — and only while they are not zero. Green is
 * for work under way. Everything else is ink: lessons, memories and claimable cards are a backlog,
 * and a backlog that shouted would teach the reader to ignore the two that matter. The tone comes
 * through `data-tone` and the token it sets, never a colour named here (doctrine §5), and the glyph
 * beside every number is what still reads when the colour does not (doctrine §6).
 *
 * ZERO AND UNKNOWN ARE TWO DIFFERENT SENTENCES. A `0` is a reading — nothing is waiting — and is
 * drawn as a calm, muted zero. No reading at all is an em-dash, in the same calm ink, and its words
 * say "not read" rather than "0". Neither is ever drawn as the other: a quiet strip must mean the
 * board is quiet, never that nobody asked.
 *
 * UNDER A NARROW HEADER IT COLLAPSES TO THE TWO AMBER REGISTERS, the only two that ask the reader
 * to do something. It collapses rather than shrinks — the strip never yields a pixel it is showing,
 * so the switcher to its left keeps truncating by its own rule and the two switches to its right
 * never move. The breakpoint is `xl` because the workspace sidebar takes 328px from `md` up: the
 * full strip needs about 690px of header, which a 1024px viewport does not have and a 1280px one
 * does.
 *
 * IT FETCHES NOTHING. The reading arrives as a prop from the header, which has it from the panel.
 */

type KanbanVitalsStripProps = {
  /** The board's counts as the header was handed them: an object is a reading; `null` is a first
   *  reading asked for and not yet answered; absent is no reading at all — no board is open, or the
   *  read could not be made. Only an object ever draws a number. */
  vitals?: KanbanVitals | null;
};

type VitalRegister = {
  key: keyof KanbanVitals;
  glyph: string;
  /** The i18n key of the register's name in words, and the English it falls back to. */
  wordsKey: string;
  words: string;
  /** The voice a NON-ZERO count speaks in. A zero and an unknown are always calm. */
  tone: Tone;
  /** Survives the narrow header. Exactly the two registers that park a build on a person. */
  loud: boolean;
};

/** The fixed left-to-right order. One home, so the strip and its documentation never drift.
 *  `▶` carries U+FE0E so a phone draws it as text in the register's ink, never as a blue emoji tile. */
const REGISTERS: VitalRegister[] = [
  { key: 'building', glyph: '▶\uFE0E', wordsKey: 'kanban.vitals.building', words: 'building now', tone: 'positive', loud: false },
  { key: 'awaitingAnswer', glyph: '?', wordsKey: 'kanban.vitals.awaitingAnswer', words: 'waiting for your answer', tone: 'warn', loud: true },
  { key: 'awaitingApprove', glyph: '✋', wordsKey: 'kanban.vitals.awaitingApprove', words: 'waiting for your approval', tone: 'warn', loud: true },
  { key: 'lessonsPendingEstate', glyph: '💡', wordsKey: 'kanban.vitals.lessonsPending', words: 'lessons to review, across every board', tone: 'neutral', loud: false },
  { key: 'memoryPendingEstate', glyph: '✎', wordsKey: 'kanban.vitals.memoryPending', words: 'memories to review, across every board', tone: 'neutral', loud: false },
  { key: 'claimable', glyph: '◇', wordsKey: 'kanban.vitals.claimable', words: 'ready to be claimed', tone: 'neutral', loud: false },
];

/** What the scaffold draws while nothing is wired: every voice at once — a calm zero, an amber
 *  register, the green one and the inked backlog — so the strip shows its whole range as-is. */
const SCAFFOLD_VITALS: KanbanVitals = {
  building: 1,
  awaitingAnswer: 2,
  awaitingApprove: 0,
  lessonsPendingEstate: 3,
  memoryPendingEstate: 0,
  claimable: 12,
};

/** Rendered by KanbanBoardHeader, between the board switcher and the switches. Nothing else mounts it. */
export function KanbanVitalsStrip({ vitals }: KanbanVitalsStripProps) {
  const { t } = useTranslation();

  // ── The wires. Each line below is the fill phase's; the composition around them is not. ──
  const reading: KanbanVitals | null = vitals ?? SCAFFOLD_VITALS; // FILL: vitals
  const loading: boolean = false; // FILL: loading

  return (
    <div
      role="group"
      aria-label={t('kanban.vitals.title', { defaultValue: 'Board vitals' })}
      aria-busy={loading}
      // `shrink-0`: it collapses at the breakpoint and never squeezes — a clipped register is a
      // number the reader cannot trust. The pulse is the whole loading state: six em-dashes that
      // breathe are a reading on its way, six that sit still are a reading nobody has.
      className={cn('vv-tabular flex shrink-0 select-none items-center gap-1', loading && 'vv-pulse')}
      data-kanban-vitals
    >
      {REGISTERS.map((register) => {
        const count = reading === null ? null : reading[register.key];
        const words = t(register.wordsKey, { defaultValue: register.words });
        const unknownWords = t('kanban.vitals.unknown', { defaultValue: 'not read' });
        // The sentence behind the glyph: "2 waiting for your answer", "0 building now", or
        // "building now — not read". Spoken and shown from the same string, so they never differ.
        const sentence = count === null ? `${words} — ${unknownWords}` : `${count} ${words}`;
        const speaking = count !== null && count > 0;

        return (
          // `contents` keeps every register a direct child of the one flex row, so the fixed
          // order holds while the quiet four stand down below `xl`.
          <div key={register.key} className={register.loud ? 'contents' : 'hidden xl:contents'}>
            <Tooltip content={sentence} position="bottom">
              <span
                role="img"
                aria-label={sentence}
                data-vital={register.key}
                data-tone={speaking ? register.tone : undefined}
                className={cn(
                  // One box for every register and every state, so a count going 0 → 1 repaints
                  // a fill and an ink and never moves its neighbours — which is also why the weight
                  // is one weight: tabular figures hold their width within a weight, not across two.
                  'inline-flex h-6 items-center gap-1 rounded-full px-1.5 text-xs font-medium leading-none',
                  !speaking && 'text-muted-foreground',
                  speaking && register.tone === 'neutral' && 'text-foreground',
                  speaking && register.tone === 'positive' && 'text-[color:var(--tone-ink)]',
                  // The only fill on the strip: where the eye lands is where a person is needed.
                  speaking && register.tone === 'warn' && 'bg-[color:var(--tone-soft)] text-[color:var(--tone-ink)]',
                )}
              >
                {/* Two of the six glyphs are emoji and paint in their own colours whatever the
                    ink is, so a calm register greys its glyph: beside a muted zero, a lit bulb
                    would be the loudest thing on a strip that has nothing to say. */}
                <span aria-hidden="true" className={cn(!speaking && 'opacity-60 grayscale')}>{register.glyph}</span>
                <span aria-hidden="true">{count === null ? '—' : count}</span>
              </span>
            </Tooltip>
          </div>
        );
      })}
    </div>
  );
}
