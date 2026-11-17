import { useTranslation } from 'react-i18next';

import { dayClockWord } from '@/modules/upload-runs/utils/uploadsWords';
import type { Tone } from '@/shared/types';
import type { UploadWalk } from '@/shared/upload-runs-types';
import { Badge, Card, CardContent, Chip } from '@/shared/ui';

type RunWalksProps = {
  /** The walks that carry this run's invocation, in the order the read gives them. */
  walks: UploadWalk[];
  /** The run is live: a walk still in flight is drawn as in progress. */
  live: boolean;
  /** The step the live run's walk stands at, once a walk frame has said one; null otherwise. */
  walkStep: string | null;
};

/** The outcome the engine writes while a walk is in flight. */
const IN_FLIGHT = 'intent';

/**
 * A step's tone, read off its status, which is the walker's own word and an open set: a refused or blocked step is the
 * warn tone, a failed or unreadable one the danger tone, and every other status is drawn plain. Plain is not "clean": only
 * the engine says whether a walk went smoothly (`bumpy`), and this never re-derives it.
 */
function stepTone(status: string): Tone | undefined {
  if (status.startsWith('refused') || status.startsWith('blocked')) return 'warn';
  if (status === 'failed' || status === 'error' || status === 'unreadable') return 'danger';
  return undefined;
}

/**
 * THE FLOW IT WALKED: each walk of a flow the run made, one card a walk.
 *
 * A CARD, top to bottom: the flow's own name (and its variant), whether it was a preview or made for real, how it ended
 * in the engine's word, and the engine's own answer to "did it go smoothly": Bumpy, Smooth, or Not scored for a walk the
 * engine never scored (which is "not known", never "clean"). A walk still in flight says In progress and names the step it
 * stands at. Then its steps in order, each a chip of its name and status; and under them every step that was refused,
 * blocked, failed or unreadable, named again with the walker's own reason, since those are what a person has to read.
 *
 * Flows, steps, statuses, outcomes and reasons are the flow's own words and are drawn as data.
 *
 * Used by this module's `RunSheet`, as its third section.
 */
export function RunWalks({ walks, live, walkStep }: RunWalksProps) {
  const { t } = useTranslation();
  const w = 'cerberus.uploads.sheet.walks';

  if (walks.length === 0) {
    return <p className="m-0 rounded-lg border border-dashed border-input px-4 py-3.5 text-[13px] text-muted-foreground" data-uploads-walks="0">{t(live ? `${w}.noneYet` : `${w}.none`)}</p>;
  }

  return (
    <ul className="m-0 flex min-w-0 list-none flex-col gap-3 p-0" data-uploads-walks={walks.length}>
      {walks.map((walk) => {
        const inFlight = live && walk.outcome === IN_FLIGHT;
        const standing = inFlight ? walkStep ?? walk.steps[walk.steps.length - 1]?.step ?? null : null;
        const named = walk.steps.filter((step) => stepTone(step.status) !== undefined);
        return (
          <li key={walk.id} className="min-w-0">
            <Card className="w-full min-w-0" data-upload-walk={walk.id} data-upload-walk-armed={walk.armed}>
              <CardContent className="flex min-w-0 flex-col gap-3 p-3.5">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 break-words font-mono text-sm text-foreground">{walk.variant === null ? walk.archetype : `${walk.archetype} · ${walk.variant}`}</span>
                  <Badge as="span" tone={walk.armed ? 'info' : 'neutral'}>{t(walk.armed ? `${w}.armed` : `${w}.preview`)}</Badge>
                  {inFlight ? (
                    <Badge as="span" tone="info">{standing === null ? t(`${w}.inProgress`) : t(`${w}.inProgressAt`, { step: standing })}</Badge>
                  ) : (
                    <>
                      <span className="font-mono text-xs text-muted-foreground" title={t(`${w}.outcomeTitle`)}>{walk.outcome}</span>
                      <Badge as="span" tone={walk.bumpy === null ? 'neutral' : walk.bumpy ? 'warn' : 'positive'}>
                        {t(walk.bumpy === null ? `${w}.notScored` : walk.bumpy ? `${w}.bumpy` : `${w}.smooth`)}
                      </Badge>
                    </>
                  )}
                  <span className="ml-auto flex-none font-mono text-xs tabular-nums text-muted-foreground">{dayClockWord(walk.updated_at)}</span>
                </div>

                {walk.steps.length === 0 ? (
                  <p className="m-0 text-xs text-muted-foreground">{t(`${w}.noSteps`)}</p>
                ) : (
                  <ol className="m-0 flex min-w-0 list-none flex-wrap gap-1.5 p-0" aria-label={t(`${w}.steps`, { count: walk.steps.length })}>
                    {walk.steps.map((step, index) => (
                      <li key={`${index}:${step.step ?? ''}`} className="min-w-0">
                        <Chip size="sm" tone={stepTone(step.status)} className="max-w-full">
                          <span className="min-w-0 truncate font-mono">{step.step ?? t(`${w}.unreadableStep`)}</span>
                          <span className="flex-none text-muted-foreground">{step.status}</span>
                        </Chip>
                      </li>
                    ))}
                  </ol>
                )}

                {named.length > 0 && (
                  <ul className="m-0 flex min-w-0 list-none flex-col gap-2 border-t border-border p-0 pt-3" data-upload-walk-named={named.length}>
                    {named.map((step, index) => (
                      <li key={`${index}:${step.step ?? ''}`} data-tone={stepTone(step.status)} className="flex min-w-0 flex-col gap-0.5 text-[13px] leading-snug">
                        <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                          <span className="h-1.5 w-1.5 flex-none rounded-full bg-tone-dot" aria-hidden="true" />
                          <span className="min-w-0 break-words font-mono text-xs text-foreground">{step.step ?? t(`${w}.unreadableStep`)}</span>
                          <span className="font-mono text-xs font-medium text-tone-ink">{step.status}</span>
                        </span>
                        <span className="min-w-0 break-words pl-3.5 text-muted-foreground">{step.reason ?? t(`${w}.noReason`)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {walk.cleared_at !== null && <p className="m-0 text-xs text-muted-foreground">{t(`${w}.cleared`, { when: dayClockWord(walk.cleared_at) })}</p>}
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
