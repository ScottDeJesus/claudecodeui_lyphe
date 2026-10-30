import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { dotStateOf, PanelDot, useStepPhrase } from '@/modules/roadmap';
import { RailEyebrow, RailFold, RailRow } from '@/modules/station/RailRow';
import { ROADMAP_EPIC_WORD_KEYS } from '@/shared/constants';
import type { Roadmap, RoadmapEpic, RoadmapEpicWord, RoadmapFeature, RoadmapMilestone } from '@/shared/roadmap-types';
import type { StationFocus } from '@/shared/station-types';
import type { RoadmapDotState, StationTier } from '@/shared/types';
import { Spinner, Tooltip } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** The epics that stand open on the rail, each with its features under it; every other epic (complete, empty) folds. */
const OPEN_WORDS: ReadonlySet<RoadmapEpicWord> = new Set<RoadmapEpicWord>(['not started', 'in progress']);

/** How a line's parts are joined, as the roadmap's own lines join theirs. */
const JOIN = ' · ';

/** One epic of the roadmap with the milestone it stands under (whose blocked reason its features' dots inherit). */
type PlacedEpic = { epic: RoadmapEpic; milestone: RoadmapMilestone };

/** The card a press puts on the stage: a feature or an epic, by its name, called by its title. */
const cardOf = (name: string, title: string): StationFocus => ({ kind: 'card', plan: name, label: title });

type FeatureRowProps = {
  feature: RoadmapFeature;
  dot: RoadmapDotState;
  tier: StationTier;
  current: boolean;
  onPress: (focus: StationFocus) => void;
};

/**
 * One feature's row: the tree's dot, its title, and its step in the roadmap's own words (`useStepPhrase`, which reads the live
 * picture, so each row is a component of its own), " · Blocked" after it while its dot is blocked so that red is never the whole
 * signal (the tree's tip says it so). A feature that waits on him has its phrase in the warn ink, and the phrase says "waiting on
 * you" itself. The phrase is cut to one line: it stands whole on the card the press opens, and the `Tooltip` repeats it for a
 * pointer and a keyboard (it is not drawn where nothing hovers, so a tap leaves none standing over the stage).
 */
function FeatureRow({ feature, dot, tier, current, onPress }: FeatureRowProps) {
  const { t } = useTranslation();
  const phrase = useStepPhrase(feature);
  const said = dot === 'blocked' ? [phrase, t('roadmap.tree.blocked')].join(JOIN) : phrase;
  return (
    <li className="flex min-w-0 flex-col">
      <Tooltip
        content={said}
        position={tier === 'narrow' ? 'top' : 'right'}
        showOnFocus
        className="max-w-[min(28rem,calc(100vw-2rem))] whitespace-normal [overflow-wrap:anywhere] [@media(hover:none)]:hidden"
      >
        <RailRow kind="feature" name={feature.name} current={current} onPress={() => onPress(cardOf(feature.name, feature.title))}>
          {/* The dot sits on the title's first line: h-5 is the title's own line height. */}
          <span className="flex h-5 shrink-0 items-center"><PanelDot state={dot} /></span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="line-clamp-2 break-words text-sm leading-5">{feature.title}</span>
            <span
              data-station-feature-phrase=""
              className={cn('truncate text-xs', feature.waiting_on_you !== null ? 'text-warn-ink' : 'text-muted-foreground')}
            >
              {said}
            </span>
          </span>
        </RailRow>
      </Tooltip>
    </li>
  );
}

type EpicRowProps = {
  placed: PlacedEpic;
  tier: StationTier;
  focus: StationFocus | null;
  onPress: (focus: StationFocus) => void;
  /** Whether its features stand under it: an open epic's do; a folded (complete or empty) epic is its row alone. */
  withFeatures: boolean;
};

/**
 * One epic's row: its title over its word and "<shipped> of <features> shipped" (the word alone while it holds no feature, and
 * " · Blocked" while it carries its own blocked reason: the tree's line, spelled by the roadmap's keys). An open epic's features
 * stand under it on a guide rule, each a row of its own, in the epic's own order.
 */
function EpicRow({ placed: { epic, milestone }, tier, focus, onPress, withFeatures }: EpicRowProps) {
  const { t } = useTranslation();
  const word = t(ROADMAP_EPIC_WORD_KEYS[epic.word]);
  const { features, shipped } = epic.standing;
  const standing = features === 0 ? word : t('roadmap.tree.epicLine', { word, shipped, count: features });
  const line = epic.blocked === null ? standing : [standing, t('roadmap.tree.blocked')].join(JOIN);
  const onStage = focus?.kind === 'card' ? focus.plan : null;
  return (
    <li className="flex min-w-0 flex-col">
      <RailRow kind="epic" name={epic.name} current={epic.name === onStage} onPress={() => onPress(cardOf(epic.name, epic.title))}>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 break-words text-sm font-medium leading-5">{epic.title}</span>
          <span className="text-xs text-muted-foreground">{line}</span>
        </span>
      </RailRow>
      {withFeatures && epic.features.length > 0 && (
        <ul data-station-epic-features={epic.name} className="ml-4 flex min-w-0 flex-col border-l border-border pl-1">
          {epic.features.map((feature) => (
            <FeatureRow
              key={feature.name}
              feature={feature}
              dot={dotStateOf(feature, epic, milestone)}
              tier={tier}
              current={feature.name === onStage}
              onPress={onPress}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

type RoadmapRowsProps = {
  tier: StationTier;
  /** The roadmap he selected: undefined until the roadmap's picture has landed, null once it has and holds no roadmap. */
  roadmap: Roadmap | null | undefined;
  focus: StationFocus | null;
  completeOpen: boolean;
  onCompleteOpen: (open: boolean) => void;
  onPress: (focus: StationFocus) => void;
};

/**
 * THE ROADMAP, the rail's second section, in its own words: "Roadmap" over the title of the roadmap he selected (the Roadmap
 * tab's one preference), then its open epics (`not started`, `in progress`) in its own order, milestone by milestone, each with
 * its features under it; the complete and empty epics fold under "Complete · N", each one row. No milestone is drawn, no
 * unplaced feature, no picker. Every word, phrase and colour is the roadmap module's or the shared constants'.
 *
 * Its states: READING (the picture has not landed: "Reading the roadmap…"), NO ROADMAP ("No roadmap yet", a quiet line under its
 * eyebrow: the rail's sessions above may already stand in their own empty frame, and a second frame would overrun a laptop's rail),
 * NOTHING OPEN (every epic folded: a quiet line over the fold), and the epics. Used by this module's `WhereThingsStandView`.
 */
export function RoadmapRows({ tier, roadmap, focus, completeOpen, onCompleteOpen, onPress }: RoadmapRowsProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const eyebrow = t('station.roadmap.eyebrow', { defaultValue: 'Roadmap' });

  if (roadmap === undefined) {
    return (
      <section aria-label={eyebrow} data-station-roadmap="reading" className="flex min-w-0 flex-col gap-1.5">
        <RailEyebrow as="h2">{eyebrow}</RailEyebrow>
        <div className="grid place-items-center py-6">
          <Spinner size={20} label={t('station.roadmap.reading', { defaultValue: 'Reading the roadmap…' })} />
        </div>
      </section>
    );
  }
  if (roadmap === null) {
    return (
      <section aria-label={eyebrow} data-station-roadmap="none" className="flex min-w-0 flex-col gap-1.5">
        <RailEyebrow as="h2">{eyebrow}</RailEyebrow>
        <p data-station-roadmap-none="" className="px-2.5 text-sm text-muted-foreground">
          {t('station.roadmap.none', { defaultValue: 'No roadmap yet. Make one on the Roadmap tab, and its open epics stand here.' })}
        </p>
      </section>
    );
  }

  const open: PlacedEpic[] = [];
  const folded: PlacedEpic[] = [];
  for (const milestone of roadmap.milestones) {
    for (const epic of milestone.epics) (OPEN_WORDS.has(epic.word) ? open : folded).push({ epic, milestone });
  }
  const rowsOf = (list: PlacedEpic[], withFeatures: boolean) => (
    <ul className="flex min-w-0 flex-col gap-1">
      {list.map((placed) => (
        <EpicRow key={placed.epic.name} placed={placed} tier={tier} focus={focus} onPress={onPress} withFeatures={withFeatures} />
      ))}
    </ul>
  );

  return (
    <section aria-labelledby={headingId} data-station-roadmap={roadmap.name} className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <RailEyebrow as="p">{eyebrow}</RailEyebrow>
        <h2 id={headingId} className="break-words px-2.5 font-serif text-lg/tight font-normal text-foreground">{roadmap.title}</h2>
      </div>
      {open.length === 0
        ? <p className="px-2.5 text-sm text-muted-foreground">{t('station.roadmap.noneOpen', { defaultValue: 'Nothing is open on this roadmap.' })}</p>
        : rowsOf(open, true)}
      {folded.length > 0 && (
        <RailFold
          kind="complete"
          label={t('station.roadmap.complete', { count: folded.length, defaultValue: 'Complete · {{count}}' })}
          open={completeOpen}
          onOpenChange={onCompleteOpen}
          current={focus?.kind === 'card' && folded.some((placed) => placed.epic.name === focus.plan)}
        >
          {rowsOf(folded, false)}
        </RailFold>
      )}
    </section>
  );
}
