import type { DragEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { ArcPhaseList } from '@/modules/plan-runner/ArcPhaseList';
import { dismissRun } from '@/modules/plan-runner/dismissedRuns';
import { useRunnerRuns } from '@/modules/plan-runner/hooks/useRunnerRuns';
import { RunControls } from '@/modules/plan-runner/RunControls';
import { RunClock, RunFace, RunStateBadge } from '@/modules/plan-runner/RunFace';
import { SessionPin } from '@/modules/plan-runner/SessionPin';
import { ARC_CARD_DRAG_TYPE, cardDraggable, cardTone } from '@/modules/plan-runner/arcState';
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
  stuck: 'runner.arcStuck',
};

type ArcCardProps = {
  arc: ArcSnapshot;
  card: ArcCardSnapshot;
  layer: ArcCardLayer;
  /**
   * The open chat's session, when the card is drawn in the chat gutter: a run this chat launched
   * wears the same pin here that the gutter's run list puts on it. `null` on the Runner tab, where
   * there is no open chat and so no "mine".
   */
  pinnedSessionId?: string | null;
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
 * One card of an arc's deck: which card it is, what it lands, where the walk stands on it — and THE
 * RUN ITSELF, whole, for the card the runner has minted a run for.
 *
 * IT COMPOSES AND DOES NOT DRAW. The frame is `Card`, the number is a `Chip`, the state is a
 * `Badge` whose tone is `cardTone`'s — nothing here spells a colour, so both themes paint it
 * through the token blocks. A done card is quieter through OPACITY alone: the tone still says
 * "complete" in its own hue, and dimness says "behind you" without inventing a sixth colour.
 *
 * THE RUN IS DRAWN HERE AND NOT BELOW THE DECK. A card's run used to appear twice — inside the card
 * and again as a `RunCard` under the gallery — and it is one plan, so it is drawn once, in its card
 * (operator, 2026-09-24: "Arc cards should display their progress and info inside the plan cards
 * nested in the arc, not creating a duplicate plan below it"). The run list subtracts every run an
 * arc card owns (`arcOwnedRunIds`), which is also why THIS join may not be partial: the card draws
 * the run the record names whatever state it is in — walking, paused, queued, or ended — because a
 * state the card skipped would be a run that had vanished from the screen entirely.
 *
 * WHAT THE RUN WEARS IS `RunFace`'s, not a copy: the same word, the same clock, the same meter, the
 * same strip, the same verbs as a `RunCard` in the lists below, so one run cannot read two ways on
 * one screen. Two things are deliberately NOT here: the run's own model control — the deck header
 * carries the arc's ONE toggle (operator, 2026-09-22: "an arc plan should have 1 toggle"), and that
 * toggle re-pins every minted, unfinished card's run — and the plan's file name, which would be a
 * second name over a card that is already the plan's.
 *
 * `draggable` is the rule's answer, never a constant: only a card the runner has not started may
 * be picked up (`cardDraggable`), and the grab cursor and the hint appear only on those, so a card
 * that cannot move never promises that it can.
 *
 * THE PHASES ARE THE PLAN'S, AND THEY ARE DISCLOSED ONCE. A card with no run draws the phase list
 * the runner wrote into its record (`arc.json:cards[].phases`, `shipped` and `blocked` from the
 * runner's own readers); a card with a run draws its LIVE run's phases instead, which carry the real
 * state — and it draws them in ONE place, the run's own `RunFace`, because one plan's rows listed
 * twice under each other inside one card is the operator's complaint in miniature ("not creating a
 * duplicate plan", 2026-09-24). The record's list stands in for the one case where nothing else
 * would draw those rows at all: a run that has not composed its phases yet. A plan
 * not written yet draws "Plan not written yet". Beside the badge, a card with a phase behind it and
 * phases still ahead draws `10 of 18 · 8 blocked` — the count over the very rows beneath it, so a
 * `stalled` card says HOW MUCH held it rather than leaving the reader to count the ⛔s, and a card
 * nothing has happened to yet says nothing at all.
 *
 * A CARD THAT CANNOT START SAYS SO, ON ITSELF. A press the start ladder REFUSES (the lint, the switch, the
 * intent lock, the arc's order gate) used to leave the card looking merely unstarted — measured 2026-09-24:
 * 38 refusals over 76 minutes under a header reading "Walking". The stamp, the `stuck` state and the gate's
 * own sentence are the RUNNER's (`hooks/plan_runner/arc_refused.py`), copied here whole.
 *
 * Every card fills its strip slot's height (`h-full`): the deck stretches its row to the tallest
 * card, so the strip does not jump as it scrolls.
 *
 * The data attributes are the browser harness's handles: position, state, layer and the session pin
 * are read off the DOM to prove the strip draws the walk's order, each card's place in it, and —
 * `data-arc-card-run`, carrying the run's id — that the plan under this card is drawn here ONCE.
 *
 * Used by `ArcDeck`, once per card of the strip.
 */

export function ArcCard({ arc, card, layer, pinnedSessionId = null }: ArcCardProps) {
  const { t } = useTranslation();
  const draggable = cardDraggable(arc, card);

  // THE CARD'S RUN, JOINED BY `run_id` AND NEVER BY PLAN PATH: a plan can have been walked more
  // than once, and the run the record minted this card against is the only one whose stages and
  // phase belong on its face. Every state, for the reason the file's own comment gives: this run is
  // not in the list below the deck, so the card is the one place it is drawn.
  const { runs, carriedIds } = useRunnerRuns();
  const live = card.run_id === null ? null : (runs.find((run) => run.run_id === card.run_id) ?? null);
  // An ended or queued run has nothing in flight — no stage lights and no clock ticks — exactly as
  // `RunFace` draws it; only a phase that is genuinely running gets a clock.
  const inert = live !== null && (live.state === 'ended' || live.state === 'queued');
  // A run whose progress has not composed its phases yet carries `[]`: the record's list stands in
  // until it does, so a freshly walking card never reads "Plan not written yet". A record phase the
  // ship log's LAST ⛔ stands over (`blocked`, `arc_phases.py`) takes the run's own blocked state,
  // so the card draws it with `PHASE_GLYPH`'s ⛔ beside the runs it belongs to.
  const phaseList = live && live.phases.length > 0
    ? live.phases
    : card.phases.map((entry) => ({
        id: entry.id,
        title: entry.title,
        state: entry.shipped ? ('shipped' as const) : entry.blocked ? ('blocked' as const) : ('pending' as const),
      }));
  // WHICHEVER LIST IS DRAWN, ONE OF THEM IS. `RunFace` below carries the run's own rows, so the
  // record's list is drawn only when the run composed none — otherwise the same phases would run
  // down the card twice, which is what the run strip did to the card's own list after the merge
  // (see the file's header: disclosed once, never both).
  const runDrawsPhases = live !== null && live.phases.length > 0;

  // THE COUNT RIDES THE SAME ROWS the list draws above it, so the two can never disagree: a card
  // whose run ended with a ⛔ reads `10 of 18 · 8 blocked` under its `stalled` badge, which is how a
  // `complete` receipt that left eight phases standing is told apart from one that landed them all.
  // Nothing for a card with nothing behind it — a `queued` or `unminted` card's `0 of 18` says
  // nothing its badge does not — and nothing for one whose every phase shipped (the badge already
  // says complete). A count needs a phase walked, or a ⛔ to explain.
  const shipped = phaseList.filter((row) => row.state === 'shipped').length;
  const blocked = phaseList.filter((row) => row.state === 'blocked').length;
  const counts = (shipped > 0 || blocked > 0) && shipped < phaseList.length ? { shipped, blocked } : null;

  // THE CHAT'S OWN RUN, PINNED HERE. `launched_by_session` arrives already resolved to an app
  // session id by the server, so a plain equality is the whole test — and `null` on either side is
  // not a match, since "no session launched it" is not "this session launched it".
  const mine = pinnedSessionId !== null && live !== null && live.launched_by_session === pinnedSessionId;
  // Dismiss is offered exactly where the lists offer it: an ended run whose ending is on the card.
  // `carriedIds` is the unfiltered lane, because that is what a dismissal prunes against.
  const dismiss = live !== null && live.state === 'ended' && live.ended_at !== null
    ? () => dismissRun({ run_id: live.run_id, ended_at: live.ended_at as number }, carriedIds)
    : undefined;

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
      data-pinned={String(mine)}
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
        {/* The pin sits with the card's own marks, not inside the run strip below: it is a fact
            about this card — the run it holds is the open chat's — and it reads the same way the
            gutter's run list pins one. */}
        {mine && <SessionPin />}
        {/* The counts ride the badge's own row, in the reader's language, as two strings the
            separator sits between — `data-arc-card-phases` is the browser harness's handle. */}
        {counts && (
          <p data-arc-card-phases className="ml-auto min-w-0 shrink-0 truncate text-xs text-muted-foreground">
            {t('runner.arcPhaseCount', { done: counts.shipped, total: phaseList.length })}
            {counts.blocked > 0 && <> · {t('runner.arcBlockedPhases', { n: counts.blocked })}</>}
          </p>
        )}
        <Badge
          data-arc-card-badge
          tone={cardTone(card.state)}
          className={cn('shrink-0', counts === null && 'ml-auto')}
        >
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
      {/* WHY THIS CARD CANNOT START — the runner's own stamp, whole (`arc.json:cards[].refusal`,
          `arc_refused.py`), in the badge's amber. The sentence is the refusing gate's, captured off its
          stderr: nothing is re-derived and nothing softened, so it cannot disagree with the brief or the push. */}
      {card.refusal !== null && (
        <p
          data-arc-card-refusal
          title={card.refusal.reason}
          className="min-w-0 break-words text-xs leading-snug text-warn-ink"
        >
          {t('runner.arcStuckReason', { reason: card.refusal.reason })}
        </p>
      )}
      {!runDrawsPhases && (
        <ArcPhaseList phases={phaseList} currentId={inert ? null : (live?.position?.phase_id ?? null)} />
      )}
      {live && (
        // THE RUN, ON THE CARD IT BELONGS TO — the same display a `RunCard` draws, minus the frame.
        // `data-arc-card-run` names it, so a probe can prove the plan is drawn here once and only
        // here; `data-arc-card-run-state` names the state, which is what the merged card has to
        // carry for a run in any of them (a queued one's Start, an ended one's outcome).
        <div
          className="mt-1 flex min-w-0 flex-col gap-2"
          data-arc-card-run={live.run_id}
          data-arc-card-run-state={live.state}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <RunStateBadge run={live} />
            <RunClock run={live} />
          </div>
          <RunFace run={live} defaultOpen={false} />
          <RunControls run={live} onDismiss={dismiss} showModel={false} />
        </div>
      )}
    </Card>
  );
}
