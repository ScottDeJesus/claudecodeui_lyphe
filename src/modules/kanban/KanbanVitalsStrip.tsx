import { useTranslation } from 'react-i18next';

import { useBoardVitals } from '@/modules/kanban/hooks/useKanbanLaneFeed';
import type { KanbanVitals } from '@/shared/kanban-types';
import type { Tone } from '@/shared/types';
import { Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * The board's six counts, in the header, where the reader is already looking.
 *
 * SIX REGISTERS, ONE FIXED ORDER, left to right, with the claimable count last:
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
 * TWO FORMS, AND NO STATE OF EITHER IN WHICH AN ASK IS HIDDEN. Where the header has room the strip
 * stands IN THE ROW: all six registers from `xl`, and below that the two amber ones alone — the only
 * two that ask the reader to do something — in every state, a calm zero included. Where the header
 * has no room it leaves the row and becomes a BADGE on the board switcher's corner: one amber pill
 * carrying every register that is asking, glyph and count; or one calm em-dash for a reading nobody
 * has; or, read and nothing asking, nothing at all. Unknown and none never look alike in either.
 *
 * The badge is out of the row because there is no row to be in. The workspace rail takes 328px from
 * `md` up, so a 768px viewport leaves a 440px header with 67px for the board's name and everything
 * else, and a 320px phone leaves 42px. A select needs 41px just to paint itself. An in-row alarm
 * there either squeezes the switcher to nothing or is itself the thing with no room — and an ask
 * that silently stands down reads exactly like a board that is not asking. The badge takes NO
 * width: in its bands the row lays out as it did before the strip existed, at every width and in
 * every state, so nothing is ever squeezed, pushed or dropped, and a count arriving moves nothing.
 * It is the mark a phone already uses to say "this wants you", and it sits on the board's name
 * because it is ABOUT the board.
 *
 * The bands: the badge below `sm` and again from `md` to 900px; the row from `sm` to `md` and from
 * 900px. They are set for the rail OPEN, which is the narrowest the header gets — a collapsed rail
 * only ever shows the badge where the row would also have fitted. In the row's bands the header has
 * at least 199px for the name and the strip; two four-digit asks need 105.
 *
 * IT READS NOTHING OF ITS OWN. The board's one feed makes the reading; the strip is told which
 * board, and listens.
 */

type KanbanVitalsStripProps = {
  /** The board these counts belong to, or `null` when no board is open — a reading nobody has, and
   *  drawn as one. The id is the whole hand-off: the header already holds it, and holds no counts. */
  boardId: string | null;
};

type VitalRegister = {
  key: keyof KanbanVitals;
  glyph: string;
  /** The i18n key of the register's name in words, and the English it falls back to. */
  wordsKey: string;
  words: string;
  /** The voice a NON-ZERO count speaks in. A zero and an unknown are always calm. */
  tone: Tone;
  /** One of the two that park a build on a person: the row keeps it below `xl`, the badge is it. */
  loud: boolean;
};

/** Which form is drawn where. Whole literal strings, because Tailwind builds only the classes it
 *  can read in the source — and each the exact complement of the other, so one form is always
 *  drawn and never both. */
const BAND_ROW = 'hidden sm:flex md:hidden min-[900px]:flex';
const BAND_BADGE = 'block sm:hidden md:block min-[900px]:hidden';

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

/** Rendered by KanbanBoardHeader, between the board switcher and the switches. Nothing else mounts it. */
export function KanbanVitalsStrip({ boardId }: KanbanVitalsStripProps) {
  const { t } = useTranslation();

  // ── The wires: the two lines that carry data. Everything around them is composition. ──
  // The reading is keyed by `boardId` and is the board feed's — what `useKanbanLaneFeed` reads for
  // the open board, and publishes for this strip to listen to. Nothing reaches the strip down a
  // prop chain: the header calls no hook, and the panel hands it no counts. `null` is no reading:
  // no board is open, or the first one is not in — the second of which is why it is `loading`, so
  // the em-dashes breathe and cannot be read as a board with nothing pending.
  const { vitals: reading, loading } = useBoardVitals(boardId);

  const title = t('kanban.vitals.title', { defaultValue: 'Board vitals' });
  const unknownWords = t('kanban.vitals.unknown', { defaultValue: 'not read' });

  // One sentence per register — "2 waiting for your answer", "0 building now", or "building now —
  // not read" — spoken and shown from the same string, so the two never differ.
  const registers = REGISTERS.map((register) => {
    const count = reading === null ? null : reading[register.key];
    const words = t(register.wordsKey, { defaultValue: register.words });
    return {
      ...register,
      count,
      speaking: count !== null && count > 0,
      sentence: count === null ? `${words} — ${unknownWords}` : `${count} ${words}`,
    };
  });
  const asking = registers.filter((register) => register.loud && register.speaking);
  const badgeSentence = reading === null ? `${title} — ${unknownWords}` : asking.map((register) => register.sentence).join(' · ');

  return (
    <>
      {/* THE BADGE. A zero-width anchor standing where the strip stands, its one gap cancelled
          (`-ml-2` against the header's `gap-2`), so the row around it is the row without it. The
          pill hangs from the anchor's top, leftward, over the switcher's top-right corner: clear of
          the chevron, which is centred, and of the name, which starts at the other end. The fill
          is opaque in both themes and ringed in the page's own surface, so the switcher's border
          never shows through it. Read, and nothing asking: no anchor at all. */}
      {(reading === null || asking.length > 0) && (
        <div
          role="group"
          aria-label={title}
          aria-busy={loading}
          className={cn('relative -ml-2 w-0 shrink-0 select-none self-stretch', BAND_BADGE)}
          data-kanban-vitals-badge
        >
          <div className="absolute right-0 top-0.5 flex">
            <Tooltip content={badgeSentence} position="bottom">
              <span
                role="img"
                aria-label={badgeSentence}
                data-tone={reading === null ? undefined : 'warn'}
                className={cn(
                  // `gap-1 px-1`, not the row's roomier pill: on a 320px phone the switcher under it is 50px
                  // wide, and a three-digit ask beside a two-digit one must still end on-screen.
                  'vv-tabular flex h-4 items-center gap-1 whitespace-nowrap rounded-full px-1 text-[10px] font-medium leading-none ring-2 ring-background',
                  reading === null ? 'bg-muted text-muted-foreground' : 'bg-[color:var(--tone-soft)] text-[color:var(--tone-ink)]',
                  loading && 'vv-pulse',
                )}
              >
                {reading === null ? (
                  <span aria-hidden="true">—</span>
                ) : (
                  asking.map((register) => (
                    <span key={register.key} aria-hidden="true" data-vital={register.key} className="flex items-center gap-0.5">
                      <span>{register.glyph}</span>
                      <span>{register.count}</span>
                    </span>
                  ))
                )}
              </span>
            </Tooltip>
          </div>
        </div>
      )}

      {/* THE ROW. `shrink-0`: a clipped register is a number the reader cannot trust, and in these
          bands nothing asks it to yield. The pulse is the whole loading state: em-dashes that
          breathe are a reading on its way, em-dashes that sit still are a reading nobody has. */}
      <div
        role="group"
        aria-label={title}
        aria-busy={loading}
        className={cn('vv-tabular shrink-0 select-none items-center gap-1', BAND_ROW, loading && 'vv-pulse')}
        data-kanban-vitals
      >
        {registers.map((register) => (
          // `contents` keeps every register a direct child of the one flex row, so the fixed order
          // holds while the quiet four stand down below `xl`.
          <div key={register.key} className={register.loud ? 'contents' : 'hidden xl:contents'}>
            <Tooltip content={register.sentence} position="bottom">
              <span
                role="img"
                aria-label={register.sentence}
                data-vital={register.key}
                data-tone={register.speaking ? register.tone : undefined}
                className={cn(
                  // One box for every register and every state, so a count going 0 → 1 repaints
                  // a fill and an ink and never moves its neighbours — which is also why the weight
                  // is one weight: tabular figures hold their width within a weight, not across two.
                  'inline-flex h-6 items-center gap-1 rounded-full px-1.5 text-xs font-medium leading-none',
                  !register.speaking && 'text-muted-foreground',
                  register.speaking && register.tone === 'neutral' && 'text-foreground',
                  register.speaking && register.tone === 'positive' && 'text-[color:var(--tone-ink)]',
                  // The only fill on the strip: where the eye lands is where a person is needed.
                  register.speaking && register.tone === 'warn' && 'bg-[color:var(--tone-soft)] text-[color:var(--tone-ink)]',
                )}
              >
                {/* Two of the six glyphs are emoji and paint in their own colours whatever the ink
                    is, so a calm register greys its glyph: beside a muted zero, a lit bulb would be
                    the loudest thing on a strip with nothing to say. Greyed and never faded — the
                    glyph is all that says WHICH register a `0` or a `—` belongs to, and at the
                    muted ink's full strength it clears the 3:1 a non-text mark needs in both themes. */}
                <span aria-hidden="true" className={cn(!register.speaking && 'grayscale')}>{register.glyph}</span>
                <span aria-hidden="true">{register.count === null ? '—' : register.count}</span>
              </span>
            </Tooltip>
          </div>
        ))}
      </div>
    </>
  );
}
