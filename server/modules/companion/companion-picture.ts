import { readClaudeModelsDefinition } from '@/modules/providers/index.js';
import type { CompanionModel, CompanionPicture } from '@/shared/companion-types.js';
import type { ProviderModelsDefinition } from '@/shared/types.js';

import type { CompanionAccount } from './companion-account.js';
import { withoutPin } from './companion-pending.js';
import { COMPANION_MODELS, readCompanionSettings } from './companion-settings.js';

/**
 * The whole of her as a page reads it (`GET /api/companion`): settings, the picker's models, her process, her
 * activity, the turn in flight, the focus, the draft, the action waiting for his word, the walk, the notes and the
 * newest 200 log lines. Every later change reaches a page as a frame, and a page that missed some reads this again,
 * so nothing here is derived from anything but what a frame would also have told it. The pending action is the
 * stored one WITHOUT its pin (`withoutPin`): what the prepare pinned is the server's alone and no picture carries it.
 *
 * THE MODEL LABELS come from the installed CLI's own catalog (`readClaudeModelsDefinition`), not from a word this
 * app wrote: the catalog names each family's current generation, so the picker says "Sonnet 5.5" and says "Sonnet
 * 5.6" the day the CLI moves, with no release here. The catalog's own `label` is already that name — it takes
 * the version out of the description's "Sonnet 5.5 · Efficient for routine tasks" when the CLI words the name
 * by family alone — so it is used as given; a family the catalog has no entry for (or an empty one) is the word
 * capitalized, which is a label that is never wrong.
 *
 * Consumer: `companion.service.ts` (`picture`).
 */

/** How many log lines the picture carries; the store keeps 400, the panel shows the newest of them. */
const PICTURE_LOG_ROWS = 200;

/** `sonnet[1m]` and `sonnet` are both the Sonnet family: the catalog's value for it may carry the `[1m]` context suffix. */
const familyOf = (value: string): string => value.replace(/\[1m\]$/i, '').toLowerCase();

const capitalized = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * The picker's models with their labels. A catalog that cannot be read is logged with what failed and
 * answers the words alone: the panel must still open, and a model change must still be possible.
 * Consumed by `buildPicture` below and by `eyes/house-reads.ts` (`read_settings`), which says her model by the label the picker shows.
 */
export async function modelOptions(): Promise<CompanionPicture['models']> {
  let definition: ProviderModelsDefinition | null = null;
  try {
    definition = await readClaudeModelsDefinition();
  } catch (error) {
    console.error('[Companion] the CLI model catalog could not be read; the picker shows the family names', error);
  }
  return COMPANION_MODELS.map((value: CompanionModel) => {
    const entry = definition?.OPTIONS.find((option) => familyOf(option.value) === value);
    return { value, label: entry?.label.trim() || capitalized(value) };
  });
}

/**
 * The picture of one account's Kaylee. The catalog is awaited FIRST and everything else is read after it in
 * one synchronous run, so the picture is a single moment: a frame cannot land between two of its fields.
 * Consumed by `companion.service.ts`.
 */
export async function buildPicture(account: CompanionAccount): Promise<CompanionPicture> {
  const models = await modelOptions();
  const { store, session } = account;
  const { focus, draft, pending, walk, floor } = store.readState();
  return {
    settings: readCompanionSettings(account.userId),
    models,
    process: session.process,
    activity: account.currentActivity(),
    turnId: session.turnId,
    focus,
    draft,
    pending: pending === null ? null : withoutPin(pending),
    walk,
    notes: store.listNotes(),
    log: store.readLog(PICTURE_LOG_ROWS),
    floor,
  };
}
