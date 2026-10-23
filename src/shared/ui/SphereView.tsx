import { Suspense, lazy, useEffect, useLayoutEffect, useRef } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';

import type { CubeFaces, SphereLook, SphereShape, SphereTrouble } from '@/shared/types';
import { Banner } from '@/shared/ui/Banner';
import { Button } from '@/shared/ui/Button';

// The sphere's half is a chunk of its own: three.js and the viewer are fetched the first time a sphere is drawn, and the
// barrel (which every screen imports) never names the canvas. Photo Sphere Viewer's CSS rides in with it.
const SphereCanvas = lazy(() => import('@/shared/ui/sphere/SphereCanvas').then((loaded) => ({ default: loaded.SphereCanvas })));

type SphereViewProps = {
  /** Six photos of a cube; null while they load, and the box is a skeleton of itself. */
  faces: CubeFaces | null;
  /** The areas to outline, each already in its look. The larger a box, the earlier it should be: later ones draw over earlier. */
  regions: SphereShape[];
  /** The chosen area: its outline is heavier and its badge ringed. One chosen somewhere else turns the view to it. */
  selectedId?: string | null;
  /** Called with an area's id when its outline or its badge is pressed. */
  onSelect?: (id: string) => void;
  /** Where the sphere looks when it is drawn. A new value turns it there; the value `onLook` just reported turns nothing. */
  look: SphereLook;
  /** Where the view came to rest, about a quarter second after a drag, a zoom or a turn stops. */
  onLook?: (look: SphereLook) => void;
  /** Whether the sphere fills the screen. */
  fullscreen: boolean;
  /** The viewer's own entering and leaving of fullscreen, Escape and its own button included. */
  onFullscreen: (on: boolean) => void;
  /** The box's accessible name: it is one picture, `role="img"` (a named group while fullscreen), and the areas on it are the caller's list. */
  label: string;
  /** The words of the overlay a plain scroll over the sphere shows ("Hold Ctrl and scroll to zoom"). */
  zoomHint: string;
  /** Called when the sphere cannot be drawn (no WebGL 2) or a photo would not load. */
  onTrouble?: (trouble: SphereTrouble) => void;
};

/** The verdict on WebGL 2, asked once per page: it does not change, and each ask makes a context. */
let webGlVerdict: boolean | null = null;

/**
 * Whether this browser can draw a sphere, by the library's own test: a scratch canvas that gives a `webgl2` context. The
 * library's `new Viewer` does not throw when it cannot (it draws its own error and returns a viewer with no renderer), so the
 * answer is had before the chunk is fetched, and a browser without it never loads three.js. The scratch context is given back.
 */
function supportsWebGl2(): boolean {
  if (webGlVerdict === null) {
    try {
      const context = document.createElement('canvas').getContext('webgl2');
      webGlVerdict = context !== null;
      context?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch (error) {
      console.warn('SphereView: asking the browser for a WebGL 2 context failed', error);
      webGlVerdict = false;
    }
  }
  return webGlVerdict;
}

/** The box's waiting surface: Verve's skeleton, square-cornered like the photos it stands in for. */
function SphereSkeleton() {
  return <span aria-hidden="true" className="vv-skeleton absolute inset-0 rounded-none" />;
}

/**
 * What stands in the box when the viewer's chunk cannot be loaded (a hashed file the server no longer has, a dropped
 * connection) or the viewer fails while it is drawn. The offer is a reload of the page and not a retry, as `ViewBoundary`'s:
 * `lazy` remembers a rejected import, and so does the browser's module map, so a second try would only fail again.
 */
function SphereFailed() {
  const { t } = useTranslation('common');
  return (
    <div role="alert" className="absolute inset-0 flex items-center justify-center p-4">
      <Banner
        tone="warn"
        action={(
          <Button variant="tonal" size="sm" className="h-8 flex-none px-2.5 text-xs max-md:h-11" onClick={() => window.location.reload()}>
            {t('viewBoundary.reload')}
          </Button>
        )}
      >
        <p className="text-sm font-medium">{t('media.sphereFailed')}</p>
        <p className="mt-0.5 text-xs">{t('media.sphereFailedDetail')}</p>
      </Banner>
    </div>
  );
}

/**
 * Used by the affected-areas module's pano screen: a pano's six views as one sphere, its areas outlined on it.
 *
 * Six square photos of a cube are stitched into a sphere you drag and zoom (Photo Sphere Viewer on three.js), and each area
 * is laid on it by yaw and pitch as a polygon in the `.vv-region*` look RegionImage draws flat, with its numbered badge.
 * Pressing either hands the area's id to `onSelect`; an area chosen elsewhere turns the view to it. The piece knows a cube,
 * its outlines and their tones: which face is which, which areas stand and what a look means stay with the caller.
 *
 * It is one picture to assistive technology (`role="img"`, named by `label`, and a named group while fullscreen so that its way
 * out can be found), as RegionImage's photo is; the caller's list
 * is the way in for a keyboard. The box is square to its parent's width. The wheel is gated so a page that scrolls past a
 * sphere keeps scrolling: a plain scroll shows `zoomHint`, Ctrl or ⌘ with the wheel (or a pinch) zooms. Fullscreen shows the
 * library's one button, the way out, which a phone needs because it has no Escape.
 *
 * Without WebGL 2 nothing is fetched or drawn and `onTrouble('no_webgl')` is called; a photo that fails is `'photo_failed'`.
 * The viewer, three.js and the library's CSS load in a chunk of their own, the first time a sphere is drawn; a chunk that cannot
 * load is contained in the box (a sentence and a reload of the page) and never reaches the caller's tree.
 */
export function SphereView({ faces, regions, selectedId = null, onSelect, look, onLook, fullscreen, onFullscreen, label, zoomHint, onTrouble }: SphereViewProps) {
  const { t } = useTranslation('common');
  const supported = supportsWebGl2();
  /** The latest `onTrouble`, so that the report below is made once per verdict and not once per new function the caller passes. */
  const reportTrouble = useRef(onTrouble);
  useLayoutEffect(() => {
    reportTrouble.current = onTrouble;
  });
  useEffect(() => {
    if (!supported) reportTrouble.current?.('no_webgl');
  }, [supported]);

  return (
    // One picture, named by `label`. Fullscreen is the exception: the viewer's one button (the way out, which a phone has no
    // Escape for) sits inside this box, and the children of an image are not exposed to assistive technology, so while the
    // sphere fills the screen the box is a named group and its button can be found.
    <div role={fullscreen ? 'group' : 'img'} aria-label={label} className="vv-sphere">
      {supported && faces !== null && (
        <ErrorBoundary fallbackRender={() => <SphereFailed />} onError={(error) => console.error('SphereView: the 360° viewer could not be shown', error)}>
          <Suspense fallback={<SphereSkeleton />}>
            <SphereCanvas
              faces={faces}
              regions={regions}
              selectedId={selectedId}
              onSelect={onSelect}
              look={look}
              onLook={onLook}
              fullscreen={fullscreen}
              onFullscreen={onFullscreen}
              zoomHint={zoomHint}
              leaveLabel={t('media.sphereLeaveFullscreen')}
              onTrouble={onTrouble}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      {supported && faces === null && <SphereSkeleton />}
    </div>
  );
}
