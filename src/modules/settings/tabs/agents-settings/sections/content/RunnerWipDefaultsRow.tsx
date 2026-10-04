import { Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useWipDefaults } from '@/modules/settings/hooks/useWipDefaults';
import { Button, SettingRow, Stepper } from '@/shared/ui';
import { wipCountOfWord, wipLadderSteps, wipLadderTop } from '@/shared/utils';

/**
 * Everything that differs between the two defaults, one entry per limit: the handle the browser harness
 * reads and the sentences around its stepper — its visible name and its three accessible names — each
 * with the English it falls back to. One table, so a limit cannot be drawn without a name or a handle.
 */
const LIMITS = {
  features: {
    handle: 'data-wip-default-features',
    name: { key: 'agents.wipDefaults.features', text: 'Features' },
    group: { key: 'agents.wipDefaults.featuresLabel', text: 'Default most features of an epic in progress at once' },
    down: { key: 'agents.wipDefaults.featuresDown', text: 'One feature fewer in progress' },
    up: { key: 'agents.wipDefaults.featuresUp', text: 'One feature more in progress' },
  },
  tasks: {
    handle: 'data-wip-default-tasks',
    name: { key: 'agents.wipDefaults.tasks', text: 'Tasks' },
    group: { key: 'agents.wipDefaults.tasksLabel', text: 'Default most tasks of each feature at once' },
    down: { key: 'agents.wipDefaults.tasksDown', text: 'One task fewer at once' },
    up: { key: 'agents.wipDefaults.tasksUp', text: 'One task more at once' },
  },
} as const;

/** The order the two steppers are drawn in, which is the order the epic card and the dispatcher print them. */
const ORDER = ['features', 'tasks'] as const;

/** The word the dispatcher's grammar has for a count the ladder landed on: `all` for no limit, else the digits. */
function wordOfCount(count: number | null): string {
  return count === null ? 'all' : String(count);
}

/**
 * THE WIP DEFAULTS — what every epic starts from: how many of its features are in progress at once, and
 * how many tasks each of them runs at once. An epic's own numbers are set on its card, so this row is
 * the only concurrency setting Settings has: two numbers, `~/.claude/state/wip.flag`, two lines.
 *
 * Its own file, as `RunnerPlannerLanesRow` is: `RunnerModelContent` is past what it should hold, and a
 * row whose read, write and re-read are its own hook has nothing to share with the rows around it
 * except their grammar — the unknown state in words, the retry in the control's slot.
 *
 * TWO STEPPERS ON THE ONE LADDER, `1, 2, … 6, All`, the same copy of the rules the epic card's WIP
 * control climbs (`wipLadderSteps`): `+` adds one and from the top count reaches All, `−` takes All to
 * the top count and stops at one. The top is six, or the count the stepper holds when that is wider;
 * the stepper's own count is the only one in play, so a count above six steps down by one and is not
 * climbed back to once left. There is no off: a task default of one is one at a time. A press the
 * ladder refuses has no step, and so no handler to fire.
 *
 * A press writes BOTH lines (the file is written whole, atomically), the other default riding along as
 * the row holds it. The row never draws a position it was not told: until the server has answered it
 * says so in words, and when no answer comes it offers the one press that can be honoured — ask again.
 *
 * Wears `Gauge` — a limit read off a dial — which no other row on this card uses.
 *
 * Used by `RunnerModelContent`, which draws it between the DeepSeek switch's row and the planner lanes.
 */
export default function RunnerWipDefaultsRow() {
  const { t } = useTranslation('settings');
  const { words, unreadable, saving, setLimit, refresh } = useWipDefaults();

  const label = t('agents.wipDefaults.label', { defaultValue: 'WIP defaults' });
  // No numbers is not two and two, and the row says so in words where the reader is already looking —
  // the window before the first answer and a read that failed alike, with only the sentence differing.
  const unknown = words === null;

  return (
    <SettingRow
      data-wip-defaults=""
      icon={<Gauge className="h-4 w-4" />}
      label={label}
      description={unknown
        ? unreadable
          ? t('agents.wipDefaults.unreadable', {
              defaultValue: 'The defaults could not be read from the server, so their numbers are unknown. They are retried whenever this page regains focus.',
            })
          : t('status.loading', { ns: 'common', defaultValue: 'Loading...' })
        : t('agents.wipDefaults.description', {
            defaultValue: 'Every epic starts from these: how many of its features are in progress at once, and how many tasks each of them runs at once. An epic’s own numbers are changed on its card.',
          })}
    >
      {words === null ? (
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          {t('buttons.retry', { ns: 'common', defaultValue: 'Try again' })}
        </Button>
      ) : (
        // `aria-busy` while a write is in flight: the steppers stay live (a real `disabled` would make
        // Chromium blur the button under a keyboard user's finger), so assistive tech is told instead.
        // A two-column grid, name then stepper, one limit to a line: the steppers stand in one column
        // whatever the names' widths, beside the words on a wide row and under them on a phone.
        <div aria-busy={saving} className="grid grid-cols-[auto_auto] items-center justify-items-start gap-x-3 gap-y-2">
          {ORDER.map((limit) => {
            const entry = LIMITS[limit];
            const word = words[limit];
            const count = wipCountOfWord(word);
            const steps = wipLadderSteps(count, wipLadderTop(count));
            return (
              // `contents`: the block is only the handle's home, its name and its stepper are the grid's cells.
              <div key={limit} className="contents" {...{ [entry.handle]: word }}>
                <span className="text-xs text-muted-foreground">{t(entry.name.key, { defaultValue: entry.name.text })}</span>
                <Stepper
                  value={count === null ? t('agents.wipDefaults.all', { defaultValue: 'All' }) : String(count)}
                  onDecrease={() => { if (steps.down !== null) void setLimit(limit, wordOfCount(steps.down.lanes)); }}
                  onIncrease={() => { if (steps.up !== null) void setLimit(limit, wordOfCount(steps.up.lanes)); }}
                  canDecrease={steps.down !== null}
                  canIncrease={steps.up !== null}
                  decreaseLabel={t(entry.down.key, { defaultValue: entry.down.text })}
                  increaseLabel={t(entry.up.key, { defaultValue: entry.up.text })}
                  ariaLabel={t(entry.group.key, { defaultValue: entry.group.text })}
                />
              </div>
            );
          })}
        </div>
      )}
    </SettingRow>
  );
}
