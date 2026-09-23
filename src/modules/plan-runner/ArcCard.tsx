import type { DragEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { ArcPhaseList } from '@/modules/plan-runner/ArcPhaseList';
import { useRunnerRuns } from '@/modules/plan-runner/hooks/useRunnerRuns';
import { PhaseRow } from '@/modules/plan-runner/PhaseRow';
import { PipelineStrip } from '@/modules/plan-runner/PipelineStrip';
import { ARC_CARD_DRAG_TYPE, cardDraggable, cardTone } from '@/modules/plan-runner/arcState';
import { pipelineForRun, seenStages, waveCompanions } from '@/modules/plan-runner/runState';
import { Badge, Card, Chip } from '@/shared/ui';
import type { ArcCardLayer, ArcCardSnapshot, ArcCardState, ArcSnapshot } from '@/shared/types';
import { cn } from '@/shared/utils';

/** The word each card state wears on its badge — the runner's word, in the reader's language. */
const STATE_KEY: Record<ArcCardState, string> = {
  unminted: 'runner.arcNotStarted',
  queued: 'runner.arcQueued',
  walking: 'runner.arcWalking',
  paused: 'runner.arcPaused',
  complete: 'runner.arcComplete',
  stalled: 'runner.arcStalled',
};

type ArcCardProps = {
  arc: ArcSnapshot;
  card: ArcCardSnapshot;
  layer: ArcCardLayer;
};

/**
 * The SCOPE a card's drag declares, as a data TYPE: this arc's name and the card's position, under
 * the card type's own prefix.
 *
 * WHAT A DRAG MUST CARRY to be allowed to move a card of arc `A` — THE CONTRACT, spelled here
 * because nothing else names it: the type `ARC_CARD_DRAG_TYPE` with the card's position, the
 * `text/plain` copy `<A>:<position>`, and the scope type
 * `ARC_CARD_DRAG_TYPE + '/' + hex(A) + ':' + <position>`. A drag that omits the scope type is
 * refused a drop, and refused SILENTLY — no `preventDefault`, no drop, no log — so a caller
 * building one from the interfaces alone has nothing to read.
 *
 * WHY THE SCOPE RIDES A TYPE AT ALL. `dragover` CANNOT READ A DRAG'S VALUES: Chromium keeps them
 * hidden until the drop — measured on this host, 2026-09-22, `getData` answers `''` throughout
 * while the type list is complete. So the deck's `dragover` — which has to decide BEFORE the drop,
 * and has to refuse a drag from another deck — is handed the arc's name and the position in the one
 * channel every browser exposes. The text copy, and the `from` the drop acts on, stay on the
 * dataTransfer — and that copy is the last word on a move, because the drop arrives whatever the
 * guard decided: `react-dropzone`, the app's upload dropzone, listens on the document and prevents
 * default for EVERY drag on the page (measured the same day), so the guard moves the cursor and the
 * drop's own exact check is what moves nothing.
 *
 * WHY THE NAME IS HEX AND NEVER ITSELF: a browser folds a type list to lower case. An arc's name
 * is case-sensitive — `Fixture` and `fixture` are two arcs to the runner — so a scope carrying the
 * name as written lets a drag out of one deck onto the other's; measured on this host 2026-09-22,
 * the browser delivered that drop, and only the drop's own exact check refused the move. Hex has
 * nothing left to fold, and it carries every byte of any name. The colon after it fences the name,
 * so arc `vv` can never be read off a drag of arc `vv-two`'s cards.
 */
const SCOPE_ENCODER = new TextEncoder();

/** The arc's name as the scope type spells it: its UTF-8 bytes in lower-case hex. */
function arcScopeName(arcName: string): string {
  return [...SCOPE_ENCODER.encode(arcName)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** The scope prefix a drag of `arcName`'s cards wears. Written here, read by the deck it is over. */
function dragScopePrefix(arcName: string): string {
  return `${ARC_CARD_DRAG_TYPE}/${arcScopeName(arcName)}:`;
}

/** The scope type a drag of `arcName`'s card at `position` wears. Written here, read below. */
function arcCardDragScope(arcName: string, position: number): string {
  return `${dragScopePrefix(arcName)}${position}`;
}

/**
 * The position a drag declares for `arcName`, or `null` when the drag is not one of its cards.
 * Read by the deck the drag is over: the deck it does not name shows no drop.
 *
 * Only THIS arc's scope answers, byte for byte: a drag carrying any other arc's name — another
 * deck's, or this one's under a different case — is no drag of these cards.
 */
export function dragScopePosition(types: readonly string[], arcName: string): number | null {
  const prefix = dragScopePrefix(arcName);
  // A type list reaches a page already folded by the sender's browser; folding the candidate too
  // costs nothing and reads a hand-built type alike.
  const scope = types.find((type) => type.toLowerCase().startsWith(prefix));
  if (scope === undefined) return null;
  const position = Number(scope.slice(prefix.length));
  return Number.isInteger(position) && position >= 1 ? position : null;
}

/**
 * One card of an arc's deck: which card it is, what it lands, and where the walk stands on it.
 *
 * IT COMPOSES AND DOES NOT DRAW. The frame is `Card`, the number is a `Chip`, the state is a
 * `Badge` whose tone is `cardTone`'s — nothing here spells a colour, so both themes paint it
 * through the token blocks. A done card is quieter through OPACITY alone: the tone still says
 * "complete" in its own hue, and dimness says "behind you" without inventing a sixth colour.
 *
 * `draggable` is the rule's answer, never a constant: only a card the runner has not started may
 * be picked up (`cardDraggable`), and the grab cursor and the hint appear only on those, so a card
 * that cannot move never promises that it can.
 *
 * THE PHASES ARE THE PLAN'S. A card with no run draws the phase list the runner wrote into its
 * record (`arc.json:cards[].phases`, `shipped` from the runner's own census); a `walking`/`paused`
 * card draws its LIVE run's phases instead, which carry the real state, so the card that has a run
 * never shows two answers (the record stands in until the run has composed any). A plan not
 * written yet draws "Plan not written yet".
 *
 * Every card fills its strip slot's height (`h-full`): the deck stretches its row to the tallest
 * card, so the strip does not jump as it scrolls.
 *
 * The data attributes are the browser harness's handles: position, state and layer are read off
 * the DOM to prove the strip draws the walk's order and each card's place in it.
 *
 * Used by `ArcDeck`, once per card of the strip.
 */

export function ArcCard({ arc, card, layer }: ArcCardProps) {
  const { t } = useTranslation();
  const draggable = cardDraggable(arc, card);

  // THE CARD'S LIVING RUN, JOINED BY `run_id` AND NEVER BY PLAN PATH: a plan can have been walked
  // more than once, and the run the record minted this card against is the only one whose stages
  // and phase belong on its face.
  const { runs } = useRunnerRuns();
  const live = card.state === 'walking' || card.state === 'paused'
    ? (runs.find((run) => run.run_id === card.run_id) ?? null)
    : null;
  // An ended or queued run has nothing in flight — no stage lights and no clock ticks — exactly as
  // `RunCard` draws it; only a phase that is genuinely running gets a clock.
  const inert = live !== null && (live.state === 'ended' || live.state === 'queued');
  const phase = live?.phases.find((row) => row.id === (live.position?.phase_id ?? null)) ?? null;
  // A run whose progress has not composed its phases yet carries `[]`: the record's list stands in
  // until it does, so a freshly walking card never reads "Plan not written yet".
  const phaseList = live && live.phases.length > 0
    ? live.phases
    : card.phases.map((entry) => ({ id: entry.id, title: entry.title, state: entry.shipped ? ('shipped' as const) : ('pending' as const) }));

  /**
   * The drag carries the card's position as the card type's value, the `<arc>:<position>` copy the
   * drop checks, and — for a `dragover`, which is blind to values — the scope type its own deck
   * reads. A card that cannot move is not draggable at all, and nothing is set on its behalf.
   */
  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    if (!draggable) return;
    event.dataTransfer.setData(ARC_CARD_DRAG_TYPE, String(card.position));
    event.dataTransfer.setData('text/plain', `${arc.arc}:${card.position}`);
    event.dataTransfer.setData(arcCardDragScope(arc.arc, card.position), String(card.position));
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <Card
      data-arc-card={card.position}
      data-arc-card-state={card.state}
      data-arc-layer={layer}
      draggable={draggable}
      onDragStart={handleDragStart}
      title={draggable ? t('runner.arcDragHint') : undefined}
      className={cn(
        'flex h-full w-full min-w-0 flex-col gap-1.5 p-3',
        layer === 'top' && 'gap-2',
        layer === 'done' && 'opacity-60',
        draggable && 'cursor-grab active:cursor-grabbing'
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Chip size="sm">{t('runner.arcCard', { n: card.position })}</Chip>
        <Badge tone={cardTone(card.state)} className="ml-auto shrink-0">
          {t(STATE_KEY[card.state])}
        </Badge>
      </div>
      <p
        data-arc-card-title
        className={cn('min-w-0 break-words font-medium leading-snug', layer === 'top' ? 'text-sm' : 'text-xs')}
      >
        {card.title}
      </p>
      <p className="line-clamp-2 min-w-0 break-words text-xs leading-snug text-muted-foreground">{card.charter}</p>
      <ArcPhaseList phases={phaseList} currentId={inert ? null : (live?.position?.phase_id ?? null)} />
      {live && (
        // THE RUN, ON THE CARD IT BELONGS TO. `data-arc-card-run` is the browser harness's handle:
        // it names the run the strip was drawn from, so a probe can prove the join is by `run_id`.
        <div className="mt-1 flex min-w-0 flex-col gap-1.5" data-arc-card-run={live.run_id}>
          <PipelineStrip
            stages={pipelineForRun(live)}
            active={inert ? '' : (live.position?.stage ?? '')}
            detail={inert ? '' : (live.position?.stage_detail ?? '')}
            seen={seenStages(live)}
          />
          {phase && (
            <PhaseRow
              phase={phase}
              // Filtered here rather than inside the row, as `RunCard` does it: the timeline is one
              // list for the whole run, and a row that scanned it would walk it once per card.
              timeline={live.timeline.filter((entry) => entry.phase_id === phase.id)}
              isCurrent={!inert && phase.id === (live.position?.phase_id ?? null)}
              stageSince={inert ? null : (live.position?.stage_since ?? null)}
              alongside={waveCompanions(live).get(phase.id)}
            />
          )}
        </div>
      )}
    </Card>
  );
}
