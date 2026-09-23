import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { DragEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { ArcCard, dragScopePosition } from '@/modules/plan-runner/ArcCard';
import { ARC_CARD_DRAG_TYPE, arcProgress, deckLayers, reorderAllowed } from '@/modules/plan-runner/arcState';
import { useArcModel } from '@/modules/plan-runner/hooks/useArcModel';
import { useArcStart } from '@/modules/plan-runner/hooks/useArcStart';
import { useDeckStrip } from '@/modules/plan-runner/hooks/useDeckStrip';
import { RunModelControl } from '@/modules/plan-runner/RunModelControl';
import { scheduleClock } from '@/modules/plan-runner/runState';
import { ScheduleControl } from '@/modules/plan-runner/ScheduleControl';
import { api } from '@/shared/api';
import { Badge, Button } from '@/shared/ui';
import type { ArcSnapshot, ArcVerbResult, Tone } from '@/shared/types';
import { cn, effectiveModelWord } from '@/shared/utils';

type ArcStatus = ArcSnapshot['status'];

/** The arc's own word and tone — the same hues a card's state wears, one level up. */
const STATUS: Record<ArcStatus, { key: string; tone: Tone }> = {
  'not-started': { key: 'runner.arcNotStarted', tone: 'neutral' },
  walking: { key: 'runner.arcWalking', tone: 'info' },
  stalled: { key: 'runner.arcStalled', tone: 'warn' },
  complete: { key: 'runner.arcComplete', tone: 'positive' },
};

/**
 * The position of the card a drag event is standing on: the nearest `[data-arc-card]` up from the
 * event's target, or `null` when the pointer is over the deck's own frame rather than a card.
 *
 * Read off the DOM rather than carried in state on purpose: the pointer moves between cards far
 * more often than the deck re-renders, and a position held in state would be a frame behind the
 * cursor while a drag is in flight.
 */
function hoveredCardPosition(target: EventTarget | null): number | null {
  const node = target instanceof Element ? target.closest('[data-arc-card]') : null;
  const position = Number(node?.getAttribute('data-arc-card'));
  return Number.isInteger(position) && position >= 1 ? position : null;
}

/**
 * Ask the runner to move one card, and say nothing about its answer but the reason it gave.
 *
 * The refusal is the runner's own sentence — `plan-runner arc reorder` prints it on `stderr`, and
 * the lane carries it whole in a 409 — and it is LOGGED rather than shown: the deck has no room
 * for a notice and no state to hold one, and a refused move left the arc file exactly as it was,
 * so the deck already tells the truth. A request that never completed is logged too, never
 * swallowed: an unhandled rejection is a console error, and silence would help nobody.
 */
async function requestReorder(arcName: string, from: number, to: number): Promise<void> {
  try {
    const response = await api.planRunner.arcReorder(arcName, from, to);
    if (response.ok) return;
    const body = (await response.json().catch(() => null)) as ArcVerbResult | null;
    console.warn(`[ArcDeck] arc ${arcName}: refusing to move card ${from} to ${to}:`, body?.stderr);
  } catch (error) {
    console.warn(`[ArcDeck] arc ${arcName}: the reorder request did not complete:`, error);
  }
}

/**
 * ONE arc, drawn as a gallery: every card in ONE horizontal strip, in position order — the finished
 * ones on the left (dimmed), the live card, then the cards still to come. Past → present → future
 * reads left to right, which is the walk's own order, and each card still wears its layer (`done`
 * / `top` / `beneath`, from `deckLayers`) as the harness's handle.
 *
 * THE STRIP MOVES THREE WAYS: a swipe or a trackpad (CSS scroll snap, no script), the arrows at
 * either end of the nav row (one card each, disabled at their end), and Left/Right on the focused
 * strip. The live card is centred on mount and again whenever the runner moves `current`
 * (`useDeckStrip`). One card: no arrows, nothing to move to.
 *
 * Every card is one fixed width (18rem, never wider than the strip) and the row stretches them to
 * one height, so the strip never jumps as it scrolls. `cardFillsStrip` is the gutter home's width
 * instead: every card exactly the strip's width, so one whole card is in view and the arrows and
 * the snap page one card at a time (`ArcGallery` says why). The drop target is the strip itself — the
 * whole list a dragged card can land in.
 *
 * AN ARC NOT YET STARTED offers its Start in the header — `arc start` now, or `Start at …` for the watchdog to
 * press at DeepSeek's next off-peak moment (`ScheduleControl`), with `starts <time>` once scheduled.
 *
 * Used by `ArcGallery`, once per arc on the lane, in either of its homes.
 */
export function ArcDeck({ arc, cardFillsStrip = false }: { arc: ArcSnapshot; cardFillsStrip?: boolean }) {
  const { t } = useTranslation();
  const cards = deckLayers(arc);
  const status = STATUS[arc.status] ?? STATUS['not-started'];
  // The card the strip opens on: the live one, or — once every card is complete — the last.
  const liveIndex = cards.findIndex(({ layer }) => layer === 'top');
  const focusIndex = liveIndex === -1 ? cards.length - 1 : liveIndex;
  const { stripRef, view, step, onScroll, onKeyDown } = useDeckStrip(Math.max(focusIndex, 0), cards.length);
  const movable = cards.length > 1;
  // The arc's ONE model word — its cards get no control of their own (operator, 2026-09-22).
  const { setModel, busy: pinning } = useArcModel(arc.arc);
  // An arc no card of which has started offers its Start — now, or ahead of time through the watchdog.
  const { start, schedule, busy: starting } = useArcStart(arc.arc);
  const unstarted = arc.status === 'not-started' && !arc.started_at;
  const startAt = arc.start_at ?? null;   // `?? null`: a frame from a server older than the field

  /**
   * A DROP IS OFFERED ONLY WHERE ONE WOULD LAND. The drag has to declare itself one of THIS deck's
   * cards — its scope type names this arc, which is what keeps a card dragged out of another deck
   * from reordering this one — and the card under the pointer has to be a position the runner would
   * move to. `reorderAllowed` asks exactly the question the runner asks, so the browser's cursor
   * never promises a drop the runner would refuse.
   */
  const handleDragOver = (event: DragEvent<HTMLOListElement>) => {
    const transfer = event.dataTransfer;
    if (!transfer) return;
    const from = dragScopePosition(transfer.types, arc.arc);
    const to = hoveredCardPosition(event.target);
    if (from === null || to === null || !reorderAllowed(arc, from, to)) return;
    // A `dragover` that does not preventDefault says "not a drop target", and the browser answers
    // with a no-entry cursor: ACCEPTING is this call. The drop itself can still arrive — the app's
    // document-level `react-dropzone` prevents default for every drag on the page (measured
    // 2026-09-22) — so this guard promises the cursor, and `handleDrop` below decides the move.
    event.preventDefault();
    transfer.dropEffect = 'move';
  };

  /**
   * The drop, handed to the runner. NOTHING MOVES HERE — no local state, no optimistic order: the
   * arc file is the truth and this tab is a view of it, so the deck redraws from the next
   * `arc_state` frame (at most one poll away) in the order the runner just wrote.
   */
  const handleDrop = (event: DragEvent<HTMLOListElement>) => {
    const transfer = event.dataTransfer;
    if (!transfer) return;
    const from = Number(transfer.getData(ARC_CARD_DRAG_TYPE));
    const to = hoveredCardPosition(event.target);
    // The drag's own text copy is what names the deck it belongs to: a card dragged out of another
    // deck carries that arc's name, and this deck is not its target.
    if (to === null || transfer.getData('text/plain') !== `${arc.arc}:${from}`) return;
    if (!reorderAllowed(arc, from, to)) return;
    event.preventDefault();
    void requestReorder(arc.arc, from, to);
  };

  return (
    <section
      data-arc-deck={arc.arc}
      data-arc-status={arc.status}
      className="flex w-full min-w-0 flex-col gap-3 rounded-lg border border-border bg-muted/40 p-3"
    >
      <header className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-start gap-2">
          <h4 className="min-w-0 flex-1 break-words text-sm font-medium leading-snug">{arc.title}</h4>
          <Badge tone={status.tone} className="shrink-0">
            {t(status.key)}
          </Badge>
        </div>
        {/* Absent once the arc is complete: no card is left for the word to reach. A record with no
            word — or a frame from an older server — reads DeepSeek. */}
        {arc.status !== 'complete' && (
          <RunModelControl scope="arc" value={effectiveModelWord(arc.model)} busy={pinning}
            onChoose={(choice) => void setModel(choice)} />
        )}
        {unstarted && (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button size="sm" disabled={starting} onClick={() => void start()} data-arc-start>
              {t('runner.start')}
            </Button>
            <ScheduleControl scope="arc" startAt={startAt} busy={starting} onSchedule={(when) => void schedule(when)} />
            {startAt !== null && (
              <span className="font-mono text-xs text-muted-foreground" data-arc-schedule-note>
                {t('runner.schedule.starts', { time: scheduleClock(startAt) })}
              </span>
            )}
          </div>
        )}
        <div className="flex min-w-0 items-center gap-2">
          {movable && (
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label={t('runner.arcPrevious')}
              disabled={view.atStart}
              onClick={() => step(-1)}
              data-arc-prev
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
          )}
          <p className="min-w-0 flex-1 text-center text-xs text-muted-foreground" data-arc-viewing>
            {movable && `${t('runner.arcViewing', { n: view.index + 1, total: cards.length })} · `}
            {t('runner.arcCards', arcProgress(arc))}
          </p>
          {movable && (
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label={t('runner.arcNextCard')}
              disabled={view.atEnd}
              onClick={() => step(1)}
              data-arc-next
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          )}
        </div>
      </header>

      {/* `relative` makes the strip its cards' offset parent, which centring reads. `tabIndex` lets
          the keyboard's Left/Right move it once focused. `overflow-y-hidden` beside `overflow-x-auto`:
          alone, `overflow-x: auto` computes `overflow-y` to `auto`, and anything absolutely placed
          below the row would turn the strip into a vertical scroller that eats the page's wheel. */}
      <ol
        ref={stripRef}
        data-arc-strip
        tabIndex={0}
        aria-label={t('runner.arcStrip', { title: arc.title })}
        className="scrollbar-hide relative flex min-w-0 snap-x snap-mandatory items-stretch gap-3 overflow-x-auto overflow-y-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {cards.map(({ card, layer }) => (
          <li key={card.position} className={cn('flex-none snap-center', cardFillsStrip ? 'w-full' : 'w-72 max-w-full')}>
            <ArcCard arc={arc} card={card} layer={layer} />
          </li>
        ))}
      </ol>
    </section>
  );
}
