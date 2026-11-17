import { CpuIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CPU_LIMIT_CHOICES, useCpuLimit, type CpuLimitChoice } from '@/modules/settings/hooks/useCpuLimit';
import { Button, Select, SettingRow } from '@/shared/ui';

/** The dropdown's word for a choice's value: the percent as a string, or `off`. */
function valueOf(choice: CpuLimitChoice): string {
  return String(choice);
}

/**
 * HOW FULL THE BOX'S CPU MAY BE BEFORE A NEW AGENT WAITS — the runner's own line, `~/.claude/state/cpu_limit.flag`. Before any agent starts (a
 * feature's planners and builders, an inline build's builder and reviewers) the runner reads the box's load over the last minute; at or past
 * this share of its cores the agent waits and checks again every half minute. Running work is never paused or stopped. The file's default,
 * when none is set, is every core (100%); `Off` is the operator's own word for no wait at all.
 *
 * Its own file and its own hook, as `RunnerWeeklyStopRow` is, and for the same reason: `RunnerModelContent` is past what it should hold, and a
 * row whose read, write and re-read are its own hook has nothing to share with the rows around it except their grammar — the unknown state in
 * words, the retry in the control's slot. It is drawn directly under the weekly stop, which is the question it sits beside: how much work to
 * start, by the week there, by the box's own CPU here.
 *
 * A DROPDOWN, NOT A STEPPER: Off, then 5% to 100% in six stops. A line the runner reads that is not one of those (a number written into the file
 * by hand, say 90) is drawn as its own option so the trigger never shows a line the file does not hold. It wears `CpuIcon`, which no other row
 * on this card uses.
 *
 * Used by `RunnerModelContent`, which draws it among the dispatcher's host-wide dials.
 */
export default function RunnerCpuLimitRow() {
  const { t } = useTranslation('settings');
  const { limit, cores, unreadable, saving, setLimit, refresh } = useCpuLimit();

  const label = t('agents.cpuLimit.label', { defaultValue: 'CPU limit' });

  const percents = limit === null || limit === 'off' || CPU_LIMIT_CHOICES.includes(limit)
    ? [...CPU_LIMIT_CHOICES]
    : [...CPU_LIMIT_CHOICES, limit].sort((a, b) => a - b);
  const options = [
    { value: valueOf('off'), label: t('agents.cpuLimit.off', { defaultValue: 'Off' }) },
    ...percents.map((percent) => ({
      value: valueOf(percent),
      label: percent === 100
        ? t('agents.cpuLimit.all', { percent, defaultValue: '{{percent}}% (all cores)' })
        : `${percent}%`,
    })),
  ];

  // No line is not the default and not off, and the row says so in words where the reader is already looking.
  if (limit === null || cores === null) {
    return (
      <SettingRow
        icon={<CpuIcon className="h-4 w-4" />}
        label={label}
        description={unreadable
          ? t('agents.cpuLimit.unreadable', {
              defaultValue: 'The setting could not be read from the server, so its value is unknown. It is retried whenever this page regains focus.',
            })
          : t('status.loading', { ns: 'common', defaultValue: 'Loading...' })}
      >
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          {t('buttons.retry', { ns: 'common', defaultValue: 'Try again' })}
        </Button>
      </SettingRow>
    );
  }

  const description = limit === 'off'
    ? t('agents.cpuLimit.descriptionOff', {
        defaultValue: 'Off: no agent waits for the box’s CPU — every agent starts the moment it is asked to.',
      })
    : t('agents.cpuLimit.description', {
        allowed: Math.round(((cores * limit) / 100) * 10) / 10,
        cores,
        percent: limit,
        defaultValue: 'A new agent waits while {{allowed}} of this box’s {{cores}} cores ({{percent}}%) have been busy over the last minute, and checks again every 30 seconds. Agents already running are never paused or stopped; a waiting agent shows “Waiting for CPU” with an Override that starts just that one. Takes effect within 30 seconds.',
      });

  return (
    <SettingRow icon={<CpuIcon className="h-4 w-4" />} label={label} description={description}>
      {/* `aria-busy` while a write is in flight: the dropdown stays live (a real `disabled` would make Chromium blur the trigger under a
          keyboard user's finger), so assistive tech is told instead. A BLOCK `w-44` wrapper (wide enough for `100% (all cores)`, which `w-28` clips), as the weekly stop's: `Select`'s root is a
          block, and as a flex item it would shrink to its text and stand short of the edge every other control ends on. */}
      <div aria-busy={saving} className="w-44">
        <Select
          options={options}
          value={valueOf(limit)}
          onChange={(next) => void setLimit(next === 'off' ? 'off' : Number(next))}
          ariaLabel={t('agents.cpuLimit.selectLabel', { defaultValue: 'CPU limit, in percent of the box’s cores' })}
        />
      </div>
    </SettingRow>
  );
}
