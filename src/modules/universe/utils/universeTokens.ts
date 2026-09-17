import type { UniverseNode } from '@/shared/types';
import type { UniverseTweaks } from '@/modules/universe/utils/universeTweaks';

/**
 * THE PALETTE, READ ONCE — and the one curve that says how bright a star is.
 *
 * READ ONCE, AND REPAINTED ON A THEME FLIP. `getComputedStyle` forces a style recalculation, and
 * the canvas wants a colour on every node of every frame, so this reads the seventeen names it can
 * actually draw with — once — and hands back the same object until the theme moves. What moves it
 * is not a subscription: `ThemeContext` flips the class on `<html>`, so one `MutationObserver` on
 * that attribute is the whole invalidation rule, and the next caller gets a freshly read palette.
 * The canvas redraws the sky when the palette's identity changes, which is why the cache is
 * dropped rather than mutated in place.
 *
 * WHAT A STAR'S COLOUR IS. Its file kind, in the five slots the chart series carries — the exact
 * table the Interfaces section gives, and the only place that mapping exists. Directory and repo
 * bodies take the ink ladder instead, because a body is not a file kind and inventing a sixth
 * chart slot would be a colour the design system does not have.
 *
 * WHAT A STAR'S BRIGHTNESS IS. How recently git saw it change, against the frame's clock: bright
 * inside `recencyBrightDays`, easing to the middle of the curve by `recencyDimDays`, easing again
 * to a floor by 180 days, and holding that floor past it. The two knees are tweaks because what
 * counts as "recent" is the operator's call; 180 is fixed, because a file untouched for half a
 * year is old on any corpus.
 *
 * ONE UNIT, ONE END OF THE LANE: `at` and `now` are BOTH epoch MILLISECONDS. The crawler writes
 * its `t` in epoch SECONDS and the wire writes its rows in milliseconds; the conversion belongs to
 * the caller that knows which it holds, never to a curve that has to guess.
 */

/** The seventeen names this build draws with — surfaces, inks, the three tones and the chart
 *  series. Every one of them is declared in `src/shared/ui/verve/tokens.css`. */
const TOKEN_NAMES: readonly string[] = [
  '--canvas', '--surface', '--surface2',
  '--ink', '--ink-mid', '--ink-muted', '--ink-faint', '--border',
  '--accent', '--info-ink', '--warn-ink', '--danger',
  '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5',
];

/** Custom property name to its current value, exactly as `readUniverseTokens` returns it. */
export type UniverseTokens = Record<string, string>;

/** The palette read once and held until the theme moves. */
let cached: UniverseTokens | null = null;

/** Whether the theme observer is already watching — one observer per page, never one per read. */
let watching = false;

/**
 * The palette as the document currently spells it. A name that resolves to nothing is left out
 * rather than cached as an empty string, so a caller's fallback (`tokenOf`) is what a missing
 * token lands on instead of a value that would win and paint nothing.
 */
export function readUniverseTokens(): UniverseTokens {
  if (cached !== null) return cached;
  const computed = getComputedStyle(document.documentElement);
  const tokens: UniverseTokens = {};
  for (const name of TOKEN_NAMES) {
    const value = computed.getPropertyValue(name).trim();
    if (value) tokens[name] = value;
  }
  watchTheme();
  cached = tokens;
  return tokens;
}

/**
 * Drops the cache when the theme class on `<html>` moves. Installed on the first read and never
 * removed: the palette is read for the life of the page, and an observer on one attribute of one
 * element is not the cost a canvas frame has to think about. A page without `MutationObserver` —
 * a test runner importing this module, say — simply never invalidates, which is what a single
 * fixed theme wants anyway.
 */
function watchTheme(): void {
  if (watching || typeof MutationObserver === 'undefined') return;
  watching = true;
  new MutationObserver(() => {
    cached = null;
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

/** The value of one name, or `transparent` — the one place a name that resolves to nothing is
 *  given a value, so every pass that draws a rule, a label or a light agrees about the fallback. */
export function tokenOf(tokens: UniverseTokens, name: string): string {
  return tokens[name] ?? 'transparent';
}

/**
 * Every kind the map carries, and the token it is drawn in. Frozen: this table is the contract
 * between the crawler's vocabulary and the design system's, and a pass that wrote to it would be
 * a second opinion about what a kind looks like.
 *
 * The five file kinds take the chart series in the order the Interfaces give (source, config,
 * docs, data-sql, assets), `other` takes the faintest ink because it is the kind nothing claimed,
 * and the three bodies take the ink ladder: a directory one step down from the sun, a galaxy
 * between them, an endpoint the info tone — an endpoint is a machine answering, not a file.
 */
export const KIND_TOKEN: Readonly<Record<UniverseNode['k'], string>> = Object.freeze({
  source: '--chart-1',
  config: '--chart-2',
  docs: '--chart-5',
  'data-sql': '--chart-3',
  assets: '--chart-4',
  other: '--ink-faint',
  dir: '--ink-mid',
  galaxy: '--ink-muted',
  core: '--ink',
  endpoint: '--info-ink',
});

/** A node as this end of the lane knows it: the instant the crawler last stamped it — epoch
 *  SECONDS, its own unit, which is why the caller does not convert and this does. */
export type NodeRecency = { t: number };

/** A day in the unit the curve is written in. */
const DAY_MS = 86_400_000;
/** The age past which nothing gets older in the drawing — the fixed, third knee. */
const OLD_DAYS = 180;
/** What the curve falls to at the middle knee, and what the floor is past the third. */
const MID_BRIGHTNESS = 0.45;
const OLD_BRIGHTNESS = 0.18;
const FLOOR_BRIGHTNESS = 0.12;

/** How a span of the curve is walked: cubic ease-out, so the fall is gentle at first and then
 *  decisive — the same easing the export used to bring its stars in. */
const easeOut = (fraction: number): number => 1 - Math.pow(1 - fraction, 3);

/**
 * How bright a star is, from the instant it last changed.
 *
 * `at` is the node's last-change instant in epoch MILLISECONDS and `now` is the frame's own clock.
 * A node whose last change is in the future — a server whose clock runs ahead of this browser's —
 * is simply at the top of the curve rather than a negative age that would read as very old.
 */
export function brightnessFor(
  at: number,
  now: number,
  tweaks: Pick<UniverseTweaks, 'recencyBrightDays' | 'recencyDimDays'>,
): number {
  const ageDays = Math.max(0, now - at) / DAY_MS;
  const bright = tweaks.recencyBrightDays;
  // The dim knee is held between the bright one and the fixed third: past the bright one, because a
  // hand-edited `{ bright: 30, dim: 7 }` would otherwise be a curve that rises with age, which is a
  // curve no star has; and no further out than 180, because the dim tweak's own range reaches 365
  // and a knee past the fixed one would hold a star at the middle of the curve for a year and then
  // drop it off a cliff — a shape the interface never described.
  const dim = Math.min(Math.max(tweaks.recencyDimDays, bright), OLD_DAYS);
  if (ageDays <= bright) return 1;
  if (dim > bright && ageDays <= dim) {
    return 1 - (1 - MID_BRIGHTNESS) * easeOut((ageDays - bright) / (dim - bright));
  }
  if (OLD_DAYS > dim && ageDays <= OLD_DAYS) {
    return MID_BRIGHTNESS - (MID_BRIGHTNESS - OLD_BRIGHTNESS) * easeOut((ageDays - dim) / (OLD_DAYS - dim));
  }
  return ageDays <= OLD_DAYS ? OLD_BRIGHTNESS : FLOOR_BRIGHTNESS;
}

/**
 * A star's brightness, quantised to three bands — what the drawing passes key their batches on.
 *
 * The curve is continuous and the canvas is not: two stars a day apart in age would otherwise
 * never share a path, and the pass that draws ten thousand of them would fill one path per star.
 * Three bands is the export's own compromise (it quantised the depth alpha the same way) and this
 * is where it belongs: the pass asks how bright a star is, not how its batches are built.
 *
 * The instant comes from the node's own `t` — the crawler's epoch SECONDS, carried through the map
 * and the graph untouched — and it is converted to the curve's milliseconds HERE, because this is
 * the one place that knows which unit it was handed.
 */
export function bandedBrightness(
  node: NodeRecency,
  now: number,
  tweaks: Pick<UniverseTweaks, 'recencyBrightDays' | 'recencyDimDays'>,
): number {
  const value = brightnessFor(node.t * 1000, now, tweaks);
  return value > 0.85 ? 1 : value > 0.4 ? 0.6 : 0.25;
}

/**
 * A colour's three channels in 0..255, or `null` for a spelling none of the five notations a
 * computed custom property may carry can make — `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`,
 * `rgba()`. An alpha pair is read and dropped: a star's strength is the brightness curve's answer,
 * so a palette's own opacity is not a second opinion about it.
 */
function channels(color: string): [number, number, number] | null {
  const text = color.trim();
  const hex = /^#([0-9a-f]+)$/i.exec(text);
  if (hex !== null) {
    // Three and four digits double each one, six and eight are already whole, and any other length
    // is a spelling no notation has.
    const digits = hex[1];
    const full = digits.length === 3 || digits.length === 4 ? digits.replace(/./g, (c) => c + c) : digits;
    if (full.length !== 6 && full.length !== 8) return null;
    return [
      Number.parseInt(full.slice(0, 2), 16),
      Number.parseInt(full.slice(2, 4), 16),
      Number.parseInt(full.slice(4, 6), 16),
    ];
  }
  const call = /^rgba?\(([^)]*)\)$/i.exec(text);
  if (call === null) return null;
  const parts = call[1].split(/[\s,/]+/).filter((part) => part !== '');
  if (parts.length < 3) return null;
  const red = component(parts[0]);
  const green = component(parts[1]);
  const blue = component(parts[2]);
  return red === null || green === null || blue === null ? null : [red, green, blue];
}

/** One `rgb()` argument as a byte: a number, or a percentage of 255. `null` for a word this does not
 *  read. A space-separated call leaves an empty part where its slash is, filtered out above. */
function component(part: string): number | null {
  const percent = /^([\d.]+)%$/.exec(part);
  const value = percent === null ? Number(part) : (Number(percent[1]) * 255) / 100;
  if (part === '' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * The colour a node is drawn in: its kind's token, dimmed toward the canvas by however far its
 * brightness has fallen.
 *
 * Dimming toward the canvas (rather than toward black, or by alpha) is what makes the curve work
 * in both themes: an old star fades into the sky it is actually drawn on, and the same code gives
 * a pale sky with grey stars under a light theme. A palette written in a notation `channels` cannot
 * make — a `color()`, a `lab()`, a named word — is returned untouched: the star keeps its kind's
 * colour at full strength rather than being mangled into something the design system never chose.
 * What once reached that branch does not any more, which is the whole of what the extension bought:
 * a token spelled `rgb(…)`, `#rgba` or `#rrggbbaa` now dims like every other.
 */
export function colorForNode(
  node: { kind: UniverseNode['k'] },
  tokens: UniverseTokens,
  brightness: number,
): string {
  const color = tokenOf(tokens, KIND_TOKEN[node.kind]);
  const weight = Math.max(0, Math.min(1, brightness));
  if (weight >= 1) return color;
  const from = channels(color);
  const to = channels(tokenOf(tokens, '--canvas'));
  if (from === null || to === null) return color;
  const mix = from.map((channel, i) => Math.round(channel + (to[i] - channel) * (1 - weight)));
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
}

/** The ends a mix falls back to when the palette spells one of them in a notation `channels` cannot
 *  make: white for the star's own colour, so an unreadable star is drawn as a light rather than as
 *  nothing, and black for the canvas, the darkest end a dim can fall to. */
const UNREADABLE_FROM: readonly [number, number, number] = [255, 255, 255];
const UNREADABLE_TO: readonly [number, number, number] = [0, 0, 0];

/**
 * A star's colour as three channels of 0..1 — the same kind token, dimmed by the same curve and
 * through the same parser `colorForNode` paints with, in the unit the GPU wants.
 *
 * `brightness` IS THE CURVE'S OWN ANSWER, handed in and never read here, so a GPU record and the
 * colour a 2D pass paints are one number apart by nothing at all. The dim cannot ride on alpha on
 * this path — a point record carries an alpha of its own and the two would multiply — so it is a
 * mix toward the canvas and nothing else, exactly as the 2D path's is.
 */
export function channelsForNode(
  node: { kind: UniverseNode['k'] },
  tokens: UniverseTokens,
  brightness: number,
): readonly [number, number, number] {
  const weight = Math.max(0, Math.min(1, brightness));
  const from = channels(tokenOf(tokens, KIND_TOKEN[node.kind])) ?? UNREADABLE_FROM;
  const to = channels(tokenOf(tokens, '--canvas')) ?? UNREADABLE_TO;
  return [
    (from[0] * weight + to[0] * (1 - weight)) / 255,
    (from[1] * weight + to[1] * (1 - weight)) / 255,
    (from[2] * weight + to[2] * (1 - weight)) / 255,
  ];
}

/**
 * A token's colour as three channels of 0..1, held per palette.
 *
 * THE MAP IS KEYED ON THE PALETTE'S IDENTITY, which is the whole invalidation rule: the GL layer
 * asks for the same handful of names on every star of every frame, and `readUniverseTokens` hands
 * back one object until the theme moves and a fresh one when it does. A new palette is a new key,
 * so nothing is emptied by hand and no stale colour outlives the palette it was read from.
 */
const rgbCache = new WeakMap<UniverseTokens, Map<string, readonly [number, number, number]>>();

export function rgbOf(tokens: UniverseTokens, token: string): readonly [number, number, number] {
  let held = rgbCache.get(tokens);
  if (held === undefined) {
    held = new Map();
    rgbCache.set(tokens, held);
  }
  const cached = held.get(token);
  if (cached !== undefined) return cached;
  const [red, green, blue] = channels(tokenOf(tokens, token)) ?? UNREADABLE_FROM;
  const rgb: readonly [number, number, number] = [red / 255, green / 255, blue / 255];
  held.set(token, rgb);
  return rgb;
}
