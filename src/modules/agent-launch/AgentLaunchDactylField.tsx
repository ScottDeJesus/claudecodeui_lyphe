import { useTranslation } from 'react-i18next';

import { Select } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** What the field hands its save: one of the dactyl's two words, keyed as the census and the CLI spell them. */
type DactylFieldChange = { dactyl_model: string } | { dactyl_effort: string };

type AgentLaunchDactylFieldProps = {
  /** The dactyl's model words, `census.choices.dactyl_models`. The field never spells one itself. */
  models: string[];
  /** Every effort the table accepts, `census.choices.efforts`. */
  efforts: string[];
  /** The table's `[dactyl] model`, the word in force. */
  model: string;
  /** The table's `[dactyl] effort`, the word in force. */
  effort: string;
  /** True while a change to the defaults is in flight: the field's lists are held, never disabled. */
  held: boolean;
  /** The Defaults block's own save, handed one word at a time. */
  onSave: (change: DactylFieldChange) => void;
};

/**
 * Used by `AgentLaunchDefaults` as its fourth field: the model and the effort every dactyl launches
 * at. These are the launch table's `[dactyl]` words, and this is the one place they are chosen.
 *
 * TWO LISTS, EACH LABELLED BESIDE IT, IN ONE GRID, so both lists start at one edge. The label column is
 * the Default effort column's 4.5rem, so stacked on a phone, or under that column two by two, the lists
 * line up with its own. A model id is never cut: `claude-haiku-…` could be any Haiku, not the one in
 * force. The model list is `models` alone, with no Default and no "none", because neither word can be
 * cleared.
 *
 * ONE HINT, the field's one surprise: a model id runs only once the installed Claude Code knows it,
 * and the Dactyls row in Settings → Agents says whether this one does. `haiku` is the CLI's own alias
 * and always runs.
 *
 * HELD, NOT DISABLED, as the block around it is: a disabled control drops keyboard focus to the page
 * and never gives it back. While held, the lists' pointer is switched off and the save returns early.
 * Choosing the word already in force writes nothing, as the default model's chips do.
 */
export function AgentLaunchDactylField(props: AgentLaunchDactylFieldProps) {
  const { t } = useTranslation();
  // `onSave` stays on `props`: the save below is its one reader.
  const { models, efforts, model, effort, held } = props;

  // ── The wire: the one line that acts. Everything around it is composition. ──
  const save = (_change: DactylFieldChange): void => {}; // FILL: onSave

  return (
    <div className="flex min-w-0 flex-col gap-2" data-agent-default-dactyl data-held={held || undefined} aria-busy={held || undefined}>
      <span id="agent-default-dactyl" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('agentLaunch.defaults.dactyl')}
      </span>
      <div
        role="group"
        aria-labelledby="agent-default-dactyl"
        className={cn('grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2', held && 'pointer-events-none')}
      >
        <span className="text-sm text-muted-foreground">{t('agentLaunch.defaults.dactylModel')}</span>
        <Select
          size="sm"
          ariaLabel={t('agentLaunch.defaults.dactylModelLabel')}
          options={models.map((word) => ({ value: word, label: word }))}
          value={model}
          onChange={(next) => next !== model && save({ dactyl_model: next })}
        />
        <span className="text-sm text-muted-foreground">{t('agentLaunch.defaults.dactylEffort')}</span>
        <Select
          size="sm"
          ariaLabel={t('agentLaunch.defaults.dactylEffortLabel')}
          options={efforts.map((word) => ({ value: word, label: word }))}
          value={effort}
          onChange={(next) => next !== effort && save({ dactyl_effort: next })}
        />
      </div>
      <p className="text-pretty text-xs text-muted-foreground">{t('agentLaunch.defaults.dactylHint')}</p>
    </div>
  );
}
