/**
 * THE FIELD THE SKY IS MADE OF — 760 stars over three parallax depths, and the milky-way band that
 * crosses them. Both come out of one seeded stream, in one pass, and never change again.
 *
 * THE ONLY PSEUDO-RANDOM NUMBERS IN THE BUILD LIVE HERE, ON PURPOSE. Nothing in this file is a
 * reading of the map: a star's position is decoration, and every phase the galaxy's own motion needs
 * is seeded from the data instead (`seedFrom` in `universeBirth`). The generator is the export's own
 * LCG at its own seed, so the sky is the same backdrop on every load, never a new one.
 *
 * WHAT A FIELD ENTRY CARRIES, AND WHAT IT DOES NOT. A star knows where it is, how big and how bright
 * it is, how fast it twinkles, and which SLOT of the sky's palette it is drawn in — a `tint`, never a
 * colour. The palette is the caller's to read, so the field never holds a colour of its own;
 * `universeSky` resolves the tints into colours when it paints.
 */

/** One field star: its parallax layer `l`, its place in the viewport (`x` and `y`, `0..1`), its
 *  radius `s`, brightness `a`, twinkle rate `w` and phase `p` — and the palette slot `tint` it is
 *  drawn in, resolved into `col` when the sky paints. */
export type SkyStar = {
  l: number;
  x: number; y: number;
  s: number; a: number; w: number; p: number;
  tint: number; col: string;
};

/** The band's own parts: its stars, its haze and its dust lanes, and the galaxies scattered off it.
 *  Each carries a `tint` — a slot in the palette, resolved when the band is painted. */
export type BandStar = { t: number; o: number; s: number; a: number; tint: number };
export type BandHaze = { t: number; o: number; r: number; a: number; tint: number };
export type BandDust = { t: number; o: number; rx: number; ry: number; a: number; rot: number };
export type BandGalaxy = { x: number; y: number; r: number; e: number; rot: number; a: number };
export type SkyBand = {
  ang: number; off: number;
  stars: BandStar[]; haze: BandHaze[]; dust: BandDust[]; gal: BandGalaxy[];
};

export type SkyField = { stars: SkyStar[]; band: SkyBand };

/** The field: 760 stars, the far 400 on the far layer, the next 240 mid, the rest near. */
const STAR_COUNT = 760;
const LAYER_SPLIT = [400, 640];
/** How many tints a star may be drawn in, and the export's seed, kept: the same sky every load. */
const STAR_TINTS = 6;
const SKY_SEED = 1337;

/** The export's generator: a Lehmer LCG, and the only randomness in this build. */
function createRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

/**
 * The field, once. The stars are drawn first and the band continues the same stream, in the export's
 * own order, so the sky that comes out is its sky: same spread, same walk, same seed.
 */
export function createField(): SkyField {
  const rng = createRng(SKY_SEED);
  const stars: SkyStar[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    stars.push({
      l: i < LAYER_SPLIT[0] ? 0 : i < LAYER_SPLIT[1] ? 1 : 2,
      x: rng(), y: rng(),
      s: 0.3 + Math.pow(rng(), 2.2) * 1.5,
      a: 0.12 + rng() * 0.5,
      w: 0.0006 + rng() * 0.0018,
      p: rng() * 6.28,
      tint: Math.floor(rng() * STAR_TINTS), col: '',
    });
  }

  // Three rolls, centred and narrowed — the export's bell, which keeps the band's stars on its line.
  const gauss = (): number => (rng() + rng() + rng() - 1.5) * 1.4;
  const band: SkyBand = {
    ang: -0.52 + (rng() - 0.5) * 0.3,
    off: (rng() - 0.5) * 0.2,
    stars: [], haze: [], dust: [], gal: [],
  };
  for (let i = 0; i < 1400; i++) band.stars.push({ t: rng() * 2 - 1, o: gauss() * 0.075, s: 0.3 + Math.pow(rng(), 3) * 1.5, a: 0.2 + rng() * 0.6, tint: Math.floor(rng() * STAR_TINTS) });
  for (let i = 0; i < 16; i++) band.haze.push({ t: -0.95 + i * 0.125 + (rng() - 0.5) * 0.05, o: gauss() * 0.03, r: 0.14 + rng() * 0.12, a: 0.035 + rng() * 0.03, tint: rng() < 0.6 ? 0 : 1 });
  for (let i = 0; i < 12; i++) band.dust.push({ t: rng() * 1.8 - 0.9, o: gauss() * 0.03, rx: 0.06 + rng() * 0.12, ry: 0.012 + rng() * 0.02, a: 0.35 + rng() * 0.3, rot: (rng() - 0.5) * 0.5 });
  for (let i = 0; i < 6; i++) band.gal.push({ x: rng(), y: rng(), r: 0.006 + rng() * 0.008, e: 0.35 + rng() * 0.5, rot: rng() * 3.14, a: 0.25 + rng() * 0.3 });

  return { stars, band };
}
