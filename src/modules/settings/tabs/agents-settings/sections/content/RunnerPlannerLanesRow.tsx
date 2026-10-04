import { PencilRuler } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { PLANNER_LANES_MIN, usePlannerLanes } from '@/modules/settings/hooks/usePlannerLanes';
import { Button, SettingRow, Stepper } from '@/shared/ui';

/**
 * HOW MANY PLANNERS RUN AT ONCE — the dispatcher's own dial, `~/.claude/state/planners.flag`, drawn
 * directly below the swarm row because the two answer the same question about different workers: the
 * swarm row is how many PHASES walk at once, this one how many PLANNERS (designs, cuts, judgments) are
 * out at once. They are separate files and neither bounds the other.
 *
 * Its own file, as `RunnerParkAtPeakRow` is: `RunnerModelContent` is past what it should hold, and a
 * row whose read, write and re-read are its own hook has nothing to share with the rows around it
 * except their grammar — the unknown state in words, the retry in the control's slot.
 *
 * THE STEPPER HAS A FLOOR AND NO TOP. One planner is the least a lane can be, and a width is a number
 * the operator chose: there is no "All" or "Unlimited" to reach, unlike the swarm ceiling's, because a
 * planner is a billed Claude child and "as many as are queued" is not a width anyone asked for. Both
 * presses are live at every count.
 *
 * It wears `PencilRuler` — the designer's shape — which no other row on this card uses.
 *
 * Used by `RunnerModelContent`, which draws it directly beneath the swarm row.
 */
export default function RunnerPlannerLanesRow() {
  const { t } = useTranslation('settings');
  const { lanes, unreadable, saving, setLanes, refresh } = usePlannerLanes();

  const label = t('agents.plannerLanes.label', { defaultValue: 'Planner lanes' });
  // No width is not the default, and the row says so in words where the reader is already looking.
  const unknown = lanes === null;

  const value = lanes === null
    ? ''
    : lanes === PLANNER_LANES_MIN
      // The count's own singular is its own string: `{{count}} lanes` would print "1 lanes".
      ? t('agents.plannerLanes.lane', { defaultValue: '1 lane' })
      : t('agents.plannerLanes.lanes', { defaultValue: '{{count}} lanes', count: lanes });

  return (
    <SettingRow
      icon={<PencilRuler className="h-4 w-4" />}
      label={label}
      description={unknown
        ? unreadable
          ? t('agents.plannerLanes.unreadable', {
              defaultValue: 'The dial could not be read from the server, so its position is unknown. It is retried whenever this page regains focus.',
            })
          : t('status.loading', { ns: 'common', defaultValue: 'Loading...' })
        : t('agents.plannerLanes.description', {
            defaultValue: 'How many planners (designs, cuts, judgments) run at once — {{count}} at a time. Lowering it stops no planner already out; the lane takes no new one until it has room. Takes effect at once.',
            count: lanes,
          })}
    >
      {unknown ? (
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          {t('buttons.retry', { ns: 'common', defaultValue: 'Try again' })}
        </Button>
      ) : (
        // `aria-busy` while a write is in flight: the stepper stays live (a real `disabled` would make
        // Chromium blur the button under a keyboard user's finger), so assistive tech is told instead.
        <div aria-busy={saving} className="inline-flex">
          <Stepper
            value={value}
            onDecrease={() => void setLanes(lanes - 1)}
            onIncrease={() => void setLanes(lanes + 1)}
            canDecrease={lanes > PLANNER_LANES_MIN}
            decreaseLabel={t('agents.plannerLanes.lanesDown', { defaultValue: 'One lane fewer' })}
            increaseLabel={t('agents.plannerLanes.lanesUp', { defaultValue: 'One lane more' })}
            ariaLabel={t('agents.plannerLanes.lanesLabel', { defaultValue: 'Planners run at once' })}
          />
        </div>
      )}
    </SettingRow>
  );
}
