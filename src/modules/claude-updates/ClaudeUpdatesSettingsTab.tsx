import type { TFunction } from 'i18next';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  isUpdateJobActive,
  useClaudeUpdates,
  type ClaudeUpdateActionResult,
} from '@/modules/claude-updates/hooks/useClaudeUpdates';
import { PackageUpdateCard } from '@/modules/claude-updates/PackageUpdateCard';
import { UpdateJobPanel } from '@/modules/claude-updates/UpdateJobPanel';
import type {
  ClaudeUpdateApplyRequest,
  ClaudeUpdatePackage,
  ClaudeUpdatesReport,
} from '@/shared/claude-update-types';
import { useCliVersion } from '@/shared/hooks/useCliVersion';
import { Banner, Button, Spinner } from '@/shared/ui';
import { formatRelativeTime } from '@/shared/utils';

/**
 * Settings → Updates: what the two Claude packages are on, what is on offer, and the one press that
 * takes the offer.
 *
 * THE ORDER IS THE DECISION. The header first — what was last checked and what is on offer — then
 * one card per package, each carrying its own versions, its own reasons and its own changelog, so
 * the reader never has to hold two packages in their head at once; the acts, named for what they do
 * ("Update and restart", not "Update"), with one line saying what pressing it means for work in
 * flight; and the job last, because it is the record of what already happened.
 *
 * A REFUSAL IS SHOWN WHERE THE PRESS WAS. The server's message ("the versions on screen are no
 * longer the newest — read them again") lands under the buttons that asked, not in a toast that
 * leaves with the reason still unread.
 *
 * The picture comes from `useClaudeUpdates`, whose one module-scope report the sidebar's two forms
 * read as well — so the row, the rail and this pane can never disagree about what is on offer.
 */

/** How a clock AHEAD of now reads: `in 30m`, `in 12h`, or `now` once it is due. */
function untilLabel(ms: number | null): string {
  if (ms === null) return '—';
  const seconds = Math.max(0, Math.floor((ms - Date.now()) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  return `in ${Math.floor(minutes / 60)}h`;
}

/** The header's clock line: when the last check ran, and when the next one is due. */
function checkedLine(checkedAt: number | null, nextCheckAt: number | null, t: TFunction): string {
  if (checkedAt === null) return t('updates.check.never', { defaultValue: 'Not checked yet' });
  const checked = formatRelativeTime(new Date(checkedAt).toISOString());
  if (nextCheckAt === null) {
    return t('updates.check.checked', { checked, defaultValue: 'Checked {{checked}}' });
  }
  return t('updates.check.checkedNext', {
    checked,
    next: untilLabel(nextCheckAt),
    defaultValue: 'Checked {{checked}} · next check {{next}}',
  });
}

/**
 * A package on offer whose `latest` is known. `updateAvailable` already means both versions are
 * strings — this only makes that true for the compiler, so a target can never be built from a null.
 */
type OfferedPackage = ClaudeUpdatePackage & { latest: string };

/** The packages this pipeline can move from here, each with the version it would move them to. */
function offeredPackages(report: ClaudeUpdatesReport): OfferedPackage[] {
  return report.packages.filter(
    (pkg): pkg is OfferedPackage => pkg.updateAvailable && pkg.updatable && pkg.latest !== null,
  );
}

export function ClaudeUpdatesSettingsTab() {
  const { t } = useTranslation('settings');
  const { report, refresh, check, apply, restart } = useClaudeUpdates();

  // The conversations still mid-turn on an older Claude Code — the size of the set the CLI version
  // store keeps, never a second reading of `/api/cli-version` (MAN-503).
  const { staleSessionIds } = useCliVersion();
  const staleCount = staleSessionIds.size;

  /** The last press's refusal, drawn under the buttons that asked; null when nothing was refused. */
  const [refusal, setRefusal] = useState<string | null>(null);

  /** Shows an action's answer: a refusal's sentence stays, a success clears the last one. */
  const showResult = (answer: Promise<ClaudeUpdateActionResult>) => {
    void answer.then((result) => setRefusal(result.ok ? null : result.message));
  };

  /** Asks npm now rather than waiting for the next tick. */
  const onCheckNow = () => {
    // No refusal to show here: a check answers with the report's own `checkError`, drawn above.
    void check();
  };

  /**
   * The empty pane's one press: read now rather than wait out the poller's own minute — and say so
   * when the read comes back empty, so a route that cannot be reached reads as a failure rather
   * than as a spinner that never stops. The poller keeps running either way.
   */
  const onRetry = () => {
    void refresh().then((ok) =>
      setRefusal(
        ok
          ? null
          : t('updates.retryFailed', {
              defaultValue:
                'The server did not answer the update report — this pane keeps asking once a minute.',
            }),
      ),
    );
  };

  /** Starts an update of every package on offer, each at the version this report carries. */
  const onUpdateAndRestart = () => {
    if (report === null) return;
    const targets: ClaudeUpdateApplyRequest['targets'] = {};
    for (const pkg of offeredPackages(report)) targets[pkg.key] = pkg.latest;
    showResult(apply({ targets }));
  };

  /** Hands this process over to the supervisor so the SDK on disk is the one that loads next. */
  const onRestartServer = () => {
    showResult(restart());
  };

  /** Rolls one package back to the version the finished job moved it from. */
  const onRollback = (request: ClaudeUpdateApplyRequest) => {
    showResult(apply(request));
  };

  // The pane's own name stands before the first report lands: a reader who opens Updates while the
  // read is in flight is still looking at Updates. The clock line needs the report — the one press
  // does not, and with every read failing this branch would otherwise offer nothing at all until
  // the poller's own next minute.
  if (report === null) {
    return (
      <div className="space-y-6 md:space-y-8">
        <h3 className="text-lg font-medium text-foreground">
          {t('updates.title', { defaultValue: 'Claude updates' })}
        </h3>
        <div className="flex h-40 flex-col items-center justify-center gap-3">
          <Spinner label={t('updates.loading', { defaultValue: 'Reading the update report…' })} />
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            {t('updates.tryAgain', { defaultValue: 'Try again' })}
          </Button>
        </div>
        {/* The press's own answer: a read that fails here says so instead of spinning. */}
        {refusal !== null && <Banner tone="warn">{refusal}</Banner>}
      </div>
    );
  }

  const updatable = offeredPackages(report);
  const versions = updatable.map((pkg) => `${pkg.label} ${pkg.latest}`);
  // The four states the runner can be in: while it is, no second action may start.
  const jobActive = isUpdateJobActive(report.job);

  return (
    <div className="space-y-6 md:space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-medium text-foreground">
            {t('updates.title', { defaultValue: 'Claude updates' })}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {checkedLine(report.checkedAt, report.nextCheckAt, t)}
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={report.checking} onClick={onCheckNow}>
          {report.checking ? (
            <Spinner size={14} />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
          {t('updates.checkNow', { defaultValue: 'Check now' })}
        </Button>
      </header>

      {/* The last check's own failure: what could not be read, and what stands from before it. */}
      {report.checkError !== null && <Banner tone="warn">{report.checkError}</Banner>}

      <div className="space-y-4">
        {report.packages.map((pkg) => (
          <PackageUpdateCard
            key={pkg.key}
            pkg={pkg}
            staleCount={staleCount}
            job={report.job}
            jobActive={jobActive}
            onRollback={onRollback}
          />
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={updatable.length === 0 || jobActive} onClick={onUpdateAndRestart}>
            {jobActive
              ? t('updates.actions.updating', { defaultValue: 'Updating…' })
              : t('updates.actions.updateAndRestart', { defaultValue: 'Update and restart' })}
          </Button>
          {/* Only where this process can hand itself over: nowhere else is there a restart to offer. */}
          {report.supervised && (
            <Button variant="outline" disabled={jobActive} onClick={onRestartServer}>
              {t('updates.actions.restartServer', { defaultValue: 'Restart server' })}
            </Button>
          )}
        </div>

        {/* The offer's own line. With nothing on offer there is no move to explain — and the
            sentence under a disabled button would claim the rest move to a version that does not
            exist — so it stands only while a press would install something. */}
        {versions.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('updates.actions.installs', {
              versions: versions.join(' and '),
              defaultValue:
                'Installs {{versions}}, then restarts the server. A conversation mid-turn keeps its version until the turn ends; the rest move to the new version at their next message.',
            })}
          </p>
        )}

        {refusal !== null && <Banner tone="warn">{refusal}</Banner>}
      </div>

      {report.job !== null && <UpdateJobPanel job={report.job} />}
    </div>
  );
}
