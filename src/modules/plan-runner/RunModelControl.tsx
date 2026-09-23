import { useTranslation } from 'react-i18next';

import { Button, ClaudeCodeMark, LLMProviderLogo } from '@/shared/ui';
import type { RunnerModelChoice } from '@/shared/types';

/** The three options, in the order they are drawn. `deepseek` is the runner's default; `auto` hands the choice to the chat's switch. */
const CHOICES: readonly RunnerModelChoice[] = ['deepseek', 'claude', 'auto'];

/** Each option's words: the visible label and the sentence behind it, per scope — a run's word and an arc's differ in reach. */
const TITLE_KEYS: Record<'run' | 'arc', Record<RunnerModelChoice, string>> = {
  run: { deepseek: 'runner.model.deepseekTitle', claude: 'runner.model.claudeTitle', auto: 'runner.model.autoTitle' },
  arc: { deepseek: 'runner.model.arcDeepseekTitle', claude: 'runner.model.arcClaudeTitle', auto: 'runner.model.arcAutoTitle' },
};

type RunModelControlProps = {
  /** Whose word this is: one run's (`run.json:model`) or one arc's (`arc.json:model`, handed to each card it mints). */
  scope: 'run' | 'arc';
  /** The word as the last frame read it off disk, already defaulted by `effectiveModelWord` — the option it names is pressed. */
  value: RunnerModelChoice;
  /** A verb is in flight for this run or arc: every option refuses the press until it answers. */
  busy: boolean;
  /** Relays the chosen word. Never called for the option already pressed — a press that changes nothing spawns nothing. */
  onChoose: (choice: RunnerModelChoice) => void;
};

/**
 * The DeepSeek · Claude · Chat switch segmented control. Used by `RunCard`'s footer, for one run's own word,
 * and by `ArcDeck`'s header, for the arc's ONE word — the same control on both, so one shape means one thing.
 *
 * NOTHING OPTIMISTIC. The pressed option is `value`, which is the runner's record as the last frame carried
 * it; a press relays the word and the control re-draws when the next `runner_state` / `arc_state` frame reads
 * it back. A refused press therefore leaves the control telling the truth, with the runner's sentence in a toast.
 *
 * The probe's handles are the scope's own: `data-runner-model` / `data-runner-model-choice` for a run,
 * `data-arc-model` / `data-arc-model-choice` for an arc — the group carries the current word, each option its own.
 */
export function RunModelControl({ scope, value, busy, onChoose }: RunModelControlProps) {
  const { t } = useTranslation();
  const groupHandle = scope === 'run' ? { 'data-runner-model': value } : { 'data-arc-model': value };

  return (
    <div
      role="group"
      aria-label={t(scope === 'run' ? 'runner.model.label' : 'runner.model.arcLabel')}
      className="inline-flex shrink-0 items-center gap-0.5 self-start rounded-md border border-border p-0.5"
      {...groupHandle}
    >
      {CHOICES.map((choice) => {
        const pressed = choice === value;
        const optionHandle = scope === 'run' ? { 'data-runner-model-choice': choice } : { 'data-arc-model-choice': choice };
        return (
          <Button
            key={choice}
            type="button"
            variant={pressed ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            aria-pressed={pressed}
            disabled={busy}
            title={t(TITLE_KEYS[scope][choice])}
            onClick={() => {
              if (!pressed) onChoose(choice);
            }}
            {...optionHandle}
          >
            {choice === 'deepseek' && <LLMProviderLogo provider="deepseek" className="h-3.5 w-3.5" />}
            {choice === 'claude' && <ClaudeCodeMark className="h-3.5 w-3.5" />}
            {t(`runner.model.${choice}`)}
          </Button>
        );
      })}
    </div>
  );
}
