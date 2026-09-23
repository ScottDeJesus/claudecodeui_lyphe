import { Network } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useElapsed } from '@/shared/hooks/useElapsed';
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
 * here rather than five (`@/shared/hooks/useElapsed`).
 *
 * A PHASE THAT CAN SWARM SAYS SO, AND WITH WHOM. `alongside` is the phases sharing this one's wave
 * (`waveCompanions`); with any, the row wears the swarm mark — the `Network` glyph every swarm
 * surface wears, in a neutral badge reading `wave N`, since it is information and not a state —
 * titled with the companions by name. With none it wears nothing. The number is what groups the
 * rows on a phone, where no title shows: every row reading `wave 3` walks together.
 * `data-runner-wave` on the row and on the mark is the browser harness's handle.
 */
export function PhaseRow({
  phase,
  timeline,
  isCurrent,
  stageSince,
  alongside = [],
}: {
  phase: RunnerPhaseRow;
  timeline: RunnerTimelineEntry[];
  isCurrent: boolean;
  stageSince: number | null;
  alongside?: string[];
}) {
  const { t } = useTranslation();
  const running = isCurrent && phase.state === 'running';
  const wave = alongside.length > 0 && typeof phase.wave === 'number' ? phase.wave : undefined;
  const companions = t('runner.waveAlongside', {
    phases: alongside.map((id) => t('runner.wavePhase', { phase: id })).join(', '),
  });
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
          // `whitespace-pre-wrap` keeps the two spaces after the clock, which align the stage words
          // under each other while rows fit; a row long enough to wrap continues under the clock.
          <li key={`${entry.at}-${entry.stage}-${index}`} className="whitespace-pre-wrap break-words px-2" data-timeline-row>
            {`${clockOf(entry.at)}  ${entry.stage}${entry.detail ? ` ${entry.detail}` : ''}`}
          </li>
        ))}
      </ul>
    );

  return (
    <Collapsible className="min-w-0" data-phase-id={phase.id} data-runner-wave={wave}>
      {/* Nothing here truncates: the title wraps, and the badge wraps onto the next line when the
          row is too tight to hold both — a phase name or a block reason cut short is unreadable
          on a phone, which is where this list is read. */}
      <CollapsibleTrigger className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 py-1.5 text-left hover:bg-muted">
        <span className="flex-none font-mono text-xs" aria-hidden="true">{PHASE_GLYPH[phase.state]}</span>
        <span className="flex-none font-mono text-xs text-muted-foreground">{phase.rank}</span>
        <span className="min-w-0 flex-1 basis-40 break-words text-sm leading-snug">{phase.title}</span>
        {/* The state and the mark wrap as ONE unit, so on a phone the title keeps its own line and
            both drop beneath it together. The state leads in the DOM — what a screen reader hears
            first, and on a phone every row's state then starts at the same edge; from `sm` the mark
            is drawn first, so the state badges keep the right-hand column. */}
        <span className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1">
          <Badge as="span" tone={phaseStateTone(phase.state)} className="min-w-0 break-words">
            {suffix ? `${stateWord} · ${suffix}` : stateWord}
          </Badge>
          {wave !== undefined && (
            <Badge as="span" tone="neutral" className="flex-none gap-1 sm:order-first" title={companions} data-runner-wave={wave}>
              <Network className="h-3 w-3 flex-none" aria-hidden="true" />
              {t('runner.wave', { n: wave })}
              <span className="sr-only">{`, ${companions}`}</span>
            </Badge>
          )}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>{rows}</CollapsibleContent>
    </Collapsible>
  );
}
