import { Check } from 'lucide-react';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { ROADMAP_FEATURE_WORD_KEYS as WORD_KEYS } from '@/shared/constants';
import type { RoadmapFeatureStep, RoadmapFeatureWord } from '@/shared/roadmap-types';
import { cn } from '@/shared/utils';

/** The five words in path order: the line's five stations, left to right. */
const STATIONS: readonly RoadmapFeatureWord[] = ['idea', 'proposed', 'designing', 'in flight', 'shipped'];

/** The two steps where the feature waits on the operator: its station is ringed amber there, never green. */
const OWED_STEPS: ReadonlySet<RoadmapFeatureStep> = new Set<RoadmapFeatureStep>(['questions', 'accept']);

type StateLineProps = {
  word: RoadmapFeatureWord;
  step: RoadmapFeatureStep;
  /** The step in words, as the caller already spells it (`useStepPhrase`): the second half of the label. */
  phrase: string;
  size: 'row' | 'large';
  /** The feature's shipped moment is playing: the last station pops and sends one ring out. */
  celebrating?: boolean;
};

/** Where one station stands against the feature's word. */
type Standing = 'passed' | 'current' | 'ahead';

/**
 * A feature's place on its own path, as five stations joined by a line — idea, proposed, designing, in
 * flight, shipped — filled up to its word, the current one ringed, and every one filled with a check
 * once it has shipped. It is the `StatusFlow` vocabulary (Verve's stage line, the dispatcher's track)
 * at a feature's scale, and inert: nothing on it is pressed.
 *
 * NEVER COLOUR ALONE. The word is always in the line's text — visually hidden in a row, where the step
 * phrase is spelled beside it, and under its station in the large line — and the label reads
 * "<word> — <step phrase>". A feature that waits on the operator rings its station in warn, with the
 * phrase saying what it waits for.
 *
 * Used by `FeatureRow` at `row` size, as the row's leading mark, and by `FeatureFacts` (`FeatureDialog`'s
 * body) at `large`.
 */
export function StateLine({ word, step, phrase, size, celebrating = false }: StateLineProps) {
  const { t } = useTranslation();
  const at = STATIONS.indexOf(word);
  const shipped = word === 'shipped';
  const owed = OWED_STEPS.has(step);
  const label = t('roadmap.stateLine', { word: t(WORD_KEYS[word]), phrase });
  const standingOf = (index: number): Standing => (index < at || shipped ? 'passed' : index === at ? 'current' : 'ahead');

  if (size === 'row') {
    return (
      <span role="img" aria-label={label} data-state-line={word} className="inline-flex w-14 shrink-0 items-center">
        {STATIONS.map((station, index) => (
          <Fragment key={station}>
            {index > 0 && <span aria-hidden="true" className={cn('h-px flex-1', index <= at ? 'bg-primary' : 'bg-border')} />}
            <RowStation standing={standingOf(index)} owed={owed} last={index === STATIONS.length - 1} celebrating={celebrating} />
          </Fragment>
        ))}
        <span className="sr-only">{t(WORD_KEYS[word])}</span>
      </span>
    );
  }

  // The large line is a grid of five equal columns, so each station sits at the centre of its own
  // fifth: 10%, 30% … 90% across. The track runs from the first centre to the last — dashed, the way
  // still to go — and the accent laid over it reaches the word's station, a fifth of the width a step.
  return (
    <div role="img" aria-label={label} data-state-line={word} className="relative grid w-full grid-cols-5">
      <span aria-hidden="true" className="absolute inset-x-[10%] top-[11px] border-t-2 border-dashed border-input" />
      <span aria-hidden="true" className="absolute left-[10%] top-[11px] h-0.5 bg-primary" style={{ width: `${at * 20}%` }} />
      {STATIONS.map((station, index) => {
        const standing = standingOf(index);
        return (
          <div key={station} className="relative flex min-w-0 flex-col items-center gap-1.5">
            <LargeStation standing={standing} owed={owed} last={index === STATIONS.length - 1} celebrating={celebrating} />
            {/* Passed and ahead words share the muted ink — the faint one measured 3.12:1 in light, under AA for
                text — and the station above each word says which it is: a check, or a hollow disc. */}
            <span
              className={cn(
                'text-center text-xs leading-tight',
                standing === 'current' || (shipped && index === at)
                  ? cn('font-semibold', owed ? 'text-warn-ink' : 'text-foreground')
                  : 'text-muted-foreground',
              )}
            >
              {t(WORD_KEYS[station])}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** What a station draws, in either size: where it stands, whether the operator holds it, and whether it is the shipped end of a moment. */
type StationProps = { standing: Standing; owed: boolean; last: boolean; celebrating: boolean };

/**
 * One station of the row line. Passed is a small accent dot; current is a larger one with a soft ring
 * (amber when the operator holds it); ahead is a hollow one. The shipped end is a disc with a check —
 * the one station a moment moves: it pops, and its holder sends one ring out (two elements, because
 * one element runs one animation).
 */
function RowStation({ standing, owed, last, celebrating }: StationProps) {
  if (last && standing === 'passed') {
    return (
      <span aria-hidden="true" className={cn('grid size-2.5 shrink-0 place-items-center rounded-full', celebrating && 'motion-safe:animate-roadmap-ring')}>
        <span className={cn('grid size-2.5 place-items-center rounded-full bg-primary text-primary-foreground', celebrating && 'motion-safe:animate-roadmap-pop')}>
          <Check className="size-2" strokeWidth={4} />
        </span>
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'shrink-0 rounded-full',
        standing === 'passed' && 'size-1.5 bg-primary',
        standing === 'current' && cn('size-2 ring-2', owed ? 'bg-warn-ink ring-warn-ink/30' : 'bg-primary ring-primary/30'),
        standing === 'ahead' && 'size-1.5 border border-input',
      )}
    />
  );
}

/**
 * One station of the large line, StatusFlow's node at 24px: passed is filled with a check, current is
 * ringed with a dot at its heart (amber when the operator holds it), ahead is hollow. Each sits on the
 * surface so the track behind it stops at its edge.
 */
function LargeStation({ standing, owed, last, celebrating }: StationProps) {
  if (standing === 'passed') {
    return (
      <span aria-hidden="true" className={cn('relative grid size-6 place-items-center rounded-full', last && celebrating && 'motion-safe:animate-roadmap-ring')}>
        <span className={cn('grid size-6 place-items-center rounded-full bg-primary text-primary-foreground', last && celebrating && 'motion-safe:animate-roadmap-pop')}>
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      </span>
    );
  }
  if (standing === 'current') {
    return (
      <span
        aria-hidden="true"
        className={cn('relative grid size-6 place-items-center rounded-full border-[1.5px] bg-card', owed ? 'border-warn-ink text-warn-ink' : 'border-primary text-primary')}
      >
        <span className="size-2 rounded-full bg-current" />
      </span>
    );
  }
  return <span aria-hidden="true" className="relative size-6 rounded-full border-[1.5px] border-input bg-card" />;
}
