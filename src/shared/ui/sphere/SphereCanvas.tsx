import { Viewer } from '@photo-sphere-viewer/core';
import '@photo-sphere-viewer/core/index.css';
import { CubemapAdapter } from '@photo-sphere-viewer/cubemap-adapter';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';
import '@photo-sphere-viewer/markers-plugin/index.css';
import { useEffect, useLayoutEffect, useRef } from 'react';

import type { CubeFaces, SphereLook, SphereShape, SphereTrouble } from '@/shared/types';
import { fixedContainingRelease } from '@/shared/ui/sphere/fixedContaining';
import {
  MAX_FOV_DEG, MIN_FOV_DEG, foldYaw, fovOfZoomLevel, sameLook, toDegrees, toRadians, zoomLevelOfFov,
} from '@/shared/ui/sphere/sphereLook';
import { markerConfigsOf, regionIdOfMarker } from '@/shared/ui/sphere/sphereMarkers';
import { gateWheel } from '@/shared/ui/sphere/wheelGate';

type SphereCanvasProps = {
  faces: CubeFaces;
  regions: SphereShape[];
  selectedId: string | null;
  onSelect?: (id: string) => void;
  look: SphereLook;
  onLook?: (look: SphereLook) => void;
  fullscreen: boolean;
  onFullscreen: (on: boolean) => void;
  zoomHint: string;
  /** What the viewer's one button (shown only while fullscreen) is called: how to leave it. */
  leaveLabel: string;
  onTrouble?: (trouble: SphereTrouble) => void;
};

/** How long the view must hold still before `onLook` reports where it came to rest. */
const REST_MS = 250;

/** The pace the library turns to a marker at, used for a turn the caller asks for with a new `look`. */
const TURN_SPEED = '8rpm';

/** The cube's faces in the order the adapter documents them, so the URLs compare the same way every time. */
const FACE_ORDER: (keyof CubeFaces)[] = ['left', 'front', 'right', 'back', 'top', 'bottom'];

/** The six URLs as one string: two `faces` objects with the same six URLs are the same panorama. */
function facesKeyOf(faces: CubeFaces): string {
  return FACE_ORDER.map((side) => faces[side]).join('\n');
}

/** How many panoramas have been asked for on this page, so that each load can have photo URLs of its own. */
let panoramaLoads = 0;

/**
 * The cubemap adapter's panorama for six separate photos. `flipTopBottom` turns the ceiling and floor views upright (see `CUBE_OF`).
 *
 * Each load asks for its photos under URLs of its OWN, the same photo with a different fragment (`#sphere-3`, which a fetch
 * ignores). three.js's `FileLoader` shares one in-flight request between every loader on the page that asks for the same URL
 * string, and the viewer that made the request aborts it when it is destroyed: the next viewer on the same photos, which is
 * exactly what React.StrictMode makes in development (a viewer, its teardown, another viewer), then received an AbortError that
 * Photo Sphere Viewer takes for its own, and waited on its photos for ever with neither a picture nor an error.
 */
function panoramaOf(faces: CubeFaces) {
  panoramaLoads += 1;
  const own = (url: string) => `${url.split('#')[0]}#sphere-${panoramaLoads}`;
  return {
    type: 'separate',
    paths: { left: own(faces.left), front: own(faces.front), right: own(faces.right), back: own(faces.back), top: own(faces.top), bottom: own(faces.bottom) },
    flipTopBottom: true,
  };
}

/**
 * Gives a canvas's WebGL context back. `viewer.destroy()` disposes the renderer and leaves the context to garbage
 * collection, and a browser keeps about sixteen: the pano screen makes a sphere for every pano and every return from
 * Fleet, so each one hands its context back by name when it goes.
 */
function loseContext(canvas: HTMLCanvasElement | null): void {
  canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
}

/**
 * The lazy half of `SphereView` (the barrel never names it, so that three.js and the viewer load in a chunk of their own,
 * the first time a sphere is drawn): ONE Photo Sphere Viewer per mount, a cube of six photos, and the areas laid on it as
 * markers. What each prop means is `SphereView`'s doc comment; this file is how.
 *
 * One viewer per mount: the screen re-renders on every `onLook`, so nothing here is keyed on an object's identity. The
 * panorama is its six URLs, the markers are their content (`JSON.stringify` of the areas and the choice), and a change in
 * either goes through `setPanorama` / `setMarkers`, never a new viewer. Callbacks and the other props the viewer's own
 * event handlers read live in `latest`, written before any effect runs.
 */
export function SphereCanvas({ faces, regions, selectedId, onSelect, look, onLook, fullscreen, onFullscreen, zoomHint, leaveLabel, onTrouble }: SphereCanvasProps) {
  /** The element handed to the library as its `container`: it appends its own root inside and takes the wheel through it. */
  const stageRef = useRef<HTMLDivElement>(null);
  /** The mount's one viewer, so the effects below can reach what the creating effect made; null before it and after its teardown. */
  const viewerRef = useRef<Viewer | null>(null);
  /** The viewer's markers plugin, so the effects below can set the areas and turn to one; null whenever `viewerRef` is. */
  const markersRef = useRef<MarkersPlugin | null>(null);
  /** The props the viewer's event handlers read at the moment an event fires, not at the render that registered them. */
  const latest = useRef({ faces, regions, selectedId, onSelect, look, onLook, fullscreen, onFullscreen, zoomHint, leaveLabel, onTrouble });
  /** The six URLs the viewer holds, so a new `faces` object that names the same photos is known for the same panorama. */
  const heldFacesKey = useRef('');
  /** The look last reported (or opened at): a `look` equal to it is the caller handing our own report back, and turns nothing. */
  const lastLook = useRef(look);
  /** The area the view has already dealt with: the one it opened on, or the one it reported pressed. Only another one turns the view. */
  const accountedSelection = useRef<string | null>(selectedId);

  useLayoutEffect(() => {
    latest.current = { faces, regions, selectedId, onSelect, look, onLook, fullscreen, onFullscreen, zoomHint, leaveLabel, onTrouble };
  });

  const facesKey = facesKeyOf(faces);
  const markersKey = JSON.stringify([regions, selectedId]);

  // The viewer: made once, torn down once.
  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return undefined;
    const opening = latest.current;
    heldFacesKey.current = facesKeyOf(opening.faces);
    lastLook.current = opening.look;
    accountedSelection.current = opening.selectedId;

    const viewer = new Viewer({
      container: stage,
      adapter: CubemapAdapter,
      panorama: panoramaOf(opening.faces),
      plugins: [[MarkersPlugin, {}]],
      // The only button: the way out of fullscreen, which on a phone has no Escape. Hidden until the viewer is fullscreen.
      navbar: ['fullscreen'],
      minFov: MIN_FOV_DEG,
      maxFov: MAX_FOV_DEG,
      defaultYaw: toRadians(opening.look.yawDeg),
      defaultPitch: toRadians(opening.look.pitchDeg),
      defaultZoomLvl: zoomLevelOfFov(opening.look.fovDeg),
      touchmoveTwoFingers: false,
      loadingTxt: '',
      // A photo that will not load draws the library's error overlay; its sentence is English only, and the words of a
      // trouble are the caller's (`onTrouble`), so the overlay keeps its icon and says nothing. The one button is shown only
      // while the viewer is fullscreen, so what its title (and the name it gives assistive technology) must say is how to leave.
      lang: { loadError: '', fullscreen: opening.leaveLabel },
      // The box's own ground, so a face still loading never shows black. Set as CSS on the canvas, so the token resolves live.
      canvasBackground: 'var(--surface2)',
    });
    // `new Viewer` does not throw when WebGL is missing: it draws its own error and returns with no renderer. `SphereView`
    // asks first and never gets here without WebGL 2, so this is the net under a context the browser refused anyway.
    if (!viewer.renderer) {
      latest.current.onTrouble?.('no_webgl');
      return undefined;
    }
    // A face that will not load rejects this promise as well as raising `panorama-error`, and nothing else holds it.
    viewer.state.loadingPromise?.catch(() => undefined);
    // The navbar is the way out of fullscreen and nothing else, so it shows only while the viewer is fullscreen. The library
    // opens it itself when the first photo is up (`init()`, just before `ready`), hence the second call, on `ready`.
    const settleNavbar = () => {
      if (viewer.isFullscreenEnabled()) viewer.navbar.show();
      else viewer.navbar.hide();
    };
    /** The iPhone emulated fullscreen's way out of the app's containing blocks; see `sphere/fixedContaining.ts`. */
    const releaseFixedContainingBlock = fixedContainingRelease(stage);
    settleNavbar();
    viewer.addEventListener('ready', settleNavbar);
    const markers = viewer.getPlugin<MarkersPlugin>(MarkersPlugin);
    viewerRef.current = viewer;
    markersRef.current = markers;

    let reportTimer: number | undefined;
    const reportLook = () => {
      reportTimer = undefined;
      const position = viewer.getPosition();
      const resting: SphereLook = {
        yawDeg: foldYaw(toDegrees(position.yaw)),
        pitchDeg: toDegrees(position.pitch),
        fovDeg: fovOfZoomLevel(viewer.getZoomLevel()),
      };
      if (sameLook(resting, lastLook.current)) return;
      lastLook.current = resting;
      latest.current.onLook?.(resting);
    };
    const scheduleLookReport = () => {
      window.clearTimeout(reportTimer);
      reportTimer = window.setTimeout(reportLook, REST_MS);
    };
    viewer.addEventListener('position-updated', scheduleLookReport);
    viewer.addEventListener('zoom-updated', scheduleLookReport);

    viewer.addEventListener('panorama-error', () => latest.current.onTrouble?.('photo_failed'));
    viewer.addEventListener('fullscreen', ({ fullscreenEnabled }) => {
      releaseFixedContainingBlock(stage.classList.contains('psv-fullscreen-emulation'));
      settleNavbar();
      latest.current.onFullscreen(fullscreenEnabled);
    });
    // Two presses on two different areas less than 300 ms apart report only the first: the viewer's own single-click window
    // (`DBLCLICK_DELAY`, core) dispatches no click for a second one at another point, and 5.15.1 has no option to turn it off.
    markers.addEventListener('select-marker', ({ marker }) => {
      const id = regionIdOfMarker(marker.id);
      accountedSelection.current = id;
      latest.current.onSelect?.(id);
    });
    // A fullscreen the browser refuses (a request with no press behind it) is told to the caller, who asked for it and would
    // otherwise stay enlarged. The browser answers a refusal with `fullscreenerror` AT the stage and does not bubble it, so the
    // listener is on the stage itself. The library also drops the request's promise, which makes a refusal an unhandled
    // rejection: the stage's own `requestFullscreen` (the element the library calls) takes the rejection, as the event says it.
    const onFullscreenError = () => latest.current.onFullscreen(false);
    stage.addEventListener('fullscreenerror', onFullscreenError);
    const requestFullscreen = stage.requestFullscreen.bind(stage);
    stage.requestFullscreen = (options) => requestFullscreen(options).catch(() => undefined);
    const stopWheelGate = gateWheel(stage, viewer, () => latest.current.zoomHint);

    return () => {
      // Hold the canvas before the viewer lets go of it: `destroy()` removes it from the page.
      const canvas = stage.querySelector<HTMLCanvasElement>('canvas.psv-canvas');
      if (reportTimer !== undefined) {
        window.clearTimeout(reportTimer);
        reportLook();
      }
      // The browser leaves fullscreen on its own for a removed element, with no event this viewer is still alive to hear.
      if (viewer.isFullscreenEnabled()) latest.current.onFullscreen(false);
      releaseFixedContainingBlock(false);
      stopWheelGate();
      stage.removeEventListener('fullscreenerror', onFullscreenError);
      // Back to the element's own method, so a StrictMode re-run wraps the real one and not the wrapper.
      Reflect.deleteProperty(stage, 'requestFullscreen');
      viewerRef.current = null;
      markersRef.current = null;
      try {
        viewer.destroy();
      } catch (error) {
        console.error('SphereView: the viewer would not take itself down', error);
      }
      loseContext(canvas);
    };
  }, []);

  // A different set of photos (a Retry re-reads them) is a new panorama on the same viewer.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (viewer === null || facesKey === heldFacesKey.current) return;
    heldFacesKey.current = facesKey;
    // Its failure also arrives as `panorama-error`, which is where the caller hears of it.
    viewer.setPanorama(panoramaOf(latest.current.faces), { transition: false }).catch(() => undefined);
  }, [facesKey]);

  // The areas, in the order that stacks them: a change in what they say or which is chosen, never in the array's identity.
  useEffect(() => {
    markersRef.current?.setMarkers(markerConfigsOf(latest.current.regions, latest.current.selectedId));
  }, [markersKey]);

  // An area chosen somewhere else (the list) turns the view to it. One chosen on the sphere, or already chosen when the
  // viewer was made, turns nothing: the view is where its caller said (`look`) or where the pointer put it.
  useEffect(() => {
    const markers = markersRef.current;
    const handled = accountedSelection.current;
    accountedSelection.current = selectedId;
    if (markers === null || selectedId === null || selectedId === handled) return;
    if (!latest.current.regions.some((region) => region.id === selectedId)) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // A falsy speed rotates at once; leaving it out takes the plugin's own pace.
    void markers.gotoMarker(selectedId, reducedMotion ? 0 : undefined);
  }, [selectedId]);

  // A new `look` turns the view there, unless it is the one we just reported.
  useEffect(() => {
    const viewer = viewerRef.current;
    const wanted = latest.current.look;
    if (viewer === null || sameLook(wanted, lastLook.current)) return;
    lastLook.current = wanted;
    const target = { yaw: toRadians(wanted.yawDeg), pitch: toRadians(wanted.pitchDeg), zoom: zoomLevelOfFov(wanted.fovDeg) };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      viewer.rotate(target);
      viewer.zoom(target.zoom);
    } else {
      void viewer.animate({ ...target, speed: TURN_SPEED });
    }
  }, [look.yawDeg, look.pitchDeg, look.fovDeg]);

  // The caller's fullscreen, made true on the viewer. The other way round arrives through the viewer's own `fullscreen` event.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (viewer === null || fullscreen === viewer.isFullscreenEnabled()) return;
    if (fullscreen) viewer.enterFullscreen();
    else viewer.exitFullscreen();
  }, [fullscreen]);

  return <div ref={stageRef} className="vv-sphere__stage" />;
}
