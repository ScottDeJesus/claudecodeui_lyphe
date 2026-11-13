import { CircleCheckIcon, FlaskConicalIcon, InfoIcon, OctagonAlertIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { reasonWords } from '@/modules/upload-runs/utils/uploadsWords';
import type { UploadRunSummary } from '@/shared/upload-runs-types';

/** A reason's icon by its tone: three shapes, so how bad it is reads without colour. */
const REASON_ICON = { danger: OctagonAlertIcon, warn: TriangleAlertIcon, neutral: InfoIcon };

/**
 * SPEED BUMPS: every reason that stands against the run, worst first, each as a whole sentence with its count or its
 * detail. The icon's shape says how bad (an octagon for what broke the run, a triangle for what slowed it, a circle for
 * what is only noted), so the tone is never the only sign. With none, the one line says it ran clean.
 *
 * A TEST RUN IS NEVER DRAWN CLEAN, here as on its row. With no reason it says nothing stood against it, in grey under the
 * test mark, and never "it ran clean" in green: the banner above it says a test is not counted clean or hiccup, and this
 * line must not answer back. Its reasons keep their shapes and lose their colours, as its row greys them.
 *
 * Used by this module's `RunSheet`, as its first section.
 */
export function RunBumps({ run }: { run: UploadRunSummary }) {
  const { t } = useTranslation();
  const b = 'cerberus.uploads.sheet.bumps';
  if (run.reasons.length === 0) {
    const live = run.verdict === 'live';
    const Icon = run.dry_run ? FlaskConicalIcon : CircleCheckIcon;
    return (
      <p className="m-0 flex items-center gap-2 text-[13.5px] text-foreground" data-tone={run.dry_run ? 'neutral' : 'positive'} data-uploads-bumps={run.dry_run ? 'test' : 'clean'}>
        <Icon className="h-4 w-4 flex-none text-tone-ink" aria-hidden="true" />
        {t(live ? `${b}.noneYet` : run.dry_run ? `${b}.noneTest` : `${b}.none`)}
      </p>
    );
  }
  return (
    <ul className="m-0 flex min-w-0 list-none flex-col gap-2 p-0" data-uploads-bumps={run.reasons.length}>
      {run.reasons.map((reason) => {
        const Icon = REASON_ICON[reason.tone] ?? InfoIcon;
        return (
          <li key={reason.code} data-tone={run.dry_run ? 'neutral' : reason.tone} data-upload-reason={reason.code} className="flex min-w-0 items-start gap-2.5 text-[13.5px] leading-snug text-foreground">
            <Icon className="mt-0.5 h-4 w-4 flex-none text-tone-ink" aria-hidden="true" />
            <span className="min-w-0 break-words">{reasonWords(t, reason).sentence}</span>
          </li>
        );
      })}
    </ul>
  );
}
