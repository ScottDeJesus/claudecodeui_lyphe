import { Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ROADMAP_DOT_PAINT } from '@/shared/constants';
import type { RoadmapDotState } from '@/shared/types';
import { Button } from '@/shared/ui';
import type { SortableList } from '@/shared/ui/sortable/useSortable';
import { cn } from '@/shared/utils';

// The pieces the roadmap tree's panel is built from, so its four bodies (`RoadmapPanel`, `MilestonePanel`,
// `EpicPanel`, `FeaturePanel`) open, list, quote and close alike: the head, the dot, the rows (one row, and a
// list of them, sortable or not), the quote and the foot's Add press.

/** One row's facts: the item's name (its key and its marker), its title, its dot's state and its meta line. */
type PanelRowItem = { name: string; title: string; dot: RoadmapDotState; meta: string };

type PanelHeadProps = {
  title: string;
  /** The muted line under the heading: what the item is and where it stands. */
  sub: ReactNode;
  /** What stands at the heading's right: a container's ⋯ menu, a feature's Open. */
  action: ReactNode;
};

/**
 * A panel's head: the item's title in the house's display serif, never bold, with its muted line under it,
 * and its one press at the right, held to the title's first line. A size and its leading are ONE class
 * (`text-xl/tight`): `cn` drops a `leading-*` spelled before a later size.
 *
 * Used by the roadmap module's panel bodies (`panel/RoadmapPanel`, `MilestonePanel`, `EpicPanel`, `FeaturePanel`).
 */
export function PanelHead({ title, sub, action }: PanelHeadProps) {
  return (
    <header className="flex min-w-0 items-start gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="break-words font-serif text-xl/tight font-normal text-foreground">{title}</h2>
        <p className="mt-1 text-xs tabular-nums text-muted-foreground">{sub}</p>
      </div>
      <div className="-mr-1.5 -mt-0.5 shrink-0">{action}</div>
    </header>
  );
}

/**
 * A state's dot as the panel paints it: the tree's own paint (`ROADMAP_DOT_PAINT`), a filled disc with its
 * ring, hollow for an idea. Decorative: the words beside it say the state.
 *
 * Used by the roadmap module's panel: its rows (here) and the feature's State fact (`panel/FeaturePanel`).
 */
export function PanelDot({ state }: { state: RoadmapDotState }) {
  const paint = ROADMAP_DOT_PAINT[state];
  return (
    <span
      aria-hidden="true"
      data-roadmap-dot={state}
      className="size-2.5 shrink-0 rounded-full border-[1.5px]"
      style={{ backgroundColor: paint.fill, borderColor: paint.stroke }}
    />
  );
}

/**
 * One row, `FeatureRow`'s shape: a free surface whose click selects, so `useSortable` can lift it from a free
 * press (`freePress.ts`: never from a control), and whose title is the real `<button>`, the keyboard's and the
 * screen reader's way in; its click bubbles to the row's one handler. The meta stands at the right while the
 * row has the width, and wraps under the title when it has not.
 */
function PanelRow({ item, onPress }: { item: PanelRowItem; onPress: () => void }) {
  return (
    <div
      data-roadmap-panel-row={item.name}
      onClick={onPress}
      className="-mx-2 flex min-w-0 cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/60"
    >
      {/* The dot sits on the title's first line: h-5 is the title's own line height. */}
      <span className="flex h-5 shrink-0 items-center">
        <PanelDot state={item.dot} />
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3">
        <button type="button" className="min-w-0 max-w-full rounded-sm text-left text-sm leading-5 text-foreground">
          <span className="line-clamp-2 break-words">{item.title}</span>
        </button>
        <span className="text-xs tabular-nums leading-5 text-muted-foreground">{item.meta}</span>
      </div>
    </div>
  );
}

type RowListProps = {
  rows: PanelRowItem[];
  /** The list's `useSortable` (its drawn order, its handle and each row's props), or null for a list never reordered. */
  sortable: SortableList | null;
  /** What the list says in its place while it holds no row. */
  empty: string;
  /** A press on a row, with the row's name. */
  onSelect: (name: string) => void;
};

/**
 * A panel's rows over top hairlines: a container's milestones, epics or features. A sortable list draws its
 * rows in the sortable's order, which is the carry's preview while a row is in the hand, and puts the
 * sortable's handle on the list and its props on each row's item; a list that is never reordered draws them
 * as they come. An empty list says so in its place, on the same hairline.
 *
 * Used by the roadmap module's panel bodies (`panel/RoadmapPanel`, `MilestonePanel`, `EpicPanel`).
 */
export function RowList({ rows, sortable, empty, onSelect }: RowListProps) {
  if (rows.length === 0) {
    return <p className="border-t border-border py-1.5 text-sm text-muted-foreground">{empty}</p>;
  }
  const byName = new Map(rows.map((row) => [row.name, row]));
  const drawn = sortable === null ? rows : sortable.order.flatMap((name) => byName.get(name) ?? []);
  return (
    <ul ref={sortable?.attachList} className="flex min-w-0 flex-col">
      {drawn.map((row) => (
        <li key={row.name} className="border-t border-border" {...sortable?.itemProps(row.name)}>
          <PanelRow item={row} onPress={() => onSelect(row.name)} />
        </li>
      ))}
    </ul>
  );
}

/**
 * A goal as the panel quotes it: a muted block on a left rule, its blockquote `>` markers off and its lines
 * kept. It folds at three lines, so a goal written as an essay never pushes the rows under it below the
 * band's fold, and offers Show all only when the fold hides something. The panel draws each item afresh
 * (`TreePanel` keys its scroller by the item), so the next item's quote opens folded again.
 *
 * Used by the roadmap module's panel bodies (`panel/RoadmapPanel`, `MilestonePanel`, `EpicPanel`).
 */
export function PanelQuote({ text }: { text: string }) {
  const { t } = useTranslation();
  // The quote's box: the fold is measured off it.
  const quoteRef = useRef<HTMLQuoteElement>(null);
  // Whether the quote is drawn whole, once Show all is pressed. Local: nothing else asks for it.
  // FILL: whole — set by Show all's press.
  const [whole] = useState(false);
  // Whether the folded quote hides lines, so Show all is offered only when there is more to read.
  // FILL: long — measured off the laid-out quote, its content taller than its box by more than half a line, when its text changes and whenever it is resized (RoadmapHeader's goal fold).
  const long = false;

  return (
    <div className="flex min-w-0 flex-col items-start">
      <blockquote
        ref={quoteRef}
        className={cn('w-full whitespace-pre-wrap break-words border-l-2 border-border pl-2 text-sm text-muted-foreground', !whole && 'line-clamp-3')}
      >
        {text.replace(/^\s*>\s?/gm, '')}
      </blockquote>
      {long && !whole && (
        <Button
          variant="link"
          size="sm"
          className="-ml-1 h-7 px-1.5"
          // FILL: onShowAll — draws the quote whole.
          onClick={() => {}}
        >
          {t('roadmap.goal.showAll')}
        </Button>
      )}
    </div>
  );
}

/**
 * A panel's foot: its one Add press, quiet (ghost), under the rows it adds to.
 *
 * Used by the roadmap module's panel bodies (`panel/RoadmapPanel`, `MilestonePanel`, `EpicPanel`).
 */
export function PanelAdd({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="-ml-3 self-start" onClick={onPress}>
      <Plus aria-hidden="true" />
      {label}
    </Button>
  );
}
