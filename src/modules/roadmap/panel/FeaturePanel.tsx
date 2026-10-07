import { useContext } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { caseMark } from '@/modules/roadmap/caseMark';
import { RoadmapFaceContext } from '@/modules/roadmap/faceContext';
import { useStepPhrase } from '@/modules/roadmap/hooks/useStepPhrase';
import { PanelDot, PanelHead } from '@/modules/roadmap/panel/PanelRows';
import { ROADMAP_FEATURE_WORD_KEYS } from '@/shared/constants';
import type { RoadmapEpic, RoadmapFeature, RoadmapMilestone } from '@/shared/roadmap-types';
import type { RoadmapDotState } from '@/shared/types';
import { Badge, Button } from '@/shared/ui';

type FeaturePanelProps = {
  feature: RoadmapFeature;
  /** The epic it stands in, named in the sub line; its blocked reason is the feature's when it has none of its own. */
  epic: RoadmapEpic;
  /** The milestone that epic stands in, whose reason is the last one a feature inherits. */
  milestone: RoadmapMilestone;
  /** That milestone's 1-based place on the roadmap, as the tree's eyebrow numbers it. */
  n: number;
  /** Its dot's state, the tree's own (`TreeLayout.dots`): the State fact wears it, and it alone says blocked. */
  dot: RoadmapDotState;
  /** The open panel's heading id (`TreePanel`'s): the panel's frame is named by it, and Open is described by it, so a screen reader says which feature it opens. */
  headingId: string;
};

/** One fact: its name in the muted ink, what it says beside it, over a top hairline. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="col-span-2 grid grid-cols-subgrid items-baseline border-t border-border py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}

/**
 * A feature's panel: its title, then "Feature · <epic> · Milestone n", and Open at the right, which leads into
 * its dialog, whose own menu and footer carry every write a feature takes (Answer among them). Under the head,
 * in amber, what it waits on the operator for and why it is blocked — the nearest reason, its own, its
 * epic's or its milestone's, said only while its dot is blocked, so a shipped feature never reads blocked —
 * because what he must act on comes first. Then its facts: its state (the tree's dot, its word and its step in
 * plain words; the step steps aside while a warn line above already says what it waits on), its tasks done,
 * its project and, once it keeps a case, the one phrase its cases say, as an amber badge once something
 * broke. Last, its goal in full, as the operator wrote it.
 *
 * Used by the roadmap module's panel, `panel/TreePanel`, for a feature's selection.
 */
export function FeaturePanel({ feature, epic, milestone, n, dot, headingId }: FeaturePanelProps) {
  const { t } = useTranslation();
  // The face's dialog opener, which Open opens the feature's dialog through.
  const { openDialog } = useContext(RoadmapFaceContext);
  const phrase = useStepPhrase(feature);

  const owed = feature.waiting_on_you;
  const blocked = dot === 'blocked' ? feature.blocked ?? epic.blocked ?? milestone.blocked : null;
  const word = t(ROADMAP_FEATURE_WORD_KEYS[feature.word]);
  const done = feature.tasks.filter((task) => task.status === 'done').length;
  // The cases' one phrase (`caseMark`'s): the key is the FULL locale key, `count` the number it is said with.
  const mark = caseMark(feature.cases);
  const casePhrase = mark === null ? null : t(mark.key, {
    count: mark.count,
    notRun: feature.cases.not_run,
    broken: t('roadmap.cases.broken', { count: feature.cases.broken }),
    regressed: t('roadmap.cases.regressed', { count: feature.cases.regressed }),
  });

  return (
    <>
      <PanelHead
        id={headingId}
        title={feature.title}
        sub={t('roadmap.panel.featureLine', { epic: epic.title, n })}
        action={(
          <Button
            variant="outline"
            size="sm"
            data-roadmap-panel-open
            aria-describedby={headingId}
            onClick={() => openDialog({ dialog: 'feature', name: feature.name })}
          >
            {t('roadmap.panel.open')}
          </Button>
        )}
      />

      {/* What needs the operator, first: each a warn sentence, a soft block that wraps rather than a pill. */}
      {(owed !== null || blocked !== null) && (
        <div className="flex min-w-0 flex-col items-start gap-1.5">
          {owed !== null && (
            <Badge tone="warn" className="max-w-full rounded-lg text-left leading-snug" data-roadmap-panel-waiting={owed}>
              {owed === 'accept' ? t('roadmap.feature.waitingAccept') : t('roadmap.feature.waitingQuestions')}
            </Badge>
          )}
          {blocked !== null && (
            <Badge tone="warn" className="max-w-full rounded-lg text-left leading-snug" data-roadmap-panel-blocked>
              <span className="break-words">{t('roadmap.blocked', { why: blocked })}</span>
            </Badge>
          )}
        </div>
      )}

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 text-sm">
        <Fact label={t('roadmap.panel.state')}>
          <span className="inline-flex max-w-full items-baseline gap-2">
            <span className="flex h-5 shrink-0 items-center self-start"><PanelDot state={dot} /></span>
            <span className="min-w-0">{owed === null ? t('roadmap.stateLine', { word, phrase }) : word}</span>
          </span>
        </Fact>
        <Fact label={t('roadmap.panel.tasks')}>
          <span className="tabular-nums">
            {feature.tasks.length === 0 ? t('roadmap.panel.noTasks') : t('roadmap.panel.tasksDone', { done, count: feature.tasks.length })}
          </span>
        </Fact>
        <Fact label={t('roadmap.panel.project')}>{feature.project}</Fact>
        {mark !== null && (
          <Fact label={t('roadmap.cases.heading')}>
            {mark.tone === 'warn' ? <Badge tone="warn" data-roadmap-cases={mark.key}>{casePhrase}</Badge> : <span data-roadmap-cases={mark.key}>{casePhrase}</span>}
          </Fact>
        )}
      </dl>

      {feature.goal ? (
        <p className="whitespace-pre-wrap break-words border-t border-border pt-2.5 text-sm leading-relaxed text-foreground">{feature.goal}</p>
      ) : (
        <p className="border-t border-border pt-2.5 text-sm italic text-muted-foreground">{t('roadmap.panel.noGoal')}</p>
      )}
    </>
  );
}
