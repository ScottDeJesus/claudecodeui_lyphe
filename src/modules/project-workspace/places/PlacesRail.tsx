import '@/modules/project-workspace/places/places.css';

import { useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionCore, useCompanion } from '@/modules/companion';
import { PlacesDial } from '@/modules/project-workspace/places/PlacesWheel';
import type { Place } from '@/shared/types';
import { Tooltip } from '@/shared/ui';

/** The side of the square Kaylee's core is drawn in at the rail's foot, in px: the rail's width less the air it keeps at each side. */
const RAIL_CORE_SIZE = 56;

type PlacesRailProps = {
  /** Every place the navigation leads to, in the wheel's order. */
  places: Place[];
  /** The places away from here with something waiting: the beads on the dial at the rail's head. */
  waiting: Place[];
  /**
   * Whether Kaylee's core stands at the rail's foot. Not on the two pages that draw her core themselves (the sessions home and her
   * station): one companion is never drawn twice on a page. Its place is kept either way, so no mark moves between pages.
   */
  corePlaced: boolean;
  /** The dial at the rail's head, pressed: the rail folds back into the wheel's menu. */
  onFold: () => void;
};

/**
 * THE WHEEL OF PLACES UNROLLED DOWN THE LEFT EDGE OF EVERY PAGE: the same places, in the wheel's order, as marks on one spine. Each
 * mark is its place's glyph alone (its name, and what waits there, are its tooltip and its name to a reader of the screen); the place
 * on screen is lit and the spine thickens at it; what waits elsewhere is a bead on the spine over its place (the accent's, breathing,
 * for a word owed; the green for finished work unseen), as the dial shows it at that place's bearing. A press goes there by the
 * place's own `go`, so the last chat floats as it does from the wheel.
 *
 * TOP TO FOOT: the dial (the wheel folded small), which folds the rail back into the menu; the places visited most (the wheel's inner
 * ring) but the station; the rest (its outer ring) but the two that open over the page; then, at the foot, those two (Accounts and
 * Settings) and Kaylee's core, which is the way to her station and wears her two rings (her conversation's fullness, the account's
 * week) as it does on every page.
 *
 * IT MAKES ITS OWN ROOM. While it is mounted the document carries `data-places-rail`, by which every page's box (the workspace frame,
 * the sessions home, the station: each `pwa-status-clear`) starts at the rail's far edge (`places.css`). Nothing of a page is covered.
 *
 * Drawn by this module's `PlacesProvider`, once for every page, while the reader's `placesRail` is on at a desk.
 */
export function PlacesRail({ places, waiting, corePlaced, onFold }: PlacesRailProps) {
  const { t } = useTranslation();
  const { picture } = useCompanion();
  const companionName = picture?.settings.name ?? t('companion.defaultName');

  // A layout effect, so the pages have moved over in the commit that draws the rail and it is never painted over one.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-places-rail', '');
    return () => root.removeAttribute('data-places-rail');
  }, []);

  const station = places.find((place) => place.id === 'station');
  const atFoot = (place: Place) => place.id === 'accounts' || place.id === 'settings';
  const most = places.filter((place) => place.ring === 'inner' && place.id !== 'station');
  const rest = places.filter((place) => place.ring === 'outer' && !atFoot(place));
  const foot = places.filter(atFoot);

  const mark = (place: Place) => {
    const Glyph = place.icon;
    const words = place.mark === null ? place.label : `${place.label} · ${place.mark.words}`;
    return (
      <Tooltip key={place.id} position="right" showOnFocus content={words}>
        <button
          type="button"
          className="places-rail-place"
          data-place={place.id}
          data-here={place.here ? 'true' : undefined}
          aria-current={place.here ? 'page' : undefined}
          aria-label={words}
          onClick={place.go}
        >
          <span className="places-rail-glyph">
            {place.mark !== null && <span className="places-rail-bead" data-mark={place.mark.kind} aria-hidden="true" />}
            <Glyph className="size-5" strokeWidth={1.75} />
          </span>
        </button>
      </Tooltip>
    );
  };

  const fold = t('places.rail.fold', { defaultValue: 'Fold into the wheel' });

  return (
    <nav className="places-rail" data-places-rail-nav="" data-core={corePlaced ? 'true' : undefined} aria-label={t('places.wheel', { defaultValue: 'Places' })}>
      <Tooltip position="right" showOnFocus content={fold}>
        <button type="button" className="places-menu places-rail-fold" aria-label={fold} onClick={onFold}>
          <PlacesDial places={places} waiting={waiting} />
        </button>
      </Tooltip>
      <div className="places-rail-run">
        {most.map(mark)}
        <span className="places-rail-gap" aria-hidden="true" />
        {rest.map(mark)}
      </div>
      <div className="places-rail-foot">
        {foot.map(mark)}
        <div className="places-rail-core" style={{ width: RAIL_CORE_SIZE, height: RAIL_CORE_SIZE }}>
          {corePlaced && station !== undefined && (
            <CompanionCore
              size={RAIL_CORE_SIZE}
              label={t('home.station', { name: companionName })}
              onPress={station.go}
              layered={false}
              pressMarks={{ 'data-rail-core': '' }}
            />
          )}
        </div>
      </div>
    </nav>
  );
}
