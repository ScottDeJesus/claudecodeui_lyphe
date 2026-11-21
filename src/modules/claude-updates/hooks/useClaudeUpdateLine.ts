import { useTranslation } from 'react-i18next';

import { isUpdateJobActive, useClaudeUpdates } from '@/modules/claude-updates/hooks/useClaudeUpdates';
import { UPDATE_STEP_LABELS } from '@/modules/claude-updates/updateWording';

/**
 * Claude's update in two lines, or null while there is nothing to say: what is on offer or being installed (`title`), what it is
 * (`detail`), and whether a job is installing it now (`working`). Read off the module's one shared report, so a second reader adds no
 * poll.
 *
 * ABSENT IS THE DEFAULT. A package whose update this pipeline cannot install here is not an offer, and a process with nothing on disk to
 * move has nothing to announce.
 *
 * Read by this module's `ClaudeUpdateFooterRow` (the sidebar's row) and, through the barrel, by project-workspace's `PlacesProvider`,
 * which marks Settings in the wheel of places while an offer stands.
 */
export function useClaudeUpdateLine(): { title: string; detail: string; working: boolean } | null {
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
      working: true,
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
    working: false,
  };
}
