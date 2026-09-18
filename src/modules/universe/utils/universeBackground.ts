import { tokenOf } from '@/modules/universe/utils/universeTokens';
import type { UniverseSky } from '@/modules/universe/utils/universeSky';
import type { UniverseTokens } from '@/modules/universe/utils/universeTokens';
import type { UniverseCamera } from '@/modules/universe/utils/universeView';

/**
 * EVERYTHING BEHIND THE GALAXY — the two passes the export ran before it entered the world
 * transform, and the sky cache they are painted from.
 *
 * THE SKY IS THE OWNER'S, AND THIS PASS ONLY PAINTS IT. The tiles are built once for a viewport and
 * a palette, so the `UniverseSky` is made once by the component that owns the canvas and handed
 * here; the `refresh` below is what decides whether anything has to be repainted, and it is a no-op
 * unless the size, the device pixel ratio or the palette has moved. Nothing here reads the document
 * either: the palette arrives as an argument, so a theme flip reaches the tiles through the caller's
 * own token read, and the one tuning this pass answers to arrives as the flag the caller's own gate
 * resolved. The glow sprite cache the star layer borrows is that same object, which is why a sky
 * nobody can reach from here is the whole point of owning it above.
 *
 * THE TWINKLERS ARE THE NEAR LAYER ALONE. A twinkle cannot be baked into a tile, so the twenty
 * nearest field stars are drawn live over the blitted layers — the export's own range, 480 to 520,
 * which `universeStarfield` lays out on the near layer last.
 */

/** How far each star layer slides against the camera, far to near, and how far the band does. */
const LAYER_PARALLAX = [0.05, 0.14, 0.3];
const BAND_PARALLAX = 0.035;
/** How far the band tile may drift from centred before it is clamped, as a fraction of the view. */
const BAND_CLAMP = 0.18;
/** The live twinklers: the export's own indices into the 760-star field. */
const TWINKLE_FIRST = 480;
const TWINKLE_LAST = 520;
/** How bright a twinkler burns at its peak, and how large it is drawn. */
const TWINKLE_PEAK = 0.5;
const TWINKLE_SIZE = 1;
/** Kept inside the viewport's own span, so a far-off camera does not slide the band off the tile. */
const clamp = (value: number, limit: number): number => Math.max(-limit, Math.min(limit, value));

/**
 * Paints the background from the sky it is handed. The canvas is left ready for the world
 * transform: the transform is set to the device ratio, and the alpha and the composite operation
 * are back where a caller expects them.
 */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  sky: UniverseSky,
  camera: UniverseCamera,
  tokens: UniverseTokens,
  milkyWay: boolean,
  now: number,
): void {
  const w = camera.w;
  const h = camera.h;
  const z = camera.z;
  sky.refresh(w, h, camera.dpr, tokens);
  ctx.setTransform(camera.dpr, 0, 0, camera.dpr, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.drawImage(sky.bg, 0, 0, w, h);

  // The sky moves slower than the galaxy, and slower still the further away it is: the zoom is
  // taken to a third of a power so a deep zoom does not fling the backdrop off the screen.
  const zp = Math.pow(z, 0.3);

  if (milkyWay) {
    const ox = -0.2 * w + clamp(-camera.x * BAND_PARALLAX * zp, BAND_CLAMP * w);
    const oy = -0.2 * h + clamp(-camera.y * BAND_PARALLAX * zp, BAND_CLAMP * h);
    ctx.globalAlpha = 1;
    ctx.drawImage(sky.band, ox, oy, sky.bandW, sky.bandH);
  }

  // Three star layers, each a tile blitted four times so the wrap never shows a seam.
  ctx.globalCompositeOperation = 'source-over';
  sky.layers.forEach((tile, li) => {
    const ox = (((-camera.x * LAYER_PARALLAX[li] * zp) % w) + w) % w;
    const oy = (((-camera.y * LAYER_PARALLAX[li] * zp) % h) + h) % h;
    ctx.globalAlpha = 0.8 + 0.2 * Math.sin(now * 0.0009 + li * 2.1);
    ctx.drawImage(tile, ox, oy, w, h);
    ctx.drawImage(tile, ox - w, oy, w, h);
    ctx.drawImage(tile, ox, oy - h, w, h);
    ctx.drawImage(tile, ox - w, oy - h, w, h);
  });

  // A handful of live twinklers on the near layer keep the sky breathing.
  ctx.fillStyle = tokenOf(tokens, '--ink');
  for (let i = TWINKLE_FIRST; i < TWINKLE_LAST && i < sky.stars.length; i++) {
    const star = sky.stars[i];
    const sx = (((star.x * w - camera.x * 0.3 * zp) % w) + w) % w;
    const sy = (((star.y * h - camera.y * 0.3 * zp) % h) + h) % h;
    ctx.globalAlpha = TWINKLE_PEAK * Math.max(0, Math.sin(now * star.w * 1.6 + star.p));
    ctx.fillRect(sx - TWINKLE_SIZE, sy - TWINKLE_SIZE, TWINKLE_SIZE * 2, TWINKLE_SIZE * 2);
  }
  ctx.globalAlpha = 1;
}
