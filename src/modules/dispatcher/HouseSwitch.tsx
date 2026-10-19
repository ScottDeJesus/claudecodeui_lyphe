import { useTranslation } from 'react-i18next';

import { useDeepSeekFeaturesSwitch } from '@/shared/hooks/useDeepSeekFlashSwitch';
import { Button, ClaudeCodeMark, LLMProviderLogo } from '@/shared/ui';

/**
 * CLAUDE · DEEPSEEK — the FEATURES switch, drawn in the master controller: the dispatcher's own switch
 * (`~/.claude/state/deepseek_features.flag`, read by `deepseek.features_on()`), through
 * `useDeepSeekFeaturesSwitch`. It is apart from the chat's switch (operator, 2026-10-19: "If I toggle one it
 * should not effect the other"): a flip here moves the features and epics with no model word of their own,
 * and never what builds started from chat run on. One with its own word, set in its fold, does not follow it.
 *
 * TWO OPTIONS, BOTH WITH THEIR WORDS, in one bordered group: this is the one place the choice is named, so
 * neither side gives its word up the way a card's icon-only option does. The pressed side is the position the
 * server last read off the file — nothing is optimistic beyond the hook's own, which the file corrects.
 * UNKNOWN is not off: until a read has landed, or after one failed, neither side is pressed, and a press asks
 * the server again (`refresh`) — the only press that can be honoured then — instead of flipping a switch the
 * reader has not seen.
 *
 * 32px tall, the height of the buttons beside it. Handles: `data-master-switch` on the group (`claude`,
 * `deepseek` or `unknown`) and `data-master-switch-choice` on each option.
 *
 * Used by `MasterController` (this module), wherever it is mounted: the Roadmap tab's In flight header and the chat gutter's Runs widget.
 */
export function HouseSwitch() {
  const { t } = useTranslation();
  const { enabled, unreadable, saving, setEnabled, refresh } = useDeepSeekFeaturesSwitch();
  const position = enabled === null ? 'unknown' : enabled ? 'deepseek' : 'claude';

  const press = (side: 'claude' | 'deepseek') => {
    if (enabled === null) {
      void refresh();
      return;
    }
    if (saving || side === position) return;
    void setEnabled(side === 'deepseek');
  };

  return (
    <div className="flex min-w-0 flex-none flex-col items-start gap-0.5">
      <span className="whitespace-nowrap text-xs font-semibold text-muted-foreground" title={t('dispatcher.master.switchHint')}>
        {t('dispatcher.master.switchLabel')}
      </span>
      <div
        role="group"
        aria-label={t('dispatcher.master.switchLabel')}
        className="inline-flex h-8 items-stretch gap-0.5 rounded-md border border-border p-0.5"
        title={unreadable ? t('dispatcher.master.switchUnreadable') : undefined}
        data-master-switch={position}
      >
        {(['claude', 'deepseek'] as const).map((side) => {
          const pressed = side === position;
          return (
            <Button
              key={side}
              type="button"
              variant={pressed ? 'secondary' : 'ghost'}
              size="sm"
              className="h-full gap-1.5 px-2 text-xs"
              aria-pressed={enabled === null ? 'mixed' : pressed}
              busy={saving && pressed}
              onClick={() => press(side)}
              data-master-switch-choice={side}
            >
              {side === 'claude' ? <ClaudeCodeMark className="h-3.5 w-3.5" /> : <LLMProviderLogo provider="deepseek" className="h-3.5 w-3.5" />}
              {t(`runner.model.${side}`)}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
