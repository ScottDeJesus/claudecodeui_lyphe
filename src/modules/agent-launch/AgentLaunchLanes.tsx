import { useTranslation } from 'react-i18next';

import type { AgentLaunchLane, AgentLaunchSide } from '@/shared/agent-launch-types';
import { Badge } from '@/shared/ui';

/**
 * Used by `AgentLaunchRowItem` to say where a row launches and at what: each lane — the Agent tool,
 * the dispatcher, a chain, Metis — with the model·effort of every side of it, and the lane's own note.
 *
 * A lane whose `reach` is `new-session` carries a marker, because it is the one that does not take a
 * change at the next launch (an Agent call reads its definition once per session). The side's word
 * for itself (`when`) is printed only where it says something the model does not: `always` is the
 * whole lane, and a planner side named `opus` riding `opus` is already the word beside it.
 */
export function AgentLaunchLanes({ lanes }: { lanes: AgentLaunchLane[] }) {
  const { t } = useTranslation();
  const noFlag = t('agentLaunch.row.noFlag');
  const whenLabel = (side: AgentLaunchSide) => {
    if (side.when === 'always' || side.when === side.model) return null;
    return t(`agentLaunch.lanes.${side.when}`, { defaultValue: side.when });
  };

  return (
    <ul className="flex min-w-0 flex-col gap-2" data-agent-lanes>
      {lanes.map((lane) => (
        <li key={lane.lane} className="flex min-w-0 flex-col gap-0.5" data-agent-lane={lane.lane} data-reach={lane.reach}>
          <div className="flex min-w-0 items-baseline gap-3">
            <span className="w-[5.5rem] shrink-0 text-xs font-medium">{t(`agentLaunch.lanes.${lane.lane}`, { defaultValue: lane.lane })}</span>
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
              {lane.sides.map((side) => (
                <span key={side.when} className="inline-flex items-baseline gap-1.5 text-xs" data-agent-side={side.when}>
                  {whenLabel(side) && <span className="text-muted-foreground">{whenLabel(side)}</span>}
                  <span className="font-mono">
                    {side.model}·{side.effort ?? noFlag}
                  </span>
                </span>
              ))}
              {lane.reach === 'new-session' && (
                <Badge as="span" variant="outline" tone="neutral" className="vv-badge--compact whitespace-nowrap">
                  {t('agentLaunch.lanes.newSession')}
                </Badge>
              )}
            </div>
          </div>
          {lane.note && <p className="text-xs text-muted-foreground [@container(min-width:64rem)]:pl-[6.25rem]">{lane.note}</p>}
        </li>
      ))}
    </ul>
  );
}
