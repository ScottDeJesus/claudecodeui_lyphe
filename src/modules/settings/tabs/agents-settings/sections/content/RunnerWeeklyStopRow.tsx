import { GaugeIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { WEEKLY_STOP_CHOICES, useWeeklyStop } from '@/modules/settings/hooks/useWeeklyStop';
import { Button, Select, SettingRow } from '@/shared/ui';

/**
 * WHERE THE WEEKLY WINDOW STOPS — the usage pacer's own line, `~/.claude/state/weekly_stop.flag`. Plans stop
 * starting when the week is on course to pass it. It answers a question of its own, about the WEEKLY window
 * alone: the 5-hour window keeps the pacer's fixed ceiling, and no work already running is stopped by a lower
 * line. The file's default, when none is set, is 95%.
 *
 * Its own file and its own hook, as `RunnerPlannerLanesRow` is, and for the same reason: `RunnerModelContent`
 * is past what it should hold, and a row whose read, write and re-read are its own hook has nothing to share
 * with the rows around it except their grammar — the unknown state in words, the retry in the control's slot.
 *
 * A DROPDOWN, NOT A STEPPER: 50% to 95% in steps of five, then 99%. A line the pacer reads that is not one of
 * those (a number written into the file by hand, say 97) is drawn as its own option so the trigger never
 * shows a line the file does not hold.
 *
 * It wears `GaugeIcon`, which no other row on this card uses.
 *
 * Used by `RunnerModelContent`, which draws it beside the planner-lanes row.
 */
export default function RunnerWeeklyStopRow() {
  const { t } = useTranslation('settings');
  const { percent, unreadable, saving, setPercent, refresh } = useWeeklyStop();

  const label = t('agents.weeklyStop.label', { defaultValue: 'Weekly stop' });
  // No percent is not the default, and the row says so in words where the reader is already looking.
  const unknown = percent === null;

  const options = (percent === null || WEEKLY_STOP_CHOICES.includes(percent)
    ? [...WEEKLY_STOP_CHOICES]
    : [...WEEKLY_STOP_CHOICES, percent].sort((a, b) => a - b)
  ).map((choice) => ({ value: String(choice), label: `${choice}%` }));

  return (
    <SettingRow
      icon={<GaugeIcon className="h-4 w-4" />}
      label={label}
      description={unknown
        ? unreadable
          ? t('agents.weeklyStop.unreadable', {
              defaultValue: 'The setting could not be read from the server, so its value is unknown. It is retried whenever this page regains focus.',
            })
          : t('status.loading', { ns: 'common', defaultValue: 'Loading...' })
        : t('agents.weeklyStop.description', {
            defaultValue: 'Plans stop starting when the week is on course to pass {{percent}}% of its limit. Set it at or under what the week has already used and no plan starts until you raise it or the week resets; the same line decides when this account counts as full for the automatic account switch. Plans already running are never stopped, and the 5-hour window keeps its own line. Takes effect at once.',
            percent,
          })}
    >
      {unknown ? (
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          {t('buttons.retry', { ns: 'common', defaultValue: 'Try again' })}
        </Button>
      ) : (
        // `aria-busy` while a write is in flight: the dropdown stays live (a real `disabled` would make
        // Chromium blur the trigger under a keyboard user's finger), so assistive tech is told instead.
        // A BLOCK `w-28` wrapper, not the stepper row's `inline-flex`: `Select`'s root is a block, and as a
        // flex item it would shrink to its text and stand short of the edge every other control ends on.
        <div aria-busy={saving} className="w-28">
          <Select
            options={options}
            value={String(percent)}
            onChange={(next) => void setPercent(Number(next))}
            ariaLabel={t('agents.weeklyStop.selectLabel', { defaultValue: 'Weekly stop, in percent of the weekly limit' })}
          />
        </div>
      )}
    </SettingRow>
  );
}
