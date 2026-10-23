import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { faceCounts, FACES, panoCounts } from '@/modules/affected-areas/utils/tourModel';
import type { ViewDetail, ViewEntry } from '@/shared/affected-areas-types';
import type { PanoShown } from '@/shared/types';
import { Tabs } from '@/shared/ui';

type FaceStripProps = {
  /** The pano's views, from its detail once it answered, else from the tour's listing: each face's count is read off its own. */
  views: (ViewEntry | ViewDetail)[];
  /** What the pano screen shows: 360° first, then its six views. */
  shown: PanoShown;
  onShow: (shown: PanoShown) => void;
};

/**
 * 360° AND THE SIX VIEWS, Ahead · Right · Behind · Left · Ceiling · Floor, each counting its areas. 360° counts every area
 * of the pano (`panoCounts`, the faces' own counts summed), so the strip's numbers add up across the tabs. Six faces and
 * their counts are wider than a phone: the strip keeps each tab on one line and scrolls sideways in its own box (the
 * library's idiom for an underline strip wider than its row), never squeezing a count under its name. Wide, it spreads
 * across the row.
 *
 * 360° opened, or a face pressed half out of the strip's edge, is scrolled into the strip's view. The strip's own box is
 * moved and nothing else: the page does not scroll for it (`scrollIntoView` would walk every scrollable ancestor).
 *
 * Used by the affected-areas module's `PanoScreen`, over the figure and the list, once the pano has views.
 */
export function FaceStrip({ views, shown, onShow }: FaceStripProps) {
  const { t } = useTranslation();
  // The strip's scroller: on a phone the chosen tab may stand past its edge, and is brought into it.
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = stripRef.current;
    const tab = strip?.querySelector('[role="tab"][aria-selected="true"]');
    if (strip === null || strip === undefined || tab === null || tab === undefined) return;
    const stripBox = strip.getBoundingClientRect();
    const tabBox = tab.getBoundingClientRect();
    if (tabBox.left < stripBox.left) strip.scrollLeft -= stripBox.left - tabBox.left;
    else if (tabBox.right > stripBox.right) strip.scrollLeft += tabBox.right - stripBox.right;
  }, [shown]);

  // 360° first: every area of the pano, across the six, in the same count its faces carry.
  const tabs = [
    { id: 'sphere', label: t('affectedAreas.sphere.tab'), count: panoCounts(views).areas, tone: 'info' as const },
    ...FACES.map((id) => ({ id, label: t(`affectedAreas.faces.${id}`), count: faceCounts(views.find((candidate) => candidate.face === id))?.areas, tone: 'info' as const })),
  ];

  return (
    <div ref={stripRef} className="min-w-0 overflow-x-auto whitespace-nowrap">
      <Tabs
        variant="underline"
        tabs={tabs}
        active={shown}
        onChange={(id) => {
          if (id === 'sphere') onShow('sphere');
          else {
            const next = FACES.find((candidate) => candidate === id);
            if (next !== undefined) onShow(next);
          }
        }}
        ariaLabel={t('affectedAreas.pano.viewsLabel')}
      />
    </div>
  );
}
