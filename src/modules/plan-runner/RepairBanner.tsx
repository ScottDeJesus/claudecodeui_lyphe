import { useTranslation } from 'react-i18next';

import { useElapsed } from '@/shared/hooks/useElapsed';
import { Banner, Spinner } from '@/shared/ui';
import type { RunnerRepair } from '@/shared/types';

/**
 * The fix-it session on a blocked phase, said on the run's card.
 *
 * A blocked phase with an unblock outing working on it looked exactly like one nobody was touching
 * (operator, 2026-09-18: "I need some sort of visual indicator that the blocked run is working to
 * be unblocked"). This strip is that indicator, in four states the runner writes to
 * `progress.json.repair`:
 *
 *   · REPAIRING — a spinner, the phase, which step the session is on, and how long it has run.
 *     Three sessions answer a ⛔, in order, and the strip names whichever is working: the REPLAN
 *     (`by: 'replan'` — first re-running the phase's checks, then Odysseus rewriting the phase),
 *     the fix-it UNBLOCK outing, and the HEAL a spent ladder filed. The first step of the first two
 *     can take minutes, and it used to leave the card reading `shiplog` with nothing said.
 *     Only while its process is alive: the run's own for an unblock outing, the heal drain's for a
 *     heal (`repair.live` — the drain is the heal side's own process, launched by the watchdog's
 *     `heal-due` beat, never by the run). A pending repair outlives its process (a park keeps it for
 *     the resume, a crash strands it), and a spinner over one nobody is walking would say work is
 *     happening.
 *   · PAUSED — the run parked on a rate limit mid-repair and the repair resumes with it; or a heal
 *     item no drain is working yet, and then the strip REPORTS it as filed. A run never waits on a
 *     heal (operator ruling 2026-09-24: "runs should only report what to heal, never wait on a
 *     heal"), so no sentence here says the run, or its heal, is waiting on anything.
 *   · FIXED — finished. `resumed` picks the words: the phase walks again, or (a heal that cured the
 *     cause without re-arming the phase) the cause is cured and the phase still stands.
 *   · FAILED — finished without clearing it, with the runner's one-line reason.
 *
 * Tone carries the state and the words carry it too (design doctrine :147-149): `info` while it
 * works, `positive` when it cleared, `warn` when it did not — never red, since a failed repair
 * denied nothing. The reason is the runner's free text and reaches the DOM as a text node only.
 */
export function RepairBanner({ repair, runLive }: { repair: RunnerRepair; runLive: boolean }) {
  const { t } = useTranslation();
  const working = repair.state === 'repairing' && (repair.by === 'heal' ? repair.live : runLive);
  const paused = repair.state === 'paused' || (repair.state === 'repairing' && !working);
  const elapsed = useElapsed(working ? repair.since : repair.ended_at, working ? 1_000 : 60_000);
  const attempt = repair.limit > 0 && repair.k > 0
    ? ` · ${t('runner.repair.attempt', { k: repair.k, limit: repair.limit })}` : '';

  if (working) {
    return (
      <div data-runner-repair="repairing">
        <Banner tone="info">
          <div className="flex min-w-0 items-center gap-2">
            <Spinner size={14} />
            <span className="min-w-0 text-sm">
              <strong>{t(repair.by === 'replan' ? 'runner.repair.replanning' : 'runner.repair.repairing',
                { phase: repair.phase_id })}</strong>
              <span className="text-muted-foreground">
                {` · ${t(`runner.repair.step.${repair.step}`, { defaultValue: repair.step })}${attempt}${elapsed ? ` · ${elapsed}` : ''}`}
              </span>
            </span>
          </div>
        </Banner>
      </div>
    );
  }

  if (paused) {
    // A heal item nobody is working yet is REPORTED as filed — the run filed it and walked on.
    const said = repair.by === 'heal' ? t('runner.repair.filedHeal', { phase: repair.phase_id })
      : t(repair.by === 'replan' ? 'runner.repair.pausedReplan' : 'runner.repair.paused',
          { phase: repair.phase_id });
    return (
      <div data-runner-repair="paused">
        <Banner tone="neutral">
          <span className="min-w-0 text-sm">
            <strong>{said}</strong>
            <span className="text-muted-foreground">{attempt}</span>
          </span>
        </Banner>
      </div>
    );
  }

  const fixed = repair.state === 'fixed';
  return (
    <div data-runner-repair={repair.state}>
      <Banner tone={fixed ? 'positive' : 'warn'}>
        <div className="min-w-0 text-sm">
          <strong>
            {fixed
              ? t(repair.resumed ? 'runner.repair.fixed' : repair.resumed === null ? 'runner.repair.healed' : 'runner.repair.cured', { phase: repair.phase_id })
              : t('runner.repair.failed', { phase: repair.phase_id })}
          </strong>
          <span className="text-muted-foreground">{`${attempt}${elapsed ? ` · ${t('runner.repair.ended', { elapsed })}` : ''}`}</span>
          {!fixed && repair.reason && (
            <p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">{repair.reason}</p>
          )}
        </div>
      </Banner>
    </div>
  );
}
