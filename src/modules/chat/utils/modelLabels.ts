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

/** The generation a label claims: "Sonnet 5 (1M context)" → "5", "Fable 5.1" → "5.1". */
function versionOfLabel(label: string): string | null {
  return /(\d+(?:\.\d+)*)/.exec(label)?.[1] ?? null;
}

/**
 * Whether a label may stand for an id. A label that names no generation fits any id of its
 * family; one that does must AGREE with it — the catalog's `opus` alias matches every opus id
 * ever recorded, and since these labels carry version numbers, letting an `claude-opus-4-8`
 * turn be captioned "Opus 5" would put a number on screen that nothing in the record supports.
 */
function generationAgrees(label: string, modelId: string): boolean {
  const labelVersion = versionOfLabel(label);
  const idVersion = versionOfId(modelId);
  if (!labelVersion || !idVersion) return true;
  return labelVersion === idVersion;
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
  // Longest alias first, so `opus[1m]` (segments opus + 1m) wins over `opus` when
  // the id carries both, and `opusplan` over `opus` when it carries that.
  const alias = options
    .filter((option) => !CATALOG_SELECTORS.has(option.value))
    .map((option) => ({ option, tokens: tokensOf(option.value) }))
    .filter(({ tokens }) => tokens.length > 0 && tokens.every((token) => segments.has(token)))
    .sort((left, right) => right.tokens.join('').length - left.tokens.join('').length)[0];

  if (alias && generationAgrees(alias.option.label || '', modelId)) {
    return alias.option.label || alias.option.value;
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

  if (suffixless && generationAgrees(suffixless.option.label || '', modelId)) {
    return suffixless.option.label || suffixless.option.value;
  }

  return null;
}
