import { useEffect, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useDactylsSwitch } from '@/shared/hooks/useDactylsSwitch';
import { Button, Select, Switch, WholeWords } from '@/shared/ui';
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
 * Used by `AgentLaunchDefaults` as its fourth field: THE DACTYLS SWITCH, and the model and the effort
 * every dactyl launches at. The switch is the runner's own, `~/.claude/state/dactyls.flag`; the words
 * are the launch table's `[dactyl]` pair. This is the one place either is chosen.
 *
 * WHY THE SWITCH LIVES HERE AND NOT ON THE SETTINGS CARD. Dactyls is one soul's way of working — Hephaestus
 * on Claude reads, decides and verifies, and every code edit is one dactyl's — and no other soul's: Iris is
 * a builder too and builds by hand (the operator's word, 2026-10-08; the runner's gate, `switch.AGENT`,
 * names Hephaestus by shim). A switch about one soul's hands belongs with the table that says what every
 * soul launches at, beside the words its children run on, not among the host-wide rows under the account.
 *
 * THE POSITION AND THE READINESS ARE TWO FACTS. The position is the operator's word, read and written by
 * `useDactylsSwitch` through its own route — never the census's save, which is the words'. The readiness is
 * the installed Claude Code's: whether it can serve the model chosen below, derived from its binary at every
 * ask. A switch that is on while the CLI cannot serve a dactyl is armed, not broken: Hephaestus works as before
 * until it can. So "Waiting" is said in the warn tone in either position, with the status call's own sentence,
 * and a readiness that could not be read is said in plain words, never drawn as waiting. The readiness is asked
 * again each time a save of the words lands, because the model just chosen is what it is about.
 *
 * A SWITCH WITH NO POSITION CANNOT BE MOVED. While the read is out, or after it failed, the slot holds the one
 * act that can be honoured — ask again — and the sentence says which it is. The switch is never drawn off for
 * a flag that may be on: drawn off while on, it promises a Hephaestus who makes his own edits; drawn on while
 * off, dactyls that are not coming. Nor is it disabled while a write is in flight (Chromium blurs a control the
 * instant a real `disabled` lands, eating a keyboard user's next press); the hook refuses the second write.
 *
 * TWO LISTS, EACH LABELLED BESIDE IT, IN ONE GRID, so both lists start at one edge. The label column is
 * the Default effort column's 4.5rem, so stacked on a phone the lists line up with its own. A model id is
 * never cut: `claude-haiku-…` could be any Haiku, not the one in force. The model list is `models` alone,
 * with no Default and no "none", because neither word can be cleared.
 *
 * ONE HINT, the field's one surprise: a model id runs only once the installed Claude Code knows it, and
 * `haiku` is the CLI's own alias and always runs. Whether this one does is the Waiting line above the lists.
 *
 * HELD, NOT DISABLED, as the block around it is: a disabled control drops keyboard focus to the page
 * and never gives it back. While held, the lists' pointer is switched off and the save returns early.
 * Choosing the word already in force writes nothing, as the default model's chips do.
 */
export function AgentLaunchDactylField(props: AgentLaunchDactylFieldProps) {
  const { t } = useTranslation();
  // `onSave` stays on `props`: the save below is its one reader.
  const { models, efforts, model, effort, held } = props;

  // ── The wires: the census's save of the two words, and the switch's own read and two acts. ──
  const save = (change: DactylFieldChange): void => {
    if (held) return;
    props.onSave(change);
  };
  const { enabled, unreadable, ready, why, setEnabled, refresh } = useDactylsSwitch();
  const onToggle = (next: boolean): void => void setEnabled(next);
  const onRetry = (): void => void refresh();

  // Whether the block was held at the last render: the readiness is about the model in force, so it is
  // asked again when a save of the words LANDS, which is `held` falling. A ref and not an effect on `held`
  // alone, because the hook already reads at mount and a second read there would be a second
  // `dactyl --status` for nothing.
  const wasHeld = useRef(false);
  useEffect(() => {
    if (wasHeld.current && !held) void refresh();
    wasHeld.current = held;
  }, [held, refresh]);

  const switchLabel = t('agentLaunch.defaults.dactylSwitch');
  // No position is not OFF, and the lie cuts both ways (above).
  const unknown = enabled === null;
  // The readiness, said one of three ways once the position is known. Ready adds nothing. Not ready says
  // "Waiting" with the status call's own sentence. Anything else is said unread: the call failed, or it
  // answered not ready without a reason, which the status contract never does.
  const waiting = !unknown && ready === false && why ? why : null;
  const readinessUnread = !unknown && ready !== true && waiting === null;

  return (
    <div
      className="flex min-w-0 flex-col gap-2"
      data-agent-default-dactyl
      data-runner-dactyls={unknown ? 'unknown' : enabled ? 'on' : 'off'}
      data-held={held || undefined}
      aria-busy={held || undefined}
    >
      <div className="flex items-center justify-between gap-3">
        <span id="agent-default-dactyl" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('agentLaunch.defaults.dactyl')}
        </span>
        {unknown ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t('buttons.retry')}
          </Button>
        ) : (
          <Switch checked={enabled === true} onChange={onToggle} label={switchLabel} />
        )}
      </div>
      <p className="text-pretty text-xs text-muted-foreground">
        {unknown
          ? unreadable ? t('agentLaunch.defaults.dactylUnreadable') : t('agentLaunch.defaults.dactylLoading')
          : t('agentLaunch.defaults.dactylOn')}
      </p>
      {waiting !== null && (
        // Pending, so the warn tone, with its glyph and its word: the switch keeps the operator's word, and
        // the first Hephaestus launched after the CLI can serve takes it.
        <p data-tone="warn" data-dactyls-waiting="" className="flex items-start gap-1.5 text-xs text-tone-ink">
          <span aria-hidden="true">▲</span>
          <span className="min-w-0">
            <Trans t={t} i18nKey="agentLaunch.defaults.dactylWaiting" values={{ why: waiting }} components={{ why: <WholeWords /> }} />
          </span>
        </p>
      )}
      {readinessUnread && (
        // Unknown is not waiting: no reason came back, so the field draws no tone it cannot back.
        <p data-dactyls-unread="" className="text-xs text-muted-foreground">
          {t('agentLaunch.defaults.dactylReadinessUnread')}
        </p>
      )}
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
