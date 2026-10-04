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
  onSave: (name: string, change: AgentLaunchRowChange) => Promise<void>;
};

/**
 * Used by `AgentLaunchPanel` for every soul and for Metis: one line of the launch table.
 *
 * THREE THINGS: who it is (the name, with the description as secondary text, cut at two lines and
 * opened by a press, because a soul's description can run a page), what it launches at (the model and
 * the effort, each changed where it is), and where that lands (its lanes). They sit in three columns
 * once the panel is 64rem wide, in two from 48rem — who and the controls stacked beside the lanes —
 * and in one below that. The pin is the row's own entry in the table; the Default choice deletes it.
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
export function AgentLaunchRowItem({ row, census, held, refused, onSave }: AgentLaunchRowItemProps) {
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
              className="-my-1 self-start py-1 text-xs text-accent-ink hover:underline"
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
              choices={census.choices.models}
              current={row.model}
              pinned={row.model_pinned}
              defaultWord={census.defaults.model}
              onChange={(next) => save({ model: next })}
            />
            <AgentLaunchChoice
              label={t('agentLaunch.row.effort')}
              ariaLabel={t('agentLaunch.row.effortLabel', { name: row.name })}
              choices={census.choices.efforts}
              current={row.effort}
              pinned={row.effort_pinned}
              defaultWord={defaultEffort}
              onChange={(next) => save({ effort: next })}
            />
          </div>
        </div>
      </div>

      <AgentLaunchLanes lanes={row.lanes} />
    </li>
  );
}
