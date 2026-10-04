import { useContext, useId } from 'react';
import { useTranslation } from 'react-i18next';

import { RoadmapFaceContext } from '@/modules/roadmap/faceContext';
import { FeatureRow } from '@/modules/roadmap/FeatureRow';
import { railSections } from '@/modules/roadmap/railSections';
import type { Roadmap, RoadmapFeature } from '@/shared/roadmap-types';
import { cn } from '@/shared/utils';

/** How many proposed features Next up lists before it counts the rest: the next few, not the whole queue. */
const NEXT_LIMIT = 5;

/** One drawn section: its heading, the rows it lists, how many it leaves uncounted, and whether it is the operator's to act on. */
type RailSection = { key: string; heading: string; features: RoadmapFeature[]; more: number; warn: boolean };

/**
 * What the roadmap wants from the operator and what is moving, across every milestone, in four short
 * sections read top to bottom by urgency: Waiting on you and its Answer presses (amber, his to act on);
 * In flight, each with its step and its task meter; Next up, the proposed features in path order, the
 * first five and a count of the rest; and Blocked, each with its reason — its own, or the epic's or the
 * milestone's it inherits. A section with nothing in it is not drawn, and a roadmap with nothing in any
 * draws no rail at all, so the stage beside it takes the whole width.
 *
 * Its rows are `FeatureRow`s at `compact`; a press on one opens the feature whole.
 *
 * Used by `RoadmapPath`: a 320px column beside the stage from 1280px up, and under it below that.
 */
export function RoadmapRail({ roadmap }: { roadmap: Roadmap }) {
  const { t } = useTranslation();
  // The four sections are one pure function of the roadmap, which the chat gutter's widget reads as well.
  const sections = railSections(roadmap);
  const { openDialog } = useContext(RoadmapFaceContext);
  const openFeature = (feature: RoadmapFeature) => openDialog({ dialog: 'feature', name: feature.name });
  const labelId = useId();

  const drawn: RailSection[] = [
    { key: 'waiting', heading: t('roadmap.rail.waiting'), features: sections.waiting, more: 0, warn: true },
    { key: 'inFlight', heading: t('roadmap.rail.inFlight'), features: sections.inFlight, more: 0, warn: false },
    { key: 'next', heading: t('roadmap.rail.next'), features: sections.next.slice(0, NEXT_LIMIT), more: Math.max(0, sections.next.length - NEXT_LIMIT), warn: false },
    { key: 'blocked', heading: t('roadmap.rail.blocked'), features: sections.blocked, more: 0, warn: true },
  ].filter((section) => section.features.length > 0);

  if (drawn.length === 0) return null;

  // Beside the stage a hairline on its left parts the two; under it, a hairline above.
  return (
    <aside
      aria-labelledby={labelId}
      data-roadmap-rail
      className="flex min-w-0 flex-col gap-6 border-t border-border pt-6 xl:w-80 xl:shrink-0 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0"
    >
      <h2 id={labelId} className="sr-only">{t('roadmap.rail.label')}</h2>
      {drawn.map((section) => (
        <section key={section.key} aria-labelledby={`${labelId}-${section.key}`} data-roadmap-rail-section={section.key}>
          <h3
            id={`${labelId}-${section.key}`}
            className={cn('flex items-baseline gap-2 text-xs font-medium uppercase tracking-[0.14em]', section.warn ? 'text-warn-ink' : 'text-muted-foreground')}
          >
            {section.heading}
            <span className="tabular-nums">{section.features.length + section.more}</span>
          </h3>
          <ul className="-mx-2 mt-2 flex flex-col gap-0.5">
            {section.features.map((feature) => (
              <li key={feature.name}>
                <FeatureRow feature={feature} onOpen={openFeature} density="compact" />
              </li>
            ))}
          </ul>
          {section.more > 0 && <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">{t('roadmap.rail.more', { count: section.more })}</p>}
        </section>
      ))}
    </aside>
  );
}
