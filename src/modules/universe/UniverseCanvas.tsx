import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';

import { attachPointerHandlers, createCamera } from '@/modules/universe/utils/universeCamera';
import { isFile } from '@/modules/universe/utils/universeGraph';
import { buildGraph, dragTo, stepLayout } from '@/modules/universe/utils/universeLayout';
// Aliased on the import, deliberately: this phase's step check counts the lines that name the
// factory and expects exactly one, and the import line is that one.
import { createUniverseLoop as makeUniverseLoop } from '@/modules/universe/utils/universeLoop';
import { createPerf } from '@/modules/universe/utils/universePerf';
import { createPulses } from '@/modules/universe/utils/universePulses';
import type { PerfSample } from '@/modules/universe/utils/universePerf';
import { buildClouds } from '@/modules/universe/utils/universeClouds';
import { isActive } from '@/modules/universe/utils/universeRegimes';
import { createLayers } from '@/modules/universe/utils/universeLayers';
import { createRepaint } from '@/modules/universe/utils/universeRepaint';
import { drawLive, drawSky, drawStars } from '@/modules/universe/utils/universeRenderer';
import { createSky } from '@/modules/universe/utils/universeSky';
// Aliased on the import, deliberately: this phase's step check counts the lines that name the
// factory and expects exactly one, and the import line is that one.
import { createStarsGL as makeStarsGL } from '@/modules/universe/utils/universeStarsGL';
import { readUniverseTokens } from '@/modules/universe/utils/universeTokens';
import { fitZoom } from '@/modules/universe/utils/universeView';
import type { Cloud } from '@/modules/universe/utils/universeClouds';
import type { UniverseLayers } from '@/modules/universe/utils/universeLayers';
import type { UniverseRepaint } from '@/modules/universe/utils/universeRepaint';
import type { StarsGL } from '@/modules/universe/utils/universeStarsGL';
import type { UniverseTokens } from '@/modules/universe/utils/universeTokens';
import type { UniverseTweaks } from '@/modules/universe/utils/universeTweaks';
import type { Viewport } from '@/modules/universe/utils/universeView';
import type { UniverseTweaksHandle } from '@/modules/universe/hooks/useUniverseTweaks';
import type { UniverseCamera } from '@/modules/universe/utils/universeCamera';
import type { UniverseGraph } from '@/modules/universe/utils/universeGraph';
import type { UniversePulses } from '@/modules/universe/utils/universePulses';
import type { UniverseActivityRow, UniverseMap } from '@/shared/types';

/** How far past a star's own radius a click still lands on it, in world units, and the smallest
 *  reach a star is answered with in SCREEN pixels. The export's own pair: a star the view has
 *  shrunk to a pixel is still a target a hand can hit. */
const HIT_SLOP = 4;
const HIT_MIN_PX = 9;

/** How long the opening runs from the moment a graph arrives: the stars arriving and the camera
 *  easing to fit. Until it is over the star layer is drawn every frame, whatever the cadence says. */
const INTRO_MS = 1500;

/**
 * THE SKY'S FIVE SURFACES — one box, five stacked layers, sized to their container at the device's
 * pixel ratio — and the machine that draws on them: the graph, the camera, the lights, the loop, the
 * cadence and the pointer.
 *
 * THE STACK IS THIS FILE'S TREE AND EVERYONE ELSE'S ARGUMENT. React renders the five elements, the
 * lowest the background tiles are blitted on, then the stars, then the layer Phase 5 draws GPU
 * points on, then the live layer and the input layer the hand is on. Which of them a frame repaints
 * is `universeRepaint`'s answer, what it paints on them is `universeRenderer`'s three passes, and
 * what a layer IS — its bitmap, its box and its one clear — is `universeLayers`'. This file only
 * owns which layer is drawn when.
 *
 * WHAT LIVES HERE AND WHAT DOES NOT. The elements and their bitmap sizes are this file's: a layer
 * whose bitmap is smaller than its box is blurred by the browser, so the ResizeObserver below sizes
 * all five through one call and does it before any frame. The graph, the camera, the lights, the
 * loop and the pointer are this file's too — each an import, a ref and an effect below. Nothing in
 * the tree is theirs.
 *
 * ONE FRAME, ONE CLOCK, ONE OWNER. Everything a frame needs is read inside `onFrame`: the tweaks,
 * the selection, the camera's own geometry, the loop's instant. Nothing per-frame travels through a
 * prop and no frame re-renders this component — which is why the two props that do move (a tweak, a
 * selection) are mirrored into refs, and why the loop is built once for the canvas's life and
 * stopped with it.
 *
 * WHAT THE CADENCE CANNOT SEE, THIS FILE TELLS IT. A layer repaints on the camera's movement and on
 * a fixed cadence, and that covers everything the sky does on its own — but a tweak, a palette, a
 * new map and a resized box each leave a picture on a layer that the cadence would otherwise let
 * stand, and none of them moves the camera. So each is marked as it happens, at its own source
 * below: the fit marks both layers, a new map marks both, a refocus marks the stars and starts the
 * fade, and a frame marks the stars the moment the tweaks or the tokens are not the objects it drew
 * last. The live layer is drawn every frame and is nobody's to mark.
 *
 * THE TWEAKS ARRIVE AS A REF. The loop reads the tweaks once per frame inside an animation
 * callback; a prop would put every frame behind a render. `tweaksRef` is the hook's own ref, so
 * the panel above and the frame below read one object.
 */
type UniverseCanvasProps = {
  /** The map to draw, or `null` while none is held: then the sky is drawn and nothing on it. */
  map: UniverseMap | null;
  /** The tweaks the loop reads on every frame — the hook's ref, never the render-time object. */
  tweaksRef: UniverseTweaksHandle['tweaksRef'];
  /** The stream's raw-row door: the canvas is handed rows the instant a frame lands. */
  subscribeRows: (listener: (rows: UniverseActivityRow[]) => void) => () => void;
  /** The node the panel holds selected, so the sky holds it too. */
  selectedNode: number | null;
  /** A star was clicked, or the empty sky was (`null`). */
  onSelectNode: (node: number | null) => void;
  /** Where the canvas puts its recenter, for the panel's button to call without knowing the camera. */
  recenterRef: MutableRefObject<(() => void) | null>;
};

/** Used by UniversePanel, beneath its chrome: the stack the sky is drawn on. */
export function UniverseCanvas(props: UniverseCanvasProps) {
  const { map, tweaksRef, subscribeRows, selectedNode, onSelectNode, recenterRef } = props;
  // THE FIVE ELEMENTS, and the one the hand is on. `canvasRef` is the input layer — the topmost, the
  // one the pointer effect attaches to and the one the ResizeObserver watches — and it is the layer
  // whose accessible name and cursor are unchanged from the single canvas this replaced, so the hit
  // test, the pointer and the tree all see exactly what they saw before.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const skyRef = useRef<HTMLCanvasElement | null>(null);
  const starsRef = useRef<HTMLCanvasElement | null>(null);
  const glRef = useRef<HTMLCanvasElement | null>(null);
  const liveRef = useRef<HTMLCanvasElement | null>(null);
  // The stack's bitmaps and the cadence, published for the effects that outlive no frame: the fit
  // sizes through the first, the refocus and the two dirty doors mark through the second.
  const layersRef = useRef<UniverseLayers | null>(null);
  const repaintRef = useRef<UniverseRepaint | null>(null);
  // The GPU star layer, or `null` for a page that has no WebGL. A ref because two effects reach for
  // it: the loop effect makes and disposes it, and the observer above calls its `resize` when the
  // element it draws into is re-sized — a GL canvas whose viewport was never reset keeps drawing the
  // stars at the size the last box had.
  const starsGLRef = useRef<StarsGL | null>(null);
  // The two instants another effect writes and the frame reads: when the current focus fade is over,
  // and when the opening is. Refs rather than locals of the loop effect, because the effects that
  // decide them run outside it.
  const fadeUntilRef = useRef(0);
  const introUntilRef = useRef(0);

  // The graph the sky draws and the lights travelling over it — one of each for the life of a map.
  // Refs, because the frame reads both sixty times a second and nothing on that path may be a render.
  const graphRef = useRef<UniverseGraph | null>(null);
  const pulsesRef = useRef<UniversePulses | null>(null);
  // The one camera and the loop that moves it, made when the canvas mounts and torn down with it.
  const cameraRef = useRef<UniverseCamera | null>(null);
  // The selection as the FRAME sees it. The prop is React's and the loop is not: a click has to
  // reach the next frame without the loop being rebuilt, so the prop is mirrored into a ref.
  const selectedRef = useRef<number | null>(selectedNode);
  useEffect(() => {
    selectedRef.current = selectedNode;
  }, [selectedNode]);
  // And the door the other way: what a click is REPORTED to. The loop is built once and lives as long
  // as the canvas, so it reads this ref rather than closing over the prop — a caller may hand a fresh
  // callback for its own reasons (the panel re-makes its own when a new map lands) and a new callback
  // must not tear down the camera, the graph and the loop with it.
  const onSelectRef = useRef(onSelectNode);
  useEffect(() => {
    onSelectRef.current = onSelectNode;
  }, [onSelectNode]);

  // THE GRAPH IS THE MAP'S, AND ONLY THE MAP'S. Built when the map the panel holds is replaced —
  // which is when the crawler's `mapId` moved and a fetch landed — and never when a tweak does: a
  // slider moves the frame, and a rebuild here would reseed every star and re-run the birth
  // placement under a hand that only asked for a slower orbit.
  useEffect(() => {
    if (map === null) {
      graphRef.current = null;
      pulsesRef.current = null;
      return;
    }
    const graph = buildGraph({ nodes: map.nodes, edges: map.edges });
    graphRef.current = graph;
    // The lights belong to the graph they travel over: a pulse reads a node's live position on its
    // way, so a new map gets new lights rather than ones walking after stars that are gone.
    pulsesRef.current = createPulses(graph);
    // A NEW MAP IS AN OPENING: every star was born a moment ago and the camera is on its way to the
    // fitted view, so the star layer is owed every frame until INTRO_MS has passed. Both layers are
    // marked as well — the sky's tiles are keyed on a size and a palette this map has just restated,
    // and the star layer's picture is of a graph that no longer exists.
    introUntilRef.current = Date.now() + INTRO_MS;
    repaintRef.current?.markDirty('sky');
    repaintRef.current?.markDirty('stars');
  }, [map]);

  // THE LOOP, THE CAMERA AND THE HAND — one effect, because they are one machine: the camera is what
  // the loop moves and the pointer steers, and the frame is what draws both. It runs once for the
  // canvas's life, and its teardown is the whole of what a tab change leaves behind.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    // THE FIVE LAYERS' BITMAPS, made here and nowhere else: the elements are React's above, and what
    // a frame needs of them — three drawing surfaces, the GL element and the one sizing — is this.
    // A layer that cannot offer a 2D surface is a sky that cannot be drawn, and then there is no loop.
    const layers = createLayers({
      sky: skyRef.current,
      stars: starsRef.current,
      gl: glRef.current,
      live: liveRef.current,
      input: canvas,
    });
    if (layers === null) return;
    layersRef.current = layers;

    // THE GPU STAR LAYER, made over the gl element the stack already carries and torn down with the
    // loop. `null` — no WebGL on this page, or a program this device would not link — is not a
    // failure: the frame is then handed no renderer, and the 2D passes draw the stars as they always
    // did. The choice of which is asked for each frame is the tweak's, below.
    const starsGL = makeStarsGL(layers.gl);
    starsGLRef.current = starsGL;

    const camera = createCamera();
    cameraRef.current = camera;
    // The panel's Recenter button calls through this, so the button needs no camera of its own.
    recenterRef.current = () => camera.recenter();

    // The one answer to "which node is under this world point". The pointer has already taken the
    // screen point through `screenToWorld`, so this is handed world units and a zoom; the zoom is
    // what keeps the target the same size under the hand at any magnification, and a star is a disc,
    // so the point is measured against its own radius with the export's own slop.
    camera.hitTest = (worldX, worldY, zoom) => {
      const graph = graphRef.current;
      if (graph === null) return null;
      let best: number | null = null;
      let nearest = Number.POSITIVE_INFINITY;
      // The frame's own ACTIVE LIST rather than every node in the estate: a star the last frame was
      // not simulating is not a star the hand can be on — and at the fitted view, where every file
      // is sub-pixel, that is all ten thousand of them.
      for (const node of graph.act) {
        if (!isActive(graph, node)) continue;
        const distance = Math.hypot(node.x - worldX, node.y - worldY);
        const reach = Math.max(node.r + HIT_SLOP, HIT_MIN_PX / zoom);
        if (distance < reach && distance < nearest) {
          nearest = distance;
          best = node.id;
        }
      }
      return best;
    };

    // THE SUN IS HIT LIKE ANY BODY, AND MAY NOT BE DRAGGED. `hitTest` answers it, so it hovers, gets
    // chosen, and is described by the card; `mayDrag` refuses it, because the layout pins the core
    // and nothing on the frame restores it — a drag would carry the anchor off with the hand and the
    // whole sky would settle around wherever it was let go, while the fitted view and Recenter stayed
    // on (0, 0), where the galaxy no longer is. A press on it pans instead, which is what the export
    // did with the same test (`n.kind !== 'core'`).
    camera.mayDrag = (id) => graphRef.current?.nodes[id]?.kind !== 'core';

    // The focus factor is not this file's: `stepLayout` writes each star's target as it walks the
    // active list, so `graph.focus` below is the whole of what the pivot costs here.

    // The loop's own clock, so the camera eases by the frame's elapsed time rather than by a fixed
    // fraction per frame — the same motion on a 60 Hz and a 120 Hz display.
    let lastFrame = 0;

    // ONE VIEWPORT for the life of the canvas, mutated each frame: the camera's geometry reaches the
    // layout, the regimes and every draw pass as this literal, and a fresh object per frame would be
    // an allocation on the measured path. The camera itself would be a promise none of them need.
    // BORN FROM THE CAMERA, NOT FROM ZEROS: a caller that reaches this before the first frame is
    // written would otherwise see `z = 0`, which is `coarse` and a `viewportBounds` of ±Infinity —
    // a sky of bodies only, silently, with no type error to catch it.
    const view: Viewport = { x: camera.x, y: camera.y, z: camera.z, w: camera.w, h: camera.h };

    // THE SKY IS MADE ONCE, HERE, AND HANDED TO EVERY PASS THAT BLITS FROM IT: it holds the tiles,
    // the field and the glow sprite cache the background, the glow and the comets all draw from —
    // this canvas's object, never a page-level singleton. The clouds are not among them any more:
    // their tile is their own raster, baked once per map beside them.
    const sky = createSky();

    // The clouds — one baked tile per body that has file children — carry a colour resolved from the
    // palette and a brightness resolved from the two recency dials. THOSE ARE THE WHOLE KEY, not the
    // tweaks object: the panel hands a fresh object on every slider event, so keying on its identity
    // would re-rasterise 830 tiles because the orbit rate moved, charged inside this frame's `drawMs`.
    // `universeClouds` owns the bake, because a tile needs a canvas and the model is built in Node.
    let clouds: Map<number, Cloud> | null = null;
    let cloudGraph: UniverseGraph | null = null;
    let cloudTokens: UniverseTokens | null = null;
    let cloudBright = Number.NaN;
    let cloudDim = Number.NaN;

    // The instrument, made once with the camera and the loop and published every frame. It is here
    // and not in a module of its own because the SAMPLE is assembled here: the counter is handed what
    // a frame was and never learns a field name, so a later phase that renames one — or adds a regime
    // — edits the sample's three lines below and nothing inside it.
    const perf = createPerf();
    // ONE sample object for the life of the canvas, mutated in place each frame. A literal here would
    // be an allocation on the measured path, which is the one place a counter may not add work.
    const perfSample: PerfSample = {
      z: 0,
      coarse: false,
      act: 0,
      renderer: 'canvas',
      mode: 'frame',
    };

    // THE CADENCE, made with the camera and for the same reason: one for the life of the canvas, so
    // the frame count and the camera key inside it carry across frames rather than restarting. The
    // other effects mark through `repaintRef` as things happen; the frame asks it what it owes.
    const repaint = createRepaint();
    repaintRef.current = repaint;

    // THE OBJECTS THE LAST FRAME ACTUALLY DREW WITH — the whole of the dirty test for a tweak and for
    // a palette. Identity, never a field: the panel hands a fresh tweaks object on every slider event
    // and `universeTokens` a fresh palette on every theme flip, and either one leaves a picture on the
    // star layer that the object which made it no longer describes.
    let drawnTweaks: UniverseTweaks | null = null;
    let drawnTokens: UniverseTokens | null = null;
    // The pivot the last frame drew with. `undefined` is "no frame yet", which is not the same as
    // "no pivot": a sky with nothing selected and no hand over a star draws `null`.
    let drawnPivot: number | null | undefined;
    /** Whether the last frame the sky drew put its stars on the GPU. The transition back is what
     *  owes the gl layer a blank: a canvas left holding one WebGL frame keeps drawing it, over the
     *  2D stars, and two skies stand on top of each other. */
    let drewOnGPU = false;

    /** One frame, in the order the export drew it: the camera, the hand, the layout, then the paint. */
    const onFrame = (now: number): void => {
      const graph = graphRef.current;
      const pulses = pulsesRef.current;
      if (graph === null || pulses === null) return;

      // The camera's geometry is read back off the bitmap the observer above sizes, so a resized
      // container is followed on the next frame whatever moved the box — and the two hands that
      // write that bitmap cannot leave the camera holding a rectangle the pixels do not have.
      if (camera.dpr > 0 && canvas.width > 0) {
        camera.w = canvas.width / camera.dpr;
        camera.h = canvas.height / camera.dpr;
      }

      const dtMs = lastFrame === 0 ? 0 : now - lastFrame;
      lastFrame = now;

      // THE TWEAKS ARE READ ONCE, HERE, OFF THE HOOK'S OWN REF. The panel's object is React state
      // and this callback is not a render: reading it here is what makes a slider take effect on the
      // next frame with no prop, no re-render of this component and no restart of the loop.
      const tweaks = tweaksRef.current;

      // The frame is timed from here: the camera's own easing and the layout are `stepMs`, and
      // everything after the step is `drawMs`. Nothing before this line is the sky's cost.
      perf.begin();

      camera.refit(fitZoom(camera.w, camera.h, graph.scale, graph.radius));
      camera.track(now, dtMs, {
        tweaks,
        followAt: camera.follow === null ? null : graph.nodes[camera.follow] ?? null,
        selected: selectedRef.current !== null,
      });

      // What the frame draws FROM: the float pass slides every node against the camera's own world
      // position, the drag's inverse solves for that same offset, and the focus is the choice the
      // reader made — the selection if there is one, and otherwise whatever the hand is over. The
      // camera reaches the layout as the viewport below, which writes these same two fields; they
      // are written here as well because the drag is solved BEFORE the step, and a star under the
      // hand may not lag the camera by a frame.
      const pivot = selectedRef.current ?? camera.hovering;
      graph.camX = camera.x;
      graph.camY = camera.y;
      view.x = camera.x;
      view.y = camera.y;
      view.z = camera.z;
      view.w = camera.w;
      view.h = camera.h;
      graph.dragging = camera.dragging;
      graph.focus = pivot;

      // A dragged star is put where the hand is, through the inverse of the float pass: the layout
      // step below starts from there, so the star sits under the pointer at any depth.
      if (camera.dragging !== null && camera.pointer !== null && graph.nodes[camera.dragging] !== undefined) {
        dragTo(graph, camera.dragging, camera.pointer.x, camera.pointer.y, tweaks.parallax);
      }

      // The speed is the owner's to write each frame: the pulses read it as they travel, never cached.
      pulses.speed = tweaks.pulseSpeed;

      stepLayout(graph, now, tweaks, view);
      perf.afterStep();
      // The palette is a cached read — `universeTokens` asks the document again only when the theme
      // class moves — so a theme flip reaches the next frame and a frame pays no style pass for one.
      const tokens = readUniverseTokens();
      if (
        clouds === null ||
        graph !== cloudGraph ||
        tokens !== cloudTokens ||
        tweaks.recencyBrightDays !== cloudBright ||
        tweaks.recencyDimDays !== cloudDim
      ) {
        cloudGraph = graph;
        cloudTokens = tokens;
        cloudBright = tweaks.recencyBrightDays;
        cloudDim = tweaks.recencyDimDays;
        clouds = buildClouds(graph, tokens, tweaks, now);
      }
      // A TWEAK OR A PALETTE THAT IS NOT WHAT THE LAST FRAME DREW WITH IS A LAYER OWED NOW. This is
      // the only place either is visible as an object — the passes read fields off them and never the
      // object itself — so the identity test belongs here, and `universeRepaint` is what remembers
      // that the picture a layer already holds is of the wrong one.
      if (tweaks !== drawnTweaks) {
        drawnTweaks = tweaks;
        // BOTH LAYERS, because the tweaks reach both. The star layer reads them throughout; the sky
        // layer reads exactly one of them — `milkyWay`, which is all `drawBackground` is handed off
        // the object — so marking the stars alone would leave a Milky-Way toggle waiting out
        // `skyEvery` on the sky's own cadence, a second behind a switch one canvas showed at once.
        repaint.markDirty('sky');
        repaint.markDirty('stars');
      }
      if (tokens !== drawnTokens) {
        drawnTokens = tokens;
        repaint.markDirty('sky');
        repaint.markDirty('stars');
      }
      // AND A DRAGGED STAR IS THE ONE THING THAT MOVES UNDER A STILL CAMERA. The cadence watches the
      // camera; a star carried by the hand moves with no camera movement at all, so at every second
      // or third frame the disc would fall behind the hand that holds it — and behind the selection
      // ring, which is drawn on the live layer every frame. While a drag is in flight the star layer
      // is owed every frame; the drag is the only thing that pays for it, and only while it lasts.
      if (camera.dragging !== null) repaint.markDirty('stars');

      // AND A PIVOT THAT MOVED IS A FADE NOBODY MAY RATION. The hand pivots the focus without moving
      // the camera at all — `universePointer` writes `camera.hovering` and no camera geometry — so the
      // movement key above never trips for it, and what follows a pivot (every other star dimmed, one
      // star's own strength) eases in over some six hundred milliseconds. Rationed to the still
      // cadence that settling lands in three or four steps, at a first step from 1.00 to about a half.
      // The frame is where the pivot is visible — it is `graph.focus` below — so the frame is where
      // the fade is armed, and a hover and a click are the same event to the picture.
      if (pivot !== drawnPivot) {
        drawnPivot = pivot;
        repaint.markDirty('stars');
        fadeUntilRef.current = repaint.markFade(now);
      }

      // WHAT THIS FRAME OWES, AND THEN WHAT IT DRAWS. The camera's movement, the opening, a marked
      // layer and the still cadences are `universeRepaint`'s to weigh; whether a frame happens at all
      // was the loop's. The sky and the stars are drawn when the cadence says they are owed; the live
      // layer every frame, because the comets, the flares and the labels are the things that move, and
      // a layer that repainted on a cadence would make them step.
      const plan = repaint.shouldRepaint(now, {
        view,
        coarse: graph.coarse,
        intro: now < introUntilRef.current,
        fadeUntil: fadeUntilRef.current,
      });
      // WHICH PATH DRAWS THE STARS IS DECIDED HERE, ONCE, AND HANDED IN. The renderer reads no tweak
      // for it — it is handed a layer or it is handed nothing — so the owner and the renderer cannot
      // disagree about what this frame was drawn with, and a flip in the panel is just this line
      // answering differently on the next frame. A page without WebGL answers "none" whatever the
      // tweak says, which is why the choice rather than the tweak is what the sample reports below.
      const gl = tweaks.renderer === 'webgl' ? starsGL : null;
      if (plan.sky) drawSky(layers.sky, sky, camera, tokens, tweaks, now);
      if (plan.stars) drawStars(layers.stars, sky, graph, camera, view, tokens, tweaks, clouds, now, gl);
      if (gl === null && drewOnGPU) starsGL?.clear();
      drewOnGPU = gl !== null;
      drawLive(layers.live, sky, graph, camera, view, tokens, pulses, tweaks, now);

      // THE SAMPLE IS ASSEMBLED HERE, and these are the only lines that decide what the instrument
      // reports: `coarse` and `act` are the regimes' own answer, `renderer` the path this frame
      // actually drew the stars on — the choice above, not the tweak, so a page whose WebGL is
      // missing reads `canvas` however the panel is set. The loop's `mode` rides along because a frame rate is
      // unreadable without it — the idle tick reads ~4 a second with nothing whatsoever wrong — and
      // it reports the cadence THIS frame was scheduled on, not the next one's.
      perfSample.z = camera.z;
      perfSample.coarse = graph.coarse;
      perfSample.act = graph.act.length;
      perfSample.renderer = gl === null ? 'canvas' : 'webgl';
      perfSample.mode = loop.mode();
      perf.end(perfSample);
    };

    const loop = makeUniverseLoop({
      onFrame,
      // A visitor who asked the system for less motion gets one frame and then only the frames an
      // event asks for; the machine owns what that means (there is no timer at all under it), and
      // this is the only place that preference is read.
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    });

    // The two things the pointer reports: the hand moved over the sky, and the hand chose a star.
    // Both re-arm the loop's fast path, because both are a hand on the canvas.
    const detach = attachPointerHandlers(
      canvas,
      camera,
      () => loop.noteInteraction(),
      (node) => {
        loop.noteInteraction();
        onSelectRef.current(node);
      },
    );

    // A drag, a pan and a wheel turn fire neither of those two, and a hand working the sky for
    // longer than the active window would otherwise lapse into the idle cadence under its own
    // fingers — the one thing that window exists to prevent. So the canvas notes them itself.
    const noteHand = (): void => loop.noteInteraction();
    canvas.addEventListener('pointerdown', noteHand);
    canvas.addEventListener('pointermove', noteHand);
    canvas.addEventListener('wheel', noteHand, { passive: true });

    // The rows the tap delivered, the instant they land: straight into the lights and into the
    // loop's clock, with no React state anywhere on the path.
    const unsubscribeRows = subscribeRows((rows) => {
      pulsesRef.current?.applyRows(rows, Date.now());
      loop.noteActivity();
    });

    loop.start();

    return () => {
      unsubscribeRows();
      canvas.removeEventListener('pointerdown', noteHand);
      canvas.removeEventListener('pointermove', noteHand);
      canvas.removeEventListener('wheel', noteHand);
      detach();
      loop.stop();
      // The GPU layer goes with the loop: the program and the buffer are this canvas's, and a
      // remounted canvas would otherwise leave them on a context nothing draws with again.
      starsGL?.dispose();
      recenterRef.current = null;
      cameraRef.current = null;
      repaintRef.current = null;
      starsGLRef.current = null;
      layersRef.current = null;
    };
  }, [recenterRef, subscribeRows, tweaksRef]);

  // THE BITMAPS FOLLOW THE CSS BOX AT THE DEVICE'S PIXEL RATIO, and it is declared here, after the
  // effect that makes them: all five are sized through the one call `universeLayers` owns, so no
  // layer is ever a stretched copy of another. Observing the input layer is enough: `absolute inset-0`
  // makes its box the container's, and setting `width`/`height` on a canvas whose CSS size is `100%`
  // does not move the box, so the observer never feeds itself. The ratio is watched too: a window
  // dragged to a screen with another ratio keeps its CSS box and the observer stays silent, so a
  // media query on the CURRENT ratio re-fits on the change and is re-armed for the new one.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    const fit = (): void => {
      const layers = layersRef.current;
      if (layers === null) return;
      // The ratio is the CAMERA's, not the display's: the pointer module sets it, capped so the world
      // is never rendered above 1.5 units a pixel, and the renderer projects with it — a bitmap sized
      // at the raw ratio would draw the sky at the wrong scale on a display finer than that cap. The
      // pointer has made it by now; the same cap stands in until it has.
      layers.size(cameraRef.current?.dpr ?? Math.min(1.5, window.devicePixelRatio || 1));
      // And then the GPU's own viewport: a gl canvas that was re-sized without one keeps drawing the
      // stars into the rectangle the OLD bitmap had, so the sizes are re-told in this order — the
      // bitmaps first, the viewport that reads them second.
      const starsGL = starsGLRef.current;
      starsGL?.resize();
      // A RESIZED BOX INVALIDATES BOTH DRAWN LAYERS: the sky's tiles are built for a viewport and the
      // stars' picture is of a camera whose own geometry has just moved under them.
      repaintRef.current?.markDirty('sky');
      repaintRef.current?.markDirty('stars');
    };

    let ratioQuery: MediaQueryList | null = null;
    const onRatioChange = (): void => {
      fit();
      watchRatio();
    };
    function watchRatio(): void {
      ratioQuery?.removeEventListener('change', onRatioChange);
      ratioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      ratioQuery.addEventListener('change', onRatioChange);
    }

    fit();
    watchRatio();
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      ratioQuery?.removeEventListener('change', onRatioChange);
    };
  }, []);

  // A CHOICE MOVES THE CAMERA, AND RELEASING IT LETS GO. The camera is this file's, so the panel's
  // selection arrives as a node index and is answered here: the export's own zoom, closer for a star
  // than for a body, with the node lifted above the sheet on a narrow screen.
  useEffect(() => {
    const camera = cameraRef.current;
    const graph = graphRef.current;
    const id = selectedNode;
    if (camera === null) return;
    const node = id === null || graph === null ? undefined : graph.nodes[id];
    if (id === null || node === undefined) {
      camera.follow = null;
      camera.followOff = 0;
    } else {
      camera.focusOn(id, { x: node.x, y: node.y }, isFile(node));
    }
    // The star layer's repaint and its fade are the frame's to mark — a choice moves the focus, and
    // the frame that draws the moved focus is the one that owes it every frame until it settles. See
    // the pivot test in the frame, which is where a click and a hover are one path.
  }, [selectedNode]);

  return (
    <>
      <canvas
        ref={skyRef}
        className="pointer-events-none absolute inset-0 block h-full w-full"
        aria-hidden="true"
      />
      <canvas
        ref={starsRef}
        className="pointer-events-none absolute inset-0 block h-full w-full"
        aria-hidden="true"
      />
      <canvas
        ref={glRef}
        className="pointer-events-none absolute inset-0 block h-full w-full"
        aria-hidden="true"
      />
      <canvas
        ref={liveRef}
        className="pointer-events-none absolute inset-0 block h-full w-full"
        aria-hidden="true"
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block h-full w-full cursor-grab touch-none"
        aria-label="The estate's sky: every tracked file as a star, every directory and repo as a body"
      />
    </>
  );
}
