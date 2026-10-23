import { useRef, useState } from 'react';

import { lookOf } from '@/modules/affected-areas/utils/sphereFaces';
import type { Face, PanoEntry, ViewEntry } from '@/shared/affected-areas-types';
import type { PanoShown, RegionLayer, SphereLook } from '@/shared/types';

/** Where a pano with no Ahead view on file is looked at on 360°: the engine's own cut of Ahead, as every pano's is. */
const AHEAD_LOOK: SphereLook = { yawDeg: 0, pitchDeg: 0, fovDeg: 90 };

/** What the open pano is showing, and the verbs that move it: the one place a person's looking at a pano is kept. */
type PanoPlace = {
  /** What the pano screen shows: 360°, or one of its six views. */
  shown: PanoShown;
  /** Where the sphere looks while 360° is shown: where it came to rest, or the view it was turned from. */
  sphereLook: SphereLook;
  /** The region chosen on the pano, outline and row at once; null when none is. */
  selectedRegionId: string | null;
  /** Whether the pano is enlarged: the Lightbox on a view, the sphere's own fullscreen on 360°. */
  enlarged: boolean;
  /** What the photo and the sphere draw: every area, or only the ones the engine says stand. */
  layer: RegionLayer;
  /**
   * A pano opens: on 360°, looking where its Ahead view was cut, with nothing chosen and every area drawn. Takes the
   * pano as its tour lists it (undefined when the tour does not list it), which is where that view is read from.
   */
  openPano: (entry: PanoEntry | undefined) => void;
  /** A tour is opened, or a tour or a pano is left: nothing is chosen and nothing is enlarged. What is shown and the layer stay, for `openPano` to set. */
  letGo: () => void;
  /** A tab is pressed in the strip: it is shown, and the area chosen on the last one is let go of. Returning to 360° looks where the view looked. */
  onShow: (shown: PanoShown) => void;
  /** The sphere came to rest after a drag, a zoom or a turn: where it looks is kept, so it comes back there. */
  onLook: (look: SphereLook) => void;
  /** A region is pressed on the sphere, the photo or in the list: it is chosen, and pressing the chosen one lets go of it. */
  onSelectRegion: (regionId: string) => void;
  /** The layer switch is pressed: the photo and the sphere draw what it names. */
  onLayer: (layer: RegionLayer) => void;
  /** Mark it on {view}: that view is shown with the area still chosen, its presses under its photo. */
  onMarkOn: (face: Face, regionId: string) => void;
  /** Enlarge is pressed: the shown view opens in the Lightbox, or the sphere fills the screen. */
  onEnlarge: () => void;
  /** The Lightbox is closed. */
  onShrink: () => void;
  /** The sphere's own entering and leaving of fullscreen, Escape and its own button included: `enlarged` follows it. */
  onFullscreen: (on: boolean) => void;
};

/**
 * THE PANO'S PLACE: what a person is looking at in the open pano — 360° or one of its six views — the area chosen, whether
 * it is enlarged, where the sphere looks, and what is drawn. They live together because the ways into and out of a pano (a
 * tour or a pano opened, left, a tab pressed) each move several of them at once. The view root holds the open tour and
 * pano (what is open) and this holds where in it the person is (what they are looking at); the Cerberus tab keeps the root
 * mounted, so all of it survives a visit to Fleet.
 *
 * The verbs are the moves of the place alone. The rest of what a press does (the open pano, the scroll to the top, the
 * reads) is the root's, around the verb it calls.
 *
 * Used by the affected-areas module's view root.
 */
export function usePanoPlace(): PanoPlace {
  // What the pano screen shows: 360° (a pano opens on it) or one of the six views. Kept while the person looks at the
  // list or the Lightbox.
  const [shown, setShown] = useState<PanoShown>('sphere');
  // Where the sphere looks: the open pano's Ahead view, the view a person returned from, else where it came to rest. Held
  // here, not in the sphere, because the sphere unmounts whenever the screen is hidden and comes back where it was.
  const [sphereLook, setSphereLook] = useState<SphereLook>(AHEAD_LOOK);
  // The region chosen on the pano, outline and row at once; null when none is.
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  // Whether the pano is enlarged: the Lightbox around a view's photo, or the sphere filling the screen.
  const [enlarged, setEnlarged] = useState(false);
  // What the pano's photo draws: every area (All, the default: the operator is judging what the model proposed, and hiding
  // the unsure ones would hide the ones that most need his eye) or only the ones the engine says stand.
  const [layer, setLayer] = useState<RegionLayer>('all');
  // The open pano's views as its tour listed them: a view's own look is what 360° takes when a person returns to it from
  // there. A ref: it answers a press and nothing draws from it.
  const views = useRef<ViewEntry[]>([]);

  const openPano = (entry: PanoEntry | undefined) => {
    const ahead = entry?.views.find((view) => view.face === 'ahead');
    views.current = entry?.views ?? [];
    setShown('sphere');
    setSphereLook(ahead === undefined ? AHEAD_LOOK : lookOf(ahead));
    setSelectedRegionId(null);
    // A new pano opens on All again, whatever the last one was set to; a view of the same pano keeps the person's choice.
    setLayer('all');
  };
  const letGo = () => {
    setSelectedRegionId(null);
    setEnlarged(false);
  };
  const onShow = (next: PanoShown) => {
    // Returning to 360° from a view: the sphere looks where the view looked. A pano already opened on the sphere
    // (`openPano`), so a sphere shown again from under another surface keeps the look the person left it at.
    if (next === 'sphere' && shown !== 'sphere') {
      const view = views.current.find((candidate) => candidate.face === shown);
      if (view !== undefined) setSphereLook(lookOf(view));
    }
    setShown(next);
    setSelectedRegionId(null);
  };
  // The sphere, the photo and the list choose the same region; pressing the chosen one lets go of it.
  const onSelectRegion = (regionId: string) => setSelectedRegionId((chosen) => (chosen === regionId ? null : regionId));
  const onMarkOn = (face: Face, regionId: string) => {
    setShown(face);
    setSelectedRegionId(regionId);
  };
  const onEnlarge = () => setEnlarged(true);
  const onShrink = () => setEnlarged(false);

  return {
    shown, sphereLook, selectedRegionId, enlarged, layer,
    openPano, letGo, onShow, onLook: setSphereLook, onSelectRegion, onLayer: setLayer, onMarkOn, onEnlarge, onShrink,
    onFullscreen: setEnlarged,
  };
}
