import { useTranslation } from 'react-i18next';

import { phaseWord } from '@/modules/dispatcher/phaseWord';
import { Badge } from '@/shared/ui';
import type { DispatcherPhase, DispatcherPlan } from '@/shared/types';

/** How many running phases get a line of their own before the rest are counted. */
const NOW_LIMIT = 3;

/**
 * What the plan is doing NOW, one line a phase: the phases reading running — walking or settling
 * (`phaseWord`) — up to three, then `+N more`. With none running on a plan that is not complete,
 * the first phase not started, as `Next`: a stopped or queued plan still answers "what moves when it
 * goes?". A complete plan draws nothing — the track above already says every node is done.
 *
 * A line is the phase's mark on the track, its position, its title on ONE line (truncated, the whole
 * title on hover and in the full list), and its assignee — who is out on it.
 *
 * Used by `PlanFace`, under the track and its receipt.
 */
export function PlanNow({ plan }: { plan: DispatcherPlan }) {
  const { t } = useTranslation();
  if (plan.status === 'complete') return null;

  const running = plan.phases.filter((phase) => phase.status === 'running');
  const next = running.length === 0 ? plan.phases.find((phase) => phase.status === 'not started') ?? null : null;
  if (running.length === 0 && next === null) return null;
  const more = running.length - NOW_LIMIT;

  return (
    <ul className="flex min-w-0 flex-col gap-1" data-plan-now>
      {next !== null ? (
        <NowLine phase={next} lead={t('dispatcher.now.next')} />
      ) : (
        running.slice(0, NOW_LIMIT).map((phase) => <NowLine key={phase.key} phase={phase} lead={null} />)
      )}
      {more > 0 && (
        <li className="pl-8 text-xs text-muted-foreground" data-now-more>{t('dispatcher.now.more', { count: more })}</li>
      )}
    </ul>
  );
}

/**
 * One line of `PlanNow`. `lead` is the `Next` word, drawn before the mark on the one line that is not
 * running; a running line's state is its mark, spoken to a screen reader as the phase's own word. The
 * mark is the track node's own circle, tone and glyph, so the eye can match a line to its node.
 */
function NowLine({ phase, lead }: { phase: DispatcherPhase; lead: string | null }) {
  const { t } = useTranslation();
  const word = phaseWord(phase);
  return (
    <li
      className="flex min-w-0 items-center gap-2 text-xs"
      data-now-phase={phase.key}
      data-now-next={lead !== null ? 'true' : undefined}
    >
      {lead !== null && <span className="flex-none font-medium text-muted-foreground">{lead}</span>}
      <Badge
        as="span"
        tone={word.tone}
        aria-hidden="true"
        className="size-6 flex-none justify-center rounded-full p-0 text-[11px] font-bold leading-none"
      >
        {word.mark}
      </Badge>
      {lead === null && <span className="sr-only">{t(word.copy)}</span>}
      {/* A phase not started wears its position AS its mark, so the eye does not read the number
          twice; the mark is hidden from a screen reader, so the number is spoken here instead. */}
      {word.key !== 'notStarted' ? (
        <span className="flex-none font-mono tabular-nums text-muted-foreground">{phase.position}</span>
      ) : (
        <span className="sr-only">{phase.position}</span>
      )}
      <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={phase.title}>{phase.title}</span>
      {/* The title is what is moving and the soul is secondary, so on a narrow card the soul's name
          gives way first: capped at a quarter of the line, and the one of the two that shrinks. */}
      <span className="min-w-0 max-w-[25%] shrink truncate font-mono text-muted-foreground" title={phase.assignee}>
        {phase.assignee}
      </span>
    </li>
  );
}
