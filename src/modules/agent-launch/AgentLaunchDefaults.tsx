import { useTranslation } from 'react-i18next';

import { AgentLaunchDactylField } from '@/modules/agent-launch/AgentLaunchDactylField';
import { AgentLaunchSummarizerField } from '@/modules/agent-launch/AgentLaunchSummarizerField';
import type { AgentLaunchCensus, AgentLaunchDefaultsChange } from '@/shared/agent-launch-types';
import { Badge, Card, Chip, Select, Spinner } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** The word the "no flag" choice carries in an effort list; it is not an effort, so it never leaves this file. */
const NO_FLAG = 'none';

type AgentLaunchDefaultsProps = {
  census: AgentLaunchCensus;
  /** True while a change to the defaults is in flight: every control in the block is held. */
  held: boolean;
  /** True when the table refused the last change handed to the defaults: the block wears the mark the banner names. */
  refused: boolean;
  onSave: (change: AgentLaunchDefaultsChange) => Promise<void>;
};

/**
 * Used by `AgentLaunchPanel`, above the rows: the table's spine — what every soul that pins nothing
 * launches at, and the one DeepSeek effort the whole house shares.
 *
 * Five fields on two columns from 48rem (three across cuts a model id and the `none` label at the 48rem
 * panel; four across cuts `none` at a 1152px one): the Default effort spans the chips and the DeepSeek
 * effort, and the Dactyls field (the runner's Dactyls switch at its head, the dactyl's two words under it) and
 * the Summarizer sit abreast under them; stacked on a phone. The default model
 * is a chip group and not a list, because it is the single most consequential word in the table and three
 * choices should be seen, not opened. The default effort is one list per model, and its `none` choice is a
 * launch that passes no `--effort` at all — so it is labelled with the CLI's own level (`cli_effort`), the
 * word that actually applies then. The DeepSeek effort says its one surprise beside it: xhigh buys nothing
 * there.
 *
 * A HELD BLOCK IS NOT DISABLED, for the reason a held row is not (`AgentLaunchRowItem`): a disabled control
 * drops keyboard focus to the page and never returns it. The chips take the kit's `busy` — `aria-disabled`,
 * focus kept — the lists have their pointer switched off, and every handler returns early while held.
 */
export function AgentLaunchDefaults({ census, held, refused, onSave }: AgentLaunchDefaultsProps) {
  const { t } = useTranslation();
  const { choices, defaults, cli_effort: cliEffort } = census;
  const effortOptions = choices.efforts.map((word) => ({ value: word, label: word }));
  const save = (change: AgentLaunchDefaultsChange) => {
    if (held) return;
    void onSave(change);
  };
  const noneLabel = cliEffort ? t('agentLaunch.defaults.none', { effort: cliEffort }) : t('agentLaunch.defaults.noneBare');

  return (
    <Card className="min-w-0" role="region" aria-labelledby="agent-defaults-title" data-agent-defaults data-held={held || undefined} aria-busy={held || undefined}>
      <div className={cn('min-w-0', held && 'opacity-60')}>
        <div className="flex flex-col gap-0.5 px-4 pt-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 id="agent-defaults-title" className="text-sm font-medium">{t('agentLaunch.defaults.title')}</h3>
            {held && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" data-agent-saving>
                <Spinner size={14} />
                {t('agentLaunch.defaults.saving')}
              </span>
            )}
            {refused && (
              <Badge as="span" tone="warn" className="vv-badge--compact gap-1" data-agent-refused-row>
                <span aria-hidden="true">▲</span>
                {t('agentLaunch.defaults.notSaved')}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t('agentLaunch.defaults.hint')}</p>
        </div>

        <div className={cn('grid min-w-0 gap-5 px-4 pb-4 pt-3 [@container(min-width:48rem)]:grid-cols-2 [@container(min-width:48rem)]:gap-x-8', held && 'pointer-events-none')}>
          <div className="flex min-w-0 flex-col gap-2">
            <span id="agent-default-model" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('agentLaunch.defaults.model')}
            </span>
            <div role="group" aria-labelledby="agent-default-model" className="flex flex-wrap gap-2">
              {choices.models.map((word) => (
                <Chip key={word} selected={word === defaults.model} busy={held} onClick={() => word !== defaults.model && save({ model: word })}>
                  {word}
                </Chip>
              ))}
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-2 [@container(min-width:48rem)]:row-span-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('agentLaunch.defaults.effort')}</span>
            <div className="flex flex-col gap-2">
              {choices.models.map((model) => (
                <div key={model} className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3">
                  <span className="text-sm">{model}</span>
                  <Select
                    size="sm"
                    ariaLabel={t('agentLaunch.defaults.effortFor', { model })}
                    options={[{ value: NO_FLAG, label: noneLabel }, ...effortOptions]}
                    value={defaults.effort[model] ?? NO_FLAG}
                    onChange={(next) => save({ effort: { [model]: next === NO_FLAG ? null : next } })}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('agentLaunch.defaults.deepseek')}</span>
            <Select
              size="sm"
              ariaLabel={t('agentLaunch.defaults.deepseek')}
              options={effortOptions}
              value={defaults.deepseek_effort}
              onChange={(next) => save({ deepseek_effort: next })}
            />
            <p className="text-xs text-muted-foreground">{t('agentLaunch.defaults.deepseekHint')}</p>
          </div>
          <AgentLaunchDactylField
            models={choices.dactyl_models}
            efforts={choices.efforts}
            model={defaults.dactyl_model}
            effort={defaults.dactyl_effort}
            held={held}
            onSave={save}
          />
          <AgentLaunchSummarizerField
            models={choices.summarizer_models}
            efforts={choices.efforts}
            model={defaults.summarizer_model}
            effort={defaults.summarizer_effort}
            held={held}
            onSave={save}
          />
        </div>
      </div>
    </Card>
  );
}
