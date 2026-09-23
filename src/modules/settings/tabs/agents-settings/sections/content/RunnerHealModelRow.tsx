import { CpuIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { HealModelSwitch, useHeal } from '@/modules/heal';
import SettingsRow from '@/modules/settings/SettingsRow';
import { Button } from '@/shared/ui';

/**
 * WHICH MODEL THE HEAL'S OWN SOULS RUN ON — the fourth switch of the family, under the master that
 * can stop them, on the plan runner card.
 *
 * IT IS THE HEAL'S OWN SWITCH, AND NOTHING ELSE'S. The file names a side in every state — absent
 * means DeepSeek Flash, the side it shipped on — so there is no "same as chat" state and no caption
 * for one: a press writes the other word to `heal_model.flag`, and the chat composer's switch (a
 * different file, drawn above on this same card) is left exactly where the operator put it.
 *
 * The side comes off the app's ONE heal poller (`useHeal`) rather than from a fetch here:
 * `switches.model` is the worker's own reading of its own flag, and a second reading of that rule is
 * a second opinion about something only the worker settles. `null` is "no summary read yet", which
 * this row draws the way every other row on this card draws an unread switch — the one act that can
 * be honoured, in the control's own slot.
 *
 * It wears `CpuIcon`: its subject is which processor the heal's souls run on, and the chip in its
 * control slot already wears the two models' own marks, so this slot must not repeat either of them.
 */
export default function RunnerHealModelRow() {
  const { t } = useTranslation('settings');
  const { state, refresh } = useHeal();
  const summary = state.phase === 'ready' ? state.summary : null;

  const label = t('agents.runnerHealModel.label', { defaultValue: 'Model for heal souls' });

  return (
    <SettingsRow
      icon={<CpuIcon className="h-4 w-4 flex-none" />}
      label={label}
      description={summary === null
        ? t('agents.runnerHealModel.descriptionUnknown', {
            defaultValue: 'Which model this heal’s souls run on could not be read — the reflex’s summary is not in hand. Press Try again to ask for it.',
          })
        : summary.switches.model === 'claude'
          ? t('agents.runnerHealModel.descriptionClaude', {
              defaultValue: 'Pinned to Claude — your subscription, so these heals are capped by nothing and count against no daily cap. It steers the heal reflex’s souls only: the chat composer’s Flash switch is a different file and never moves with it. Press the chip to send them back to DeepSeek Flash.',
            })
          : t('agents.runnerHealModel.descriptionDeepseek', {
              defaultValue: 'Pinned to DeepSeek Flash. These heals count against the daily cap on the Heal tab, and park until midnight once it is reached. It steers the heal reflex’s souls only: the chat composer’s Flash switch is a different file and never moves with it. Press the chip to send them to Claude instead.',
            })}
    >
      {summary === null ? (
        // This card's own grammar for "no position": a switch with nothing to point at cannot be
        // moved, so the slot holds the one act that can be honoured.
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          {t('buttons.retry', { ns: 'common', defaultValue: 'Try again' })}
        </Button>
      ) : (
        <HealModelSwitch model={summary.switches.model} />
      )}
    </SettingsRow>
  );
}
