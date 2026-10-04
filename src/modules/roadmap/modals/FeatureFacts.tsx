import { Check, Hourglass, PenLine } from 'lucide-react';
import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useStepPhrase } from '@/modules/roadmap/hooks/useStepPhrase';
import { StateLine } from '@/modules/roadmap/StateLine';
import { ROADMAP_FEATURE_WORD_KEYS } from '@/shared/constants';
import type { RoadmapFeature, RoadmapPicture, RoadmapTask } from '@/shared/roadmap-types';
import { Meter, Shimmer } from '@/shared/ui';
import { cn, formatShortDate, roadmapFeatureIndex } from '@/shared/utils';

/** A task's status in words, for a screen reader: the mark beside it is drawn, never read. */
const TASK_STATUS_KEYS: Record<RoadmapTask['status'], string> = {
  done: 'roadmap.dialog.feature.task.done',
  running: 'roadmap.dialog.feature.task.running',
  'not started': 'roadmap.dialog.feature.task.notStarted',
};

/** The feature's dates in the order they happen, each with its words; one it has not reached is left out. */
const DATE_KEYS = [
  ['created_at', 'roadmap.dates.created'],
  ['promoted_at', 'roadmap.dates.promoted'],
  ['approved_at', 'roadmap.dates.approved'],
  ['shipped_at', 'roadmap.dates.shipped'],
] as const;

/** A section's small heading: the module's eyebrow, in the muted ink that reads at AA. */
const EYEBROW = 'text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground';

type FeatureFactsProps = {
  feature: RoadmapFeature;
  /** The picture the waits are named from: a wait on a feature of another roadmap still has its title and word. */
  picture: RoadmapPicture | null;
  /** The goal's empty place, pressed: `FeatureDialog` opens the goal for writing. */
  onWriteGoal: () => void;
  /** The Cases section's body (`FeatureCases`), drawn under its heading; null for a feature that keeps no case. */
  cases: ReactNode;
};

/** One section of the facts: a small heading over what it holds. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2.5">
      <h3 className={EYEBROW}>{title}</h3>
      {children}
    </section>
  );
}

/**
 * A task's mark: a check once done, an accent dot that breathes while it runs, a hollow ring before it
 * starts, in the faint ink that still reads as a mark (over 3:1 in both themes).
 */
function TaskMark({ status }: { status: RoadmapTask['status'] }) {
  if (status === 'done') return <Check aria-hidden="true" className="size-3.5 text-primary" strokeWidth={3} />;
  if (status === 'running') return <span aria-hidden="true" className="size-2.5 rounded-full bg-primary motion-safe:animate-live-ring" />;
  return <span aria-hidden="true" className="size-2.5 rounded-full border-[1.5px] border-ink-faint" />;
}

/**
 * Everything a feature says about itself, top to bottom: where it stands on its own path (the step line
 * at `large`, its step in words, and what it waits on, each wait with its word); its goal, pre-wrapped
 * and scrolling past 40vh; its cases, each the goal's claim checked, so they sit right under it and above
 * the tasks, which are history once it ships; its tasks under a meter of how many are done; the days it was added,
 * promoted, accepted and shipped; and, small and muted, its name for Claude — the one place on the
 * screen a slug is shown, selected whole on a press so it can be handed to a chat as it is.
 *
 * A feature with no goal shows "Write its goal to propose or promote it" in the goal's place while it is
 * an idea, as a press that opens the goal; a designed feature's goal is its design's, so it has none to
 * invite. The step phrase steps aside where something else already says it: for a feature that waits on
 * the operator, the warn banner above (`FeatureDialog`'s own); for one waiting on other features, the
 * waits under it. Each wait carries its word, so a met one reads as met; a wait the picture cannot name
 * reads "another feature", never its slug.
 *
 * Used by the roadmap module's `FeatureDialog`, as its scrolling body.
 */
export function FeatureFacts({ feature, picture, onWriteGoal, cases }: FeatureFactsProps) {
  const { t } = useTranslation();
  const phrase = useStepPhrase(feature);
  const index = picture === null ? null : roadmapFeatureIndex(picture);

  const total = feature.tasks.length;
  const done = feature.tasks.filter((task) => task.status === 'done').length;
  const unpromoted = feature.word === 'idea' || feature.word === 'proposed';
  const phrased = feature.waiting_on_you === null && !(feature.step === 'waiting' && feature.waits_on.length > 0);
  const dates = DATE_KEYS.flatMap(([field, key]) => {
    const day = formatShortDate(feature[field]);
    return day === null ? [] : [t(key, { date: day })];
  });

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Where it stands, and what that stands on: each wait says "Waits on" itself, so the list needs no heading. */}
      <div className="flex min-w-0 flex-col gap-2.5">
        <StateLine word={feature.word} step={feature.step} phrase={phrase} size="large" />
        {phrased && (
          <p className="text-sm text-muted-foreground">{feature.step === 'building' ? <Shimmer>{phrase}</Shimmer> : phrase}</p>
        )}
        {feature.waits_on.length > 0 && (
          <ul data-roadmap-waits className="flex flex-col gap-1.5">
            {feature.waits_on.map((name) => {
              const known = index?.get(name);
              const met = known?.word === 'shipped';
              return (
                <li key={name} className="flex min-w-0 items-start gap-2 text-sm">
                  <span className="flex h-5 shrink-0 items-center">
                    {met
                      ? <Check aria-hidden="true" className="size-3.5 text-primary" strokeWidth={3} />
                      : <Hourglass aria-hidden="true" className="size-3.5 text-muted-foreground" />}
                  </span>
                  <span className={cn('min-w-0 break-words', met ? 'text-muted-foreground' : 'text-foreground')}>
                    {known
                      ? t('roadmap.dialog.feature.waitsOn', { title: known.title, word: t(ROADMAP_FEATURE_WORD_KEYS[known.word]) })
                      : t('roadmap.dialog.feature.waitsOnAnother')}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {feature.goal ? (
        <Section title={t('roadmap.dialog.feature.goal')}>
          {/* Its own scroller past 40vh, focusable so the keyboard can scroll a long goal too. */}
          <div
            role="region"
            tabIndex={0}
            aria-label={t('roadmap.dialog.feature.goal')}
            className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words text-[15px] leading-relaxed text-foreground"
          >
            {feature.goal}
          </div>
        </Section>
      ) : unpromoted && (
        <button
          type="button"
          onClick={onWriteGoal}
          data-roadmap-no-goal
          className="vv-empty flex w-full items-center justify-center gap-2 px-4 py-5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <PenLine aria-hidden="true" className="size-4 shrink-0" />
          {t('roadmap.dialog.feature.noGoal')}
        </button>
      )}

      {cases ? <Section title={t('roadmap.cases.heading')}>{cases}</Section> : null}

      {total > 0 && (
        <Section title={t('roadmap.dialog.feature.tasks')}>
          <Meter
            percent={Math.round((done / total) * 100)}
            label={t('roadmap.feature.done')}
            value={t('roadmap.feature.tasks', { done, count: total })}
          />
          <ol className="flex flex-col gap-1.5">
            {feature.tasks.map((task) => (
              <li key={task.key} data-roadmap-task={task.status} className="flex min-w-0 items-start gap-2.5 text-sm">
                <span className="flex h-5 w-3.5 shrink-0 items-center justify-center">
                  <TaskMark status={task.status} />
                </span>
                <span className={cn('min-w-0 break-words', task.status === 'running' ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                  {task.title}
                </span>
                <span className="sr-only">{t(TASK_STATUS_KEYS[task.status])}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      <div className="flex min-w-0 flex-col gap-1.5 border-t border-border pt-4 text-xs text-muted-foreground">
        {dates.length > 0 && <p className="tabular-nums">{dates.join(' · ')}</p>}
        <p className="break-all">
          <Trans
            i18nKey="roadmap.dialog.feature.nameForClaude"
            values={{ name: feature.name }}
            components={{ name: <code className="select-all font-mono" /> }}
          />
        </p>
      </div>
    </div>
  );
}
