import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { isUpdateJobActive, useClaudeUpdates } from '@/modules/claude-updates/hooks/useClaudeUpdates';
import { UPDATE_STEP_LABELS } from '@/modules/claude-updates/updateWording';

/**
 * The sidebar's own line for Claude: an offer when there is one, and the job that is taking it when
 * one is running. Both forms — the footer row and the collapsed rail's icon — read the same two
 * lines off the same hook, so the rail and the panel can never say different things.
 *
 * ABSENT IS THE DEFAULT. A package whose update this pipeline cannot install here is not an offer,
 * and a process with nothing on disk to move has nothing to announce; in either case both forms
 * render nothing at all rather than a row that opens a tab with nothing in it to press.
 *
 * WHILE A JOB RUNS the row says so — "Updating Claude…" with the step under it — because a sidebar
 * row that still says "Update available" while the update is happening is a row that invites a
 * second press.
 */

/** The two lines either form draws: what is on offer or running, and what it is. Null = draw nothing. */
function useUpdatesFooterLine(): { title: string; detail: string } | null {
  const { t } = useTranslation('settings');
  const { report } = useClaudeUpdates();

  if (report === null) return null;

  const job = report.job;
  if (isUpdateJobActive(job)) {
    const running = job.steps.find((step) => step.state === 'running') ?? null;
    const step = running === null ? null : UPDATE_STEP_LABELS[running.key];
    return {
      title: t('updates.footer.updating', { defaultValue: 'Updating Claude…' }),
      detail:
        step === null
          ? t('updates.footer.working', { defaultValue: 'Working…' })
          : t(step.key, { defaultValue: step.defaultValue }),
    };
  }

  const offered = report.packages.filter((pkg) => pkg.updateAvailable && pkg.updatable);
  const cli = offered.find((pkg) => pkg.key === 'cli');
  const sdk = offered.find((pkg) => pkg.key === 'sdk');
  const one = cli ?? sdk;
  if (one === undefined) return null;

  return {
    // "Claude Code 2.1.284 · SDK 0.3.284"; one package alone names itself and stops. The labels are
    // the server's own, so a row and the card under it never spell a package two ways.
    title:
      cli === undefined || sdk === undefined
        ? `${one.label} ${one.latest}`
        : `${cli.label} ${cli.latest} · ${t('updates.footer.sdkShort', { defaultValue: 'SDK' })} ${sdk.latest}`,
    detail: t('updates.footer.available', { defaultValue: 'Update available' }),
  };
}

/** The sidebar footer's row, above the app's own update row. Renders nothing when there is no offer. */
export function ClaudeUpdateFooterRow({ onOpen }: { onOpen: () => void }) {
  const line = useUpdatesFooterLine();
  if (line === null) return null;

  return (
    <>
      <div className="nav-divider" />

      {/* Desktop */}
      <div className="hidden px-2 py-1.5 md:block">
        <button
          className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-primary/10"
          onClick={onOpen}
        >
          <div className="relative flex-shrink-0">
            <Download className="h-4 w-4 text-primary" />
            <span aria-hidden className="vv-pulse absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <span className="block truncate text-sm font-normal text-accent-ink">{line.title}</span>
            <span className="text-[10px] text-muted-foreground">{line.detail}</span>
          </div>
        </button>
      </div>

      {/* Mobile */}
      <div className="px-3 py-2 md:hidden">
        <button
          className="flex h-11 w-full items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-3.5 transition-all active:scale-[0.98]"
          onClick={onOpen}
        >
          <div className="relative flex-shrink-0">
            <Download className="h-4 w-4 text-primary" />
            <span aria-hidden className="vv-pulse absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary" />
          </div>
          <div className="min-w-0 flex-1 text-left">
            <span className="block truncate text-sm font-normal text-accent-ink">{line.title}</span>
            <span className="text-xs text-muted-foreground">{line.detail}</span>
          </div>
        </button>
      </div>
    </>
  );
}

/** The same row as one icon in the collapsed rail, right after Settings. */
export function ClaudeUpdateRailButton({ onOpen }: { onOpen: () => void }) {
  const line = useUpdatesFooterLine();
  if (line === null) return null;

  // The rail hides both lines, so the whole sentence becomes the button's own name.
  const label = `${line.title} · ${line.detail}`;

  return (
    <button
      onClick={onOpen}
      className="group relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80"
      aria-label={label}
      title={label}
    >
      <Download className="h-4 w-4 text-primary" />
      <span aria-hidden className="vv-pulse absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
    </button>
  );
}
