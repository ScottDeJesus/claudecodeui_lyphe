/**
 * What the Claude picker offers, built from the installed CLI's own model catalog.
 *
 * Claude Code reports its catalog through the SDK's `supportedModels()` (read by
 * `claude-model-catalog.ts`): every model it can run, the alias each family answers to, the name it
 * gives each model, a description, and the effort levels each accepts. The picker's options,
 * descriptions and effort levels are all taken from that answer, so a CLI release that moves an alias
 * moves the picker with it. So are its names, with one rule about the version (`shownNameOf`): the CLI
 * words a name either with the version in it ("Haiku 4.5") or by family alone ("Opus") with the
 * version opening the description ("Opus 5.5 · Best for everyday, complex tasks"). A name that
 * carries a version is shown as the CLI gives it. A name that carries none, whose description opens
 * with that name, a version and ` · `, is shown as "Opus 5.5" over the description that follows the
 * separator, so the menu, the composer chip and chat captions all name the generation and stay
 * correct with each release. Any other name or description is shown exactly as the CLI says it.
 *
 * Which entries are offered: the newest model of each family, one row per family.
 * - A family's ALIAS entry (`opus`, `sonnet`, `haiku` — a value that is the family's own name) is
 *   the CLI's pointer at that family's current model, so it wins whenever the catalog has one.
 * - A family with no alias (Fable) is offered through its newest PINNED entry, one whose value is
 *   the model id it runs, with or without the `[1m]` context suffix (`claude-fable-5-1[1m]`).
 * - Everything else is dropped: the older pinned versions, and `default`, which names a policy
 *   ("the recommended model") and duplicates a family's own entry (`POLICY_SELECTORS`).
 * A family the catalog gains appears on its own, in the catalog's order.
 */
import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';

import type { ProviderModelOption, ProviderModelsDefinition } from '@/shared/types.js';

/**
 * Ultracode is not one of the SDK's reasoning-effort levels. Selecting it runs the turn at `xhigh`
 * effort with standing dynamic-workflow orchestration, which the Claude runtime translates into the
 * session-scoped `ultracode` setting. It is therefore offered exactly on the models whose catalog
 * effort levels include `xhigh`.
 *
 * consumer: claude-runtime.provider.js (applyClaudeEffort expands it back into what the SDK takes)
 */
export const CLAUDE_ULTRACODE_EFFORT = 'ultracode';

const ULTRACODE_EFFORT_OPTION = {
  value: CLAUDE_ULTRACODE_EFFORT,
  description: 'Highest effort plus standing workflow orchestration.',
};

/**
 * The model a turn runs on when it names none, and the picker's default whenever it is offered.
 * An alias, so it names a family and never a generation.
 *
 * consumer: claude-runtime.provider.js (mapCliOptionsToSDK, for a turn that carries no model)
 */
export const CLAUDE_DEFAULT_MODEL = 'opus[1m]';

/**
 * The value the composer sends for each family that sessions already hold one for.
 *
 * Stored sessions and every browser's saved selection carry these exact strings, and an option under
 * any other value would leave each of them matching nothing. Each is an alias the CLI resolves, so
 * none names a generation and none goes stale when a release moves its family. The `[1m]` suffix
 * changes nothing for the current generation, which is natively 1M; it stays because it is what
 * those stored selections say. A family missing here is offered under the catalog's own value.
 */
const STORED_VALUE_BY_FAMILY: Readonly<Record<string, string>> = {
  opus: 'opus[1m]',
  fable: 'fable',
  sonnet: 'sonnet[1m]',
  haiku: 'haiku',
};

/**
 * Catalog values that name a POLICY rather than a model: "the recommended one", "the best one". Refused
 * by value, because the alias-or-pinned test below only tells `default` apart while the entry carries
 * `resolvedModel` (optional in the SDK's type); without it, `default` reads as a family of its own.
 * Mirrors `CATALOG_SELECTORS` in the client's modelLabels.ts.
 */
const POLICY_SELECTORS: ReadonlySet<string> = new Set(['default', 'best']);

/** The `[1m]` context suffix a catalog value may carry after the model id it runs. */
const ONE_MILLION_SUFFIX = /\[1m\]$/i;

/** A version as a description states it right after the family's name: `5`, `5.5`, `4.8`. */
const DESCRIPTION_VERSION_THEN_SEPARATOR = /^(\d+(?:\.\d+)*) · ([\s\S]*)$/;

type EffortLevel = NonNullable<ModelInfo['supportedEffortLevels']>[number];

/**
 * The name and description the picker shows for one catalog entry.
 *
 * A name with no digit in it states no version. When the entry's description then opens with that
 * very name, a space, a version and ` · `, the version belongs to this entry and the name becomes
 * `<name> <version>`; the description is what follows the separator, so the menu does not say the
 * version twice. A description that opens with another name ("Default (recommended)" over
 * "Sonnet 5.5 · …") or with a notice ("Newer version available · …") says nothing about this entry's
 * version, so such an entry is shown as the catalog has it, as is one with no description.
 */
function shownNameOf(entry: ModelInfo): { label: string; description: string | undefined } {
  const asCatalogHasIt = { label: entry.displayName, description: entry.description || undefined };
  if (/\d/.test(entry.displayName) || typeof entry.description !== 'string') return asCatalogHasIt;

  const nameThenSpace = `${entry.displayName} `;
  if (!entry.description.startsWith(nameThenSpace)) return asCatalogHasIt;
  const stated = DESCRIPTION_VERSION_THEN_SEPARATOR.exec(entry.description.slice(nameThenSpace.length));
  if (!stated) return asCatalogHasIt;

  return { label: `${entry.displayName} ${stated[1]}`, description: stated[2].trim() || undefined };
}

/** The effort choices one model offers: the catalog's levels, plus ultracode wherever xhigh is one. */
function effortFor(levels: readonly EffortLevel[]): Pick<ProviderModelOption, 'effort'> {
  if (levels.length === 0) return {};
  return {
    effort: {
      values: [
        ...levels.map((level) => ({ value: level })),
        ...(levels.includes('xhigh') ? [ULTRACODE_EFFORT_OPTION] : []),
      ],
    },
  };
}

/**
 * The family and version a model id names: `claude-sonnet-5-5` → sonnet 5.5,
 * `claude-haiku-4-5-20251001` → haiku 4.5 (an eight-digit release date is not a version), `sonnet` →
 * sonnet with no version. Null for an id with no word in it besides `claude`.
 */
function identityOf(modelId: string): { family: string; version: number[] } | null {
  const tokens = modelId.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token && token !== 'claude');
  const words = tokens.filter((token) => !/^\d+$/.test(token));
  const version = tokens.filter((token) => /^\d+$/.test(token) && token.length < 8).map(Number);
  return words.length > 0 ? { family: words.join('-'), version } : null;
}

/** Positive when `left` is the newer version, part by part: 5.1 > 5 > 4.8. */
function compareVersions(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? -1) - (right[index] ?? -1);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** A catalog entry this module can read at all: a value and a name, both non-empty strings. */
const isReadableEntry = (entry: unknown): entry is ModelInfo => {
  const candidate = entry as Partial<ModelInfo> | null;
  return typeof candidate?.value === 'string' && candidate.value.trim() !== ''
    && typeof candidate.displayName === 'string' && candidate.displayName.trim() !== '';
};

/**
 * The picker's definition, built from one catalog answer, or null when the answer offers nothing the
 * picker can show (the caller treats that exactly like a failed read).
 *
 * `LABELS_BY_MODEL_ID` carries the picker's name (`shownNameOf`) for every concrete model id the catalog
 * lists, offered or not, so a stored turn is captioned with the generation its model has:
 * `claude-sonnet-5-5` reads "Sonnet 5.5" and the `claude-sonnet-5` that answered earlier turns reads
 * "Sonnet 5".
 *
 * consumer: claude-model-catalog.ts (on every fresh read, and on every catalog loaded from disk)
 */
export function buildClaudeModelsDefinition(catalog: readonly unknown[]): ProviderModelsDefinition | null {
  // Insertion order is first appearance in the catalog, and a newer entry replacing an older one
  // keeps its family's place — so the rows come out in the CLI's own order.
  const newestByFamily = new Map<string, {
    entry: ModelInfo;
    shown: ReturnType<typeof shownNameOf>;
    version: number[];
    isAlias: boolean;
  }>();
  const labelsByModelId: Record<string, string> = {};

  for (const entry of catalog) {
    if (!isReadableEntry(entry) || POLICY_SELECTORS.has(entry.value)) continue;
    // The id the entry runs, without the context suffix: a value that is `claude-fable-5-1[1m]` with no
    // `resolvedModel` still names `claude-fable-5-1`, and `1m` is not a word of the family's name.
    const modelId = (entry.resolvedModel?.trim() || entry.value).replace(ONE_MILLION_SUFFIX, '');
    const identity = identityOf(modelId);
    if (!identity) continue;

    const isAlias = entry.value === identity.family;
    // The context suffix names a window of the same model, so a value that is the id plus `[1m]` is pinned too.
    const isPinned = entry.value.replace(ONE_MILLION_SUFFIX, '') === modelId;
    if (!isAlias && !isPinned) continue;

    // First name wins: the alias row comes before its own pinned twin, and both say the same.
    const shown = shownNameOf(entry);
    labelsByModelId[modelId] ??= shown.label;

    const held = newestByFamily.get(identity.family);
    const replaces = !held
      || (!held.isAlias && (isAlias || compareVersions(identity.version, held.version) > 0));
    if (replaces) newestByFamily.set(identity.family, { entry, shown, version: identity.version, isAlias });
  }

  const options: ProviderModelOption[] = [...newestByFamily].map(([family, { entry, shown }]) => ({
    value: STORED_VALUE_BY_FAMILY[family] ?? entry.value,
    label: shown.label,
    ...(shown.description ? { description: shown.description } : {}),
    ...effortFor(entry.supportsEffort ? entry.supportedEffortLevels ?? [] : []),
  }));
  if (options.length === 0) return null;

  return {
    OPTIONS: options,
    // The default has to name an option: it is what the service compares a session's model against.
    DEFAULT: options.some((option) => option.value === CLAUDE_DEFAULT_MODEL) ? CLAUDE_DEFAULT_MODEL : options[0].value,
    LABELS_BY_MODEL_ID: labelsByModelId,
  };
}

const FALLBACK_EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** One fallback row: the family's stored value, named by the family alone. */
function fallbackOption(family: string, levels: readonly EffortLevel[]): ProviderModelOption {
  return {
    value: STORED_VALUE_BY_FAMILY[family],
    label: family.charAt(0).toUpperCase() + family.slice(1),
    ...effortFor(levels),
  };
}

/**
 * What the picker offers when no catalog has ever been read: the CLI could not be asked and nothing
 * was kept on disk from an earlier read. Each row is named by its FAMILY alone ("Sonnet"), because a
 * generation is the one thing a list written here cannot know and the CLI moves under it; the
 * transcript still captions stored turns with the generation their own id carries.
 *
 * consumer: claude-model-catalog.ts (the last fallback), claude-runtime.provider.js (effort
 * validation when the provider catalog itself cannot be loaded)
 */
export const CLAUDE_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    fallbackOption('opus', FALLBACK_EFFORT_LEVELS),
    fallbackOption('fable', FALLBACK_EFFORT_LEVELS),
    fallbackOption('sonnet', FALLBACK_EFFORT_LEVELS),
    fallbackOption('haiku', []),
  ],
  DEFAULT: CLAUDE_DEFAULT_MODEL,
};
