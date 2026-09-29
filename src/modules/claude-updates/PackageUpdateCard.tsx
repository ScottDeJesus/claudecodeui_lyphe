import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type {
  ClaudeUpdateApplyRequest,
  ClaudeUpdateJob,
  ClaudeUpdatePackage,
} from '@/shared/claude-update-types';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/shared/ui';
import { PatchNotes } from '@/modules/claude-updates/PatchNotes';

/**
 * One package: where it stands, why, what can be done about it, and what changed.
 *
 * THE VERSION IS NEVER ORDERED HERE. `updateAvailable` is the server's reading of `installed` against
 * `latest`, taken with the CLI's own ordering, and this card only draws it — a client that compared
 * version strings itself would eventually disagree with the pipeline that has to do the work.
 *
 * "Available" means the pipeline can act on it: an update that exists but cannot be installed here
 * (`updatable` false, with the `reason` underneath) is drawn as the plain pair, not as an offer.
 *
 * THE ONE BUTTON IS A ROLL BACK, and it stands only when the last job FINISHED an update that moved
 * this package: `kind` is `update` and the job is `done`, so nothing is half-applied, and this
 * package's own step reached `done`. It rolls back to the version that step started from, and it
 * sends that one package alone — either can go back without the other.
 */
export function PackageUpdateCard({
  pkg,
  staleCount,
  job,
  jobActive,
  onRollback,
}: {
  pkg: ClaudeUpdatePackage;
  /** Conversations still mid-turn on an older Claude Code; the CLI's line below. 0 hides it. */
  staleCount: number;
  /** The report's current (or last) job — where a finished update leaves its roll-back offer. */
  job: ClaudeUpdateJob | null;
  /** A job is being carried out: a second one may not be started. */
  jobActive: boolean;
  onRollback: (request: ClaudeUpdateApplyRequest) => void;
}) {
  const { t } = useTranslation('settings');
  const canUpdate = pkg.updateAvailable && pkg.updatable;
  const ownStep = job?.steps.find((step) => step.key === pkg.key) ?? null;
  const rollbackFrom =
    job !== null && job.kind === 'update' && job.state === 'done' && ownStep?.state === 'done'
      ? ownStep.from
      : null;
  const loadedBehind = pkg.loaded !== null && pkg.installed !== null && pkg.loaded !== pkg.installed;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{pkg.label}</CardTitle>

        {/* Where it stands: an offer the pipeline can take, a pair it cannot, or level. */}
        {canUpdate ? (
          <p className="text-sm text-warn-ink">
            {t('updates.card.available', {
              installed: pkg.installed,
              latest: pkg.latest,
              defaultValue: '{{installed}} → {{latest}} available',
            })}
          </p>
        ) : pkg.updateAvailable ? (
          <p className="text-sm text-foreground">
            {t('updates.card.behind', {
              installed: pkg.installed,
              latest: pkg.latest,
              defaultValue: '{{installed}} → {{latest}}',
            })}
          </p>
        ) : pkg.installed !== null ? (
          <p className="text-sm text-accent-ink">
            {t('updates.card.upToDate', {
              version: pkg.installed,
              defaultValue: 'Up to date · {{version}}',
            })}
          </p>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-2">
        {/* Why a version is unknown, or why this package cannot be moved from here. */}
        {pkg.reason !== null && <p className="text-xs text-muted-foreground">{pkg.reason}</p>}

        {/* The SDK this process actually imported at boot: a restart is what changes it. */}
        {pkg.key === 'sdk' && loadedBehind && (
          <p className="text-xs text-muted-foreground">
            {t('updates.card.loaded', {
              loaded: pkg.loaded,
              installed: pkg.installed,
              defaultValue:
                'This server is running {{loaded}}; it loads {{installed}} at its next restart',
            })}
          </p>
        )}

        {/* The CLI: a conversation mid-turn keeps the build it started on until the turn ends. */}
        {pkg.key === 'cli' && staleCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('updates.card.midTurn', {
              count: staleCount,
              version: pkg.installed,
              defaultValue_one:
                '{{count}} conversation mid-turn on an older Claude Code moves to {{version}} when its turn ends',
              defaultValue_other:
                '{{count}} conversations mid-turn on an older Claude Code move to {{version}} when their turn ends',
            })}
          </p>
        )}

        {rollbackFrom !== null && (
          <Button
            variant="outline"
            size="sm"
            disabled={jobActive}
            onClick={() => onRollback({ targets: { [pkg.key]: rollbackFrom } })}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            {t('updates.card.rollBack', {
              version: rollbackFrom,
              defaultValue: 'Roll back to {{version}}',
            })}
          </Button>
        )}

        <PatchNotes notes={pkg.notes} notesReason={pkg.notesReason} changelogUrl={pkg.changelogUrl} />
      </CardContent>
    </Card>
  );
}
