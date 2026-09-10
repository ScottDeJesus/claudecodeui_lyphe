import { useTranslation } from 'react-i18next';

import { useElapsed } from '@/modules/plan-runner/hooks/useElapsed';
import { PHASE_GLYPH, phaseStateTone } from '@/modules/plan-runner/runState';
import { Badge, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui';
import type { RunnerPhaseRow, RunnerTimelineEntry } from '@/shared/types';

/**
 * The clock part of the runner's own local ISO stamp (`2026-09-09T17:46:25` → `17:46:25`).
 *
 * Sliced rather than parsed, because the runner writes LOCAL time with no zone on it: handing it
 * to `new Date()` would have the browser guess an offset and print an hour that never happened.
 * A stamp in any other shape is shown whole rather than mangled into a wrong-looking time.
 */
function clockOf(at: string): string {
  const marker = at.indexOf('T');
  return marker === -1 ? at : at.slice(marker + 1);
}

/**
 * One phase of a run: its mark, its rank, its title and its state — and, folded away underneath,
 * the stages the runner logged while it was in it.
 *
 * EVERY STATE CARRIES A WORD AND A GLYPH, not just a colour (design doctrine :147-149). The badge
 * says `running` beside its blue, the mark says ▶ beside that, and neither is decoration: the row
 * has to be readable in a screenshot, by somebody who cannot tell the tones apart, and at 390px
 * where the badge is the first thing to be cropped.
 *
 * `timeline` is ALREADY this phase's — the card filters it, so a row never scans the run's whole
 * log to draw itself. The elapsed clock runs only for the phase that is genuinely in flight:
 * every other row passes `null` and buys no interval at all, so a five-phase card holds one timer
 * here rather than five (`hooks/useElapsed.ts`).
 */
export function PhaseRow({
  phase,
  timeline,
  isCurrent,
  stageSince,
}: {
  phase: RunnerPhaseRow;
  timeline: RunnerTimelineEntry[];
  isCurrent: boolean;
  stageSince: number | null;
}) {
  const { t } = useTranslation();
  const running = isCurrent && phase.state === 'running';
  const elapsed = useElapsed(running ? stageSince : null);

  // What the badge adds after the state word: how long the phase has been where it is while it
  // runs, and the runner's own note once it has landed — a ship date, or why it stopped.
  const suffix = running
    ? elapsed
    : phase.state === 'shipped' || phase.state === 'blocked'
      ? phase.note
      : '';

  const stateWord = t(`runner.phase.${phase.state}`);

  const rows = timeline.length === 0
    ? <p className="px-2 py-1 text-xs text-muted-foreground">{t('runner.timeline.empty')}</p>
    : (
      <ul className="flex flex-col gap-0.5 py-1 font-mono text-xs text-muted-foreground">
        {timeline.map((entry, index) => (
          // `whitespace-pre` so the two spaces after the clock survive: they are what keeps a
          // column of stage words aligned under each other in a monospaced list.
          <li key={`${entry.at}-${entry.stage}-${index}`} className="truncate whitespace-pre px-2" data-timeline-row>
            {`${clockOf(entry.at)}  ${entry.stage}${entry.detail ? ` ${entry.detail}` : ''}`}
          </li>
        ))}
      </ul>
    );

  return (
    <Collapsible className="min-w-0" data-phase-id={phase.id}>
      <CollapsibleTrigger className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted">
        <span className="flex-none font-mono text-xs" aria-hidden="true">{PHASE_GLYPH[phase.state]}</span>
        <span className="flex-none font-mono text-xs text-muted-foreground">{phase.rank}</span>
        <span className="min-w-0 flex-1 truncate text-sm">{phase.title}</span>
        <Badge tone={phaseStateTone(phase.state)}>{suffix ? `${stateWord} · ${suffix}` : stateWord}</Badge>
      </CollapsibleTrigger>
      <CollapsibleContent>{rows}</CollapsibleContent>
    </Collapsible>
  );
}
