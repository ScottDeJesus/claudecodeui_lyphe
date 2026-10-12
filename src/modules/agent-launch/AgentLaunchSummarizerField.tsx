import { useTranslation } from 'react-i18next';

import { Select } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** What the field hands its save: one of the summarizer's two words, keyed as the census and the CLI spell them. */
type SummarizerFieldChange = { summarizer_model: string } | { summarizer_effort: string };

type AgentLaunchSummarizerFieldProps = {
  /** The summarizer's model words, `census.choices.summarizer_models`. The field never spells one itself. */
  models: string[];
  /** Every effort the table accepts, `census.choices.efforts`. */
  efforts: string[];
  /** The table's `[summarizer] model`, the word in force. */
  model: string;
  /** The table's `[summarizer] effort`, the word in force. */
  effort: string;
  /** True while a change to the defaults is in flight: the field's lists are held, never disabled. */
  held: boolean;
  /** The Defaults block's own save, handed one word at a time. */
  onSave: (change: SummarizerFieldChange) => void;
};

/**
 * Used by `AgentLaunchDefaults` as its fifth field: the model and the effort that write a chat's
 * compaction while Custom compaction is on. These are the launch table's `[summarizer]` words, and this
 * is the one place they are chosen.
 *
 * THE DACTYL FIELD'S TWIN, NOT A SHARED PAIR FIELD: the same two lists, each labelled beside it in one
 * grid on the Default effort column's 4.5rem, so both lists start at one edge. From 48rem it sits in that
 * column, its lists on the Default effort lists' edge and on the same lines as the Dactyl field's beside
 * it; stacked on a phone, all three line up. Merging the two into one pair field waits until both have
 * landed. A model id is never cut:
 * `claude-haiku-…` could be any Haiku, not the one in force. The model list is `models` alone, with no
 * Default and no "none", because neither word can be cleared.
 *
 * ONE HINT, the field's one surprise: what this model writes, and that a model id runs only once the
 * installed Claude Code knows it, which the Custom compaction row in Settings → Agents says.
 *
 * HELD, NOT DISABLED, as the block around it is: a disabled control drops keyboard focus to the page
 * and never gives it back. While held, the lists' pointer is switched off and the save returns early.
 * Choosing the word already in force writes nothing, as the default model's chips do.
 */
export function AgentLaunchSummarizerField(props: AgentLaunchSummarizerFieldProps) {
  const { t } = useTranslation();
  // `onSave` stays on `props`: the save below is its one reader.
  const { models, efforts, model, effort, held } = props;

  // ── The wire: the one line that acts. Everything around it is composition. ──
  const save = (change: SummarizerFieldChange): void => {
    if (held) return;
    props.onSave(change);
  };

  return (
    <div className="flex min-w-0 flex-col gap-2" data-agent-default-summarizer data-held={held || undefined} aria-busy={held || undefined}>
      <span id="agent-default-summarizer" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {t('agentLaunch.defaults.summarizer')}
      </span>
      <div
        role="group"
        aria-labelledby="agent-default-summarizer"
        className={cn('grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2', held && 'pointer-events-none')}
      >
        <span className="text-sm text-muted-foreground">{t('agentLaunch.defaults.summarizerModel')}</span>
        <Select
          size="sm"
          ariaLabel={t('agentLaunch.defaults.summarizerModelLabel')}
          options={models.map((word) => ({ value: word, label: word }))}
          value={model}
          onChange={(next) => next !== model && save({ summarizer_model: next })}
        />
        <span className="text-sm text-muted-foreground">{t('agentLaunch.defaults.summarizerEffort')}</span>
        <Select
          size="sm"
          ariaLabel={t('agentLaunch.defaults.summarizerEffortLabel')}
          options={efforts.map((word) => ({ value: word, label: word }))}
          value={effort}
          onChange={(next) => next !== effort && save({ summarizer_effort: next })}
        />
      </div>
      <p className="text-pretty text-xs text-muted-foreground">{t('agentLaunch.defaults.summarizerHint')}</p>
    </div>
  );
}
