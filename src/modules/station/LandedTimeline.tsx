import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, ReactNode, WheelEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useHostWindow } from '@/shared/context/HostWindowContext';
import type { StationLanded } from '@/shared/station-types';
import { ScrollArea } from '@/shared/ui';
import { cn, resizeObserverIn } from '@/shared/utils';

/** The rule on the timeline: where he last looked, between the last landing he saw and the first he has not. */
function LastLookRule({ when }: { when: string }) {
  const { t } = useTranslation();
  return (
    <div
      data-strip-rule=""
      className="flex flex-col-reverse justify-center border-l-2 border-dashed border-garnish py-0.5 pl-2 pr-1 max-md:min-h-11"
    >
      <span className="whitespace-nowrap text-sm leading-5 text-garnish">
        {t('station.strip.rule', { defaultValue: 'You last looked' })}
      </span>
      <span className="text-xs tabular-nums leading-4 text-muted-foreground">{when}</span>
    </div>
  );
}

type LandedTimelineProps = {
  /** The week's landings, oldest first. */
  entries: StationLanded[];
  /** Where the new landings start: the index of the first one after his last look, `-1` when none is new. */
  firstFresh: number;
  /** His last look in the strip's words on his clock, for the rule; `null` when none is on record, and then no rule stands. */
  lastLook: string | null;
  /** One landing, drawn: the strip's `LandedEntry`, with its badge, its time and its press, and whether it is the line's tab stop. */
  entryOf: (entry: StationLanded, at: number, place: { tabbable: boolean }) => ReactNode;
  /** The scroller, for the station's scroll memory on the page. Absent on a fixture, which remembers nothing. */
  scrollRef?: (node: HTMLElement | null) => void;
};

/**
 * THE STRIP'S TIMELINE, the week sideways: its landings oldest to newest in a horizontal `ScrollArea`, a finger panning it
 * and a mouse's wheel turning it, between the strip's head and its fold. The rule "You last looked" stands before the
 * first new landing, so "since you last looked" is a place on the line and not only a colour: its dashed edge in the
 * garnish, his last look's time over its words.
 *
 * IT LANDS ON THE NEWEST as it is drawn (the strip opening from its fold draws it anew) and as a new landing joins its
 * end, so what landed last is what stands in view. And while it stands at that end it holds it: a narrower line (the
 * head's words grown as "<n> new" is pressed, the rule gone, a narrower window) moves its end without a scroll, so a
 * resize puts it back there; a line he scrolled back to read stays where he put it. Its own scroll events say where it
 * stands, and its leading edge fades while it is not at its start, so a landing cut there reads as "more this way" and
 * not as a fragment. Its times run along its top, each landing's and the rule's alike.
 *
 * ONE TAB STOP for the whole week: Tab enters at the landing he last moved to, else the first new one, else the newest,
 * and leaves for the fold; ←/→ walk the line and Home/End reach its ends, so a keyboard crosses sixty landings in one step.
 *
 * Drawn by `SinceYouLastLookedView` (this module), which draws each landing (`entryOf`) and decides what is new.
 */
export function LandedTimeline({ entries, firstFresh, lastLook, entryOf, scrollRef }: LandedTimelineProps) {
  const { t } = useTranslation();
  const hostWindow = useHostWindow();
  // The scroller this lands on the newest; the station's scroll memory is handed the same node.
  const scroller = useRef<HTMLDivElement | null>(null);
  // Whether the line stands at its newest end, from its own scroll events: while it does, a resize puts it back there.
  // A ref, as nothing is drawn from it; true at first, as the line is drawn at its end.
  const atEnd = useRef(true);
  // Whether the line stands at its oldest end. State, as the leading edge's fade is drawn from it.
  const [atStart, setAtStart] = useState(true);
  // The landing he last moved to on the line, by id: its one tab stop. `null` until he moves along it.
  const [chosenId, setChosenId] = useState<number | null>(null);
  const newestId = entries.length === 0 ? null : entries[entries.length - 1].id;
  const stopId = entries.some((entry) => entry.id === chosenId) ? chosenId : (entries[firstFresh]?.id ?? newestId);

  const bindScroller = useCallback((node: HTMLDivElement | null) => {
    scroller.current = node;
    scrollRef?.(node);
  }, [scrollRef]);

  // On the newest: as the timeline is drawn, and as a new landing joins its end (even one he had scrolled back from).
  useLayoutEffect(() => {
    const node = scroller.current;
    if (node !== null) node.scrollLeft = node.scrollWidth;
  }, [newestId]);

  // Where the line stands, on its own scroll events; and a line that stood at its end kept there as it narrows, on the
  // resize of the scroller or of its list. Events only: the observer's first report reads the line as drawn.
  useEffect(() => {
    const node = scroller.current;
    if (node === null) return undefined;
    const read = () => {
      atEnd.current = node.scrollLeft + node.clientWidth >= node.scrollWidth - 1;
      setAtStart(node.scrollLeft <= 1);
    };
    const settle = () => {
      if (atEnd.current) node.scrollLeft = node.scrollWidth;
      read();
    };
    node.addEventListener('scroll', read, { passive: true });
    const observer = resizeObserverIn(hostWindow, settle);
    observer?.observe(node);
    if (node.firstElementChild !== null) observer?.observe(node.firstElementChild);
    return () => {
      node.removeEventListener('scroll', read);
      observer?.disconnect();
    };
  }, [hostWindow]);

  // A mouse's wheel turns the timeline: a bar does not scroll down, so its downward turn is read as sideways. A wheel
  // that counts in lines (Firefox's) is turned into pixels; a trackpad's sideways sweep is left to the browser.
  const turnSideways = (event: WheelEvent<HTMLDivElement>) => {
    const node = scroller.current;
    if (node === null || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    node.scrollLeft += event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
  };

  // A landing focused (by Tab, an arrow or a press) becomes the line's tab stop, so Tab returns to it.
  const followFocus = (event: FocusEvent<HTMLOListElement>) => {
    const id = Number((event.target as HTMLElement).closest('[data-landed-entry]')?.getAttribute('data-landed-entry'));
    if (Number.isSafeInteger(id)) setChosenId(id);
  };

  // ←/→ walk the line, Home/End reach its ends; only a keystroke made on one of its landings moves it.
  const walk = (event: KeyboardEvent<HTMLOListElement>) => {
    const presses = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-landed-entry] button'));
    const at = presses.indexOf(event.target as HTMLElement);
    if (at === -1) return;
    const next = event.key === 'ArrowRight' ? Math.min(at + 1, presses.length - 1)
      : event.key === 'ArrowLeft' ? Math.max(at - 1, 0)
        : event.key === 'Home' ? 0
          : event.key === 'End' ? presses.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    presses[next].focus();
  };

  return (
    <ScrollArea
      ref={bindScroller}
      orientation="horizontal"
      data-strip-timeline=""
      className={cn('min-w-0 flex-1', !atStart && '[mask-image:linear-gradient(to_right,transparent,black_1.5rem)]')}
      onWheel={turnSideways}
    >
      <ol
        aria-label={t('station.strip.timeline', { defaultValue: 'This week’s landings, oldest first' })}
        className="flex w-max items-stretch gap-1.5"
        onFocus={followFocus}
        onKeyDown={walk}
      >
        {entries.map((entry, at) => (
          <Fragment key={entry.id}>
            {at === firstFresh && lastLook !== null && (
              <li className="flex shrink-0">
                <LastLookRule when={lastLook} />
              </li>
            )}
            <li className="w-max min-w-0 max-w-52 shrink-0 md:max-w-72">{entryOf(entry, at, { tabbable: entry.id === stopId })}</li>
          </Fragment>
        ))}
      </ol>
    </ScrollArea>
  );
}
