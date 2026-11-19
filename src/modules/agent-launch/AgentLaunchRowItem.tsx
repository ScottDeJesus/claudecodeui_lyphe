import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AgentLaunchChoice } from '@/modules/agent-launch/AgentLaunchChoice';
import { AgentLaunchLanes } from '@/modules/agent-launch/AgentLaunchLanes';
import type { AgentLaunchCensus, AgentLaunchRow, AgentLaunchRowChange } from '@/shared/agent-launch-types';
import { Badge, Spinner } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * A description longer than this is offered a Show more: at the narrowest column a row draws (about 38
 * characters a line) two lines hold roughly this many, so anything shorter is never cut.
 */
const DESCRIPTION_CLAMP_CHARS = 70;

type AgentLaunchRowItemProps = {
  row: AgentLaunchRow;
  /** The census's own vocabulary and defaults: every choice list and every "Default · …" comes from it. */
  census: AgentLaunchCensus;
  /** True while this row's save is in flight: its controls are held and say so. */
  held: boolean;
  /** True when the table refused the last change handed to this row: the row wears the same mark the banner names. */
  refused: boolean;
  /** The row's own model words where they are not every soul's (`census.choices.models`): the sorter's list, the tweak's. */
  models?: string[];
  /** True for a row whose words always stand in the table (the sorter, the tweak): its lists offer no Default and wear no pinned mark. */
  required?: boolean;
  /**
   * True for a row that holds a model alone (the tweak): its effort is said in words where the list would be, with whose word it
   * is. `row.effort_pinned` picks the words: false is the table's default for the row's model, true is Hephaestus's own effort
   * pin, which the tweak launches at when its model is the one his row gives him.
   */
  effortFollows?: boolean;
  onSave: (name: string, change: AgentLaunchRowChange) => Promise<void>;
};

/**
 * Used by `AgentLaunchPanel` for every soul and for the sorter and the tweak: one line of the launch table.
 *
 * THREE THINGS: who it is (the name, with the description as secondary text, cut at two lines and
 * opened by a press, because a soul's description can run a page), what it launches at (the model and
 * the effort, each changed where it is), and where that lands (its lanes). They sit in three columns
 * once the panel is 64rem wide, in two from 48rem — who and the controls stacked beside the lanes —
 * and in one below that. The pin is the row's own entry in the table; the Default choice deletes it.
 *
 * THE SORTER AND THE TWEAK ARE THE SAME ROW WITH LESS TO CHOOSE. Their words are not pins (`required`), each has a
 * model list of its own (`models`), and the tweak's effort is not its row's to set (`effortFollows`): the slot says
 * the effort it will launch at and whose word that is (its model's default, or Hephaestus's own pin), so the row
 * still answers "at what?" in the place a reader looks for it and names the control that would change it.
 *
 * SHOW MORE IS 44 PX UNDER A FINGER WITHOUT MOVING THE ROW. Its words stay one line of 24 px; under a finger a
 * transparent `::before` reaches 10 px above and below them, over the description and into the gap under it, where
 * no other press stands (the Model list begins 2 px below the catch on a phone).
 *
 * A HELD ROW IS HELD WITHOUT BEING DISABLED. A save takes as long as the shims take to regenerate, and a
 * second press on a row still writing would race the first. A disabled control drops keyboard focus to
 * the page the moment it is set and never gives it back — the kit's `Chip` names the same failure — so the
 * controls stay enabled and focused: the pointer is switched off, the row is dimmed, and `onChange`
 * returns early while held, so a keyboard press is dropped and the picture does not change.
 *
 * A shim that has fallen behind the table is marked on the row too, not only in the warnings above:
 * the warning says how many, the mark says which. So is a change the table refused.
 */
export function AgentLaunchRowItem({ row, census, held, refused, models, required = false, effortFollows = false, onSave }: AgentLaunchRowItemProps) {
  const { t } = useTranslation();
  // Whether the description is opened past its two lines. It cannot be derived: it is the reader's own press.
  const [expanded, setExpanded] = useState(false);
  const behind = row.shim !== null && !row.shim.current;
  const longDescription = row.description.length > DESCRIPTION_CLAMP_CHARS;
  // What clearing the effort pin would fall back to: the default for the model this row resolves to.
  const defaultEffort = census.defaults.effort[row.model] ?? null;
  const save = (change: AgentLaunchRowChange) => {
    if (held) return;
    void onSave(row.name, change);
  };

  return (
    <li
      className="grid min-w-0 gap-4 px-4 py-4 [@container(min-width:48rem)]:grid-cols-2 [@container(min-width:48rem)]:gap-x-6 [@container(min-width:64rem)]:grid-cols-[minmax(0,4fr)_minmax(17rem,20rem)_minmax(0,7fr)]"
      data-agent-row={row.name}
      data-held={held || undefined}
      aria-busy={held || undefined}
    >
      {/* Who and the controls travel together: one column beside the lanes on a mid-width panel, and
          `contents` on a wide one, where the grid above places each of them in a column of its own. */}
      <div className="flex min-w-0 flex-col gap-4 [@container(min-width:64rem)]:contents">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="text-sm font-medium">{row.name}</h4>
            {held && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" data-agent-saving>
                <Spinner size={14} />
                {t('agentLaunch.row.saving')}
              </span>
            )}
            {refused && (
              <Badge as="span" tone="warn" className="vv-badge--compact gap-1" data-agent-refused-row>
                <span aria-hidden="true">▲</span>
                {t('agentLaunch.row.notSaved')}
              </Badge>
            )}
            {behind && (
              <Badge as="span" tone="warn" className="vv-badge--compact gap-1" data-agent-shim-behind>
                <span aria-hidden="true">▲</span>
                {t('agentLaunch.row.shimBehind')}
              </Badge>
            )}
          </div>
          <p className={cn('text-xs text-muted-foreground', !expanded && 'line-clamp-2')}>{row.description}</p>
          {longDescription && (
            <button
              type="button"
              className="relative -my-1 self-start py-1 text-xs text-accent-ink hover:underline finger:before:absolute finger:before:-inset-y-2.5 finger:before:inset-x-0 finger:before:content-['']"
              aria-expanded={expanded}
              onClick={() => setExpanded((wasExpanded) => !wasExpanded)}
            >
              {expanded ? t('agentLaunch.row.less') : t('agentLaunch.row.more')}
            </button>
          )}
        </div>

        <div className={cn('min-w-0 max-w-md', held && 'pointer-events-none opacity-60')}>
          <div className="grid grid-cols-1 gap-2 [@container(min-width:64rem)]:grid-cols-2 [@container(min-width:64rem)]:gap-3">
            <AgentLaunchChoice
              label={t('agentLaunch.row.model')}
              ariaLabel={t('agentLaunch.row.modelLabel', { name: row.name })}
              choices={models ?? census.choices.models}
              current={row.model}
              pinned={row.model_pinned}
              defaultWord={census.defaults.model}
              required={required}
              onChange={(next) => save({ model: next })}
            />
            {effortFollows ? (
              <AgentLaunchChoice
                label={t('agentLaunch.row.effort')}
                said={row.effort_pinned
                  ? t('agentLaunch.row.effortOwnPin', { effort: row.effort ?? t('agentLaunch.row.noFlag') })
                  : t('agentLaunch.row.effortFollows', { effort: row.effort ?? t('agentLaunch.row.noFlag'), model: row.model })}
              />
            ) : (
              <AgentLaunchChoice
                label={t('agentLaunch.row.effort')}
                ariaLabel={t('agentLaunch.row.effortLabel', { name: row.name })}
                choices={census.choices.efforts}
                current={row.effort}
                pinned={row.effort_pinned}
                defaultWord={defaultEffort}
                required={required}
                onChange={(next) => save({ effort: next })}
              />
            )}
          </div>
        </div>
      </div>

      <AgentLaunchLanes lanes={row.lanes} />
    </li>
  );
}
