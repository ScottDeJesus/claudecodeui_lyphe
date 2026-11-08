import { DraftingCompass } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { epochOf, plannerStatusTone } from '@/modules/dispatcher/dispatcherState';
import { useDispatcherPlans } from '@/modules/dispatcher/hooks/useDispatcherPlans';
import { KindTag } from '@/modules/dispatcher/LaneCardHead';
import { operatorWords, soulWord } from '@/modules/dispatcher/operatorWords';
import { PaceOverride } from '@/modules/dispatcher/PaceOverride';
import { PlanningPausedLine, PlanningPausePress } from '@/modules/dispatcher/PlanningPause';
import { useElapsed } from '@/shared/hooks/useElapsed';
import { useModelName } from '@/shared/hooks/useModelName';
import { Badge, Card } from '@/shared/ui';
import type { DispatcherPlanner, PlanningLine } from '@/shared/types';

/** What the outing is doing while it is OUT, by its verb, in the operator's words: a cut makes TASKS (`operatorWords`), never phases. */
const WORK_KEYS: Record<DispatcherPlanner['verb'], string> = {
  design: 'dispatcher.planning.work.design',
  tell: 'dispatcher.planning.work.tell',
  cut: 'dispatcher.planning.work.cut',
  judge: 'dispatcher.planning.work.judge',
};

/** The same work while it WAITS: held by Pause all or the pacer, or queued for the daemon's next pass. A pause that holds a subject words the line `Planning paused` instead. */
const WAITING_KEYS: Record<DispatcherPlanner['verb'], string> = {
  design: 'dispatcher.planning.waiting.design',
  tell: 'dispatcher.planning.waiting.tell',
  cut: 'dispatcher.planning.waiting.cut',
  judge: 'dispatcher.planning.waiting.judge',
};

/**
 * ONE SUBJECT BEING PLANNED, one line: what it is and its name as the board writes it (`KindTag` and the mono name, the card head's own
 * face), then what is happening to it, who is doing it on which model and for how long, then its planning press at the line's end.
 *
 * THE STATE IS ONE WORD, AND ITS TONE IS THE PLANNER BADGE'S (`plannerStatusTone`): out reads `info` (work is happening), waiting
 * `neutral`, ended short `warn` (amber — the one state that wants a hand: the plan card's Resume planner, or the daemon's retry), and an outing
 * the house says is not running `danger`, worded `Not running` (`outing.no_run`, read by truthiness: a frame from a server older than the
 * key carries none). The words carry it without colour. A subject whose OWN pause stands reads `Planning paused` in foreground ink and no
 * tone (`PlanningPausedLine`, the card head's register: the operator's own brake is a fact, not an alarm) whatever its outing reads,
 * since the pause is what holds it.
 *
 * THE HOUSE'S OWN SENTENCE RIDES AFTER THE WORD, where an ended outing's cause does. An epic with no plan on the lane has neither a plan card nor
 * a deck, so `PlannerBadge` is never drawn for it and this line is the one screen the push's `Open the Roadmap tab` can land on: it says here
 * what the push said, in the operator's words (`operatorWords`).
 *
 * WHO, ON WHAT, FOR HOW LONG: the soul's name (`soulWord`), the model as an agent row names it (`useModelName`, the store's own word
 * until the catalog names it), and the clock (`useElapsed`) — since the outing was WRITTEN while it waits, since it FORKED while it is out,
 * and none once it has ended, is paused, or the house says it is not running: the word says what became of it, and nothing is happening to
 * tick for. Why it ended, or why it is not running, rides after, in the operator's words.
 *
 * A TELL IS ONE WORD, `Continuing the design`: the store writes the operator's answers, a Rework's notes and the `continue` a Resume
 * planner sends as the same verb, and the document carries nothing that tells them apart, so the line says what is true of all three.
 *
 * THE PRESS LIVES HERE AND ONLY HERE (`PlanningPausePress`, the reading's `press` through its `scope`): Pause planning while the subject is
 * being planned, Resume planning where its own pause stands. A line whose subject has NO card or deck drawn on this screen (`line.drawn`
 * false: an epic with no feature on the board yet, or a feature or epic the operator has put away) also carries its outing's pace hold with
 * the Override (`PaceOverride`, through the line's own door), because nothing else on the screen carries it; a drawn card or deck carries its
 * own, so each hold has one press.
 *
 * Handles: `data-planning-line` (the subject's name), `data-planning-kind`, `data-planning-loose`, `data-planning-drawn` (whether the
 * subject's card or deck is on this screen), `data-planning-state` (what the line says: `out`, `queued`, `ended` or `paused`) and
 * `data-planning-outing` (the outing's own state under a pause: `out`, `queued`, `ended` or `none`); the press keeps its own
 * (`data-dispatcher-pause-planning` / `data-dispatcher-resume-planning`).
 */
function PlanningLineRow({ line }: { line: PlanningLine }) {
  const { t } = useTranslation();
  const { outing, paused } = line;
  // The house's own sentence for an outing it says is not running, or none: a pause outranks it (the pause is what holds the outing).
  const noRun = !paused && outing !== null ? outing.no_run : '';
  const ticking = outing !== null && outing.state !== 'ended' && !paused && !noRun;
  const elapsed = useElapsed(ticking ? epochOf(outing.state === 'queued' ? outing.created_at : outing.launched_at) : null);
  const modelName = useModelName(outing?.model ?? null);
  const state = paused ? 'paused' : outing?.state ?? 'paused';

  let word = null;
  if (paused) {
    word = <PlanningPausedLine via="own" />;
  } else if (outing !== null) {
    const key = noRun
      ? 'dispatcher.planning.notRunning'
      : outing.state === 'ended' ? 'dispatcher.planning.endedShort' : outing.state === 'queued' ? WAITING_KEYS[outing.verb] : WORK_KEYS[outing.verb];
    word = <Badge as="span" tone={plannerStatusTone(outing)} className="vv-badge--compact">{t(key)}</Badge>;
  }
  const who = outing === null ? [] : [soulWord(t, outing.soul), modelName ?? outing.model, ticking ? elapsed : ''];
  const cause = noRun ? operatorWords(noRun) : !paused && outing?.state === 'ended' && outing.outcome ? operatorWords(outing.outcome) : null;

  return (
    <li data-planning-line={line.name} data-planning-kind={line.kind} data-planning-loose={String(line.loose)} data-planning-drawn={String(line.drawn)}
      data-planning-state={state} data-planning-outing={outing?.state ?? 'none'}
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1.5">
        <p className="min-w-fit break-words text-sm">
          <KindTag kind={line.kind} />{' '}<span className="font-mono text-foreground">{line.name}</span>
        </p>
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {word}
          {who.some(Boolean) && <span className="min-w-0 break-words">{who.filter(Boolean).join(' · ')}</span>}
          {cause && <span className="min-w-0 break-words">{cause}</span>}
        </p>
        {!line.drawn && outing !== null && (outing.pace_hold || outing.overridden) && (
          <PaceOverride name={line.name} hold={outing.pace_hold} overridden={outing.overridden} scope={line.scope} />
        )}
      </div>
      {line.press !== null && <PlanningPausePress name={line.name} press={line.press} scope={line.scope} />}
    </li>
  );
}

/**
 * THE PLANNING CARD — what is being planned, and the brake on each (operator, 2026-11-07: "can we add a planning card area, which says
 * what is being planned and move the pause planning button into [it]").
 *
 * ONE LINE PER FEATURE OR EPIC BEING PLANNED (`useDispatcherPlans().planning`, `planningLines`): every planner outing on the document —
 * out, waiting or ended short, its subject's card drawn, put away, or not on the board at all — but a feature's while its epic's pause
 * holds it (the epic's line says that), and every subject whose own planning pause stands with no outing left. So the card is the one
 * place to see what Eupalinos and Odysseus are doing, and the one place Pause planning
 * and Resume planning are pressed; a plan card or a deck keeps its `Planning paused` words and carries no press.
 *
 * IT IS ALWAYS DRAWN, so the area is always where he looks for it: with nothing being planned and nothing paused it reads one quiet line,
 * `Nothing being planned`. It draws no count: the lines are few, and the empty line says zero in words.
 *
 * THE SAME COMPOSITION IN BOTH HOMES, and it owns no position: the In flight face draws it first in its scroll body, in a measure of its
 * own so a line's name and its press are never a wall apart, and the Runs widget draws it under the master controller, in the same measure.
 * Its lines come off the bus, so it paints on its first render with the retained picture; the one thing it asks for is the model names,
 * the Claude catalog once per page (`useModelName`), and a line shows the store's own word until that answers.
 *
 * Handles: `data-planning-card` on the root (valued with the number of lines), `data-planning-empty` on the quiet line.
 *
 * Used by the runner-tab module, through this module's barrel: `RunnerPanel` (In flight) and `RunnerWidgetBody` (the Runs widget).
 */
export function PlanningCard() {
  const { t } = useTranslation();
  const { planning } = useDispatcherPlans();
  return (
    <Card className="min-w-0" data-planning-card={planning.length}>
      <div className="flex min-w-0 items-center gap-2 px-4 pb-2 pt-3">
        <DraftingCompass className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-sm font-medium">{t('dispatcher.planning.title')}</h3>
      </div>
      {planning.length === 0 ? (
        <p data-planning-empty className="px-4 pb-3 text-xs text-muted-foreground">{t('dispatcher.planning.empty')}</p>
      ) : (
        <ul className="flex min-w-0 flex-col divide-y divide-border border-t border-border" aria-label={t('dispatcher.planning.title')}>
          {planning.map((line) => <PlanningLineRow key={line.name} line={line} />)}
        </ul>
      )}
    </Card>
  );
}
