import { useTranslation } from 'react-i18next';

import { Button, ClaudeCodeMark, LLMProviderLogo } from '@/shared/ui';
import type { RunnerModelChoice } from '@/shared/types';

/** The three options, in the order they are drawn. `deepseek` is the runner's default; `auto` hands the choice to the chat's switch. */
const CHOICES: readonly RunnerModelChoice[] = ['deepseek', 'claude', 'auto'];

/** Whose word the control is drawing — the four homes it has, and the scope of the sentence behind every option. */
export type ModelScope = 'run' | 'arc' | 'plan' | 'dispatch-arc';

/**
 * Everything that differs between the four scopes, in one row per scope: the visible label, the three
 * sentences behind the options, and the browser harness's two handles (`data-…-model` on the group,
 * `data-…-model-choice` on each option).
 *
 * THE WORDS DIFFER BECAUSE THE REACH DOES. A run's word reaches that run's builders; a runner arc's
 * reaches every card the arc mints; a v3 plan's reaches that plan's builders from its next phase and
 * is what its ARC hands down until the plan says otherwise; a dispatch arc's is handed to every plan
 * of the arc already in the store (`store.set_arc_model`), which is why it is the one control that
 * overrides a plan's own word. One table, so a scope cannot be added to the control and left without
 * a sentence, a label or a handle.
 */
const SCOPES: Record<ModelScope, {
  label: string;
  titles: Record<RunnerModelChoice, string>;
  group: string;
  choice: string;
}> = {
  run: {
    label: 'runner.model.label',
    group: 'data-runner-model',
    choice: 'data-runner-model-choice',
    titles: { deepseek: 'runner.model.deepseekTitle', claude: 'runner.model.claudeTitle', auto: 'runner.model.autoTitle' },
  },
  arc: {
    label: 'runner.model.arcLabel',
    group: 'data-arc-model',
    choice: 'data-arc-model-choice',
    titles: { deepseek: 'runner.model.arcDeepseekTitle', claude: 'runner.model.arcClaudeTitle', auto: 'runner.model.arcAutoTitle' },
  },
  plan: {
    label: 'dispatcher.model.planLabel',
    group: 'data-plan-model',
    choice: 'data-plan-model-choice',
    titles: { deepseek: 'dispatcher.model.planDeepseekTitle', claude: 'dispatcher.model.planClaudeTitle', auto: 'dispatcher.model.planAutoTitle' },
  },
  'dispatch-arc': {
    label: 'dispatcher.model.arcLabel',
    group: 'data-dispatch-arc-model',
    choice: 'data-dispatch-arc-model-choice',
    titles: { deepseek: 'dispatcher.model.arcDeepseekTitle', claude: 'dispatcher.model.arcClaudeTitle', auto: 'dispatcher.model.arcAutoTitle' },
  },
};

type RunModelControlProps = {
  /** Whose word this is: one run's, one runner arc's, one v3 plan's, or one dispatch arc's. */
  scope: ModelScope;
  /** The word as the last frame read it, already defaulted by `effectiveModelWord` — the option it names is pressed. */
  value: RunnerModelChoice;
  /** A verb is in flight for this row: every option refuses the press until it answers. */
  busy: boolean;
  /** Relays the chosen word. Never called for the option already pressed — a press that changes nothing spawns nothing. */
  onChoose: (choice: RunnerModelChoice) => void;
};

/**
 * The DeepSeek · Claude · Chat switch segmented control. Four homes, one shape: `RunCard`'s footer for
 * a run's own word, `ArcDeck`'s own row for a runner arc's, `PlanControls` for a v3 plan's, and
 * `DispatchArcControls` for a dispatch arc's — so one shape means one thing whatever it sits on.
 *
 * NOTHING OPTIMISTIC. The pressed option is `value`, which is the record's own answer as the last frame
 * carried it; a press relays the word and the control re-draws when the next frame reads it back. A
 * refused press therefore leaves the control telling the truth, with the engine's sentence in a toast.
 *
 * The probe's handles are the scope's own, from `SCOPES`: the group carries the current word, each
 * option carries its own choice, so a reading is always taken from ONE scope and can never be another's.
 */
export function RunModelControl({ scope, value, busy, onChoose }: RunModelControlProps) {
  const { t } = useTranslation();
  const words = SCOPES[scope];

  return (
    <div
      role="group"
      aria-label={t(words.label)}
      className="inline-flex shrink-0 items-center gap-0.5 self-start rounded-md border border-border p-0.5"
      {...{ [words.group]: value }}
    >
      {CHOICES.map((choice) => {
        const pressed = choice === value;
        return (
          <Button
            key={choice}
            type="button"
            variant={pressed ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            aria-pressed={pressed}
            disabled={busy}
            title={t(words.titles[choice])}
            onClick={() => {
              if (!pressed) onChoose(choice);
            }}
            {...{ [words.choice]: choice }}
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
