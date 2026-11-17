import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { agoWord, dayClockWord, durationWord, endingSentence, flowWord, jobWord, runLength, typeWord, verdictLook, whoWord } from '@/modules/upload-runs/utils/uploadsWords';
import type { UploadRunSummary, UploadRunWhole } from '@/shared/upload-runs-types';
import { Badge, Banner, Steps } from '@/shared/ui';

type RunSheetHeadProps = {
  /** The run: as the overview listed it until its own read answers, then as that read holds it. */
  run: UploadRunSummary;
  /** The run whole, once read: how far the upload got is counted from its walks and what came after. Null while the read is out. */
  whole: UploadRunWhole | null;
  now: number;
};

/**
 * THE SHEET'S HEAD: the run in one screen, before any section. It stands from the overview's row the moment the sheet
 * opens, so the reader has the verdict while the run's own read is still out.
 *
 * Top to bottom: the verdict as word, tone and icon beside the ending sentence (who stopped it, or what its exit said);
 * the facts (who pressed and when, the job, its type and flow, the model the run observed, how long it took); and, for an
 * upload that was real, how far it got: walked for real, confirmed by a person, pressed. That strip is counted from what
 * the run's read holds and nothing else: an armed walk, a confirmation that still stands, a confirmation the press fired on.
 *
 * TWO KINDS OF RUN SAY WHAT THEY ARE. A test run says nothing was uploaded and is never drawn clean or hiccup. An
 * imported run wears its "imported" mark beside the verdict; what that costs (the answers typed and the server's own
 * notes were never kept) is said once, in Inside the run, where a reader would look for them.
 *
 * Used by this module's `RunSheet`, as its first block.
 */
export function RunSheetHead({ run, whole, now }: RunSheetHeadProps) {
  const { t } = useTranslation();
  const s = 'cerberus.uploads.sheet';
  const look = verdictLook(t, run);
  const length = runLength(run, now);
  // How far a real upload got, as the count of steps done: an armed walk, a confirmation still standing, a press on one.
  const armed = whole?.walks.some((walk) => walk.armed) ?? false;
  const confirmed = whole?.after.some((entry) => entry.revoked_at === null || entry.consumed_at !== null) ?? false;
  const pressed = whole?.after.some((entry) => entry.consumed_at !== null) ?? false;
  const stage = pressed ? 3 : confirmed ? 2 : armed ? 1 : 0;
  // The step in hand is the one after the last done. A run that ended having walked nothing has none in hand: no step is lit.
  const inHand = stage === 0 && run.verdict !== 'live' ? -1 : stage;

  // Each fact is its label and its parts. A part is held whole, so a narrow sheet breaks a fact between parts ("· 16 d ago" on its own line) and never inside one.
  const facts: [string, string[], boolean?][] = [
    [t(`${s}.facts.pressed`), [whoWord(t, run.generated_by), dayClockWord(run.started_at), agoWord(t, run.started_at, now)]],
    [t(`${s}.facts.job`), [jobWord(t, run)]],
    [t(`${s}.facts.upload`), [typeWord(t, run.upload_type), flowWord(t, run.archetype)]],
    [t(`${s}.facts.model`), [run.model ?? t(`${s}.facts.modelNone`)], true],
    [t(`${s}.facts.took`), [length === null ? t(`${s}.facts.tookNone`) : run.verdict === 'live' ? t(`${s}.facts.tookSoFar`, { length: durationWord(t, length) }) : durationWord(t, length)]],
  ];

  return (
    <div className="flex min-w-0 flex-col gap-4" data-uploads-sheet-head data-upload-run={run.session_id}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <Badge as="span" tone={look.tone} className="flex-none">
          <look.Icon className="mr-1 h-3 w-3" aria-hidden="true" />
          {look.word}
        </Badge>
        <p className="m-0 min-w-0 break-words text-[15px] font-medium leading-snug text-foreground" data-uploads-ending>{endingSentence(t, run)}</p>
        {run.imported && <Badge as="span" tone="neutral" className="flex-none" title={t('cerberus.uploads.runs.importedTitle')}>{t('cerberus.uploads.runs.imported')}</Badge>}
      </div>

      <dl className="m-0 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
        {facts.map(([label, parts, mono]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className={mono ? 'm-0 min-w-0 break-words font-mono text-xs leading-[1.65] text-foreground' : 'm-0 min-w-0 break-words text-foreground'}>
              {parts.map((part, index) => (
                <Fragment key={part}>
                  {index > 0 && ' '}
                  {/* A lone part may break where it must (a long customer name); one of several stays whole. */}
                  <span className={parts.length > 1 ? 'inline-block max-w-full' : undefined}>{index < parts.length - 1 ? `${part} ·` : part}</span>
                </Fragment>
              ))}
            </dd>
          </div>
        ))}
      </dl>

      {run.dry_run && <Banner tone="neutral"><p className="text-[13px]">{t(`${s}.testNote`)}</p></Banner>}

      {!run.dry_run && whole !== null && (
        <div className="flex min-w-0 flex-col gap-2.5" data-uploads-stage={stage}>
          <p className="m-0 text-xs text-muted-foreground">{t(`${s}.stage.title`)}</p>
          <Steps steps={[t(`${s}.stage.walked`), t(`${s}.stage.confirmed`), t(`${s}.stage.pressed`)]} current={inHand} />
        </div>
      )}
    </div>
  );
}
