import { useTranslation } from 'react-i18next';

import { Stepper } from '@/shared/ui';
import type { DispatcherArcWip, DispatcherWipChoice, DispatcherWipDefaults, DispatcherWipLimit, DispatcherWipSetting } from '@/shared/types';
import { wipCountOfWord, wipLadderSteps, wipLadderTop } from '@/shared/utils';

/**
 * Everything that differs between the epic's two limits, in one row per limit: the handle the browser
 * harness reads, and the sentences behind the stepper — its visible name, its accessible names and the
 * two hints. One table, so a limit cannot be added to the control and left without a name or a handle.
 */
const LIMITS: Record<DispatcherWipLimit, {
  handle: string;
  word: string;
  group: string;
  down: string;
  up: string;
  hint: string;
  hintDefault: string;
}> = {
  features: {
    handle: 'data-epic-wip-features',
    word: 'dispatcher.wip.features',
    group: 'dispatcher.wip.featuresLabel',
    down: 'dispatcher.wip.featuresDown',
    up: 'dispatcher.wip.featuresUp',
    hint: 'dispatcher.wip.featuresHint',
    hintDefault: 'dispatcher.wip.featuresHintDefault',
  },
  tasks: {
    handle: 'data-epic-wip-tasks',
    word: 'dispatcher.wip.tasks',
    group: 'dispatcher.wip.tasksLabel',
    down: 'dispatcher.wip.tasksDown',
    up: 'dispatcher.wip.tasksUp',
    hint: 'dispatcher.wip.tasksHint',
    hintDefault: 'dispatcher.wip.tasksHintDefault',
  },
};

/** The order the two steppers are drawn in, which is the order the dispatcher prints them. */
const ORDER: readonly DispatcherWipLimit[] = ['features', 'tasks'];

/**
 * The word a press on the ladder sends for the number it landed on.
 *
 * COMPARED AS NUMBERS, NOT WORDS: landing on Settings' number is `default` however Settings spells it,
 * so the epic follows Settings again instead of freezing a copy of it. Anything else is the epic's own
 * word, spelled as the dispatcher's grammar has it: a count, or `all`.
 */
function choiceForCount(count: number | null, defaultCount: number | null): DispatcherWipChoice {
  if (count === defaultCount) return 'default';
  return count === null ? 'all' : `${count}`;
}

type LimitStepperProps = {
  limit: DispatcherWipLimit;
  /** The limit as the last frame read it: the epic's own word (`null` while it follows Settings) and the word in force. */
  setting: DispatcherWipSetting;
  /** Settings' word for this limit as the same frame read it (`DispatcherRoute.wip`) — what a press is compared against. */
  defaultWord: string;
  /** A verb is in flight for this epic: every press is refused until it answers. */
  busy: boolean;
  /** Relays the word a press chose (`default` hands the limit back to Settings). Never called for a press the ladder refuses. */
  onChoose: (limit: DispatcherWipLimit, choice: DispatcherWipChoice) => void;
};

/** One limit: its name, then one compact `Stepper` of the epic's number. */
function LimitStepper({ limit, setting, defaultWord, busy, onChoose }: LimitStepperProps) {
  const { t } = useTranslation();
  const words = LIMITS[limit];
  const shown = wipCountOfWord(setting.effective);
  const defaultCount = wipCountOfWord(defaultWord);
  const following = setting.own === null;
  const steps = wipLadderSteps(shown, wipLadderTop(defaultCount, shown));

  const press = (move: { lanes: number | null } | null) => {
    if (move === null || busy) return;
    onChoose(limit, choiceForCount(move.lanes, defaultCount));
  };

  return (
    <div
      className="inline-flex h-8 shrink-0 items-center gap-1.5"
      title={following ? t(words.hintDefault) : t(words.hint)}
      data-epic-wip-effective={setting.effective}
      data-epic-wip-default={following ? '' : undefined}
      {...{ [words.handle]: setting.own ?? 'default' }}
    >
      <span className="text-xs text-muted-foreground">{t(words.word)}</span>
      <Stepper
        compact
        value={shown === null ? t('dispatcher.wip.all') : String(shown)}
        note={following ? t('dispatcher.wip.default') : undefined}
        onDecrease={() => press(steps.down)}
        onIncrease={() => press(steps.up)}
        canDecrease={!busy && steps.down !== null}
        canIncrease={!busy && steps.up !== null}
        decreaseLabel={t(words.down)}
        increaseLabel={t(words.up)}
        ariaLabel={t(words.group)}
      />
    </div>
  );
}

type EpicWipControlProps = {
  /** The epic's two limits as the last frame read them (`DispatcherArc.wip`), or `null` from a dispatcher build older than the field. A frame that omits the key outright reads the same. */
  wip: DispatcherArcWip | null;
  /** Settings' two defaults as the same frame read them (`DispatcherRoute.wip`), or `undefined` before the first frame and from an older build. */
  defaults: DispatcherWipDefaults | undefined;
  /** A verb is in flight for this epic: every press is refused until it answers. */
  busy: boolean;
  /** Relays one limit's chosen word (`default` hands it back to Settings). */
  onChoose: (limit: DispatcherWipLimit, choice: DispatcherWipChoice) => void;
};

/**
 * An epic's WIP — how much of it may run at once — as ONE group labelled "WIP", two compact `Stepper`s
 * in it: **Features** (how many of the epic's features are in progress at once) and **Tasks** (how many
 * tasks each of them runs at once). These are the only concurrency switches there are for the work
 * under an epic (`dispatcher wip`), which is why a feature's card carries none of its own.
 *
 * SETTINGS HOLDS THE DEFAULTS. An epic with no word of its own draws Settings' number for the limit
 * (`DispatcherRoute.wip`) and wears a quiet `default` inside the stepper; one with its own word draws
 * that number and wears nothing. Stepping to a number other than Settings' gives the epic its own word;
 * stepping back to Settings' number sends `default`, so it follows Settings again and the marker comes
 * back. The number IS the word: a count is itself, `all` is All.
 *
 * ONE LADDER FOR BOTH, AND THE SETTINGS ROW'S TOO (`wipLadderSteps`, one copy of the rules): `+` adds
 * one up to the top rung — six, or a wider count Settings or the epic already holds — then goes to All;
 * `−` takes All to the top rung and stops at one.
 *
 * NOTHING IS GUESSED OR OPTIMISTIC, as `RunModelControl`: the number drawn is the frame's own word
 * (`effective`), `busy` refuses presses on both steppers, and a refused press leaves the control telling
 * the truth with the dispatcher's sentence in a toast. A frame from a dispatcher build older than the
 * fields (`wip` or the defaults missing) draws NOTHING here — a press could not be compared against
 * Settings — and the rest of the bar stands.
 *
 * The probe's handles: `data-epic-wip` is the group; each limit's block carries `data-epic-wip-features`
 * or `data-epic-wip-tasks` — the epic's own word (`default` for none) — with `data-epic-wip-effective`,
 * the word in force, and `data-epic-wip-default`, present while the epic follows Settings.
 *
 * Used by `DispatchArcControls`, beside the epic's model control at the end of its `ActionBar`.
 */
export function EpicWipControl({ wip, defaults, busy, onChoose }: EpicWipControlProps) {
  const { t } = useTranslation();
  // `!wip`, not `=== null`: the reader writes `null`, but a frame that never named the key must draw nothing too.
  if (!wip || !defaults) return null;

  return (
    <div
      role="group"
      aria-label={t('dispatcher.wip.groupLabel')}
      className="inline-flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"
      data-epic-wip=""
    >
      <span className="text-xs font-semibold text-muted-foreground" title={t('dispatcher.wip.groupHint')}>
        {t('dispatcher.wip.label')}
      </span>
      {ORDER.map((limit) => (
        <LimitStepper key={limit} limit={limit} setting={wip[limit]} defaultWord={defaults[limit]} busy={busy} onChoose={onChoose} />
      ))}
    </div>
  );
}
