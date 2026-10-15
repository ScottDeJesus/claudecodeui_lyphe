import { useTranslation } from 'react-i18next';

import { LabeledPick } from '@/modules/dispatcher/LabeledPick';
import type { DispatcherArcWip, DispatcherWipChoice, DispatcherWipDefaults, DispatcherWipLimit, DispatcherWipSetting } from '@/shared/types';
import { wipCountOfWord, wipLadderTop, wipLadderWords } from '@/shared/utils';

/**
 * Everything that differs between the epic's two limits, in one row per limit: the handle the browser
 * harness reads, and the sentences around its picker — its visible name and its hint. One table, so a limit
 * cannot be added to the control and left without a name or a handle.
 */
const LIMITS: Record<DispatcherWipLimit, { handle: string; label: string; hint: string }> = {
  features: { handle: 'data-epic-wip-features', label: 'dispatcher.master.wip.features', hint: 'dispatcher.wip.featuresHint' },
  tasks: { handle: 'data-epic-wip-tasks', label: 'dispatcher.master.wip.tasks', hint: 'dispatcher.wip.tasksHint' },
};

/** The order the two pickers are drawn in, which is the order the dispatcher prints them. */
const ORDER: readonly DispatcherWipLimit[] = ['features', 'tasks'];


type LimitPickProps = {
  limit: DispatcherWipLimit;
  /** The limit as the last frame read it: the epic's own word (`null` while it follows the top) and the word in force. */
  setting: DispatcherWipSetting;
  /** The word the epic falls back to as the same frame read it (`wip[limit].default`, else the defaults'): what the first option names. */
  defaultWord: string;
  /** A verb is in flight for this epic: the pick refuses a press until it answers. */
  busy: boolean;
  /** Relays the word chosen (`default` hands the limit back to the top). Never called for the option already chosen. */
  onChoose: (limit: DispatcherWipLimit, choice: DispatcherWipChoice) => void;
};

/** One limit: its name over a dropdown whose first option follows the top, then the ladder `1 … top, All`. */
function LimitPick({ limit, setting, defaultWord, busy, onChoose }: LimitPickProps) {
  const { t } = useTranslation();
  const words = LIMITS[limit];
  const allWord = t('dispatcher.wip.all');
  const value = setting.own ?? 'default';
  // The ladder reaches the widest count in play, so a limit already set above six is an option of the list that shows it.
  const ladder = wipLadderWords(wipLadderTop(wipCountOfWord(defaultWord), wipCountOfWord(setting.effective)));
  const options = [
    { value: 'default', label: t('dispatcher.fold.follow.top', { value: defaultWord === 'all' ? allWord : defaultWord }) },
    ...ladder.map((word) => ({ value: word, label: word === 'all' ? allWord : word })),
  ];
  return (
    <LabeledPick
      label={t(words.label)}
      hint={t(words.hint)}
      options={options}
      value={value}
      disabled={busy}
      width="w-44"
      handle={words.handle}
      onChoose={(word) => {
        if (word !== value) onChoose(limit, word as DispatcherWipChoice);
      }}
    />
  );
}

type EpicWipControlProps = {
  /** The epic's two limits as the last frame read them (`DispatcherArc.wip`), or `null` from a dispatcher build older than the field. A frame that omits the key outright reads the same. */
  wip: DispatcherArcWip | null;
  /** The master controller's two defaults as the same frame read them (`DispatcherRoute.wip`), or `undefined` before the first frame and from an older build. */
  defaults: DispatcherWipDefaults | undefined;
  /** A verb is in flight for this epic: every pick refuses a press until it answers. */
  busy: boolean;
  /** Relays one limit's chosen word (`default` hands it back to the top). */
  onChoose: (limit: DispatcherWipLimit, choice: DispatcherWipChoice) => void;
};

/**
 * An epic's WIP — how much of it may run at once — as two dropdowns inside the deck's fold (`OverrideFold`):
 * **Features at once** (how many of the epic's features are in progress) and **Tasks at once** (how many tasks
 * each of them runs). These are the only concurrency switches for the work under an epic (`dispatcher wip`),
 * which is why a feature's card carries none of its own.
 *
 * EVERYTHING HERE IS AN OVERRIDE of the master controller's two defaults (`DispatcherRoute.wip`, Features at
 * once and Tasks at once in In flight's header). Each dropdown's FIRST option follows the top and names it
 * (`Follow top · 2`, from the epic's own `wip[limit].default` — DeepSeek work defaults to All, operator,
 * 2026-10-04: "DeepSeek should default all always" — with the header's default standing in for a build older
 * than that field); it sends `default`, and the epic follows again. Any other option is the epic's own word,
 * spelled as the dispatcher's grammar has it: a count, or `all`, listed on one ladder `1 … 6, All` that
 * reaches any wider count already in play (`wipLadderTop`).
 *
 * NOTHING IS GUESSED OR OPTIMISTIC, as `ModelPick`: the option chosen is the frame's own word (`own`), `busy`
 * refuses presses on both, and a refused press leaves the control telling the truth with the dispatcher's
 * sentence in a toast. A frame from a dispatcher build older than the fields (`wip` or the defaults missing)
 * draws NOTHING here — the first option could not be named — and the rest of the fold stands.
 *
 * The probe's handles: each pick's group carries `data-epic-wip-features` or `data-epic-wip-tasks` — the
 * epic's own word (`default` for none).
 *
 * Used by `DispatchArcControls`, inside the epic's `OverrideFold`.
 */
export function EpicWipControl({ wip, defaults, busy, onChoose }: EpicWipControlProps) {
  // `!wip`, not `=== null`: the reader writes `null`, but a frame that never named the key must draw nothing too.
  if (!wip || !defaults) return null;
  return (
    <>
      {ORDER.map((limit) => (
        <LimitPick key={limit} limit={limit} setting={wip[limit]} defaultWord={wip[limit].default ?? defaults[limit]} busy={busy} onChoose={onChoose} />
      ))}
    </>
  );
}
