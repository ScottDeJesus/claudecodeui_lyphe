import { Layers, Puzzle } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import type { RoadmapPicture } from '@/shared/roadmap-types';
import { Badge, Banner, Button } from '@/shared/ui';

/** Something the store holds that no roadmap reaches yet, as the banner names it: an epic (`arc`) or a feature (`plan`). */
type Unplaced = { kind: 'arc' | 'plan'; name: string; title: string };

/**
 * What the store holds that no roadmap reaches — epics under no milestone, features under no epic — in
 * one informational strip over the roadmap, each with the press that puts it on one. It names each by
 * its kind (the dispatcher's own Epic and Feature tags) so a title is never mistaken for the other.
 *
 * Used by `RoadmapTreeFace`, in viewport fit (the Roadmap tab and the widget at full screen), above the
 * picker row while the picture holds anything unplaced.
 */
export function UnplacedBanner({ unplaced, onPlace }: { unplaced: RoadmapPicture['unplaced']; onPlace: (item: Unplaced) => void }) {
  const { t } = useTranslation();
  // Each title's id: its Place… press is described by it, so three presses named alike are told apart.
  const titleId = useId();
  const items: Unplaced[] = [
    ...unplaced.epics.map((item) => ({ kind: 'arc' as const, name: item.name, title: item.title })),
    ...unplaced.features.map((item) => ({ kind: 'plan' as const, name: item.name, title: item.title })),
  ];
  // One grid for every row, so the kinds, the titles and the presses each stand in a column; held to a
  // reading measure, so on a wide face each Place… stays beside the title it places.
  return (
    <div data-roadmap-unplaced>
      <Banner tone="info">
        <p className="font-medium">{t('roadmap.unplaced.banner', { count: items.length })}</p>
        <ul className="mt-1.5 grid max-w-2xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1">
          {items.map((item, index) => (
            <li key={item.name} className="col-span-3 grid grid-cols-subgrid items-center">
              <Badge as="span" kind={item.kind === 'arc' ? 'epic' : 'feature'} className="gap-1 justify-self-start">
                {item.kind === 'arc' ? <Layers aria-hidden="true" className="size-3.5" /> : <Puzzle aria-hidden="true" className="size-3.5" />}
                {t(item.kind === 'arc' ? 'roadmap.kind.epic' : 'roadmap.kind.feature')}
              </Badge>
              <span id={`${titleId}-${index}`} className="truncate">{item.title}</span>
              <Button variant="secondary" size="sm" className="h-7 px-2.5 text-xs" aria-describedby={`${titleId}-${index}`} onClick={() => onPlace(item)}>
                {t('roadmap.unplaced.place')}
              </Button>
            </li>
          ))}
        </ul>
      </Banner>
    </div>
  );
}
