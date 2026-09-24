import { Moon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import SettingsRow from '@/modules/settings/SettingsRow';
import SettingsToggle from '@/modules/settings/SettingsToggle';
import { useParkAtPeakSwitch } from '@/shared/hooks/useParkAtPeakSwitch';
import { Button } from '@/shared/ui';

/**
 * WHETHER AN ACCEPT DURING DEEPSEEK'S PEAK WAITS FOR THE WINDOW TO LIFT — the dispatcher's own switch,
 * `~/.claude/state/park_at_peak.flag`, drawn directly below the swarm row because it answers the
 * same question that row does: how the DeepSeek route spends its hours. The dispatcher reads it at
 * both Accept doors; on the Claude route it holds nothing, which is why it lives on this card and
 * not on the Runner tab.
 *
 * Its own file, as `RunnerHealModelRow` is: `RunnerModelContent` is past what it should hold, and a
 * row whose read, write and re-read are its own hook has nothing to share with the rows around it
 * except their grammar — the unknown state in words, the retry in the control's slot.
 *
 * It wears `Moon`: the plan is set down for later, and no other row on this card uses that shape.
 * `flex-none` for the reason every row here carries it — the label wraps on a phone, and a
 * shrinkable icon measures zero wide at 360px.
 */
export default function RunnerParkAtPeakRow() {
  const { t } = useTranslation('settings');
  const { enabled, unreadable, setEnabled, refresh } = useParkAtPeakSwitch();

  const label = t('agents.runnerParkAtPeak.label', { defaultValue: 'Park new plans at DeepSeek peak hours' });
  // No position is not OFF, and for this switch the lie cuts both ways: drawn off while on, it
  // promises an Accept that walks now; drawn on while off, an hour that is not armed.
  const unknown = enabled === null;

  return (
    <SettingsRow
      icon={<Moon className="h-4 w-4 flex-none" />}
      label={label}
      description={unknown
        ? unreadable
          ? t('agents.runnerParkAtPeak.unreadable', {
              defaultValue: 'The switch could not be read from the server, so its position is unknown — this is not the same as off. It is retried whenever this page regains focus.',
            })
          : t('status.loading', { ns: 'common', defaultValue: 'Loading...' })
        : t('agents.runnerParkAtPeak.description', {
            defaultValue: 'An Accept during DeepSeek’s peak window (01:00–04:00 and 06:00–10:00 UTC, weekdays) queues the plan and starts it when the window lifts. Off: Accept walks now.',
          })}
    >
      {unknown ? (
        // A switch with nothing to point at cannot be moved: the slot holds the one act that can be
        // honoured, ask again.
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          {t('buttons.retry', { ns: 'common', defaultValue: 'Try again' })}
        </Button>
      ) : (
        <SettingsToggle
          checked={enabled === true}
          onChange={(next) => void setEnabled(next)}
          ariaLabel={label}
          // Never disabled while a write is in flight — Chromium blurs a control the instant a real
          // `disabled` lands, eating a keyboard user's next press. The hook refuses the second write.
          disabled={enabled === null}
        />
      )}
    </SettingsRow>
  );
}
