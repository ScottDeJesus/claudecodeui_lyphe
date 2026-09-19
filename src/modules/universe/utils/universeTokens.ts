import type { UniverseNode } from '@/shared/types';
import type { UniverseTweaks } from '@/modules/universe/utils/universeTweaks';

/**
 * THE PALETTE, READ ONCE — and the one curve that says how bright a star is.
 *
 * READ ONCE, FOR GOOD. `getComputedStyle` forces a style recalculation, and the canvas wants a
 * colour on every node of every frame, so this reads the seventeen names it can actually draw
 * with — once — and hands back the same object for the life of the page. The sky is dark whatever
 * the app's theme is, so there is no second palette to change to (`readUniverseTokens`).
 *
 * WHAT A STAR'S COLOUR IS. Its temperature — the export's ramp from orange to blue, keyed on its
 * size — never its kind; a folder is its repo's pastel warmed halfway, a repo warm white, the sun
 * cream with a cool glow, and every glow the repo's pastel (`baseColorOf`, `glowColorOf` below).
 * The two kinds the export never drew, an endpoint and an integration folder, keep a token each.
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

/** The palette, read once and held for the life of the page. */
let cached: UniverseTokens | null = null;

/**
 * THE SKY IS DARK, WHATEVER THE APP'S THEME IS — there is no white space, so there is no light sky.
 * The palette is therefore read off `scope`, an element inside the panel's own `.dark` wrapper
 * (`UniversePanel`), never off the document: inside that wrapper every token resolves to its dark
 * value whichever theme the rest of the app wears. One read, held for good — the dark palette does
 * not change, so nothing watches for a theme and no frame ever asks the document twice.
 *
 * A name that resolves to nothing is left out rather than cached as an empty string, so a caller's
 * fallback (`tokenOf`) is what a missing token lands on instead of a value that would win and paint
 * nothing.
 */
export function readUniverseTokens(scope: Element): UniverseTokens {
  if (cached !== null) return cached;
  const computed = getComputedStyle(scope);
  const tokens: UniverseTokens = {};
  for (const name of TOKEN_NAMES) {
    const value = computed.getPropertyValue(name).trim();
    if (value) tokens[name] = value;
  }
  cached = tokens;
  return tokens;
}

/** The value of one name, or `transparent` — the one place a name that resolves to nothing is
 *  given a value, so every pass that draws a rule, a label or a light agrees about the fallback. */
export function tokenOf(tokens: UniverseTokens, name: string): string {
  return tokens[name] ?? 'transparent';
}

/**
 * THE EXPORT'S OWN COLOURING, restored at the operator's word (2026-09-17): a star is not its kind's
 * colour but its TEMPERATURE — a ramp from orange through warm white to blue, keyed on its size, so a
 * small file burns orange and a large one blue, with a little jitter so a folder of equal files is not
 * one shade; a folder is its repo's pastel mixed half toward warm white; a repo is warm white; the sun
 * is the palest cream with a cool glow; and every glow below the sun is the repo's own pastel, which
 * is what tells the repos apart at a distance. The literals are the export's, kept as literals: the
 * design system's tokens have no star temperature and no seven pastels, and a token that meant "the
 * third repo" would be a second opinion about what a repo looks like.
 *
 * The two kinds the export never drew keep their tokens: an endpoint the info tone — a machine
 * answering, not a file — and an integration folder (`system`) the warn tone, the estate's reach into a
 * platform. Only these two rows are read from the table now; the star ramp and the palettes below are
 * the rest.
 */
export const KIND_TOKEN: Readonly<Partial<Record<UniverseNode['k'], string>>> = Object.freeze({
  endpoint: '--info-ink',
  system: '--warn-ink',
});

/** The export's star ramp, orange to blue, and where a star's size lands on it. */
const STAR_RAMP = ['#ff9c5a', '#ffcf9a', '#fff3e0', '#eef2ff', '#b9c8ff'] as const;
/** One pastel per repo, cycled; the export's seven. */
const PACKAGE_PALETTE = ['#9fb3d9', '#7fb8c4', '#c9899b', '#a394c9', '#8fbfa6', '#c9ad7f', '#c98f7f'] as const;
/** The same seven, slot for slot, at the strength a HAZE needs: a pastel laid at a nebula's few
 *  percent of alpha is grey, so each repo's nebula is its own pastel's hue with the chroma put back —
 *  blue, teal, rose, violet, green, amber, coral. A repo's glow and its nebula are one colour family. */
const NEBULA_PALETTE = ['#4f7fe6', '#25b3c9', '#e0527f', '#8c63e6', '#36c48a', '#e6a431', '#e6684a'] as const;
/** Warm white — a repo's own colour, and what a folder is mixed halfway toward. */
const HUB_COLOR = '#fff3e0';
/** The sun: the palest cream, glowing cool. */
const CORE_COLOR = '#f4f1ea';
const CORE_GLOW = '#c8d6ff';
/** How far along the ramp a file's size takes it, and how much its own jitter moves it. */
const RAMP_SCALE = 52;
const RAMP_JITTER = 0.28;
/** What a node needs to be coloured: the fields a graph node carries; a caller with a bare kind gets
 *  the ramp's middle and the first palette slot. */
export type Colourable = { kind: UniverseNode['k']; lines?: number; id?: number; cluster?: number };

/** Two hex colours mixed, `t` of the way from the first to the second — the export's `mix`. */
function mixHex(a: string, b: string, t: number): string {
  const pa = Number.parseInt(a.slice(1), 16);
  const pb = Number.parseInt(b.slice(1), 16);
  const ch = (s: number): number => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return '#' + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('');
}

/** The ramp at `t` in `[0, 1)`, quantised to thirds between stops the way the export did. */
function rampAt(t: number): string {
  const at = Math.max(0, Math.min(0.999, t)) * (STAR_RAMP.length - 1);
  const i = Math.floor(at);
  return mixHex(STAR_RAMP[i], STAR_RAMP[i + 1], Math.round((at - i) * 3) / 3);
}

/** A stable value in `[0, 1)` from a node's id — the export's `rnd()` for the jitter, made repeatable. */
const jitterOf = (id: number): number => (Math.imul(id + 1, 2654435761) >>> 0) / 4294967296;

/** The pastel a node's repo paints with. */
const palette = (node: Colourable): string => PACKAGE_PALETTE[(node.cluster ?? 0) % PACKAGE_PALETTE.length];

/** A node's own colour at full brightness, before the recency dim. */
export function baseColorOf(node: Colourable, tokens: UniverseTokens): string {
  const token = KIND_TOKEN[node.kind];
  if (token !== undefined) return tokenOf(tokens, token);
  if (node.kind === 'core') return CORE_COLOR;
  if (node.kind === 'galaxy') return HUB_COLOR;
  if (node.kind === 'dir') return mixHex(palette(node), HUB_COLOR, 0.5);
  if (node.lines === undefined || node.id === undefined) return HUB_COLOR;
  return rampAt(Math.sqrt(node.lines) / RAMP_SCALE + (jitterOf(node.id) - 0.5) * RAMP_JITTER);
}

/** The hue a node's repo fills its space with (`universeNebula`) — the repo's palette slot, inherited
 *  down the tree, so a folder's haze is its galaxy's colour. */
export function nebulaColorOf(node: Colourable): string {
  return NEBULA_PALETTE[(node.cluster ?? 0) % NEBULA_PALETTE.length];
}

/** The colour a node's glow is drawn in: the sun's cool halo, a source's own tone, else the repo's pastel. */
export function glowColorOf(node: Colourable, tokens: UniverseTokens): string {
  const token = KIND_TOKEN[node.kind];
  if (token !== undefined) return tokenOf(tokens, token);
  if (node.kind === 'core') return CORE_GLOW;
  return palette(node);
}

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
 * The colour a node is drawn in: its own colour (`baseColorOf`), dimmed toward the canvas by however
 * far its brightness has fallen.
 *
 * Dimming toward the canvas (rather than toward black, or by alpha) is what makes the curve read
 * true: an old star fades into the sky it is actually drawn on. A palette written in a notation `channels` cannot
 * make — a `color()`, a `lab()`, a named word — is returned untouched: the star keeps its kind's
 * colour at full strength rather than being mangled into something the design system never chose.
 * What once reached that branch does not any more, which is the whole of what the extension bought:
 * a token spelled `rgb(…)`, `#rgba` or `#rrggbbaa` now dims like every other.
 */
export function colorForNode(node: Colourable, tokens: UniverseTokens, brightness: number): string {
  const color = baseColorOf(node, tokens);
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
 * A star's colour as three channels of 0..1 — the same colour, dimmed by the same curve and
 * through the same parser `colorForNode` paints with, in the unit the GPU wants.
 *
 * `brightness` IS THE CURVE'S OWN ANSWER, handed in and never read here, so a GPU record and the
 * colour a 2D pass paints are one number apart by nothing at all. The dim cannot ride on alpha on
 * this path — a point record carries an alpha of its own and the two would multiply — so it is a
 * mix toward the canvas and nothing else, exactly as the 2D path's is.
 */
export function channelsForNode(
  node: Colourable,
  tokens: UniverseTokens,
  brightness: number,
): readonly [number, number, number] {
  const weight = Math.max(0, Math.min(1, brightness));
  const from = channels(baseColorOf(node, tokens)) ?? UNREADABLE_FROM;
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
  // A token name is read from the palette; a literal colour — the star ramp, a repo's pastel — is
  // parsed as it stands. Both are cached under the string they were asked by.
  const [red, green, blue] = channels(token.startsWith('--') ? tokenOf(tokens, token) : token) ?? UNREADABLE_FROM;
  const rgb: readonly [number, number, number] = [red / 255, green / 255, blue / 255];
  held.set(token, rgb);
  return rgb;
}
