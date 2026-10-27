import type { TFunction } from 'i18next';
import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { placementNotes } from '@/modules/affected-areas/utils/dayOneModel';
import { REGION_LOOK, regionState } from '@/modules/affected-areas/utils/regionLook';
import type { Region } from '@/shared/affected-areas-types';
import type { PanoRoom } from '@/shared/types';
import { Badge, Card } from '@/shared/ui';
import { cn } from '@/shared/utils';

type RegionListProps = {
  /** The shown face's regions, in their badge order. */
  regions: Region[];
  /** The pano's room: a region the plan credits to another room says so in its line. */
  panoRoom: PanoRoom;
  selectedId: string | null;
  /** A kind's label from the codebook ("Material removed"); the kind's key spoken as it is until the codebook answers. */
  kindLabel: (cls: string) => string;
  /** The list's accessible name: whose regions these are ("Marked on the Behind view"). */
  label: string;
  /** The heading that names this card instead of its own title: on 360° each view's name stands over its list. Absent, the card draws "Marked on this view" as it does on a view. */
  headingId?: string;
  onSelect: (regionId: string) => void;
};

/** The panel width, in px, from which `PanoScreen` draws the face beside its list (its `COLUMNS`); under it the blocks stack. */
const SIDE_BY_SIDE_FROM = 720;

/**
 * Whether the list stands in the stacked layout: its container, the nearest ancestor that is one (`PanoScreen`'s
 * `@container` query reads the same box), is under the width where the face moves beside the list.
 */
function isStacked(list: HTMLElement): boolean {
  const view = list.ownerDocument.defaultView;
  for (let box = list.parentElement; box !== null && view !== null; box = box.parentElement) {
    if (view.getComputedStyle(box).containerType.includes('inline-size')) return box.clientWidth < SIDE_BY_SIDE_FROM;
  }
  return false;
}

/**
 * "Proposed · 95% sure · seen in the photo · Counted in Kitchen · Seen in 2 photos": where the region stands, how sure the
 * reader was, on what ground, and, when the plan has placed it, the room it is counted in (when not its photo's) and how many
 * photos see its area.
 */
function regionMeta(region: Region, panoRoom: PanoRoom, t: TFunction): string {
  return [
    t(REGION_LOOK[regionState(region)].wordKey),
    region.confidence === null ? null : t('affectedAreas.region.sure', { percent: Math.round(region.confidence * 100) }),
    t(`affectedAreas.region.basis.${region.basis}`),
    ...placementNotes(region.placement, panoRoom, t),
  ].filter((part) => part !== null).join(' · ');
}

/**
 * EVERY REGION MARKED ON A FACE, the same numbers the photo carries, under "Marked on this view": the areas and the
 * ones set aside alike (unsure, or marked not a change), each saying which it is, so the list, the badges and the
 * caption's "3 areas · 2 set aside" always add up. Each row: the region's number in its look's tone, the kind's label
 * (the codebook's words, never a colour: tone is by judgment), the reader's own label for it, the visible evidence in
 * the reader's words, and where it stands, how sure the reader was and on what ground; once the plan has placed it, the room it
 * is counted in when that is not its photo's ("Counted in Kitchen") and "Seen in 2 photos" when several photos see its area.
 *
 * Selecting a row selects its region on the photo and the photo's selects its row: the chosen row wears the
 * house's chosen-row mark (the canvas ground and an accent bar, `aria-current`), and is brought into view when the
 * photo chose it.
 *
 * Used by the affected-areas module's `PanoScreen`, which draws it beside the face while the face has regions, and by `PanoAreas`,
 * which draws one under each view's name on 360°.
 */
export function RegionList({ regions, panoRoom, selectedId, kindLabel, label, headingId, onSelect }: RegionListProps) {
  const { t } = useTranslation();
  const ownHeadingId = useId();
  // The list's box: the chosen row is found in it and brought into view.
  const listRef = useRef<HTMLUListElement>(null);
  // A region chosen on the photo may stand far down a long list: its row is brought into view. `nearest` moves the panel
  // no further than needed and not at all when the row is already in view, so a row pressed in the list stays put. In the
  // stacked layout the row stands below the photo and its presses, and scrolling to it would take both off the screen: the
  // face block (`FacePhoto`) brings the photo and its presses into view instead, and the bar names the area, so the row is left.
  useEffect(() => {
    const list = listRef.current;
    if (list === null || isStacked(list)) return;
    list.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  return (
    <Card role="region" aria-labelledby={headingId ?? ownHeadingId} className="flex min-w-0 flex-col overflow-hidden">
      {/* A caller that draws the card's heading (360°'s view name) hands its id in; its own title gives way to it. */}
      {headingId === undefined && (
        <h3 id={ownHeadingId} className="px-4 pb-2 pt-4 text-xs uppercase tracking-[0.14em] text-ink-faint">{t('affectedAreas.pano.markedTitle')}</h3>
      )}
      <ul ref={listRef} aria-label={label} className="m-0 list-none divide-y divide-border border-t border-border p-0">
        {regions.map((region) => {
          const look = REGION_LOOK[regionState(region)];
          const selected = region.regionId === selectedId;
          return (
            <li key={region.regionId}>
              <button
                type="button"
                aria-current={selected || undefined}
                onClick={() => onSelect(region.regionId)}
                className={cn(
                  'relative flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-background focus-visible:[outline-offset:-2px]',
                  selected && 'bg-background before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-primary',
                )}
              >
                <Badge as="span" tone={look.tone} className="min-w-[26px] flex-none justify-center border-tone-dot px-1.5 font-bold tabular-nums">
                  {region.ordinal}
                </Badge>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  {/* The kind the area counts as, so a rename redraws the list as it redraws the bar. */}
                  <span className="text-sm font-medium text-foreground">{kindLabel(region.effectiveClass ?? region.class)}</span>
                  {region.label !== null && <span className="text-[13px] text-foreground [overflow-wrap:anywhere]">{region.label}</span>}
                  {region.evidence !== null && region.evidence !== '' && (
                    <span className="text-[12.5px] text-muted-foreground [overflow-wrap:anywhere]">“{region.evidence}”</span>
                  )}
                  <span className="text-xs text-muted-foreground">{regionMeta(region, panoRoom, t)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
