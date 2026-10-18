import { useTranslation } from 'react-i18next';

import { LabeledPick } from '@/modules/dispatcher/LabeledPick';
import type { DispatcherModelChoice, DispatcherModelWord } from '@/shared/types';

/** Whose word the pick is drawing — the two homes it has, and the scope of the sentence behind it. */
export type ModelScope = 'plan' | 'dispatch-arc';

/** Per scope: the pick's hint sentence and the group's harness handle (`data-…-model`, valued with the record's own word or `default`). */
const SCOPES: Record<ModelScope, { hint: string; handle: string }> = {
  plan: { hint: 'dispatcher.model.planLabel', handle: 'data-plan-model' },
  'dispatch-arc': { hint: 'dispatcher.model.arcLabel', handle: 'data-dispatch-arc-model' },
};

type ModelPickProps = {
  /** Whose word this is: one feature's, or one epic's. */
  scope: ModelScope;
  /** The record's OWN word as the last frame read it, or `null` while it follows. */
  own: DispatcherModelWord | null;
  /** The word it follows while it has none of its own: its epic's, else the house switch's. */
  follows: DispatcherModelWord;
  /** Which of the two it follows — a feature of an epic that carries a word follows the epic, anything else the top. */
  source: 'top' | 'epic';
  /** A verb is in flight for this record: the pick refuses a second press until it answers. */
  busy: boolean;
  /** Relays the chosen word; `default` hands the record back to what it follows. Never called for the word already chosen. */
  onChoose: (choice: DispatcherModelChoice) => void;
};

/**
 * THE MODEL DROPDOWN INSIDE A CARD'S FOLD: three options on the kit's `Select` — the first FOLLOWS what sits
 * above the card and names it (`Follow top · DeepSeek`), then Claude, then DeepSeek. The first sends `default`
 * (the dispatcher clears the record's own word, `dispatcher model <name> default`); either other option is an
 * override, written to the record and, on an epic, handed down to every feature of it (`store.set_arc_model`).
 *
 * WHAT IT FOLLOWS is the house switch for an epic or a loose feature — the same switch the master controller
 * draws (`HouseSwitch`) — and the epic's own word for a feature of an epic that has one. The frame's own
 * reading of that is handed in (`follows`), never derived here, so the option names the model the next task
 * really runs on.
 *
 * NOTHING OPTIMISTIC. The chosen option is `own`, the record's own answer as the last frame carried it; a
 * press relays the word and the pick re-draws when the next frame reads it back. A refused press therefore
 * leaves the pick telling the truth, with the dispatcher's sentence in a toast.
 *
 * Used by `PlanControls` (a feature's fold) and `DispatchArcControls` (an epic's), inside `OverrideFold`.
 */
export function ModelPick({ scope, own, follows, source, busy, onChoose }: ModelPickProps) {
  const { t } = useTranslation();
  const words = SCOPES[scope];
  const value = own ?? 'default';
  const options = [
    { value: 'default', label: t(`dispatcher.fold.follow.${source}`, { value: t(`runner.model.${follows}`) }) },
    { value: 'claude', label: t('runner.model.claude') },
    { value: 'deepseek', label: t('runner.model.deepseek') },
  ];
  return (
    <LabeledPick
      label={t('dispatcher.model.label')}
      hint={t(words.hint)}
      options={options}
      value={value}
      disabled={busy}
      width="w-44"
      handle={words.handle}
      onChoose={(choice) => {
        if (choice !== value) onChoose(choice as DispatcherModelChoice);
      }}
    />
  );
}
