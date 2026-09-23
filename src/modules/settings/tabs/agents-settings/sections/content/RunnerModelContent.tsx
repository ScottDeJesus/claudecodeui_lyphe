import { HeartPulseIcon, Network } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useDeepSeekFlashSwitch } from '@/shared/hooks/useDeepSeekFlashSwitch';
import { useHealMasterSwitch } from '@/shared/hooks/useHealMasterSwitch';
import { LANES_MIN, useSwarmSwitch } from '@/shared/hooks/useSwarmSwitch';
import { Button, LLMProviderLogo, Stepper } from '@/shared/ui';
import SettingsRow from '@/modules/settings/SettingsRow';
import SettingsToggle from '@/modules/settings/SettingsToggle';
import RunnerHealModelRow from '@/modules/settings/tabs/agents-settings/sections/content/RunnerHealModelRow';

/**
 * The first stop below `Unlimited` on the ceiling stepper: the smallest ceiling that is a swarm at
 * all. `Unlimited` is the TOP of the scale — nothing is wider — so the press that steps down from
 * it has to land somewhere, and it cannot land on one lane: `LANES_MIN` is the serial walk the
 * switch is off for, so a press that arrived there would have changed nothing anyone can see. Two
 * is the first count that runs phases beside each other, which is the thing this row turns on.
 */
const FIRST_CEILING = 2;

/**
 * Rendered by AgentCategoryContentSection under Claude's "account" panel: which model the plan
 * runner's hands — the builder, his fix-pass and Athena — actually dispatch on, whether the runner
 * runs several phases of one plan at once, and whether the heal reflex may launch a heal at all.
 *
 * It sits beside the Claude connection rather than in a tab of its own because that is the
 * question it answers: this account's souls, or DeepSeek's. Every switch it writes is a file the
 * runner or the reflex's worker re-reads as it goes, so a flip here reaches the next phase — or the
 * next ending — with nothing restarted.
 *
 * The read, the write and the re-read live in `useDeepSeekFlashSwitch`, `useSwarmSwitch` and
 * `useHealMasterSwitch` — one hook per switch rather than one generalised switch, because switches
 * sharing a module move together the first time one of them is edited, and these must never. The
 * fourth, `useHealModelSwitch`, is drawn by `RunnerHealModelRow` below — its own file, because the
 * row that asks WHICH MODEL a heal runs on needs this card's heal poller and grew past what this
 * file should hold.
 *
 * THE SWARM ROW WEARS THE SWARM MARK, `Network` — the same Lucide glyph the run card draws beside a
 * swarming run's lanes — and the heal row wears the heal panel's own `HeartPulseIcon`, so one shape
 * means one thing wherever it appears. Both are `flex-none` for the reason `SettingsRow`'s layout
 * makes plain: these labels wrap on a phone, and a shrinkable icon measures zero wide at 360px, which
 * is the mark the row exists to draw, gone.
 */
export default function RunnerModelContent() {
  const { t } = useTranslation('settings');
  const { enabled, unreadable, setEnabled, refresh } = useDeepSeekFlashSwitch();
  const {
    enabled: swarmEnabled,
    lanes,
    unreadable: swarmUnreadable,
    setEnabled: setSwarmEnabled,
    setLanes,
    refresh: refreshSwarm,
  } = useSwarmSwitch();
  const {
    enabled: healEnabled,
    unreadable: healUnreadable,
    setEnabled: setHealEnabled,
    refresh: refreshHeal,
  } = useHealMasterSwitch();

  const label = t('agents.runnerModel.label', { defaultValue: 'Use DeepSeek Flash for build souls' });
  // A switch drawn off for a switch that is on is the one thing this row must never do, and it
  // cannot draw a third state the way the composer's chip can. So when there is no position the row
  // says so in words, in the place the reader is already looking — the only surface they come to
  // when they want to be sure.
  //
  // `enabled === null` is the chip's own rule and covers BOTH windows: the read still on the wire,
  // and the read that failed. The first is not brief — the app's request timeout is 30 s and the
  // hook asks again after it — so drawing it as OFF is the same lie for up to a minute. Only the
  // sentence differs, and the chip already carries the same pair.
  const unknown = enabled === null;

  const swarmLabel = t('agents.runnerSwarm.label', {
    defaultValue: 'Run every independent phase of a plan at once',
  });
  // The same rule for the row below, and the same pair of sentences.
  const swarmUnknown = swarmEnabled === null;

  const healLabel = t('agents.runnerHeal.label', { defaultValue: 'Heal reflex' });
  // The same rule a third time, and the same pair of sentences. It bites hardest here: a reflex drawn
  // off while it is launching is a reader told to stop looking for the switch that would stop it.
  const healUnknown = healEnabled === null;

  // `null` is NO CEILING, and the control says so in words: it is the switch's own default — every
  // phase the independence rule frees — and not a missing value, so a reader has to be able to tell
  // "Unlimited" from "not read yet" (which is the row's other branch, and says so itself).
  const ceiling = lanes === null
    ? t('agents.runnerSwarm.lanesUnlimited', { defaultValue: 'Unlimited' })
    : lanes === LANES_MIN
      // The count's own singular is its own string: `{{count}} lanes` would print "1 lanes".
      ? t('agents.runnerSwarm.lane', { defaultValue: '1 lane' })
      : t('agents.runnerSwarm.lanes', { defaultValue: '{{count}} lanes', count: lanes });
  // UNLIMITED IS THE TOP OF THE SCALE, not a dead end — the count climbs towards it from below and
  // the press that reaches it is the row's own `Unlimited` action, so nothing here has to walk a
  // number all the way down to get back to no ceiling. `−` from Unlimited therefore CHOOSES the
  // first ceiling, `+` from Unlimited is refused because nothing is wider than it, and `+` on any
  // count is unbounded. One lane is the floor: there is no lane under one to ask for.
  const dropCeiling = () => {
    if (lanes === null) void setLanes(FIRST_CEILING);
    else if (lanes > LANES_MIN) void setLanes(lanes - 1);
  };
  const raiseCeiling = () => {
    // The twin of the disabled `+` at Unlimited: that button never fires, and this cannot either.
    if (lanes !== null) void setLanes(lanes + 1);
  };

  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-card">
      <SettingsRow
        icon={<LLMProviderLogo provider="deepseek" className="h-4 w-4" />}
        label={label}
        description={unknown
          ? unreadable
            ? t('agents.runnerModel.unreadable', {
                defaultValue: 'The switch could not be read from the server, so its position is unknown — this is not the same as off. It is retried whenever this page regains focus.',
              })
            : t('status.loading', { ns: 'common', defaultValue: 'Loading...' })
          : t('agents.runnerModel.description', {
              defaultValue: 'Dispatch the plan runner’s builder, its fix-pass and Athena on DeepSeek’s deepseek-flash instead of Claude Opus. Prometheus, the scouts and the replanner stay on Claude. Takes effect on the next phase.',
            })}
      >
        {unknown ? (
          // The same press the composer's chip offers in this state, in the row's own grammar: a
          // switch with no position cannot be moved, so what the slot holds is the one act that can
          // be honoured — ask again. Without it a persistent read failure left the row dead until
          // the reader closed Settings and reopened it, which is a way out only if they guess it.
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            {t('buttons.retry', { ns: 'common', defaultValue: 'Try again' })}
          </Button>
        ) : (
          <SettingsToggle
            checked={enabled === true}
            onChange={(next) => void setEnabled(next)}
            ariaLabel={label}
            // Disabled ONLY while there is no position to set: a switch with nothing to point at
            // cannot be moved, and the button beside it is the way back. NOT disabled while the
            // write is in flight — `Switch` renders a real `disabled` attribute, and Chromium blurs
            // the element the instant one lands, so the second Space a keyboard user presses would
            // go to the document and the row would read as broken. The hook refuses that second
            // write itself, and `checked` is already the optimistic position, so the toggle never
            // shows a side it cannot back.
            disabled={enabled === null}
          />
        )}
      </SettingsRow>

      <SettingsRow
        // The swarm mark, in the slot the DeepSeek row above gives its logo — the same `Network`
        // glyph a swarming run's card wears beside its lanes. One shape, one meaning, both surfaces.
        //
        // `flex-none` is what keeps it a mark: `SettingsRow` lays the icon and the label out in a
        // flex row, and this row's label is long enough to wrap on a phone, so a shrinkable icon
        // measures 7.4px wide at 430px and ZERO at 360px — the mark the row exists to draw, gone.
        // The run card's own copy carries the same class for the same reason.
        icon={<Network className="h-4 w-4 flex-none" />}
        label={swarmLabel}
        description={swarmUnknown
          ? swarmUnreadable
            ? t('agents.runnerSwarm.unreadable', {
                defaultValue: 'The switch could not be read from the server, so its position is unknown — this is not the same as off. It is retried whenever this page regains focus.',
              })
            : t('status.loading', { ns: 'common', defaultValue: 'Loading...' })
          : swarmEnabled === true
            ? lanes === null
              ? t('agents.runnerSwarm.descriptionOnUnlimited', {
                  defaultValue: 'The plan runner runs every independent phase of the plan at once — only ever phases that touch no file each other writes and that do not wait on each other. Everything else stays serial, one phase at a time. Takes effect at the next phase boundary.',
                })
              : t('agents.runnerSwarm.descriptionOn', {
                  defaultValue: 'The plan runner runs up to {{lanes}} independent phases at once, and only phases that touch no file each other writes and that do not wait on each other. Everything else stays serial, one phase at a time. Takes effect at the next phase boundary.',
                  lanes,
                })
            // Said in the tense the runner is in: with the switch off exactly one phase is admitted,
            // so a sentence about lanes would be describing a walk that is not happening.
            : t('agents.runnerSwarm.descriptionOff', {
                defaultValue: 'Off: the plan runner walks one phase at a time, exactly as it always has. Turn this on and it runs every independent phase of a plan at once — with an optional ceiling on how many at a time — and only ever phases that touch no file each other writes and that do not wait on each other. Takes effect at the next phase boundary.',
              })}
      >
        {swarmUnknown ? (
          <Button variant="outline" size="sm" onClick={() => void refreshSwarm()}>
            {t('buttons.retry', { ns: 'common', defaultValue: 'Try again' })}
          </Button>
        ) : (
          <div className="flex items-center gap-3">
            {/* THE CEILING IS OPTIONAL, and this control is where it is chosen: `Unlimited` is the
                switch's own default and the TOP of the scale, with the counts below it and no
                largest count at all — the runner's own grammar (`hooks/plan_runner/swarm.py`) has 1
                as its floor and no ceiling on a ceiling. Stepper buttons and NOT a number input: the
                reader is choosing whether to have a ceiling at all, which is a press and not a
                figure to type.
                Both presses are live with the switch OFF as well as on: the flag file is one line
                and `off` carries no ceiling, so a count chosen while off is held here and written by
                the next ON press — the same way the toggle's own next press carries it. The row
                whose position could not be read is the one state with nothing to point at, and there
                the whole control stands down. */}
            <Stepper
              value={ceiling}
              onDecrease={dropCeiling}
              onIncrease={raiseCeiling}
              canDecrease={swarmEnabled !== null && (lanes === null || lanes > LANES_MIN)}
              canIncrease={swarmEnabled !== null && lanes !== null}
              decreaseLabel={t('agents.runnerSwarm.lanesDown', { defaultValue: 'One lane fewer' })}
              increaseLabel={t('agents.runnerSwarm.lanesUp', { defaultValue: 'One lane more' })}
              ariaLabel={t('agents.runnerSwarm.lanesLabel', { defaultValue: 'Ceiling on phases run at once' })}
            />
            {/* THE WAY BACK IS ITS OWN PRESS, shown exactly while there is a ceiling to clear, so a
                reader never has to step a count down to reach no ceiling — and so the one count they
                cannot see from the row, the number of phases the independence rule will free, is
                never the number the row would make them count to. */}
            {lanes !== null && (
              <Button variant="ghost" size="sm" onClick={() => void setLanes(null)}>
                {t('agents.runnerSwarm.lanesUnlimitedAction', { defaultValue: 'Unlimited' })}
              </Button>
            )}
            <SettingsToggle
              checked={swarmEnabled === true}
              onChange={(next) => void setSwarmEnabled(next)}
              ariaLabel={swarmLabel}
              // The same rule as the row above, for the same reason.
              disabled={swarmEnabled === null}
            />
          </div>
        )}
      </SettingsRow>

      {/* THE MASTER OF THE HEAL REFLEX — the one switch on this card that STOPS work rather than
          starting it, and the answer to "theyre running crazy, theres suppose to be a toggle for it
          right?". Off: no ending launches a heal. Every ending still files the friction it saw, so
          nothing is lost while it is off, and a typed `/heal` — the operator's own hand — still runs
          one. It ships ABSENT, and absent means on, so this row's OFF is his deliberate word and
          never something the row invented. */}
      <SettingsRow
        icon={<HeartPulseIcon className="h-4 w-4 flex-none" />}
        label={healLabel}
        description={healUnknown
          ? healUnreadable
            ? t('agents.runnerHeal.unreadable', {
                defaultValue: 'The switch could not be read from the server, so its position is unknown — this is not the same as off. It is retried whenever this page regains focus.',
              })
            : t('status.loading', { ns: 'common', defaultValue: 'Loading...' })
          : healEnabled === true
            ? t('agents.runnerHeal.descriptionOn', {
                defaultValue: 'The heal reflex launches a heal from an ending that finds friction past its threshold, once the box has been idle an hour and with at most two heals in flight. This is what it does with no flag file at all, which is how it ships.',
              })
            : t('agents.runnerHeal.descriptionOff', {
                defaultValue: 'Off: no ending launches a heal. Every ending still files the friction it saw, so nothing is lost while it is off, and a typed /heal still runs one. Takes effect at the next ending.',
              })}
      >
        {healUnknown ? (
          <Button variant="outline" size="sm" onClick={() => void refreshHeal()}>
            {t('buttons.retry', { ns: 'common', defaultValue: 'Try again' })}
          </Button>
        ) : (
          <SettingsToggle
            checked={healEnabled === true}
            onChange={(next) => void setHealEnabled(next)}
            ariaLabel={healLabel}
            // The same rule as the two rows above, for the same reason.
            disabled={healEnabled === null}
          />
        )}
      </SettingsRow>

      {/* WHICH MODEL THE HEAL'S OWN SOULS RUN ON — its own file, beside this one: the fourth switch
          of the family, and the row that needs this card's one heal poller rather than a second
          reading of the worker's rule. */}
      <RunnerHealModelRow />
    </div>
  );
}
