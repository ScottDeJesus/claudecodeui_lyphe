import type { ProviderModelOption } from '@/shared/types';

/**
 * Catalog values that name a POLICY rather than a model — "use the recommended
 * one", "use the best one". A custom model called `best-effort-model` would
 * otherwise be labelled "Best available", which is a different promise.
 */
const CATALOG_SELECTORS = new Set(['default', 'best']);

/** The alphanumeric runs in an id or an alias: `opus[1m]` → ['opus','1m']. */
const tokensOf = (value: string): string[] => value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** The `[1m]` context suffix, which the CLI itself strips before comparing two model names. */
const ONE_MILLION_SUFFIX = /\[1m\]$/i;

/**
 * The generation an id names: `claude-opus-4-8` → "4.8", `claude-haiku-4-5-20251001` → "4.5".
 *
 * Release dates are eight digits and are not part of the version. Null when the id carries no
 * version at all, which is the honest answer for a custom model.
 */
function versionOfId(modelId: string): string | null {
  const parts: string[] = [];
  for (const token of tokensOf(modelId)) {
    if (!/^\d+$/.test(token)) {
      if (parts.length > 0) break;
      continue;
    }
    if (token.length >= 8) break;
    parts.push(token);
  }
  return parts.length > 0 ? parts.join('.') : null;
}

/**
 * The aside a label carries about the entry it was written for: `My Opus (fast lane)` → `My Opus`.
 * A parenthetical is a claim about the entry named in `OPTIONS`, so it never rides along onto a
 * generation that entry does not describe.
 */
const LABEL_ASIDE = /\s*\([^)]*\)/g;

/** Wherever a label states its own generation: `GPT-5.6 Sol` → `5.6`, `Opus 5.5` → `5.5`. */
const LABEL_VERSION = /\d+(?:\.\d+)*/;

/**
 * The name a caption reads, for an id of a family the catalog carries but does not name itself.
 *
 * The FAMILY comes from the catalog entry the id matched, and the GENERATION comes off the record: a
 * stored turn carries the id the SDK actually ran, and an entry naming the family's current model may
 * not overrule it. So the `Opus 5.5` entry captions an id `claude-opus-4-5` it does not list as
 * "Opus 4.5" rather than as the entry's own generation.
 *
 * The record's generation goes WHERE THE LABEL PUT ITS OWN, word for word around it. A label may
 * carry words after the number — `GPT-5.6 Sol` names a variant, not a version — so assembling the
 * family by deleting the label's digits would reorder those words and leave the separator that
 * joined them behind ("GPT- Sol 5.6"). Substituting in place keeps every word of the label and
 * every separator between them; a label stating no generation of its own ("Opus", the Claude
 * fallback list's) takes the record's at its end.
 *
 * An id carrying no version, or a label left with no words of its own, falls back to the label
 * verbatim — the catalog's own words are the last honest thing available.
 */
function captionFor(option: ProviderModelOption, modelId: string): string {
  const label = (option.label || option.value).replace(LABEL_ASIDE, '').trim();
  const version = versionOfId(modelId);
  if (!version || !label) return option.label || option.value;
  return LABEL_VERSION.test(label) ? label.replace(LABEL_VERSION, version) : `${label} ${version}`;
}

/**
 * An id DeepSeek's own endpoint answers with, whole: `deepseek` and then dash-separated segments of
 * letters, digits and dotted versions (`deepseek-v4-pro`, `deepseek-flash`, `deepseek-v3.2`). Anything
 * else — a path, a bracket, a space — is not an id this reader names.
 */
const DEEPSEEK_ID = /^deepseek(?:-[a-z0-9]+(?:\.\d+)*)*$/;

/** A version segment — a letter and its number (`v4`, `r1`, `v3.2`) — which a name writes with the letter capitalized. */
const VERSION_SEGMENT = /^[a-z]\d+(?:\.\d+)*$/;

/**
 * The name for an id DeepSeek's endpoint answers with: `deepseek-v4-pro` → "DeepSeek V4 Pro",
 * `deepseek-flash` → "DeepSeek Flash", and a `deepseek-v5-pro` nothing has run yet → "DeepSeek V5 Pro".
 *
 * DeepSeek has no catalog in this app — only Claude reports one — so its words come off the id itself,
 * the way a new Claude generation's number comes off the record: the vendor first, a version segment
 * (`v4`) with its letter capitalized, every other segment capitalized. A new DeepSeek model therefore
 * names itself the day it first runs, with no code change. The `[1m]` context suffix is dropped, as for
 * Claude: it is the same model with a larger window.
 *
 * Null for any id that is not DeepSeek's. The vendor is read off the id's own first segment, which is
 * what keeps `deepseek-flash` from being caught by a catalog's `flash` alias in `aliasMatching`.
 */
function deepseekLabelOf(modelId: string): string | null {
  const id = modelId.toLowerCase().replace(ONE_MILLION_SUFFIX, '');
  if (!DEEPSEEK_ID.test(id)) return null;
  const words = id.split('-').map((segment) => (
    VERSION_SEGMENT.test(segment) ? segment.toUpperCase() : `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`
  ));
  // The vendor's own spelling, not a capitalized `Deepseek`.
  return ['DeepSeek', ...words.slice(1)].join(' ');
}

/** The catalog entry whose alias tokens all appear among the id's segments, longest alias first. */
function aliasMatching(
  options: ProviderModelOption[],
  segments: Set<string>,
  aliasOf: (value: string) => string,
): ProviderModelOption | null {
  return options
    .filter((option) => !CATALOG_SELECTORS.has(option.value))
    .map((option) => ({ option, tokens: tokensOf(aliasOf(option.value)) }))
    .filter(({ tokens }) => tokens.length > 0 && tokens.every((token) => segments.has(token)))
    .sort((left, right) => right.tokens.join('').length - left.tokens.join('').length)[0]?.option ?? null;
}

/**
 * The name a person calls a model, given the id a transcript row or a session carries.
 *
 * In order:
 * 1. An option's own value — the alias the composer sent (`opus[1m]`) — takes that option's label.
 * 2. The provider's name for the id, where its catalog lists it (`labelsByModelId`, Claude's
 *    `LABELS_BY_MODEL_ID`): `claude-sonnet-5-5` → "Sonnet 5.5", `claude-sonnet-5` → "Sonnet 5". The
 *    server has already put the generation into that name; nothing here second-guesses it.
 * 3. An id DeepSeek answers with (`deepseek-v4-pro`, `deepseek-flash`): named off the id itself, because
 *    no catalog here lists DeepSeek's models (`deepseekLabelOf`). It comes BEFORE the alias match, which
 *    would otherwise hand a catalog's `flash` entry to `deepseek-flash`.
 * 4. Only for an id no catalog names: the id is read as its dash-separated segments and matched
 *    against the options' aliases — segments, never substrings, because `opus` is inside `opusplan`
 *    and a substring match would hand back the wrong name with no way to tell — and captioned with
 *    that family plus the id's own generation (`captionFor`).
 *
 * Null when nothing matches. That is the honest answer for a custom model the catalog has never
 * carried, and it is what lets a caller decide whether to show the provider's name (a transcript
 * caption) or the id itself (the composer's own chip, where the id is the thing the user typed in).
 *
 * Used by chat's `useModelLabelResolver` (transcript captions and exports, the agent rows in the transcript and
 * in the pinned strip and the gutter widget) and ComposerModelMenu (the chip), and by `useModelName`
 * (`src/shared/hooks`) for the dispatcher's Planning card, so a planner's model reads as an agent row names it.
 */
export function resolveModelLabel(
  options: ProviderModelOption[],
  modelId: string | undefined | null,
  labelsByModelId: Record<string, string> = {},
): string | null {
  if (!modelId) return null;

  const exact = options.find((option) => option.value === modelId);
  if (exact) return exact.label || exact.value;

  // Own keys only: an id such as `constructor` must not read a name off the object's prototype.
  for (const candidate of [modelId, modelId.replace(ONE_MILLION_SUFFIX, '')]) {
    if (Object.prototype.hasOwnProperty.call(labelsByModelId, candidate)) return labelsByModelId[candidate];
  }

  const deepseekLabel = deepseekLabelOf(modelId);
  if (deepseekLabel) return deepseekLabel;

  const segments = new Set(tokensOf(modelId));
  // Longest alias first, so a catalog carrying both `opus[1m]` and a bare `opus` names an id
  // that carries `opus` and `1m` with the `[1m]` entry rather than the plain one. Then the same
  // aliases with the `[1m]` suffix normalized away: a recorded id never carries the suffix — the
  // SDK writes `claude-sonnet-5` — so a catalog offering ONLY `sonnet[1m]` would otherwise match
  // no stored turn on that family at all.
  const alias = aliasMatching(options, segments, (value) => value)
    ?? aliasMatching(options, segments, (value) => value.replace(ONE_MILLION_SUFFIX, ''));

  return alias ? captionFor(alias, modelId) : null;
}
