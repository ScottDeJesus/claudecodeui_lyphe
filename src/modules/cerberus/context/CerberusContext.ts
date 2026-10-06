import { createContext, useContext } from 'react';

import type { CerberusOverview } from '@/shared/cerberus-types';
import type { CerberusLabelInput, CerberusMuteInput } from '@/shared/types';

/**
 * The fleet as center's read model last answered it, and the three writes the tab presses. No
 * component lives here: the provider is its own file so this one can be imported by anything that
 * only reads (`react(only-export-components)` would warn about a hook exported beside it).
 *
 * `null` on purpose, not a filled-in default: a default overview makes the reader's guard
 * unreachable and lets a consumer mounted outside the provider draw a fleet nobody reads for.
 */

/**
 * The overview and the verbs that move it. The verbs keep one identity for the app's life, so
 * nothing that memoises on them is rebuilt by a language switch or a read landing.
 */
export type CerberusValue = {
  /** The last overview a read applied. `null` until a read answers: "not asked yet", which the panel draws as its loading state and never as an empty fleet. */
  overview: CerberusOverview | null;
  /** True while no read has ever answered and the last one failed. A read that fails after a good one keeps the overview it had, so this never turns true over one. */
  unreachable: boolean;
  /** Reads the overview again. Resolves when the read has been answered or has failed; never rejects. */
  refresh: () => Promise<void>;
  /** Each write answers `true` when it landed — and by then the overview has been re-read. On `false` it has already raised the toast. */
  mute: (input: CerberusMuteInput) => Promise<boolean>;
  liftMute: (id: string) => Promise<boolean>;
  setLabel: (input: CerberusLabelInput) => Promise<boolean>;
};

export const CerberusContext = createContext<CerberusValue | null>(null);

/** The overview and its verbs. Read by the module's own views, its sheet and its dialogs. */
export function useCerberus(): CerberusValue {
  const value = useContext(CerberusContext);
  if (!value) {
    throw new Error('useCerberus must be used within a CerberusProvider');
  }
  return value;
}

/**
 * How many checks need a person right now: the overview's own count, `0` while it has not been read.
 * Meant for src/modules/project-workspace, through the module's barrel, as the tab strip's count
 * pill — the workspace phase of this plan wires it; until then nothing outside the module reads it.
 */
export function useCerberusNeeds(): number {
  return useCerberus().overview?.counts.needsYou ?? 0;
}
