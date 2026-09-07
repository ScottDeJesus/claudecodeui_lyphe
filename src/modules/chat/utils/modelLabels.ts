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
  // Longest alias first, so `opus[1m]` (segments opus + 1m) wins over `opus` when
  // the id carries both, and `opusplan` over `opus` when it carries that.
  const alias = options
    .filter((option) => !CATALOG_SELECTORS.has(option.value))
    .map((option) => ({ option, tokens: tokensOf(option.value) }))
    .filter(({ tokens }) => tokens.length > 0 && tokens.every((token) => segments.has(token)))
    .sort((left, right) => right.tokens.join('').length - left.tokens.join('').length)[0];

  return alias ? alias.option.label || alias.option.value : null;
}
