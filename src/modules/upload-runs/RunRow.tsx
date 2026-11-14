import { HeartPulseIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { RunFriction } from '@/modules/upload-runs/utils/uploadsModel';
import { dayClockWord, durationWord, flowWord, jobWord, reasonWords, runLength, typeWord, verdictLook, whoWord } from '@/modules/upload-runs/utils/uploadsWords';
import type { UploadRunSummary } from '@/shared/upload-runs-types';
import { Badge, Chip } from '@/shared/ui';

type RunRowProps = {
  run: UploadRunSummary;
  /** The heal answer's rows for this run's Claude session; undefined when it filed none, or while the answer is not read. */
  friction: RunFriction | undefined;
  /** The clock a live run's length is counted to, epoch ms. */
  now: number;
  onOpenRun: (sessionId: string) => void;
};

/** How many reasons a row names before the rest are counted: the worst three, since the wire sends them worst first. */
const REASON_CHIPS = 3;

/**
 * ONE RUN AS A ROW. The whole row is the press that opens the run's sheet, at least 44 px tall; everything inside it is a
 * span, so nothing pressable is nested.
 *
 * The verdict leads, as a word with its tone and its icon, since "did it go well" is the question a list of runs is
 * scanned for. Then the job (customer and project number) with the date and clock at the row's end; under it the type and
 * flow, who pressed and how long it took; and last the marks: up to three reasons as chips, worst first, then "+N", the
 * agent's own friction from the heal answer (how many stumbles, and whether a heal took them or they stand open), and
 * "imported" on a run read back from disk.
 *
 * A TEST RUN IS DRAWN QUIET: its mark is the neutral "Test run" and its reasons are grey, so it can never be counted with
 * the real uploads by eye. A customer, a login, a flow and a reason's detail are data and reach the row as text.
 *
 * It draws ONE `<li>`; the caller owns the `<ul>`. Used by this module's `RunList` (the Runs section) and `UploadTypeList`
 * (the runs a type opens to).
 */
export function RunRow({ run, friction, now, onOpenRun }: RunRowProps) {
  const { t } = useTranslation();
  const r = 'cerberus.uploads.runs';
  const look = verdictLook(t, run);
  const length = runLength(run, now);
  const more = run.reasons.length - REASON_CHIPS;
  const job = jobWord(t, run);

  return (
    <li className="min-w-0" data-upload-run={run.session_id} data-upload-verdict={run.dry_run ? 'test' : run.verdict}>
      <button
        type="button"
        onClick={() => onOpenRun(run.session_id)}
        // One keyboard ring, the app's own outline, drawn INSIDE the row: the list clips what stands outside it, and a ring of this row's own beside the app's made two.
        className="flex min-h-11 w-full min-w-0 flex-col gap-1.5 px-3 py-2.5 text-left hover:bg-muted focus-visible:[outline-offset:-2px]"
        aria-label={t(`${r}.open`, { verdict: look.word, job, when: dayClockWord(run.started_at) })}
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Badge as="span" tone={look.tone} className="flex-none">
            <look.Icon className="mr-1 h-3 w-3" aria-hidden="true" />
            {look.word}
          </Badge>
          <span className="min-w-0 flex-1 basis-40 break-words text-sm font-medium leading-snug text-foreground">{job}</span>
          <span className="flex-none font-mono text-xs tabular-nums text-muted-foreground">{dayClockWord(run.started_at)}</span>
        </span>
        <span className="min-w-0 break-words text-xs leading-relaxed text-muted-foreground">
          {typeWord(t, run.upload_type)} · <span className="font-mono">{flowWord(t, run.archetype)}</span>
          {' · '}{whoWord(t, run.generated_by)}
          {' · '}<span className="tabular-nums">{length === null ? t(`${r}.noLength`) : durationWord(t, length)}</span>
        </span>
        {(run.reasons.length > 0 || friction !== undefined || run.imported) && (
          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
            {run.reasons.slice(0, REASON_CHIPS).map((reason) => (
              <Chip key={reason.code} size="sm" tone={run.dry_run ? 'neutral' : reason.tone}>{reasonWords(t, reason).chip}</Chip>
            ))}
            {more > 0 && <span className="text-xs text-muted-foreground">{t(`${r}.moreReasons`, { count: more })}</span>}
            {friction !== undefined && friction.rows > 0 && (
              <Badge as="span" tone={friction.open > 0 ? 'warn' : friction.healed > 0 ? 'positive' : 'neutral'} title={t(`${r}.frictionTitle`)}>
                <HeartPulseIcon className="mr-1 h-3 w-3" aria-hidden="true" />
                {friction.open > 0
                  ? t(`${r}.frictionOpen`, { count: friction.rows, open: friction.open })
                  : friction.healed > 0 ? t(`${r}.frictionHealed`, { count: friction.rows }) : t(`${r}.friction`, { count: friction.rows })}
              </Badge>
            )}
            {run.imported && <Badge as="span" tone="neutral" title={t(`${r}.importedTitle`)}>{t(`${r}.imported`)}</Badge>}
          </span>
        )}
      </button>
    </li>
  );
}
