import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { RegionList } from '@/modules/affected-areas/RegionList';
import { FACES, kindName, listWords } from '@/modules/affected-areas/utils/tourModel';
import type { Codebook, ViewDetail } from '@/shared/affected-areas-types';
import type { PanoRoom } from '@/shared/types';

/** The house's section eyebrow (MAN-742): a view's name over its list, as "Panos · 12" stands over the tour's gallery. */
const EYEBROW = 'text-xs uppercase tracking-[0.14em] text-ink-faint';

type PanoAreasProps = {
  /** The pano's six views with what the reader marked on each, from its detail. */
  views: ViewDetail[];
  /** The pano's room, handed on to each list: a row the plan credits to another room says so. */
  panoRoom: PanoRoom;
  /** The chosen area, on any of the six views; null when none is. */
  selectedRegionId: string | null;
  /** The kinds' labels; null until the codebook answers. */
  codebook: Codebook | null;
  /** A row chosen in any view's list: its area is chosen, outline and row at once. */
  onSelectRegion: (regionId: string) => void;
};

/**
 * 360°, THE LIST COLUMN: every area of the pano under the name of the view it was marked on, in the strip's order (Ahead ·
 * Right · Behind · Left · Ceiling · Floor), each view's list the one a view draws beside its photo (`RegionList`). Two views
 * can each have an area 1; the view's name over each list is what tells them apart, as the sphere tells them apart by where
 * they stand. Choosing a row chooses its area on the sphere, which turns to it, and choosing an outline chooses its row.
 *
 * Under the lists, one line for the read views where nothing was found ("Nothing found on Right, Behind, Left and Ceiling")
 * and one for the views not read yet ("Not read yet: Ceiling"), so all six are always accounted for. With nothing found on
 * any read view there is no list above them, and they stand alone, the same plain lines. A view carrying an area drawn by hand
 * is listed whether or not the reader has read it: every outline on the sphere has its row.
 *
 * Used by the affected-areas module's `PanoScreen`, in its list column while 360° is shown.
 */
export function PanoAreas({ views, panoRoom, selectedRegionId, codebook, onSelectRegion }: PanoAreasProps) {
  const { t } = useTranslation();
  // One id for the list of headings: each view's is it with the view after it.
  const headingBase = useId();
  // The views in the strip's order, whatever order the answer carries them in.
  const ordered = FACES.map((face) => views.find((view) => view.face === face)).filter((view) => view !== undefined);
  const marked = ordered.filter((view) => view.regions.length > 0);
  const viewNames = (shown: ViewDetail[]): string => listWords(shown.map((view) => t(`affectedAreas.faces.${view.face}`)), t);
  const nothing = ordered.filter((view) => view.read?.status === 'read' && view.regions.length === 0);
  const unread = ordered.filter((view) => view.read?.status !== 'read');

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {marked.map((view) => {
        const faceName = t(`affectedAreas.faces.${view.face}`);
        const headingId = `${headingBase}-${view.face}`;
        return (
          <div key={view.face} className="flex min-w-0 flex-col gap-2">
            <h3 id={headingId} className={EYEBROW}>{faceName}</h3>
            <RegionList
              regions={view.regions}
              panoRoom={panoRoom}
              selectedId={selectedRegionId}
              kindLabel={(cls) => kindName(cls, codebook)}
              label={t('affectedAreas.pano.listLabel', { face: faceName })}
              // The view's name above names this card, so its own "Marked on this view" title gives way.
              headingId={headingId}
              onSelect={onSelectRegion}
            />
          </div>
        );
      })}
      {(nothing.length > 0 || unread.length > 0) && (
        <div className="flex min-w-0 flex-col gap-1.5 text-[13px] text-muted-foreground">
          {nothing.length > 0 && <p>{t('affectedAreas.sphere.nothingOn', { views: viewNames(nothing) })}</p>}
          {unread.length > 0 && <p>{t('affectedAreas.sphere.notReadYet', { views: viewNames(unread) })}</p>}
        </div>
      )}
    </div>
  );
}
