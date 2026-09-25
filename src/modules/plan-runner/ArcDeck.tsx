import type { DragEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { ArcCard, dragScopePosition } from '@/modules/plan-runner/ArcCard';
import { ARC_CARD_DRAG_TYPE, arcProgress, deckLayers, reorderAllowed } from '@/modules/plan-runner/arcState';
import { DeckFrame, DeckItem } from '@/modules/plan-runner/DeckFrame';
import { useArcModel } from '@/modules/plan-runner/hooks/useArcModel';
import { useArcStart } from '@/modules/plan-runner/hooks/useArcStart';
import { RunModelControl } from '@/modules/plan-runner/RunModelControl';
import { scheduleClock } from '@/modules/plan-runner/runState';
import { ScheduleControl } from '@/modules/plan-runner/ScheduleControl';
import { api } from '@/shared/api';
import { runnerArcFoldKey } from '@/shared/hooks/useCardFold';
import { Button } from '@/shared/ui';
import type { ArcSnapshot, ArcVerbResult, Tone } from '@/shared/types';
import { effectiveModelWord } from '@/shared/utils';

type ArcStatus = ArcSnapshot['status'];

/** The arc's own word and tone — the same hues a card's state wears, one level up. `stuck` is there because the runner derives it (`arcs._derive`): an arc with a card it cannot start is not walking — whichever card that is, since the word rides the arc while ANY of its cards wears it — and a header reading "walking" over a card that is refused every two minutes is the lie this word exists to end. */
const STATUS: Record<ArcStatus, { key: string; tone: Tone }> = {
  'not-started': { key: 'runner.arcNotStarted', tone: 'neutral' },
  walking: { key: 'runner.arcWalking', tone: 'info' },
  stalled: { key: 'runner.arcStalled', tone: 'warn' },
  stuck: { key: 'runner.arcStuck', tone: 'warn' },
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
 * ONE arc of the RUNNER's lane, drawn as a gallery through the shared deck (`DeckFrame`): the arc's
 * own header, and every card in one horizontal strip in position order — the finished ones on the
 * left (dimmed), the live card, then the cards still to come.
 *
 * THE SHAPE IS NOT THIS FILE'S. The chrome, the fold, the arrows, the strip and the snap are
 * `DeckFrame`'s, drawn identically for the dispatcher's arcs — an arc of plans is one shape on both
 * screens (operator, 2026-09-25). What is the runner's own, and what this file adds, is the lane's
 * data and its writing hand: the STATUS words, the drag that reorders a card in the arc FILE, the
 * model switch and Start.
 *
 * AN ARC NOT YET STARTED offers its Start — `arc start` now, or `Start at …` for the watchdog to
 * press at DeepSeek's next off-peak moment (`ScheduleControl`), with `starts <time>` once scheduled.
 *
 * `pinnedSessionId` travels through to the cards untouched: the deck knows nothing about "mine", it
 * only carries the gutter's answer to the card that has to decide it.
 *
 * Used by `ArcGallery`, once per arc on the lane, in either of its homes.
 */
export function ArcDeck({ arc, cardFillsStrip = false, pinnedSessionId = null }: {
  arc: ArcSnapshot;
  cardFillsStrip?: boolean;
  pinnedSessionId?: string | null;
}) {
  const { t } = useTranslation();
  const cards = deckLayers(arc);
  const status = STATUS[arc.status] ?? STATUS['not-started'];
  // The card the strip opens on: the live one, or — once every card is complete — the last.
  const liveIndex = cards.findIndex(({ layer }) => layer === 'top');
  const focusIndex = liveIndex === -1 ? cards.length - 1 : liveIndex;
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
    <DeckFrame
      rootAttributes={{ 'data-arc-deck': arc.arc }}
      status={arc.status}
      title={arc.title}
      badge={status}
      foldKey={runnerArcFoldKey(arc.arc)}
      note={t('runner.arcCards', arcProgress(arc))}
      stripLabel={t('runner.arcStrip', { title: arc.title })}
      focusIndex={Math.max(focusIndex, 0)}
      cardCount={cards.length}
      drag={{ onDragOver: handleDragOver, onDrop: handleDrop }}
      bodyTop={(
        <div className="flex min-w-0 flex-col gap-1">
          {/* Absent once the arc is complete: no card is left for the word to reach. A record with
              no word — or a frame from an older server — reads DeepSeek. */}
          {(arc.status !== 'complete' || unstarted) && (
            <div className="flex min-w-0 flex-col gap-1">
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
            </div>
          )}
        </div>
      )}
    >
      {cards.map(({ card, layer }) => (
        // The item carries the WIDTH alone: `data-arc-card` and its state stay on the card's own root,
        // where every reading of a card has always taken them (`ArcCard`), so a strip does not answer
        // twice for one card.
        <DeckItem key={card.position} cardFillsStrip={cardFillsStrip}>
          <ArcCard arc={arc} card={card} layer={layer} pinnedSessionId={pinnedSessionId} />
        </DeckItem>
      ))}
    </DeckFrame>
  );
}
