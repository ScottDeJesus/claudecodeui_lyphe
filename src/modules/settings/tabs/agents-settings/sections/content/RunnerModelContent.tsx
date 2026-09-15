import { useTranslation } from 'react-i18next';

import { useDeepSeekFlashSwitch } from '@/shared/hooks/useDeepSeekFlashSwitch';
import { Button } from '@/shared/ui';
import SettingsRow from '@/modules/settings/SettingsRow';
import SettingsToggle from '@/modules/settings/SettingsToggle';

/**
 * Rendered by AgentCategoryContentSection under Claude's "account" panel: which model the plan
 * runner's hands — the builder, his fix-pass and Athena — actually dispatch on.
 *
 * It sits beside the Claude connection rather than in a tab of its own because that is the
 * question it answers: this account's souls, or DeepSeek's. The switch it writes is a file the
 * runner re-reads at every spawn, so a flip here reaches the next phase with nothing restarted.
 *
 * The read, the write and the re-read live in `useDeepSeekFlashSwitch`, which the composer's own
 * chip beside the Plain button composes too: the two surfaces are the same switch, and a flip on
 * either is announced to the other while both are mounted.
 */
export default function RunnerModelContent() {
  const { t } = useTranslation('settings');
  const { enabled, unreadable, setEnabled, refresh } = useDeepSeekFlashSwitch();

  const label = t('agents.runnerModel.label', { defaultValue: 'Use DeepSeek Flash for build souls' });
  // A switch drawn off for a switch that is on is the one thing this row must never do, and it
  // cannot draw a third state the way the composer's chip can. So when the read has failed the
  // row says so in words, in the place the reader is already looking — the only surface they
  // come to when they want to be sure.
  const unknown = enabled === null && unreadable;

  return (
    <div className="rounded-xl border border-border bg-card">
      <SettingsRow
        label={label}
        description={unknown
          ? t('agents.runnerModel.unreadable', {
              defaultValue: 'The switch could not be read from the server, so its position is unknown — this is not the same as off. It is retried whenever this page regains focus.',
            })
          : t('agents.runnerModel.description', {
              defaultValue: 'Dispatch the plan runner’s builder, its fix-pass and Athena on DeepSeek’s deepseek-flash instead of Claude Opus. Prometheus, the scouts and the replanner stay on Claude. Takes effect on the next phase.',
            })}
      >
        {unknown ? (
          // The same press the composer's chip offers in this state, in the row's own grammar: a
          // switch with no position cannot be moved, so what the slot holds is the one act that can
          // be honoured — ask again. Without it a persistent read failure left the row dead until
          // the reader closed Settings and reopened it, which is a way out only if they guess it.
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            {t('retry', { ns: 'common' })}
          </Button>
        ) : (
          <SettingsToggle
            checked={enabled === true}
            onChange={(next) => void setEnabled(next)}
            ariaLabel={label}
            // Disabled ONLY while there is no position to set: a switch with nothing to point at
            // cannot be moved, and the button beside it is the way back. NOT disabled while the
            // write is in flight — `Switch` renders a real `disabled` attribute, and Chromium blurs
            // the element the instant one lands, so the second Space a keyboard user presses would
            // go to the document and the row would read as broken. The hook refuses that second
            // write itself, and `checked` is already the optimistic position, so the toggle never
            // shows a side it cannot back.
            disabled={enabled === null}
          />
        )}
      </SettingsRow>
    </div>
  );
}
