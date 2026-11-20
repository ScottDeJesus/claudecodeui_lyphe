import { Binoculars, Clock, Folders, ListOrdered, Repeat, Ticket, Timer } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  BUG_HUNTER_TURN_RULES,
  BUG_HUNTERS_MINUTES_MAX,
  BUG_HUNTERS_MINUTES_MIN,
  BUG_HUNTERS_TICKETS_MAX,
  BUG_HUNTERS_TICKETS_MIN,
  useBugHunters,
} from '@/modules/settings/hooks/useBugHunters';
import type { BugHunterKind, BugHunterTurnRule } from '@/modules/settings/hooks/useBugHunters';
import SettingsToggle from '@/modules/settings/SettingsToggle';
import RunnerBugHuntersList from '@/modules/settings/tabs/agents-settings/sections/content/RunnerBugHuntersList';
import { HunterSetting, HunterTypedField, HunterUnknown, HunterWarning } from '@/modules/settings/tabs/agents-settings/sections/content/RunnerBugHuntersSetting';
import { Select } from '@/shared/ui';

/** The typed fields' ids: each label's `htmlFor`, and the handle a verify script reads the value by. */
const START_FIELD_ID = 'runner-bug-hunters-start';
const MINUTES_FIELD_ID = 'runner-bug-hunters-minutes';
const TICKETS_FIELD_ID = 'runner-bug-hunters-tickets';

/** The two lists' label ids: each list is named by its row's label. */
const HUNTERS_LABEL_ID = 'runner-bug-hunters-hunters-label';
const PROJECTS_LABEL_ID = 'runner-bug-hunters-projects-label';

/**
 * THE BUG HUNTERS' SETTINGS, `~/.claude/charters/hunts.toml`: whether a night of hunting starts by itself and when, how long it
 * runs, how many tickets a hunter may file in it, which of the five hunters take turns and in what order, the order of the
 * projects they go through, and how the turns are taken.
 *
 * SEVEN ROWS, ONE FILE, ONE HOOK, ordered by what is asked first. THE SWITCH LEADS, and its sentence is the whole night in one
 * line, built from the numbers the rows under it hold: on or off is the one thing a reader comes here to be sure of. A night that
 * would find nothing to hunt (no hunter in the order, no project in the file) is said there too, in amber, on or off. Then when,
 * how long and how many, which are typed. Then who (the hunters) and where (the projects), which are orders, and last the rule
 * that says what the two orders mean together.
 *
 * NOTHING IS GREYED WHILE THE SWITCH IS OFF. A night started by hand from the bug board's Dashboard reads every number here, so
 * each stays live. Only the start time means nothing then, and its sentence says so. NO READ IS ONE ROW, NOT SEVEN
 * (`HunterUnknown`): a default drawn in the rows' place would be a value the file may not hold.
 *
 * EACH TYPED FIELD CARRIES ITS BOUNDS AS ITS CAPTION (the start time, the clock it is read by), and is written when it is left.
 * THE TURN RULE'S LIST IS WIDER than the fields (`w-72`): its longest choice is "A different hunter each night", and a list that
 * cuts its own choices is no list. ALL THREE RULES ARE SAID IN THE ROW, each by its name and one sentence, the chosen one in the
 * full ink: a pick is a write, so a rule has to be readable before it is picked, and the kit's list cuts a sentence put in it.
 *
 * THE TWO ORDERS ARE LISTS UNDER THEIR WORDS, the row's full width (`RunnerBugHuntersList`): five rows with two arrows and a
 * switch each do not fit beside a sentence. A hunter switched off leaves the order and stands under it, marked "Sits out". A
 * project has no switch: it is added or removed in the file, and the row says where.
 *
 * A REFUSED CHANGE SNAPS BACK AND SAYS WHY, in the dispatcher's own sentence, on the row it was made on. That line, and the typed
 * field the three typed rows share, are `RunnerBugHuntersSetting`'s `HunterSetting` and `HunterTypedField`. No control is ever
 * `disabled` while a write is in flight (Chromium blurs a control the instant one lands): `aria-busy` tells assistive tech instead.
 *
 * Used by `RunnerModelContent`, directly under `RunnerBugBoardRow`: those rows say how the board's cards are worked, these who fills it.
 */
export default function RunnerBugHuntersRow() {
  const { t } = useTranslation('settings');

  // ── The wires: one read of the whole file, and its acts. Everything below them is composition. ──
  const { config, unreadable, saving, texts, refusals, setNightly, typeField, leaveField, setHunterTurn, moveHunter, reorderHunters, moveProject, reorderProjects, setTurns, refresh } =
    useBugHunters();

  const nightlyLabel = t('agents.bugHunters.nightly.label');

  if (config === null) {
    return (
      <HunterUnknown
        icon={<Binoculars className="h-4 w-4" />}
        label={nightlyLabel}
        unreadable={unreadable}
        onRetry={() => void refresh()}
      />
    );
  }

  const hunterName = (kind: BugHunterKind): string => t(`agents.bugHunters.hunters.kinds.${kind}.name`);
  // A night that would open and close with nothing done, and why, said under the switch: no hunter in the order, or no project in
  // the file. The first is mended in the hunters' row and the second in the file, and each of those rows shows its own emptiness.
  const nothingToHunt = !config.hunters.some((hunter) => hunter.takesTurn)
    ? t('agents.bugHunters.nightly.noHunter')
    : config.projects.length === 0 ? t('agents.bugHunters.nightly.noProject') : null;
  const minutesBounds = { min: BUG_HUNTERS_MINUTES_MIN, max: BUG_HUNTERS_MINUTES_MAX };
  const ticketsBounds = { min: BUG_HUNTERS_TICKETS_MIN, max: BUG_HUNTERS_TICKETS_MAX };
  // The start time as the field under it draws it: the browser's own clock notation (`00:30`, or `12:30 AM`), so the sentence and the
  // field never say one time two ways. A value that is not `HH:MM` is said as it came.
  const [startHour, startMinute] = config.start.split(':').map(Number);
  const startSaid = Number.isInteger(startHour) && Number.isInteger(startMinute)
    ? new Date(2000, 0, 1, startHour, startMinute).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : config.start;
  const moveLabel = (title: string, by: -1 | 1, position: number, total: number): string =>
    t(by === -1 ? 'agents.bugHunters.moveUp' : 'agents.bugHunters.moveDown', { name: title, position, total });

  return (
    <>
      <HunterSetting
        name="nightly"
        icon={<Binoculars className="h-4 w-4" />}
        label={nightlyLabel}
        refusal={refusals.nightly}
        description={(
          <>
            <p>
              {config.nightly
                ? t('agents.bugHunters.nightly.descriptionOn', { start: startSaid, count: config.minutes })
                : t('agents.bugHunters.nightly.descriptionOff')}
            </p>
            {nothingToHunt !== null && (
              <div className="mt-1.5" data-bug-hunters-nothing="">
                <HunterWarning>{nothingToHunt}</HunterWarning>
              </div>
            )}
          </>
        )}
      >
        {/* A label around the switch, so a press anywhere on it presses the switch: the kit's 30 px switch gets a 44 px catch under a finger. */}
        <label aria-busy={saving} className="flex cursor-pointer items-center finger:min-h-11">
          <SettingsToggle
            checked={config.nightly}
            ariaLabel={nightlyLabel}
            onChange={(next) => void setNightly(next)}
          />
        </label>
      </HunterSetting>

      <HunterSetting
        name="start"
        icon={<Clock className="h-4 w-4" />}
        label={t('agents.bugHunters.start.label')}
        refusal={refusals.start}
        description={(
          <p id={`${START_FIELD_ID}-about`}>
            {config.nightly ? t('agents.bugHunters.start.description') : t('agents.bugHunters.start.descriptionOff')}
          </p>
        )}
      >
        <HunterTypedField
          id={START_FIELD_ID}
          type="time"
          caption={t('agents.bugHunters.start.field')}
          value={texts.start}
          refused={refusals.start !== undefined}
          saving={saving}
          onType={(text) => typeField('start', text)}
          onLeave={() => leaveField('start')}
        />
      </HunterSetting>

      <HunterSetting
        name="minutes"
        icon={<Timer className="h-4 w-4" />}
        label={t('agents.bugHunters.minutes.label')}
        refusal={refusals.minutes}
        description={<p id={`${MINUTES_FIELD_ID}-about`}>{t('agents.bugHunters.minutes.description', { count: config.minutes })}</p>}
      >
        <HunterTypedField
          id={MINUTES_FIELD_ID}
          type="number"
          caption={t('agents.bugHunters.bounds', minutesBounds)}
          ariaLabel={t('agents.bugHunters.minutes.fieldLabel', minutesBounds)}
          {...minutesBounds}
          step={5}
          value={texts.minutes}
          refused={refusals.minutes !== undefined}
          saving={saving}
          onType={(text) => typeField('minutes', text)}
          onLeave={() => leaveField('minutes')}
        />
      </HunterSetting>

      <HunterSetting
        name="tickets"
        icon={<Ticket className="h-4 w-4" />}
        label={t('agents.bugHunters.tickets.label')}
        refusal={refusals.tickets}
        description={<p id={`${TICKETS_FIELD_ID}-about`}>{t('agents.bugHunters.tickets.description', { count: config.tickets })}</p>}
      >
        <HunterTypedField
          id={TICKETS_FIELD_ID}
          type="number"
          caption={t('agents.bugHunters.bounds', ticketsBounds)}
          ariaLabel={t('agents.bugHunters.tickets.fieldLabel', ticketsBounds)}
          {...ticketsBounds}
          step={1}
          value={texts.tickets}
          refused={refusals.tickets !== undefined}
          saving={saving}
          onType={(text) => typeField('tickets', text)}
          onLeave={() => leaveField('tickets')}
        />
      </HunterSetting>

      <HunterSetting
        name="hunters"
        icon={<ListOrdered className="h-4 w-4" />}
        label={<span id={HUNTERS_LABEL_ID}>{t('agents.bugHunters.hunters.label')}</span>}
        refusal={refusals.hunters}
        description={t('agents.bugHunters.hunters.description')}
        below={(
          <div aria-busy={saving}>
            <RunnerBugHuntersList
              labelledBy={HUNTERS_LABEL_ID}
              moveLabel={moveLabel}
              onMove={(kind, by) => void moveHunter(kind as BugHunterKind, by)}
              onReorder={(order) => reorderHunters(order)}
              items={config.hunters.map(({ kind, takesTurn }) => ({
                key: kind,
                title: hunterName(kind),
                detail: t(`agents.bugHunters.hunters.kinds.${kind}.looksFor`),
                outWord: takesTurn ? undefined : t('agents.bugHunters.hunters.sitsOut'),
                // The same 44 px catch as the nightly switch's.
                control: (
                  <label className="flex cursor-pointer items-center finger:min-h-11">
                    <SettingsToggle
                      checked={takesTurn}
                      ariaLabel={t('agents.bugHunters.hunters.turnLabel', { name: hunterName(kind) })}
                      onChange={(next) => void setHunterTurn(kind, next)}
                    />
                  </label>
                ),
              }))}
            />
          </div>
        )}
      />

      <HunterSetting
        name="projects"
        icon={<Folders className="h-4 w-4" />}
        label={<span id={PROJECTS_LABEL_ID}>{t('agents.bugHunters.projects.label')}</span>}
        refusal={refusals.projects}
        description={t('agents.bugHunters.projects.description')}
        below={(
          <div aria-busy={saving}>
            <RunnerBugHuntersList
              labelledBy={PROJECTS_LABEL_ID}
              empty={t('agents.bugHunters.projects.none')}
              moveLabel={moveLabel}
              onMove={(name, by) => void moveProject(name, by)}
              onReorder={(order) => reorderProjects(order)}
              items={config.projects.map(({ name, path }) => ({ key: name, title: name, detail: <span className="break-all font-mono">{path}</span> }))}
            />
          </div>
        )}
      />

      <HunterSetting
        name="turns"
        icon={<Repeat className="h-4 w-4" />}
        label={t('agents.bugHunters.turns.label')}
        refusal={refusals.turns}
        description={(
          <>
            <ul className="flex flex-col gap-1" data-bug-hunters-turn-rules="">
              {BUG_HUNTER_TURN_RULES.map((rule) => (
                <li key={rule} data-chosen={rule === config.turns ? '' : undefined} className={rule === config.turns ? 'text-foreground' : undefined}>
                  <span className="font-medium text-foreground">{t(`agents.bugHunters.turns.rules.${rule}.name`)}</span>
                  {': '}
                  {t(`agents.bugHunters.turns.rules.${rule}.sentence`)}
                </li>
              ))}
            </ul>
            <p className="mt-1.5">{t('agents.bugHunters.turns.description')}</p>
          </>
        )}
      >
        {/* A BLOCK wrapper with a width of its own: `Select`'s root is a block, and as a flex item it would shrink to its text. */}
        <div aria-busy={saving} className="w-72 max-w-full">
          <Select
            options={BUG_HUNTER_TURN_RULES.map((rule) => ({ value: rule, label: t(`agents.bugHunters.turns.rules.${rule}.name`) }))}
            value={config.turns}
            ariaLabel={t('agents.bugHunters.turns.label')}
            onChange={(next) => void setTurns(next as BugHunterTurnRule)}
          />
        </div>
      </HunterSetting>
    </>
  );
}
