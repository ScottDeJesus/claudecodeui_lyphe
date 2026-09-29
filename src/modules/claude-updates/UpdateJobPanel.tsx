import { AlertTriangle, Check, CircleDashed, Minus, ScrollText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { JOB_STATE_SENTENCES, UPDATE_STEP_LABELS } from '@/modules/claude-updates/updateWording';
import type { ClaudeUpdateJob, ClaudeUpdateStepState } from '@/shared/claude-update-types';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  FoldChevron,
  Spinner,
} from '@/shared/ui';
import { useCollapsible } from '@/shared/ui/Collapsible';

/**
 * The job as it stands: the four steps, what became of each, and the log the runner is writing.
 *
 * ONE SENTENCE FIRST, because "is it still going, and is anything wrong" is the question someone
 * opens this for — the steps below say where it got to, and the log says why when the answer is
 * bad. The log is folded: it is 40 lines of npm, read once and only on a failure.
 *
 * A step that would name a version the report does not carry draws no arrow rather than a guess.
 */


/** The sign one step wears: a ring while it runs, a check when it landed, a cross when it did not. */
function StepIcon({ state }: { state: ClaudeUpdateStepState }) {
  if (state === 'running') return <Spinner size={14} />;
  if (state === 'done') return <Check className="h-4 w-4 text-accent-ink" />;
  if (state === 'failed') return <AlertTriangle className="h-4 w-4 text-destructive" />;
  if (state === 'skipped') return <Minus className="h-4 w-4 text-muted-foreground" />;
  return <CircleDashed className="h-4 w-4 text-muted-foreground" />;
}

/** The fold's own sign, turned by the fold rather than by a second copy of its state. */
function LogChevron() {
  const { open } = useCollapsible();
  return <FoldChevron collapsed={!open} />;
}

export function UpdateJobPanel({ job }: { job: ClaudeUpdateJob }) {
  const { t } = useTranslation('settings');
  const sentence = JOB_STATE_SENTENCES[job.state];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {t(job.kind === 'rollback' ? 'updates.job.rollbackTitle' : 'updates.job.updateTitle', {
            defaultValue: job.kind === 'rollback' ? 'Rollback' : 'Update',
          })}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t(sentence.key, { defaultValue: sentence.defaultValue })}</p>
      </CardHeader>

      <CardContent className="space-y-3">
        <ol className="space-y-3">
          {job.steps.map((step) => {
            const label = UPDATE_STEP_LABELS[step.key];
            return (
              <li key={step.key} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center">
                  <StepIcon state={step.state} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium text-foreground">
                      {t(label.key, { defaultValue: label.defaultValue })}
                    </span>
                    {step.from !== null && step.to !== null && (
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {step.from} → {step.to}
                      </span>
                    )}
                  </div>
                  {step.detail !== null && (
                    <p className="mt-0.5 break-words text-xs text-muted-foreground">{step.detail}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {job.logTail.length > 0 && (
          <Collapsible className="rounded-lg border border-border/60">
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60">
              <span className="inline-flex items-center gap-1.5">
                <ScrollText className="h-3.5 w-3.5" />
                {t('updates.job.log', { defaultValue: 'Log' })}
              </span>
              <LogChevron />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="max-h-64 overflow-auto px-2.5 pb-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {job.logTail.join('\n')}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
