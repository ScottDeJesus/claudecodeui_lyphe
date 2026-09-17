import { createField } from '@/modules/universe/utils/universeStarfield';
import type { SkyBand, SkyStar } from '@/modules/universe/utils/universeStarfield';

// The sky is the field plus the tiles it is painted into: the field itself — the stars and the band —
// is generated in `universeStarfield`, and is re-exported here so a caller has one place to ask.
export type { SkyStar } from '@/modules/universe/utils/universeStarfield';

/**
 * THE SKY BEHIND THE GALAXY — a star field, a milky-way band and a base wash, each rendered once
 * into an offscreen tile and blitted thereafter.
 *
 * WHY TILES. The field is 760 stars over three parallax depths plus a 1,400-star band, a tilted
 * cloud, a base radial and a glow sprite per colour. Painting that per frame would cost more than the
 * galaxy it sits behind, and none of it changes between frames — only the camera does, and a camera
 * move is the same tile blitted at another offset. So the tiles are rebuilt for a viewport and a
 * palette and at no other time: `refresh` is the only thing that repaints, and it says what its key
 * is.
 *
 * THE KEY INCLUDES THE PALETTE, where the export keyed size and device pixel ratio alone. That was
 * right while the colours were its own literals; here a theme flip changes what the sky looks like
 * without changing a single dimension, so the palette is part of the key and a theme switch repaints.
 *
 * THE FIELD IS NOT THIS FILE'S. Where the stars are and how the band runs is generated once, from a
 * seed, in `universeStarfield` — the one place in this build where a pseudo-random number is drawn,
 * and the one decoration that is not a reading of the map. What is here is the painting: the palette,
 * the tile, the cache and the glow sprite.
 *
 * EVERY COLOUR IS A TOKEN, and they arrive as an argument: this file never reads the document. Where
 * the export spelled alpha into its own hex literals (`col + 'aa'`), a gradient here fades to
 * `transparent` instead — a token may be written in any notation, and canvas interpolates gradients
 * premultiplied, so the fade is the same one with no assumption about how a colour is spelled. The
 * upshot is the one worth having: a light theme gives a light sky with dark stars, a dark theme the
 * reverse, out of the same code.
 */

/**
 * The palette as the token reader hands it over: custom property name to its current value, exactly
 * what `readUniverseTokens()` returns. A name that resolves to nothing paints `transparent`.
 */
export type SkyTokens = Record<string, string>;

export type UniverseSky = {
  /** The base wash — a radial, lighter at the centre — drawn first and opaque. */
  bg: HTMLCanvasElement;
  /** Three parallax depths, far to near: viewport-sized tiles the caller wraps over the canvas by
   *  blitting each of them four times, once per quadrant. */
  layers: HTMLCanvasElement[];
  /** The milky-way tile, oversized so its slow parallax never exposes an edge, and the size it was
   *  drawn at. */
  band: HTMLCanvasElement;
  bandW: number;
  bandH: number;
  /** The field itself. The tiles are painted from it, but a twinkle cannot be baked into a tile, so
   *  the caller draws stars `480..519` live. */
  stars: readonly SkyStar[];
  /** The cached radial glow for a colour: how a flare, a nebula and a comet are all drawn. */
  sprite(color: string): HTMLCanvasElement;
  /** The same glow at a quarter the side, for a light no wider than a few pixels: the large tile's
   *  texels would be thrown away by the sampler. */
  small(color: string): HTMLCanvasElement;
  /** Repaint the tiles for a viewport and a palette. A no-op when neither has changed. */
  refresh(w: number, h: number, dpr: number, tokens: SkyTokens): void;
};

/** How much larger and brighter a nearer layer's stars are drawn — far, mid, near. */
const LAYER_SIZE = [0.55, 0.85, 1.25];
const LAYER_ALPHA = [0.7, 0.85, 1];
/** The band tile's stretch over the viewport, and how much of the diagonal its band runs along. */
const BAND_STRETCH = 1.4;
const BAND_SPAN = 0.75;
/** The glow sprite's side, where its plateau ends and where its fade is over. */
const SPRITE_SIZE = 128;
const SPRITE_PLATEAU = 0.25;
const SPRITE_FADE = 0.6;
/** The small sprite, for a light blitted under a handful of pixels: a quarter the side, and a
 *  sixteenth the texels, of the one above. The same gradient at the same offsets, so a glow is the
 *  same shape whatever size it lands at — only its grain changes. */
const SPRITE_SMALL = 32;
const TAU = 6.283;

type SkyPalette = {
  key: string;
  bgInner: string; bgOuter: string; dust: string; bandCore: string; bandMid: string;
  haze: string[]; stars: string[];
};

const token = (tokens: SkyTokens, name: string): string => tokens[name] ?? 'transparent';

/**
 * The palette, read out of the tokens in one place. The pale inks carry the starlight, the charts
 * carry the hues the few warm and cool stars are drawn in, and the canvas and the surface carry the
 * wash. `--ink` is listed twice because the export's own star palette weighted its white double,
 * which is what keeps most of the field neutral.
 */
function paletteFrom(tokens: SkyTokens): SkyPalette {
  const bgInner = token(tokens, '--surface');
  const bgOuter = token(tokens, '--canvas');
  const dust = token(tokens, '--canvas');
  const bandCore = token(tokens, '--ink');
  const bandMid = token(tokens, '--ink-mid');
  const haze = [token(tokens, '--ink-muted'), token(tokens, '--chart-5')];
  const stars = [
    token(tokens, '--ink'), token(tokens, '--ink'), token(tokens, '--ink-mid'),
    token(tokens, '--chart-3'), token(tokens, '--chart-4'), token(tokens, '--chart-5'),
  ];
  return {
    key: [bgInner, bgOuter, dust, bandCore, bandMid, ...haze, ...stars].join('|'),
    bgInner, bgOuter, dust, bandCore, bandMid, haze, stars,
  };
}

/** One offscreen tile, scaled so the caller may paint in CSS pixels on a retina display. */
function createTile(
  w: number,
  h: number,
  dpr: number,
): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const g = canvas.getContext('2d');
  if (g === null) throw new Error('the sky needs a 2d canvas context');
  g.scale(dpr, dpr);
  return { canvas, g };
}

function paintBackground(palette: SkyPalette, w: number, h: number, dpr: number): HTMLCanvasElement {
  const { canvas, g } = createTile(w, h, dpr);
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.75);
  gr.addColorStop(0, palette.bgInner);
  gr.addColorStop(1, palette.bgOuter);
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  return canvas;
}

/** One tile per depth, so the caller's parallax factors are three blits and no per-star work. */
function paintLayers(stars: readonly SkyStar[], w: number, h: number, dpr: number): HTMLCanvasElement[] {
  return LAYER_ALPHA.map((alpha, li) => {
    const { canvas, g } = createTile(w, h, dpr);
    for (const star of stars) {
      if (star.l !== li) continue;
      g.fillStyle = star.col;
      g.globalAlpha = star.a * alpha * 0.8;
      g.beginPath();
      g.arc(star.x * w, star.y * h, star.s * LAYER_SIZE[li], 0, TAU);
      g.fill();
    }
    return canvas;
  });
}

function paintBand(
  band: SkyBand,
  palette: SkyPalette,
  w: number,
  h: number,
  dpr: number,
): { canvas: HTMLCanvasElement; w: number; h: number } {
  const bw = w * BAND_STRETCH;
  const bh = h * BAND_STRETCH;
  const { canvas, g } = createTile(bw, bh, dpr);
  const cs = Math.cos(band.ang);
  const sn = Math.sin(band.ang);
  const span = Math.hypot(bw, bh) * BAND_SPAN;
  // A point on the band: `t` along it, `o` across it, the whole line tilted by the band's angle.
  const at = (t: number, o: number): [number, number] => [
    bw / 2 + t * span * cs - (o + band.off) * bh * sn,
    bh / 2 + t * span * sn + (o + band.off) * bh * cs,
  ];
  const glow = (color: string, x: number, y: number, r: number, mid: string | null): CanvasGradient => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, color);
    if (mid !== null) gr.addColorStop(0.3, mid);
    gr.addColorStop(1, 'transparent');
    return gr;
  };

  // the band's own cloud — a row of overlapping glows, added to the tile rather than painted over it
  g.globalCompositeOperation = 'lighter';
  for (const hz of band.haze) {
    const [x, y] = at(hz.t, hz.o);
    const r = hz.r * bh;
    g.globalAlpha = hz.a;
    g.fillStyle = glow(palette.haze[hz.tint], x, y, r, null);
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';

  // the dust lanes in front of it, dark over the light: this is the band's grain, each lane an
  // ellipse turned to the band's angle.
  for (const d of band.dust) {
    const [x, y] = at(d.t, d.o);
    g.save();
    g.translate(x, y);
    g.rotate(band.ang + d.rot);
    g.scale(d.rx * bw, d.ry * bh);
    g.globalAlpha = d.a;
    g.fillStyle = glow(palette.dust, 0, 0, 1, null);
    g.beginPath();
    g.arc(0, 0, 1, 0, TAU);
    g.fill();
    g.restore();
  }

  for (const star of band.stars) {
    const [x, y] = at(star.t, star.o);
    g.fillStyle = palette.stars[star.tint];
    g.globalAlpha = star.a * 0.7;
    g.beginPath();
    g.arc(x, y, star.s, 0, TAU);
    g.fill();
  }

  // distant galaxies across the tile — a core, a disc and a fade, squashed to the galaxy's own
  // eccentricity and turned to its own angle.
  for (const q of band.gal) {
    g.save();
    g.translate(q.x * bw, q.y * bh);
    g.rotate(q.rot);
    g.scale(q.r * bw, q.r * bw * q.e);
    g.globalAlpha = q.a;
    g.fillStyle = glow(palette.bandCore, 0, 0, 1, palette.bandMid);
    g.beginPath();
    g.arc(0, 0, 1, 0, TAU);
    g.fill();
    g.restore();
  }

  return { canvas, w: bw, h: bh };
}

/**
 * A cache of glow sprites for one side, made once and asked per colour. The export wrote its
 * falloff into the colour's own spelling; a token is not ours to respell, so the glow is cut by a
 * mask instead — the colour laid down opaque, then a white-to-clear radial whose only meaningful
 * channel is its alpha, falling at the export's own offsets. Both offsets are FRACTIONS of the
 * side, so the same call at 32 px is the same falloff at a quarter of the grain.
 */
function spriteCache(side: number): (color: string) => HTMLCanvasElement {
  const cached = new Map<string, HTMLCanvasElement>();
  const mid = side / 2;
  return (color: string): HTMLCanvasElement => {
    const held = cached.get(color);
    if (held !== undefined) return held;
    const { canvas, g } = createTile(side, side, 1);
    g.fillStyle = color;
    g.fillRect(0, 0, side, side);
    const gr = g.createRadialGradient(mid, mid, 0, mid, mid, mid);
    gr.addColorStop(0, 'white');
    gr.addColorStop(SPRITE_PLATEAU, 'white');
    gr.addColorStop(SPRITE_FADE, 'transparent');
    gr.addColorStop(1, 'transparent');
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = gr;
    g.fillRect(0, 0, side, side);
    cached.set(color, canvas);
    return canvas;
  };
}

export function createSky(): UniverseSky {
  const { stars, band } = createField();
  let key = '';

  const sky: UniverseSky = {
    bg: document.createElement('canvas'),
    layers: [],
    band: document.createElement('canvas'),
    bandW: 0,
    bandH: 0,
    stars,
    sprite: spriteCache(SPRITE_SIZE),
    small: spriteCache(SPRITE_SMALL),

    refresh(w, h, dpr, tokens) {
      if (w <= 0 || h <= 0) return;
      const palette = paletteFrom(tokens);
      const next = `${w}x${h}@${dpr}|${palette.key}`;
      if (next === key) return;
      key = next;
      for (const star of stars) star.col = palette.stars[star.tint];
      sky.bg = paintBackground(palette, w, h, dpr);
      sky.layers = paintLayers(stars, w, h, dpr);
      const painted = paintBand(band, palette, w, h, dpr);
      sky.band = painted.canvas;
      sky.bandW = painted.w;
      sky.bandH = painted.h;
    },
  };

  return sky;
}
