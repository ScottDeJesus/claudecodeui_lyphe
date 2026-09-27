import { MessageSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button, ClaudeCodeMark, LLMProviderLogo } from '@/shared/ui';
import type { DispatcherModelChoice } from '@/shared/types';

/** The three options, in the order they are drawn. `deepseek` is the dispatcher's default; `auto` hands the choice to the chat's switch. */
const CHOICES: readonly DispatcherModelChoice[] = ['deepseek', 'claude', 'auto'];

/** Whose word the control is drawing — the two homes it has, and the scope of the sentence behind every option. */
export type ModelScope = 'plan' | 'dispatch-arc';

/**
 * Everything that differs between the two scopes, in one row per scope: the group's name and the
 * browser harness's two handles (`data-…-model` on the group, `data-…-model-choice` on each option).
 *
 * THE GROUP'S NAME DIFFERS BECAUSE THE REACH DOES. A plan's word reaches that plan's builders from its
 * next phase and is what its ARC hands down until the plan says otherwise; a dispatch arc's is handed
 * to every plan of the arc already in the store (`store.set_arc_model`), which is why it is the one
 * control that overrides a plan's own word. One table, so a scope cannot be added to the control and
 * left without a name or a handle.
 */
const SCOPES: Record<ModelScope, { label: string; group: string; choice: string }> = {
  plan: { label: 'dispatcher.model.planLabel', group: 'data-plan-model', choice: 'data-plan-model-choice' },
  'dispatch-arc': { label: 'dispatcher.model.arcLabel', group: 'data-dispatch-arc-model', choice: 'data-dispatch-arc-model-choice' },
};

/** Each option's mark — the one thing an icon-only option shows, so every option has one. */
function ChoiceMark({ choice }: { choice: DispatcherModelChoice }) {
  if (choice === 'deepseek') return <LLMProviderLogo provider="deepseek" className="h-3.5 w-3.5" />;
  if (choice === 'claude') return <ClaudeCodeMark className="h-3.5 w-3.5" />;
  return <MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />;
}

type RunModelControlProps = {
  /** Whose word this is: one plan's, or one dispatch arc's. */
  scope: ModelScope;
  /** The word as the last frame read it, already defaulted by `effectiveModelWord` — the option it names is pressed. */
  value: DispatcherModelChoice;
  /** A verb is in flight for this row: every option refuses the press until it answers. */
  busy: boolean;
  /** Relays the chosen word. Never called for the option already pressed — a press that changes nothing spawns nothing. */
  onChoose: (choice: DispatcherModelChoice) => void;
};

/**
 * The DeepSeek · Claude · Chat switch segmented control. Two homes, one shape: `PlanControls` for a
 * plan's own word, and `DispatchArcControls` for a dispatch arc's — so one shape means one thing
 * whatever it sits on. Both put it at the end of the card's `ActionBar`.
 *
 * THE PRESSED OPTION IS ICON AND WORD, THE OTHER TWO ARE THEIR ICONS ALONE. The pressed one is the
 * answer a glance wants ("this runs on DeepSeek"); the others are only the ways to change it, so they
 * give up their words and the row stays short enough to share a line with the verbs on a phone. Every
 * option keeps its word as its `aria-label` and its `title`, so an icon-only option still names
 * itself to a screen reader and on hover — and each has a mark, which is why the Chat option wears
 * one (`MessageSquare`).
 *
 * 32px TALL, the action bar's height: the group is `h-8` and its options fill it.
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
      className="inline-flex h-8 shrink-0 items-stretch gap-0.5 rounded-md border border-border p-0.5"
      {...{ [words.group]: value }}
    >
      {CHOICES.map((choice) => {
        const pressed = choice === value;
        const word = t(`runner.model.${choice}`);
        return (
          <Button
            key={choice}
            type="button"
            variant={pressed ? 'secondary' : 'ghost'}
            size="sm"
            className={pressed ? 'h-full gap-1 px-2 text-xs' : 'h-full w-7 px-0'}
            aria-pressed={pressed}
            aria-label={word}
            disabled={busy}
            title={word}
            onClick={() => {
              if (!pressed) onChoose(choice);
            }}
            {...{ [words.choice]: choice }}
          >
            <ChoiceMark choice={choice} />
            {pressed && word}
          </Button>
        );
      })}
    </div>
  );
}
