import { Check } from 'lucide-react';
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
};

/** Where one station stands against the feature's word. */
type Standing = 'passed' | 'current' | 'ahead';

/**
 * A feature's place on its own path, as five stations joined by a line — idea, proposed, designing, in
 * flight, shipped — filled up to its word, the current one ringed, and every one filled with a check
 * once it has shipped. It is the `StatusFlow` vocabulary (Verve's stage line, the dispatcher's track)
 * at a feature's scale, and inert: nothing on it is pressed.
 *
 * NEVER COLOUR ALONE. The word is always in the line's text, under its station, and the label reads
 * "<word> — <step phrase>". A feature that waits on the operator rings its station in warn, with the
 * phrase saying what it waits for.
 *
 * Used by `FeatureFacts` (`FeatureDialog`'s body), as the line that says where the feature stands.
 */
export function StateLine({ word, step, phrase }: StateLineProps) {
  const { t } = useTranslation();
  const at = STATIONS.indexOf(word);
  const shipped = word === 'shipped';
  const owed = OWED_STEPS.has(step);
  const label = t('roadmap.stateLine', { word: t(WORD_KEYS[word]), phrase });
  const standingOf = (index: number): Standing => (index < at || shipped ? 'passed' : index === at ? 'current' : 'ahead');

  // The line is a grid of five equal columns, so each station sits at the centre of its own
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
            <LargeStation standing={standing} owed={owed} />
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

/**
 * One station of the line, StatusFlow's node at 24px: passed is filled with a check, current is
 * ringed with a dot at its heart (amber when the operator holds it), ahead is hollow. Each sits on the
 * surface so the track behind it stops at its edge.
 */
function LargeStation({ standing, owed }: { standing: Standing; owed: boolean }) {
  if (standing === 'passed') {
    return (
      <span aria-hidden="true" className="relative grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
        <Check className="size-3.5" strokeWidth={3} />
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
