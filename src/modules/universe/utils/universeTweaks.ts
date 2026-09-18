import type { UniverseNode } from '@/shared/types';
import { isFileKind } from '@/modules/universe/utils/universeBirth';
/**
 * EVERY TUNABLE THE ESTATE SKY HAS, IN ONE HOME — the type, the defaults, and the domain each value
 * has to fall inside.
 *
 * ONE CONTROL SURFACE. The layout and the renderer read this object on every frame, the Tweaks
 * panel is the only thing that writes it, and `parseTweaks` is the only door a value from outside
 * comes through. localStorage is a text file a person can hand-edit, so nothing read back is
 * trusted: every number is clamped into its range, every word checked against its options, every
 * flag coerced, every unknown key dropped and every missing key defaulted. A 900 typed into the
 * orbit rate cannot reach the loop — there is no path from the file to the loop that skips here.
 *
 * PURE BY CONSTRUCTION — no React, no DOM, no storage. What persists is `diffFromDefaults`, and the
 * only thing that knows where it goes is the hook that owns the storage.
 *
 * A ZERO OR A `false` MEANS THE PASS IS SKIPPED WHOLE. The decoration — wobble, doppler, transits,
 * depth of field, trails — defaults to zero, and the layout does not enter those loops rather than
 * computing a field it will not draw.
 */

/** The key the diff from defaults is kept under, in localStorage and nowhere else. */
export const TWEAKS_STORAGE_KEY = 'universe.tweaks.v1';

/** A numeric tunable's domain. A value outside it is clamped into it, never refused. */
export type UniverseTweakRange = { readonly min: number; readonly max: number };

/** A tunable's domain: a range for a number, a word list for an enum, a flag for a boolean. */
type UniverseTweakDomain =
  | UniverseTweakRange
  | { readonly options: readonly string[] }
  | { readonly boolean: true };

/**
 * The sky's whole set of knobs. Read by `universeLayout` (motion, decoration), `universeSky`
 * (the milky way) and `universeRenderer` (look, labels, pulses); written only by the Tweaks panel.
 */
export type UniverseTweaks = {
  // motion — how the bodies move
  orbit: number;
  inclination: number;
  precession: number;
  parallax: number;
  drift: boolean;
  pulseSpeed: number;
  /** Seconds of trail a star keeps. Zero means the pass is skipped whole. */
  trails: number;
  // look — what is drawn
  labels: 'hubs' | 'all' | 'none';
  edges: 'all' | 'tree' | 'import' | 'cochange' | 'none';
  gravity: number;
  /** How far everything sits from the sun, as a multiple of the rooms' own measure: every resting
   *  position, ring and spring is scaled about the sun at once, so the sky closes in or opens out at
   *  any zoom without waiting on the relaxation. */
  distance: number;
  milkyWay: boolean;
  twinkle: number;
  perspective: number;
  /** Pulses are drawn at all. */
  flow: boolean;
  /** Which path draws the stars: the GPU layer, or the canvas passes it replaced. */
  renderer: 'webgl' | 'canvas';
  // decoration — every one of these defaults to off, and off costs nothing
  doppler: number;
  wobble: number;
  lensing: number;
  transits: boolean;
  depthOfField: number;
  // data — where a star's brightness curve bends
  recencyBrightDays: number;
  recencyDimDays: number;
  /** Which files are stars: `code` draws the `source` kind alone; `all` draws every tracked file —
   *  config, docs, data, assets. Code by default: the operator's word (2026-09-17), the rest is not the
   *  shape of the estate. */
  files: 'code' | 'all';
};

/** A node kind the tweaks hide from the sky — not drawn, not hit, not clouded, not lit. It is still
 *  relaxed: the relaxation is whole-graph by physics, so a folder's shape does not change when the
 *  tweak flips. Only a file kind is ever hidden; a body, the sun and a source always stand. */
export const hiddenKind = (kind: UniverseNode['k'], tweaks: UniverseTweaks): boolean =>
  tweaks.files === 'code' && kind !== 'source' && isFileKind(kind);

/**
 * The defaults. Frozen: the panel, the layout and the parser all read the same object, and a
 * stray write to one field would be a default nobody could see change back.
 */
export const DEFAULT_TWEAKS: Readonly<UniverseTweaks> = Object.freeze({
  orbit: 0.05, inclination: 0.7, precession: 0.5, parallax: 0.6, drift: false,
  pulseSpeed: 1.2, trails: 0,
  labels: 'hubs', edges: 'import',
  gravity: 1.3, distance: 1, milkyWay: true, twinkle: 0.6, perspective: 0.8, flow: true, renderer: 'webgl',
  doppler: 0, wobble: 0, lensing: 0, transits: false, depthOfField: 0,
  recencyBrightDays: 7, recencyDimDays: 30,
  files: 'code',
} satisfies UniverseTweaks);

/**
 * Every tunable's domain, in one table — the second half of what `DEFAULT_TWEAKS` starts.
 *
 * `as const` and not a widened annotation, deliberately: the table IS the proof that a stored word
 * belongs to its key, and a widened `readonly string[]` would throw that proof away and leave the
 * parser assigning a bare `string` into `labels: 'hubs' | 'all' | 'none'`. `satisfies` keeps the
 * table honest against the domain type either way.
 */
export const TWEAK_RANGES = Object.freeze({
  orbit: { min: 0, max: 1 }, inclination: { min: 0, max: 1 }, precession: { min: 0, max: 1 },
  parallax: { min: 0, max: 1 }, drift: { boolean: true }, pulseSpeed: { min: 0.1, max: 3 },
  trails: { min: 0, max: 40 },
  labels: { options: ['hubs', 'all', 'none'] },
  edges: { options: ['all', 'tree', 'import', 'cochange', 'none'] },
  gravity: { min: 0.3, max: 3 }, distance: { min: 0.3, max: 1.5 }, milkyWay: { boolean: true }, twinkle: { min: 0, max: 1 },
  perspective: { min: 0, max: 1 }, flow: { boolean: true },
  renderer: { options: ['webgl', 'canvas'] },
  doppler: { min: 0, max: 1 }, wobble: { min: 0, max: 1 }, lensing: { min: 0, max: 1 },
  transits: { boolean: true }, depthOfField: { min: 0, max: 1 },
  recencyBrightDays: { min: 1, max: 90 }, recencyDimDays: { min: 2, max: 365 },
  files: { options: ['code', 'all'] },
} as const satisfies Readonly<Record<keyof UniverseTweaks, UniverseTweakDomain>>);

/** A stored word, narrowed to the words a domain actually holds — the guard is what lets the parser
 *  write into a key whose type is a union of words, with no cast anywhere. */
function isOption<T extends string>(options: readonly T[], value: string): value is T {
  return options.some((option) => option === value);
}

/** The one place a validated value lands on a target — the generic is what keeps this cast-free. */
function assign<K extends keyof UniverseTweaks>(
  target: Partial<UniverseTweaks>,
  key: K,
  value: UniverseTweaks[K],
): void {
  target[key] = value;
}

/** A stored flag read back as a flag, or `null` when the value is not one however it is spelled. */
function asBoolean(value: unknown): boolean | null {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return null;
}

/**
 * A stored object — or a hand-edited file, or a value from another version of this build — read
 * into a whole, valid set of tweaks. Never throws; anything it cannot read becomes the default.
 */
export function parseTweaks(raw: unknown): UniverseTweaks {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const result: UniverseTweaks = { ...DEFAULT_TWEAKS };

  for (const key of Object.keys(DEFAULT_TWEAKS) as (keyof UniverseTweaks)[]) {
    const domain = TWEAK_RANGES[key];
    const value = source[key];
    if (value === undefined) continue;
    if ('min' in domain) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        assign(result, key, Math.min(domain.max, Math.max(domain.min, value)));
      }
      continue;
    }
    if ('options' in domain) {
      if (typeof value === 'string' && isOption(domain.options, value)) assign(result, key, value);
      continue;
    }
    const flag = asBoolean(value);
    if (flag !== null) assign(result, key, flag);
  }

  return result;
}

/**
 * What persists: the keys that differ from the defaults, and nothing else. A sky left alone stores
 * an empty object — and the hook removes the key for that rather than keeping a no-op row.
 */
export function diffFromDefaults(tweaks: UniverseTweaks): Partial<UniverseTweaks> {
  const diff: Partial<UniverseTweaks> = {};
  for (const key of Object.keys(DEFAULT_TWEAKS) as (keyof UniverseTweaks)[]) {
    if (tweaks[key] !== DEFAULT_TWEAKS[key]) assign(diff, key, tweaks[key]);
  }
  return diff;
}
