import type { ProviderModelOption } from '@/shared/types';

/**
 * Catalog values that name a POLICY rather than a model — "use the recommended
 * one", "use the best one". A custom model called `best-effort-model` would
 * otherwise be labelled "Best available", which is a different promise.
 */
const CATALOG_SELECTORS = new Set(['default', 'best']);

/** The alphanumeric runs in an id or an alias: `opus[1m]` → ['opus','1m']. */
const tokensOf = (value: string): string[] => value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

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
 * The aside a label carries about the entry it was written for: `Opus 5.5 (1M context)` →
 * `Opus 5.5`. A parenthetical is a claim about the entry named in `OPTIONS`, so it never rides
 * along onto a generation that entry does not describe.
 */
const LABEL_ASIDE = /\s*\([^)]*\)/g;

/** Wherever a label states its own generation: `GPT-5.6 Sol` → `5.6`, `Opus 5.5` → `5.5`. */
const LABEL_VERSION = /\d+(?:\.\d+)*/;

/**
 * The name a caption reads, for an id of a family the catalog carries.
 *
 * The FAMILY comes from the catalog — it is the only part of a model's name a static list can
 * hold, and it is what the composer's alias is keyed by. The GENERATION comes off the record: a
 * stored turn carries the id the SDK actually ran, and a list written months earlier may not
 * overrule it. So `Opus 5.5 (1M context)` captions the id `claude-opus-5-5` as "Opus 5.5", the
 * `claude-opus-5` id that answered every turn before it as "Opus 5", and even a generation this
 * catalog never offered, `claude-opus-4-8`, as "Opus 4.8" rather than as the entry the list
 * happens to hold today.
 *
 * The record's generation goes WHERE THE LABEL PUT ITS OWN, word for word around it. A label may
 * carry words after the number — `GPT-5.6 Sol` names a variant, not a version — so assembling the
 * family by deleting the label's digits would reorder those words and leave the separator that
 * joined them behind ("GPT- Sol 5.6"). Substituting in place keeps every word of the label and
 * every separator between them; a label stating no generation of its own takes the record's at
 * its end.
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
 * The name a person calls a model, given the id a transcript row carries.
 *
 * The catalog is keyed by the SHORT alias the composer sends (`haiku`, `sonnet`,
 * `opus`), while a stored turn records the id the SDK actually ran
 * (`claude-haiku-4-5-20251001`). So an exact hit is tried first, and failing
 * that the id is read as its dash-separated segments and matched against the
 * aliases — segments, never substrings, because `opus` is inside `opusplan` and
 * a substring match would hand back the wrong name with no way to tell.
 *
 * Null when nothing matches. That is the honest answer for a custom model the
 * catalog has never carried, and it is what lets a caller decide whether to show
 * the provider's name (a transcript caption) or the id itself (the composer's
 * own chip, where the id is the thing the user typed in).
 */
export function resolveModelLabel(
  options: ProviderModelOption[],
  modelId: string | undefined | null,
): string | null {
  if (!modelId) return null;

  const exact = options.find((option) => option.value === modelId);
  if (exact) return exact.label || exact.value;

  const segments = new Set(tokensOf(modelId));
  // Longest alias first, so a catalog carrying both `opus[1m]` and a bare `opus` names an id
  // that carries `opus` and `1m` with the `[1m]` entry rather than the plain one.
  const alias = options
    .filter((option) => !CATALOG_SELECTORS.has(option.value))
    .map((option) => ({ option, tokens: tokensOf(option.value) }))
    .filter(({ tokens }) => tokens.length > 0 && tokens.every((token) => segments.has(token)))
    .sort((left, right) => right.tokens.join('').length - left.tokens.join('').length)[0];

  if (alias) {
    return captionFor(alias.option, modelId);
  }

  // Last: the same alias set with the `[1m]` suffix normalized away, which is what the CLI
  // itself does before comparing two model names. A recorded id never carries the suffix — the
  // SDK writes `claude-sonnet-5` — so once a catalog offers ONLY `sonnet[1m]`, every stored
  // turn on that model resolved to nothing and the chip fell back to the raw id.
  const suffixless = options
    .filter((option) => !CATALOG_SELECTORS.has(option.value))
    .map((option) => ({ option, tokens: tokensOf(option.value.replace(/\[1m\]$/i, '')) }))
    .filter(({ tokens }) => tokens.length > 0 && tokens.every((token) => segments.has(token)))
    .sort((left, right) => right.tokens.join('').length - left.tokens.join('').length)[0];

  if (suffixless) {
    return captionFor(suffixless.option, modelId);
  }

  return null;
}
