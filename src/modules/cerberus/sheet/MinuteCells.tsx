import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { StatusCell } from '@/modules/cerberus/StatusMarks';
import { STATUS_TABLE } from '@/modules/cerberus/utils/cerberusStatus';
import { hm } from '@/modules/cerberus/utils/cerberusTime';
import type { CerberusCell } from '@/shared/cerberus-types';
import { cn } from '@/shared/utils';

/** How far a key moves the minute under the keyboard: one minute with an arrow, ten with a page key. */
const STEP_KEYS: Partial<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, PageUp: -10, PageDown: 10 };

/** The gap between the strip and its tooltip, in px: the `bottom-2` / `top-2` the bubble stands at. */
const TIP_GAP_PX = 8;

/**
 * The nearest ancestor that clips what overflows it, a scroller or a box with its overflow hidden,
 * or null when only the window does. The sheet's body and History's panel both scroll.
 */
function clippingAncestorOf(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style && style.overflowY !== 'visible') return node;
  }
  return null;
}

/**
 * A STRIP OF MINUTES: one `StatusCell` per cell, oldest on the left, with the times of its start,
 * middle and end under it. The sheet draws 60 under "Last 60 minutes · click a minute", and History
 * draws the 60 that end at the moment it looks up. It draws any count it is handed, 30 as readily
 * as 60.
 *
 * The minute under the pointer or the keyboard is named in a tooltip above it: its time, its word,
 * and for a strip that folds several checks, the check that set it. Clicking a minute, or pressing
 * Enter on it, hands it to `onPick`. What a pick does (move the lookup, move the time) is the
 * caller's, so this piece holds no data and no marker.
 *
 * The strip is ONE tab stop, a listbox with each minute as an option. Arrows move a minute,
 * Page Up and Page Down move ten, Home and End go to the ends. The pointer works out which minute it
 * is over from its x position, so a press on the 2px gap between two cells still lands on the
 * nearer one. That matters on a phone, where 60 cells are 4px wide each. `selectedFrom` marks the
 * minute whose `from` it names (the one being looked up) with an accent outline.
 *
 * Used by the sheet (`CheckSheet`) and by History's look-up card (`LookupCard`), which each wire `onPick`.
 */
export function MinuteCells({ cells, selectedFrom, onPick }: {
  cells: CerberusCell[];
  selectedFrom?: number;
  onPick: (cell: CerberusCell) => void;
}) {
  const { t } = useTranslation();
  const optionId = useId();
  const stripRef = useRef<HTMLDivElement>(null);
  const tipLayerRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  // The minute the pointer or the keyboard is on, by index: what the tooltip names and what Enter
  // picks. Essential: it is where the person is pointing, which no prop holds. Null when neither the
  // pointer nor the keyboard is on the strip.
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const count = cells.length;
  // A strip that shrank under a resting pointer must not name a minute it no longer has.
  const shownIndex = activeIndex !== null && activeIndex < count ? activeIndex : null;
  const selectedIndex = selectedFrom === undefined ? -1 : cells.findIndex((cell) => cell.from === selectedFrom);

  /** "17:52 · Failing": a minute's time and word, the first line of its tooltip. */
  const timeAndWord = (cell: CerberusCell): string =>
    t('cerberus.sheet.cellTip', { time: hm(cell.from), word: t(STATUS_TABLE[cell.status].wordKey) });

  /** A minute's accessible name: its time and word, and the check that set it when the strip folds several. */
  const describe = (cell: CerberusCell): string => (cell.worst === null
    ? timeAndWord(cell)
    : t('cerberus.sheet.cellTipWorst', { time: hm(cell.from), word: t(STATUS_TABLE[cell.status].wordKey), check: cell.worst }));

  // The minute the tooltip names, and how far along the strip its centre sits, as a share of the width.
  const tipCell = shownIndex === null ? null : cells[shownIndex];
  const tipText = tipCell === null ? null : describe(tipCell);
  const tipCentre = shownIndex === null ? null : (shownIndex + 0.5) / count;

  // The bubble is centred over its minute, then held inside the strip, so near either end it pins to
  // that end instead of running past the sheet's edge. Its pointer stays on the minute's centre
  // either way. It stands above the strip unless the nearest clipping ancestor leaves it no room
  // there. A strip scrolled to the top of the sheet would hide it whole, so it then hangs under the
  // strip's foot, over the axis times (`data-side="below"`). It is placed here, before paint, because
  // its size is only known once it is drawn (so its text is a dependency). The placement is written to
  // the nodes, not to state, because a second render per minute would buy nothing. React never owns
  // `data-side`, so a render never puts it back.
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const layer = tipLayerRef.current;
    const bubble = tipRef.current;
    if (tipCentre === null || !strip || !layer || !bubble) return;
    const room = Math.max(0, strip.clientWidth - bubble.offsetWidth);
    bubble.style.left = `${Math.min(room, Math.max(0, tipCentre * strip.clientWidth - bubble.offsetWidth / 2))}px`;
    const clip = clippingAncestorOf(strip);
    const roomAbove = strip.getBoundingClientRect().top - (clip === null ? 0 : clip.getBoundingClientRect().top);
    layer.dataset.side = roomAbove < bubble.offsetHeight + TIP_GAP_PX ? 'below' : 'above';
  }, [tipCentre, tipText]);

  if (count === 0) return null;

  const clampIndex = (index: number) => Math.min(count - 1, Math.max(0, index));
  // Where the keyboard starts from: the minute it is on, else the one being looked up, else the newest.
  const restingIndex = () => shownIndex ?? (selectedIndex >= 0 ? selectedIndex : count - 1);

  /** The minute under a pointer's x. Over a gap it is the nearer cell, and past an end it is that end. */
  const indexAt = (clientX: number): number => {
    const box = stripRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return restingIndex();
    return clampIndex(Math.floor(((clientX - box.left) / box.width) * count));
  };

  const point = (event: PointerEvent<HTMLDivElement>) => setActiveIndex(indexAt(event.clientX));

  const pick = (index: number) => {
    setActiveIndex(index);
    onPick(cells[index]);
  };

  // A click with no pointer behind it (`detail` 0, as assistive tech sends) picks the minute the
  // keyboard is on. Read from its x, it would always land on the first minute.
  const onClick = (event: MouseEvent<HTMLDivElement>) => pick(event.detail === 0 ? restingIndex() : indexAt(event.clientX));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = STEP_KEYS[event.key];
    let next: number | null = null;
    if (step !== undefined) next = clampIndex(restingIndex() + step);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = count - 1;
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pick(restingIndex());
      return;
    }
    if (next === null) return;
    event.preventDefault();
    setActiveIndex(next);
  };

  const middleIndex = Math.floor(count / 2);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        {tipCell !== null && tipCentre !== null && (
          // The tooltip's layer spans the strip and stands on its top edge, or under its foot when the
          // effect above sets `data-side="below"`. Its bubble and pointers place themselves inside it.
          <div
            ref={tipLayerRef}
            className="group pointer-events-none absolute inset-x-0 bottom-full z-20 data-[side=below]:bottom-auto data-[side=below]:top-full"
          >
            {/* The check that set a folded minute goes on a line of its own in the mono face, the raw key's own
                face, so a long key wraps as a whole line and never breaks mid-name at a hyphen. */}
            <div ref={tipRef} className="absolute bottom-2 w-max max-w-full group-data-[side=below]:bottom-auto group-data-[side=below]:top-2">
              <div className="vv-tooltip tabular-nums">
                <div>{timeAndWord(tipCell)}</div>
                {tipCell.worst !== null && <div className="font-mono text-[11.5px] [overflow-wrap:anywhere]">{tipCell.worst}</div>}
              </div>
            </div>
            {/* The pointer sits at the minute's centre in the library tooltip's own arrow paint. It points down
                from the bubble's foot above the strip, and up from its head below it. */}
            <div
              aria-hidden
              className="vv-tooltip__arrow vv-tooltip__arrow--top absolute bottom-0 size-0 -translate-x-1/2 group-data-[side=below]:hidden"
              style={{ left: `${tipCentre * 100}%` }}
            />
            <div
              aria-hidden
              className="vv-tooltip__arrow vv-tooltip__arrow--bottom absolute top-0 hidden size-0 -translate-x-1/2 group-data-[side=below]:block"
              style={{ left: `${tipCentre * 100}%` }}
            />
          </div>
        )}
        <div
          ref={stripRef}
          role="listbox"
          tabIndex={0}
          aria-label={t('cerberus.sheet.cells')}
          aria-activedescendant={shownIndex === null ? undefined : `${optionId}-${shownIndex}`}
          className="flex h-[26px] cursor-pointer touch-pan-y gap-0.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
          onPointerDown={point}
          onPointerMove={point}
          onPointerLeave={() => setActiveIndex(null)}
          onClick={onClick}
          onFocus={() => setActiveIndex((current) => current ?? restingIndex())}
          onBlur={() => setActiveIndex(null)}
          onKeyDown={onKeyDown}
        >
          {cells.map((cell, index) => (
            <StatusCell
              key={cell.from}
              id={`${optionId}-${index}`}
              role="option"
              aria-selected={index === selectedIndex}
              status={cell.status}
              label={describe(cell)}
              className={cn(
                'h-full min-w-[3px] flex-1 transition-transform duration-move ease-spring motion-reduce:transition-none',
                index === shownIndex && 'scale-y-125',
                index === selectedIndex && 'relative z-10 outline outline-2 outline-offset-1 outline-primary',
              )}
            />
          ))}
        </div>
      </div>
      <div aria-hidden className="flex justify-between text-[11.5px] tabular-nums text-muted-foreground">
        <span>{hm(cells[0].from)}</span>
        <span>{hm(cells[middleIndex].from)}</span>
        <span>{hm(cells[count - 1].from)}</span>
      </div>
    </div>
  );
}
