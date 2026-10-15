import { useTranslation } from 'react-i18next';

import { AcceptWhenCut } from '@/modules/dispatcher/AcceptWhenCut';
import { ActionBar } from '@/modules/dispatcher/ActionBar';
import { EpicWipControl } from '@/modules/dispatcher/EpicWipControl';
import { useDispatcherPlans } from '@/modules/dispatcher/hooks/useDispatcherPlans';
import { useDispatcherVerbs } from '@/modules/dispatcher/hooks/useDispatcherVerbs';
import { ModelPick } from '@/modules/dispatcher/ModelPick';
import { OverrideFold } from '@/modules/dispatcher/OverrideFold';
import { Button } from '@/shared/ui';
import type { DispatcherArc, DispatcherWipLimit } from '@/shared/types';
import { effectiveModelWord } from '@/shared/utils';

/** The two limits of an epic, in the order the dispatcher prints them and the folded line names them. */
const WIP_LIMITS: readonly DispatcherWipLimit[] = ['features', 'tasks'];

/**
 * The words an epic's own WIP limits are read as for the fold's folded line — `Features 3`, `Tasks All` — one per
 * limit that carries its own word, none for one that follows the top. `labelOf` names a limit in the card's language.
 */
function wipOverrides(wip: DispatcherArc['wip'], allWord: string, labelOf: (limit: DispatcherWipLimit) => string): string[] {
  if (!wip) return [];
  return WIP_LIMITS.flatMap((limit) => {
    const own = wip[limit].own;
    return own === null ? [] : [`${labelOf(limit)} ${own === 'all' ? allWord : own}`];
  });
}

/**
 * Everything a dispatch arc PRESSES, as the deck's ONE `ActionBar` — the plan card's own shape, so the two read
 * alike: the verbs that move the plans under the arc (Pause, Resume), then the FOLD of the epic's own
 * overrides (`OverrideFold`): its feature and task limits (`EpicWipControl`) and its model (`ModelPick`).
 *
 * THERE IS NO START HERE. The plans an epic's operator accepted with Queue wait for their FIRST Start, and the
 * board has one Start for all of them, in the master controller at the top of In flight (`MasterController`);
 * a feature's own Start, on its card, is the override. So the deck draws RESUME alone, and only while the epic has
 * a plan that needs it: one STOPPED MID-WALK (`arc.midwalk`) or STALLED (`arc.stalled`) — never for an epic
 * whose waiting plans are all held for their first Start, which would be a second Start under another word.
 * There is no `Schedule start` either: an hour armed from a terminal is still named on the deck's head
 * (`DispatchArcDeck`), and the card of a plan stopped mid-walk keeps its `Resume at …`.
 *
 * IT IS THE DECK'S `bodyTop`, AND THE FOLD TAKES IT WITH THE STRIP: the verbs are the same layer a plan
 * card's own bar folds away, so the deck cannot disagree with a card about what "collapsed" hides.
 *
 * THE VERBS ARE THE PLAN CARD'S OWN, APPLIED TO THE WHOLE ARC, and each is drawn exactly where the
 * dispatcher's own arc door would take it — `arc.walking` for Pause, `arc.midwalk` or `arc.stalled` for Resume, and
 * never a control drawn greyed out where the verb would refuse. A STALLED plan is released, so Pause stays beside
 * Resume; Resume is the press that wakes the dispatcher, or starts one, and takes the stopped plan up. The sets
 * are the dispatcher's own (`report_arcs.walking` / `.midwalk` / `.stalled`), read off the same plan rows the
 * strip's cards are drawn from, so a press here and the same verb at a terminal can never reach different plans.
 *
 * THE FOLD IS THE EPIC'S OVERRIDES OF THE TOP. Each dropdown's first option follows the top and names it; any other
 * option is the epic's own word, and the fold's folded line names every one the epic holds
 * (`Features 3 · Tasks All · DeepSeek`) and nothing when it holds none. The model dropdown draws `arc.model` —
 * the ARC's own word, never a plan's effective one — and pressing it hands the word to every plan of the arc
 * (`dispatcher model <arc> <word>`, `store.set_arc_model`); `default` clears the epic's and theirs. The WIP
 * words are the epic's alone: `dispatcher wip` takes an epic's name and no feature's, and the limit is read at
 * the rule's next take-up, so no epic's state refuses it. The WIP dropdowns draw nothing from a frame that
 * carries no `arc.wip` or no defaults, and the rest of the fold stands.
 *
 * `Accept when cut` (`AcceptWhenCut`, `arc.armable` / `arc.armed`) heads the row while any designed member can
 * still be Accepted ahead of its cut, or stands armed with its Cancel.
 *
 * Handles: `data-dispatch-arc-stop`, `data-dispatch-arc-resume`, the fold's (`OverrideFold`), the WIP
 * dropdowns' (`EpicWipControl`'s `data-epic-wip…`) and the model dropdown's (`data-dispatch-arc-model`). A probe
 * scopes them under the deck's own `[data-dispatch-arc][data-arc-name]` root, so it reads and presses ONE arc
 * — the operator's own arcs walk beside a probe's and must never be pressed.
 *
 * Used by `DispatchArcDeck`, as the first row of its body.
 */
export function DispatchArcControls({ arc }: { arc: DispatcherArc }) {
  const { t } = useTranslation();
  const { stop, resume, setModel, setWip, armAccept, disarmAccept, busy } = useDispatcherVerbs(arc.name, 'arc', t('runner.resume'));
  const { route } = useDispatcherPlans();
  const held = busy !== null;
  const resumable = arc.midwalk || arc.stalled;
  // What an epic with no word of its own follows: the house switch, as the frame read it.
  const follows = effectiveModelWord(null, route ? route.provider === 'deepseek' : null);
  const overrides = [
    ...wipOverrides(arc.wip, t('dispatcher.wip.all'), (limit) => t(`dispatcher.master.wip.${limit}Short`)),
    ...(arc.model === null ? [] : [t(`runner.model.${arc.model}`)]),
  ];

  return (
    <ActionBar
      // Only where a verb would be taken: an arc with nothing live and nothing stopped draws no verb,
      // so a deck never offers a press the dispatcher would refuse.
      verbs={arc.walking || resumable || arc.armable > 0 || arc.armed > 0 ? (
        <>
          {/* `Accept when cut` over the deck: every DESIGNED member is Accepted ahead of its cut, each on its
              own current design (`arc.armable`); once none is left to press, the armed word and Cancel
              (`arc.armed`). A member not yet designed is not reached — the operator has not read its design. */}
          <AcceptWhenCut scope="dispatch-arc" busy={held} pressable={arc.armable > 0} armed={arc.armed > 0}
            onArm={() => void armAccept()} onCancel={() => void disarmAccept()} />
          {arc.walking && (
            <Button variant="secondary" size="sm" className="h-8" disabled={held} onClick={() => void stop()}
              data-dispatch-arc-stop>{t('dispatcher.arcPause')}</Button>
          )}
          {/* THE ARC'S RESUME, for the plans that have walked and stopped, and for a stalled one: the
              plans' own Resume repeated over the arc, with the daemon's waits keeping their order. */}
          {resumable && (
            <Button size="sm" className="h-8" disabled={held} onClick={() => void resume()}
              data-dispatch-arc-resume>{t('runner.resume')}</Button>
          )}
        </>
      ) : null}
      fold={(
        <OverrideFold scope="dispatch-arc" overrides={overrides}>
          <EpicWipControl wip={arc.wip} defaults={route?.wip} busy={held}
            onChoose={(limit, choice) => void setWip(limit, choice)} />
          <ModelPick scope="dispatch-arc" own={arc.model} follows={follows} source="top" busy={held}
            onChoose={(choice) => void setModel(choice)} />
        </OverrideFold>
      )}
    />
  );
}
