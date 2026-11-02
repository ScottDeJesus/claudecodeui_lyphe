import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useCanvasBackingSide } from '@/modules/companion/hooks/useCanvasBackingSide';
import { useReducedMotion } from '@/modules/companion/hooks/useReducedMotion';
import type { FaceAtlas } from '@/modules/companion/hooks/useFaceAtlas';
import { createFaceEngine, frameNames } from '@/modules/companion/utils/faceEngine';
import type { FaceDraw } from '@/modules/companion/utils/faceEngine';
import type { FacePlaying } from '@/modules/companion/utils/faceMoodHold';
import { createHeadMemory, stampHead } from '@/modules/companion/utils/portraitHead';
import type { CompanionFaceLook, CompanionFaceSentences, CompanionFaceVoice, CompanionPresenceState } from '@/shared/types';

type CompanionPortraitProps = {
  /** Her face, decoded: the manifest and the sheets its frames are cut from (`useFaceAtlas`). A new atlas is a new face, played from its first frame. */
  atlas: FaceAtlas;
  /** What she is doing: the engine picks her face from it (listening leans toward the sound, thinking looks up and away, speaking moves her mouth). */
  presence: CompanionPresenceState;
  /** The page's voice, read by the loop while she speaks; null where no voice sounds (Settings' preview). */
  voice: CompanionFaceVoice | null;
  /** The sentences she says: the one sounding sets her mood and her vowels, the newest sets the mood on a page that plays no voice. */
  sentences: CompanionFaceSentences;
  /** Where the anchor she looks at lies from her; null when no look holds. She turns her head toward it. */
  look: CompanionFaceLook | null;
};

/**
 * The sentence the player is sounding now: its log entry's words with the audio's place in them and the timed mouth shapes the page has heard for it,
 * or null when the entry is not the one the player names. The shapes are looked up here on every step, so a piece that landed since the last one is in hand.
 */
function playingNow(entry: CompanionFaceSentences['playing'], voice: CompanionFaceVoice | null): FacePlaying | null {
  if (entry === null || voice === null) return null;
  const progress = voice.progress();
  if (progress === null || entry.turnId !== progress.turnId || entry.index !== progress.index) return null;
  return {
    mood: entry.mood, text: entry.text, sounds: entry.sounds, elapsed: progress.elapsed, duration: progress.duration,
    mouth: voice.mouth(entry.turnId, entry.index),
  };
}

/**
 * How far the hair lags the face, ms: the `--kaylee-lag` the stylesheet gives the hair canvas, read from there so the two cannot disagree.
 * A clip's motion runs on the hair that much after it runs on the face, so it must stay on the root that much after the engine drops it.
 */
function hairLagMs(hairCanvas: HTMLCanvasElement): number {
  return Number.parseFloat(getComputedStyle(hairCanvas).getPropertyValue('--kaylee-lag')) || 0;
}

/**
 * Cuts frame `frame` out of its sheet onto `context`, whole, scaled to the canvas's own backing store (the cell's side is the atlas's tier,
 * the backing store's is the pixels the canvas is drawn at). A frame the manifest does not hold draws nothing, so a bad index leaves the last frame up.
 */
function drawFrame(context: CanvasRenderingContext2D, atlas: FaceAtlas, frame: number): void {
  const cell = atlas.manifest.frames[frame];
  const sheet = cell ? atlas.sheets[cell.sheet] : undefined;
  if (!cell || !sheet) return;
  const { frameSize } = atlas;
  const side = context.canvas.width;
  context.drawImage(sheet, cell.column * frameSize, cell.row * frameSize, frameSize, frameSize, 0, 0, side, side);
}

/**
 * Used by this module's CompanionAvatar, which draws it under her marks: her face as a player. The bake made her face once, as
 * frames in an atlas; this picks which frame to show (`faceEngine.ts`, in pure code) and draws it. No model runs and no GPU
 * is asked for: the page copies a square out of an image it has already decoded.
 *
 * TWO CANVASES, one frame. The HAIR canvas holds the whole frame; the FACE canvas holds the same frame under a feathered circular
 * mask over its inner part (CompanionAvatar.css). Both are drawn a little larger than the disc and clipped to its circle, so her
 * movement never shows the disc's ground at the rim. Their backing store is the pixels they are drawn at, CSS size times the screen's
 * pixel ratio (`useCanvasBackingSide`), never the atlas's cell size stretched by CSS, and each frame is scaled onto it with the
 * browser's high-quality smoothing: a screen that has more pixels than the atlas has detail shows the atlas's own detail, scaled
 * well, not a smaller picture stretched twice. A resize or a change of pixel ratio clears a canvas, so the loop restarts and draws again. Every continuous movement
 * is CSS on the compositor (breath, sway, her lean, her head's bob and roll, the clips' motions), and the hair takes each of them 90 ms after the face on a
 * softer ease: where the two canvases differ the mask blends them, so her face leads and her hair follows.
 *
 * WHEN IT DRAWS. A canvas is redrawn only when its frame changes: a mouth shape, a blink step, a mood, a glance, a turn, a clip frame,
 * or a step of a crossfade between two. Animation frames run while she speaks, during a crossfade or a clip (`FaceDraw.over` and
 * `motion`), and while her head settles after she has spoken (`FaceDraw.head`, at most 300 ms, and the hair's lag after it), and never
 * otherwise; the engine's `nextAt` is a timer deadline that wakes the loop for the next blink, glance or hold running out. A hidden page
 * schedules nothing and draws again the moment it is shown. Under reduced motion she speaks on one held mouth and her head holds still,
 * so no frame is asked for.
 *
 * HER MOUTH reads the page's timed shapes (`voice.mouth`) on each of those steps: wherever an announced piece holds the audio's place the
 * engine draws that shape's mouth, and elsewhere the level's. The store is not React state, so a piece landing mid-sentence takes over at
 * the next animation frame and nothing is redrawn for it.
 *
 * WHAT THE PROBES READ. The root's `data-frame` is the base frame's name and, during a crossfade, `data-frame-over` the frame
 * fading in (`frameNames`); `data-mouth` is what drove her mouth while she speaks, `exact` (a timed shape) or `voice` (her level and the
 * sentence's vowel), and is absent when she is not speaking and under reduced motion; `data-motion` and `--kaylee-tilt` are what the
 * stylesheet plays, and `--kaylee-bob` and `--kaylee-roll` are her head's, written on each LAYER (the hair's the value from `--kaylee-lag` ago,
 * read from a short history that is a ref) and removed from both once the hair's has come to rest. All are written straight onto the node, and
 * only when they change: nothing in React redraws at the loop's pace.
 */
export function CompanionPortrait({ atlas, presence, voice, sentences, look }: CompanionPortraitProps) {
  const reducedMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const hairRef = useRef<HTMLCanvasElement>(null);
  const faceRef = useRef<HTMLCanvasElement>(null);
  const hairLayerRef = useRef<HTMLDivElement>(null);
  const faceLayerRef = useRef<HTMLDivElement>(null);

  // The seed of this portrait's blinks and glances, made once: two pages (or the button and Settings' preview) should not blink in step.
  const [seed] = useState(() => Math.floor(Math.random() * 0x7fffffff));
  const { manifest } = atlas;
  const names = useMemo(() => frameNames(manifest), [manifest]);
  // One engine per manifest: a new face is a new engine, and the inputs changing never resets one mid-blink.
  const engine = useMemo(() => createFaceEngine(manifest, seed), [manifest, seed]);

  // What the canvases and the root's stamps show now, kept across the loop's restarts so a restart that changes nothing draws and writes nothing.
  // `motionHold` is the deadline that takes `data-motion` off the root once the hair has finished the motion the engine dropped; it outlives a restart.
  // `mouthBy` is the `data-mouth` the root carries now (null: none).
  const shown = useRef<{
    atlas: FaceAtlas | null; side: number; base: number; over: number | null; alpha: number; motion: string | null; tilt: number | null; motionHold: number | null;
    mouthBy: FaceDraw['mouthBy'];
  }>({ atlas: null, side: 0, base: -1, over: null, alpha: 0, motion: null, tilt: null, motionHold: null, mouthBy: null });

  // Her head's history (the engine's last answers with their times) and what each layer's variables hold now: refs kept across the loop's restarts.
  const headMemory = useRef(createHeadMemory());

  // A portrait that goes away takes its pending hold with it.
  useEffect(() => {
    const memory = shown.current;
    return () => {
      if (memory.motionHold !== null) window.clearTimeout(memory.motionHold);
    };
  }, []);

  // The pixels per side both canvases are drawn at on the screen; the atlas's own cell side stands until the canvas is measured.
  const side = useCanvasBackingSide(hairRef, atlas.frameSize);
  const { playing, newest, turnRunning } = sentences;
  const lookDx = look?.dx;
  const lookDy = look?.dy;

  // THE LOOP, restarted whenever an input changes: it steps the engine at once with the new inputs and schedules the next step itself. A layout
  // effect, so the first frame is on the canvases before the first paint (an opaque canvas starts black, and the sheets are already decoded).
  // `voice` is read by identity: its three functions are the provider's, kept for the page's life, and the caller keeps the object as long.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const hairCanvas = hairRef.current;
    const hairContext = hairCanvas?.getContext('2d', { alpha: false });
    const faceContext = faceRef.current?.getContext('2d', { alpha: false });
    const hairLayer = hairLayerRef.current;
    const faceLayer = faceLayerRef.current;
    if (!root || !hairCanvas || !hairContext || !faceContext || !hairLayer || !faceLayer) return undefined;
    const contexts = [hairContext, faceContext];
    // A canvas's size attribute resets its context, so the smoothing is set again each time the loop starts (it restarts when `side` changes).
    for (const context of contexts) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
    }
    const lookNow = lookDx === undefined || lookDy === undefined ? null : { dx: lookDx, dy: lookDy };
    const newestMood = newest === null ? null : newest.mood ?? '';
    let frameHandle: number | null = null;
    let timerHandle: number | null = null;

    // The two canvases take the same frame, the base whole and the one fading in on top at its alpha.
    const paint = (draw: FaceDraw): void => {
      const last = shown.current;
      const sameAtlas = last.atlas === atlas;
      const sameSide = last.side === side;
      if (sameAtlas && sameSide && last.base === draw.base && last.over === draw.over && last.alpha === draw.alpha) return;
      for (const context of contexts) {
        context.globalAlpha = 1;
        drawFrame(context, atlas, draw.base);
        if (draw.over !== null) {
          context.globalAlpha = draw.alpha;
          drawFrame(context, atlas, draw.over);
          context.globalAlpha = 1;
        }
      }
      if (!sameAtlas || last.base !== draw.base) root.dataset.frame = names[draw.base];
      if (!sameAtlas || last.over !== draw.over) {
        if (draw.over === null) delete root.dataset.frameOver;
        else root.dataset.frameOver = names[draw.over];
      }
      last.atlas = atlas;
      last.side = side;
      last.base = draw.base;
      last.over = draw.over;
      last.alpha = draw.alpha;
    };

    // What the stylesheet plays: the clip's motion and her lean, written only when they change, and with them the probes' `data-mouth` (no frame
    // change carries it: the exact mouth and the voice's draw the same frame names). The motion is taken off the root only once the
    // hair has finished it (its lag after the face): taking it off at the engine's end would cut the hair's animation short and snap it to rest.
    const stamp = (draw: FaceDraw): void => {
      const last = shown.current;
      if (last.mouthBy !== draw.mouthBy) {
        if (draw.mouthBy === null) delete root.dataset.mouth;
        else root.dataset.mouth = draw.mouthBy;
        last.mouthBy = draw.mouthBy;
      }
      if (last.motion !== draw.motion) {
        if (last.motionHold !== null) window.clearTimeout(last.motionHold);
        last.motionHold = null;
        last.motion = draw.motion;
        if (draw.motion !== null) {
          // Begun again inside the hold, under the same name: the attribute must leave and return for the animation to run again.
          if (root.dataset.motion === draw.motion) {
            delete root.dataset.motion;
            root.getBoundingClientRect();
          }
          root.dataset.motion = draw.motion;
        } else {
          last.motionHold = window.setTimeout(() => {
            last.motionHold = null;
            delete root.dataset.motion;
          }, hairLagMs(hairCanvas));
        }
      }
      if (last.tilt !== draw.tilt) {
        root.style.setProperty('--kaylee-tilt', `${draw.tilt}deg`);
        last.tilt = draw.tilt;
      }
    };

    // `lagMs` is read once per loop: a computed-style read after the head's writes each frame would force a restyle each frame.
    const lagMs = hairLagMs(hairCanvas);

    const step = (): void => {
      frameHandle = null;
      timerHandle = null;
      const now = performance.now();
      const draw = engine.step({
        now, presence, level: presence === 'speaking' ? voice?.level() ?? 0 : 0,
        playing: playingNow(playing, voice), newestMood, turnRunning, look: lookNow, reducedMotion,
      });
      paint(draw);
      stamp(draw);
      const hairTrails = stampHead(headMemory.current, faceLayer, hairLayer, lagMs, draw.head, now);
      if (document.hidden) return;
      const animating = (presence === 'speaking' && !reducedMotion) || draw.over !== null || draw.motion !== null || draw.head !== null || hairTrails;
      if (animating) frameHandle = requestAnimationFrame(step);
      // The delay is rounded up: a timer cuts a fractional delay down and would wake the engine just short of its deadline, to be told a new one a fraction away.
      else if (draw.nextAt !== null) timerHandle = window.setTimeout(step, Math.max(0, Math.ceil(draw.nextAt - now)));
    };

    const cancel = (): void => {
      if (frameHandle !== null) cancelAnimationFrame(frameHandle);
      if (timerHandle !== null) window.clearTimeout(timerHandle);
      frameHandle = null;
      timerHandle = null;
    };

    // A hidden page asks for nothing; shown again, it steps at once, and the engine catches up on what fell due.
    const handleVisibility = (): void => {
      cancel();
      if (!document.hidden) step();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    step();
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      cancel();
    };
  }, [atlas, side, engine, names, presence, voice, playing, newest, turnRunning, lookDx, lookDy, reducedMotion]);

  return (
    <div ref={rootRef} className="kaylee-portrait" aria-hidden="true" data-state={presence}>
      <div ref={hairLayerRef} className="kaylee-portrait__layer kaylee-portrait__layer--hair">
        <canvas ref={hairRef} width={side} height={side} />
      </div>
      <div ref={faceLayerRef} className="kaylee-portrait__layer kaylee-portrait__layer--face">
        <canvas ref={faceRef} width={side} height={side} />
      </div>
    </div>
  );
}
