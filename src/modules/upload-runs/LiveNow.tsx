import { useTranslation } from 'react-i18next';

import type { LiveStep } from '@/modules/upload-runs/utils/uploadsModel';
import { clockWord, durationWord, flowWord, jobWord, typeWord, whoWord } from '@/modules/upload-runs/utils/uploadsWords';
import type { UploadRunSummary } from '@/shared/upload-runs-types';
import { Badge, Button, Card, CardContent, Shimmer } from '@/shared/ui';

type LiveNowProps = {
  /** The run the registry holds as live. */
  run: UploadRunSummary;
  /** What it is doing right now, from its own stream; null until the stream has said anything. */
  step: LiveStep | null;
  /** The clock its elapsed time is counted to, epoch ms. */
  now: number;
  onOpenRun: (sessionId: string) => void;
};

/**
 * LIVE NOW: the one run going, drawn only while there is one. The registry lets one upload run at a time, so this is a
 * single card and never a list.
 *
 * Read left to right, top to bottom: the mark (Live now, with a dot that breathes) and what it is doing in one word,
 * Working or Waiting on a person, with the time it has been going; then the job, its type and flow, and who pressed and
 * when; then its newest step in its own words (the newest tool call, or what the agent last said), the step its walk
 * stands at once the walk has said one, and the turns and tool calls so far. Open raises the run's sheet, which follows it.
 *
 * WAITING IS THE STATE TO NOTICE: a run waiting on a person does nothing until somebody answers on the Uploads page, so
 * the card turns from the info tone to the warn tone and says so in words. Cerberus only watches: there is no answer box
 * and no Stop here.
 *
 * The agent's words and a tool's summary are the vendor's own text and reach the page as text, never as markup.
 *
 * Used by this module's root, `UploadsView`, between the pills and the body.
 */
export function LiveNow({ run, step, now, onOpenRun }: LiveNowProps) {
  const { t } = useTranslation();
  const l = 'cerberus.uploads.live';
  const waiting = step === null ? run.state === 'awaiting_input' : !step.working;
  const elapsed = durationWord(t, now - Date.parse(run.started_at));
  const turns = step?.turns ?? run.counts.turns;
  const toolCalls = step?.toolCalls ?? run.counts.tool_calls;

  return (
    <section id="uploads-live" aria-label={t(`${l}.title`)} className="scroll-mt-4" data-uploads-live={waiting ? 'waiting' : 'working'}>
      <Card className="w-full min-w-0" data-tone={waiting ? 'warn' : 'info'}>
        <CardContent className="flex min-w-0 flex-col gap-3 p-4">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <Badge as="span" tone={waiting ? 'warn' : 'info'}>
              <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-tone-dot motion-safe:animate-pulse" aria-hidden="true" />
              {t(`${l}.title`)}
            </Badge>
            {/* The state in a word, never the dot alone: a working run shimmers, a waiting one stands still in the warn ink. */}
            {waiting
              ? <span className="text-sm font-medium text-tone-ink">{t(`${l}.waiting`)}</span>
              : <Shimmer className="text-sm font-medium">{t(`${l}.working`)}</Shimmer>}
            <span className="font-mono text-xs tabular-nums text-muted-foreground" title={t(`${l}.elapsedTitle`)}>{elapsed}</span>
            <Button variant="outline" size="sm" className="ml-auto h-8 flex-none max-md:h-11" onClick={() => onOpenRun(run.session_id)} data-uploads-live-open>
              {t(`${l}.open`)}
            </Button>
          </div>

          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="min-w-0 break-words text-base font-medium leading-snug text-foreground">{jobWord(t, run)}</p>
            <p className="min-w-0 break-words text-[13px] text-muted-foreground">
              {typeWord(t, run.upload_type)} · <span className="font-mono text-xs">{flowWord(t, run.archetype)}</span>
              {' · '}
              {t(`${l}.pressed`, { who: whoWord(t, run.generated_by), at: clockWord(run.started_at) })}
            </p>
          </div>

          <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
            <dt className="text-muted-foreground">{t(`${l}.newest`)}</dt>
            <dd className="m-0 line-clamp-2 min-w-0 break-words font-mono text-xs leading-relaxed text-foreground">{step?.words ?? t(`${l}.newestNone`)}</dd>
            {step?.walkStep != null && (
              <>
                <dt className="text-muted-foreground">{t(`${l}.walk`)}</dt>
                <dd className="m-0 min-w-0 break-words font-mono text-xs leading-relaxed text-foreground">{step.walkStep}</dd>
              </>
            )}
            <dt className="text-muted-foreground">{t(`${l}.soFar`)}</dt>
            <dd className="m-0 tabular-nums text-foreground">{t(`${l}.turns`, { count: turns })} · {t(`${l}.toolCalls`, { count: toolCalls })}</dd>
          </dl>
        </CardContent>
      </Card>
    </section>
  );
}
