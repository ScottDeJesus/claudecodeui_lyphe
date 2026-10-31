import { Pin } from 'lucide-react';
import { useId, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useCompanion } from '@/modules/companion';
import { useStation } from '@/modules/station/context/StationContext';
import type { CompanionNote } from '@/shared/companion-types';
import { COMPANION_NOTE_KIND_GLYPHS } from '@/shared/constants';
import type { StationFocus } from '@/shared/station-types';
import { Button, ScrollArea } from '@/shared/ui';

type StageShelfViewProps = {
  /** Her cards as her picture holds them, in any order. */
  notes: CompanionNote[];
  /** The thing on the stage: the chip of the card standing there reads as on the stage. */
  focus: StationFocus | null;
  /** A chip, pressed: its card put on the stage. */
  onOpen: (note: CompanionNote) => void;
};

/** The cards of a picture not yet read: one array, so the shelf's inputs do not change identity on every draw. */
const NO_CARDS: CompanionNote[] = [];

/** How many of her newest unpinned cards the shelf holds; the rest stand in the conversation where she put them. */
const NEWEST_SHOWN = 3;

/** The room the row leaves either side of the lit chip when it brings it into view, so its edge never touches the column's. */
const LIT_MARGIN = 16;

/**
 * The shelf's cards: his pinned ones, the oldest first (by when she put each up: the wire keeps no time of the pin); her three
 * newest unpinned, the newest first; and how many unpinned ones that leaves off.
 */
function shelfOf(notes: CompanionNote[]): { pinned: CompanionNote[]; newest: CompanionNote[]; more: number } {
  const pinned = notes.filter((note) => note.pinned).sort((a, b) => a.id - b.id);
  const unpinned = notes.filter((note) => !note.pinned).sort((a, b) => b.id - a.id);
  return { pinned, newest: unpinned.slice(0, NEWEST_SHOWN), more: Math.max(0, unpinned.length - NEWEST_SHOWN) };
}

/**
 * One card on the shelf: its kind's glyph AND word, its title (cut to one line; the whole stands on the stage), and the pin's
 * glyph when he pinned it, said in words to a reader. The card on the stage is lit: the kit's tonal fill where the others
 * wear an outline (a channel that survives greyscale) and `aria-current`.
 *
 * A chip is at most 18rem and at most 60% of the shelf's own width (`cqw`, the shelf a query container), so the label and one
 * whole chip always fit in the stage's column, 396 px at 1440 as 390 px on a phone, with the next chip's edge showing that
 * the row goes on. A lone card is never cut by the column.
 */
function ShelfChip({ note, current, onOpen }: { note: CompanionNote; current: boolean; onOpen: (note: CompanionNote) => void }) {
  const { t } = useTranslation();
  const glyph = COMPANION_NOTE_KIND_GLYPHS[note.kind];
  const KindIcon = glyph.icon;
  return (
    <Button
      variant={current ? 'tonal' : 'outline'}
      size="sm"
      data-station-shelf-chip={note.id}
      data-station-shelf-pinned={note.pinned}
      aria-current={current ? 'true' : undefined}
      className="max-w-[min(18rem,60cqw)] shrink-0 finger:h-11"
      onClick={() => onOpen(note)}
    >
      <KindIcon aria-hidden="true" />
      <span className="shrink-0 text-xs font-medium uppercase tracking-[0.12em]">{t(glyph.wordKey)}</span>
      {/* A space a flex row lays out as nothing, so the press's words read "List Runs: recent" and never "ListRuns". */}
      {' '}
      <span className="min-w-0 truncate font-normal">{note.title}</span>
      {note.pinned && (
        <>
          <Pin aria-hidden="true" className="fill-current" />
          <span className="sr-only">{t('station.cards.shelf.pinnedWord', { defaultValue: ', pinned' })}</span>
        </>
      )}
    </Button>
  );
}

/**
 * HER CARDS' SHELF, drawn by the stage frame above its head (and above the empty stage, where her regions leave it alone):
 * "Her cards", then his pinned cards, the oldest first; a hairline; her three newest unpinned cards, the newest first; and
 * "+<n> more in the conversation" for the rest, which stand where she put them. A press on a chip puts its card on the stage.
 *
 * One row, never wrapped over the card: it scrolls sideways under a finger (the kit's horizontal `ScrollArea`, which stops a
 * swipe at its end rather than handing the browser its Back). Every chip is a 44 px catch below 768 px (the touch law).
 * The chip of the card on the stage is brought into the row's view, sideways only, whenever another card takes the stage or
 * the row changes: it is what tells him which card stands there. With no cards the shelf draws nothing, and the stage stands
 * as it was.
 *
 * A pure view: `StageShelf` below binds it, and `.verify/kaylee-station-shots.mjs` draws it on `fake/cards.ts`'s cards.
 */
export function StageShelfView({ notes, focus, onOpen }: StageShelfViewProps) {
  const { t } = useTranslation();
  const labelId = useId();
  // The row's sideways scroller (the kit's `ScrollArea` hands its ref to it), which the lit chip is brought into view in.
  const rowRef = useRef<HTMLDivElement>(null);
  const { pinned, newest, more } = shelfOf(notes);
  const onStage = focus?.kind === 'note' ? focus.id : null;
  // The chips in their order, so a card arriving or leaving that moves the lit chip brings it into view again too.
  const order = [...pinned, ...newest].map((note) => note.id).join(',');

  // The lit chip scrolled into the row's view by the row's own `scrollLeft`, never `scrollIntoView`, which would move the
  // section's and the page's scrollers as well. Before paint, so the row never shows a frame without it.
  useLayoutEffect(() => {
    const row = rowRef.current;
    const lit = row?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!row || !lit) return;
    const start = lit.offsetLeft - LIT_MARGIN;
    const end = lit.offsetLeft + lit.offsetWidth + LIT_MARGIN;
    if (start < row.scrollLeft) row.scrollLeft = start;
    else if (end > row.scrollLeft + row.clientWidth) row.scrollLeft = end - row.clientWidth;
  }, [onStage, order]);

  if (pinned.length + newest.length === 0) return null;

  const chip = (note: CompanionNote) => <ShelfChip key={note.id} note={note} current={note.id === onStage} onOpen={onOpen} />;
  return (
    <nav data-station-shelf="" aria-labelledby={labelId} className="shrink-0 border-b border-border [container-type:inline-size]">
      <ScrollArea ref={rowRef} orientation="horizontal">
        <div className="flex w-max items-center gap-2 px-3 py-2 lg:px-4">
          <span id={labelId} className="shrink-0 pr-1 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {t('station.cards.shelf.label', { defaultValue: 'Her cards' })}
          </span>
          {pinned.map(chip)}
          {pinned.length > 0 && newest.length > 0 && <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-border" />}
          {newest.map(chip)}
          {more > 0 && (
            <span data-station-shelf-more="" className="shrink-0 px-1 text-sm text-muted-foreground">
              {t('station.cards.shelf.more', { count: more, defaultValue: '+{{count}} more in the conversation' })}
            </span>
          )}
        </div>
      </ScrollArea>
    </nav>
  );
}

/**
 * The shelf on the page: drawn by `StationStage` above the stage's head. It reads her cards and the thing on the stage and
 * binds a chip's press, and hands them to `StageShelfView`, which draws nothing while she has no cards.
 */
export function StageShelf() {
  const { picture } = useCompanion();
  const { focus, setFocus } = useStation();
  // Her cards as her picture holds them, folded live by `companion_note`, `companion_note_removed`, `companion_note_pinned` and
  // `companion_cleared`; none while the picture has not been read, so the shelf stands out of the stage until it has something.
  const notes = picture?.notes ?? NO_CARDS;

  return <StageShelfView notes={notes} focus={focus} onOpen={(note) => setFocus({ kind: 'note', id: note.id, label: note.title })} />;
}
