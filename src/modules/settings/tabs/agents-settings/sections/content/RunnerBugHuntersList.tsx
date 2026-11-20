import { ArrowDown, ArrowUp } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge, Button } from '@/shared/ui';
import { useSortable } from '@/shared/ui/sortable/useSortable';
import { cn } from '@/shared/utils';

/** One row of an ordered list: a hunter, or a project. */
export type BugHuntersListItem = {
  /** What the order is written in: a hunter's kind, a project's name. */
  key: string;
  /** The row's name, as the operator knows it. */
  title: string;
  /** The muted line under the name: what a hunter looks for, a project's folder. */
  detail: ReactNode;
  /** For a row that is NOT in the order, the word that says so beside its name (`Sits out`). A row with no word is in the order. */
  outWord?: string;
  /** The row's own control, at its right end: a hunter's switch. */
  control?: ReactNode;
};

type RunnerBugHuntersListProps = {
  /** The id of the row label that names this list. */
  labelledBy: string;
  /** The rows as they are drawn: the ones in the order first, in that order, then the ones out of it. */
  items: BugHuntersListItem[];
  /** What the list says in its place while it holds no row. A list that always holds rows (the five hunters) gives none. */
  empty?: string;
  /** The spoken name of a row's move press: the row's name, the direction, its place now and how many rows the order holds. */
  moveLabel: (title: string, by: -1 | 1, position: number, total: number) => string;
  /** A press on a row's arrow: the row's key, and one place earlier (`-1`) or later (`1`). */
  onMove: (key: string, by: -1 | 1) => void;
  /** A carry put a row down in another place: the keys in the order, as they now stand. Answers whether the store took it. */
  onReorder: (order: readonly string[]) => Promise<boolean>;
};

/**
 * AN ORDER THE OPERATOR SETS, as numbered rows: the hunters in turn order, the projects in the order they are gone through.
 *
 * TWO WAYS TO MOVE A ROW, BOTH ALWAYS ON SCREEN OR SAID. A row is carried by its free surface (the kit's `useSortable`: a mouse
 * drags it, a finger holds and then drags), and each row has an up and a down arrow, which is the keyboard's way and the way
 * nobody has to be told about. The number in front of a row is its place, so the order reads without counting. An arrow that has
 * nowhere to go (the first row's up, the last row's down) is dimmed with `aria-disabled`, never `disabled`: Chromium blurs a
 * disabled button, and a row moved to the top by keyboard would drop the focus that moved it. Its glyph is drawn at half strength
 * on top of the kit's own dimming and takes no hover ink: on Night's ground the kit's 0.7 alone left a muted arrow that could not
 * be told from one that works. A list of one row draws no arrows.
 *
 * A ROW OUT OF THE ORDER STAYS IN THE LIST, under the ones in it: no number, no arrows, its name muted and the word for its state
 * beside it (`outWord`), so the state is never a colour alone. It is not carried: it has no place to be carried to.
 *
 * A ROW IS INSET 8 PX INSIDE ITS OWN HAIRLINES (the list reaches 8 px past its column on each side), so a row lifted in the hand is a
 * card with air round its words, and the numbers and the switches still stand on the column's two edges.
 *
 * THE PARTS OF A ROW ARE A SPACE APART IN ITS TEXT, not only on screen: the gap the grid draws is not text, and a row copied or
 * read as text would otherwise run its number, its name and its line together ("1SecurityWho can reach it").
 *
 * ONE LAYOUT FOR A ROW, TWO PLACES FOR ITS SECOND LINE. The name and the presses share the first line. The muted line sits under
 * the name beside the presses on a wide row, and under a finger it runs the row's full width below them: beside two 44 px
 * arrows and a switch a phone leaves it a column of 20 characters.
 *
 * Used by `RunnerBugHuntersRow`, for the hunters and for the projects.
 */
export default function RunnerBugHuntersList({ labelledBy, items, empty, moveLabel, onMove, onReorder }: RunnerBugHuntersListProps) {
  const byKey = new Map(items.map((item) => [item.key, item]));
  const out = items.filter((item) => item.outWord !== undefined);
  const { order, attachList, itemProps } = useSortable({
    keys: items.filter((item) => item.outWord === undefined).map((item) => item.key),
    newKeys: 'back',
    onReorder: (_carried, next) => onReorder(next),
  });
  const movable = order.length > 1;

  if (items.length === 0) {
    return empty === undefined ? null : <p className="border-t border-border py-3 text-xs text-muted-foreground">{empty}</p>;
  }

  return (
    <ul ref={attachList} role="list" aria-labelledby={labelledBy} className="-mx-2 flex min-w-0 flex-col border-b border-border">
      {order.flatMap((key) => byKey.get(key) ?? []).map((item, index) => (
        <li
          key={item.key}
          data-bug-hunters-item={item.key}
          className={cn(
            'grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-t border-border px-2 py-2',
            movable && 'cursor-grab',
          )}
          {...itemProps(item.key)}
        >
          <span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>
          {' '}
          <span className="min-w-0 break-words text-sm font-medium text-foreground">{item.title}</span>
          {' '}
          <div className="row-span-2 flex items-center gap-1 self-center finger:row-span-1">
            {movable && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn('h-8 w-8 text-muted-foreground finger:h-11 finger:w-11', index === 0 ? '[&_svg]:opacity-50' : 'hover:text-foreground')}
                  aria-label={moveLabel(item.title, -1, index + 1, order.length)}
                  title={moveLabel(item.title, -1, index + 1, order.length)}
                  aria-disabled={index === 0}
                  onClick={() => onMove(item.key, -1)}
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn('h-8 w-8 text-muted-foreground finger:h-11 finger:w-11', index === order.length - 1 ? '[&_svg]:opacity-50' : 'hover:text-foreground')}
                  aria-label={moveLabel(item.title, 1, index + 1, order.length)}
                  title={moveLabel(item.title, 1, index + 1, order.length)}
                  aria-disabled={index === order.length - 1}
                  onClick={() => onMove(item.key, 1)}
                >
                  <ArrowDown aria-hidden="true" />
                </Button>
              </>
            )}
            {item.control && <div className="ml-2 flex">{item.control}</div>}
          </div>
          <div className="col-start-2 min-w-0 break-words text-xs text-muted-foreground finger:col-end-4">{item.detail}</div>
        </li>
      ))}
      {out.map((item) => (
        <li
          key={item.key}
          data-bug-hunters-item={item.key}
          data-bug-hunters-out=""
          className="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-t border-border px-2 py-2"
        >
          <span className="col-start-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 break-words text-sm font-medium text-muted-foreground">{item.title}</span>
            {' '}
            <Badge as="span" tone="neutral" className="vv-badge--compact">{item.outWord}</Badge>
          </span>
          {' '}
          <div className="row-span-2 flex items-center self-center finger:row-span-1">{item.control}</div>
          <div className="col-start-2 min-w-0 break-words text-xs text-muted-foreground finger:col-end-4">{item.detail}</div>
        </li>
      ))}
    </ul>
  );
}
