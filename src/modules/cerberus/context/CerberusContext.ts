import { createContext, useContext } from 'react';

import type { CerberusCatalogEntryView, CerberusNodeProject, CerberusOverview, CerberusWardens } from '@/shared/cerberus-types';
import type { CerberusLabelInput, CerberusMuteInput, CerberusProjectMove, CerberusPromoteInput, CerberusStartedBatch } from '@/shared/types';

/**
 * The fleet as center's read model last answered it, the catalog beside it, and the writes the tab presses. No
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
  /**
   * True once a read has failed while the overview held was answered more than 90 s before (three missed
   * polls): what is on screen is the last answer center gave, not this minute's. False again with the next
   * good answer, and judged only when a read fails, never on a timer. `overview` is never null while this is true.
   */
  stale: boolean;
  /**
   * The catalog's entries, read with the overview and kept as it keeps it. `null` until the first read answers:
   * the Catalog draws shimmering rows then, and never an empty catalog.
   */
  catalog: CerberusCatalogEntryView[] | null;
  /** True while the catalog has never been read and its last read failed. A failed read after a good one keeps the entries. */
  catalogFailed: boolean;
  /** Reads the overview and the catalog again. Resolves when the overview has answered or failed (the catalog follows, and never holds a write's verdict back), with whether it answered; never rejects. */
  refresh: () => Promise<boolean>;
  /** Each write answers `true` when it landed — and by then the overview has been re-read, or, if that read failed, is being read again until it answers. On `false` it has already raised the toast. */
  mute: (input: CerberusMuteInput) => Promise<boolean>;
  liftMute: (id: string) => Promise<boolean>;
  setLabel: (input: CerberusLabelInput) => Promise<boolean>;
  /**
   * Runs a project's Claude chats on a node's warden (`node` the node's id), or back on this server
   * (`null`). Resolves to what `NodeProjects` draws from: `moved` (the overview has been re-read and a
   * toast has said so), `refused` (409 `PROJECT_NODE_NOT_COLOCATED`: no toast, the section's banner says it)
   * or `failed` (the write's own toast has said it). Never rejects.
   */
  setProjectNode: (project: CerberusNodeProject, node: string | null) => Promise<CerberusProjectMove>;
  /**
   * The catalog entries whose Run press is still out (none: empty). Center answers a run once the warden has
   * accepted it (up to 10 s), and each press reads "Running…" for all of that wait, in every place it is drawn.
   */
  starting: readonly string[];
  /**
   * Runs a catalog entry now, by you. Answers `true` when it started, and by then the overview holds the
   * run; on `false` the toast has said why (a run already going on the check, the node's warden not linked).
   */
  runEntry: (id: string) => Promise<boolean>;
  /** Switches an entry's auto-run on or off. Answers `true` when it landed, with the catalog re-read; a capped entry is refused and the toast says so. */
  setAuto: (id: string, on: boolean) => Promise<boolean>;
  /**
   * Where the fleet's wardens stand against the release center holds, read beside the overview and again on
   * `cerberus_changed`. `null` until a read answers: the header draws no update button and the dialog nothing
   * until then, so "not read yet" never looks like "nothing to update".
   */
  wardens: CerberusWardens | null;
  /**
   * Starts a batch that takes `nodes` to the release, one at a time. Answers the batch's id and its updates as they
   * stood, which the Update wardens dialog follows; `null` when it was refused (a batch already going, nothing
   * built): the toast has said why, and the wardens are read again so a batch started elsewhere shows.
   */
  startUpdate: (nodes: string[]) => Promise<CerberusStartedBatch | null>;
  /**
   * Starts a read-only diagnosis of one check (`key` its key, `<service>/<id>`) on `node`, and sends no model:
   * center picks its own. Answers `true` when it started, and by then the overview holds it (the card says
   * "Diagnosing…"); on `false` the toast has said why (a diagnosis already going on the check, an unknown check).
   */
  diagnose: (node: string, key: string) => Promise<boolean>;
  /**
   * Runs a diagnosis's proposal once, by you. Answers `true` when the warden accepted the run and the fleet was
   * re-read; on `false` the toast has said why (no proposal, its one-off ran out, a run already going on the check,
   * the node's warden not linked). It never touches the catalog.
   */
  runProposal: (id: string) => Promise<boolean>;
  /**
   * Adds a diagnosis's proposal to the catalog as the entry `input` describes. Answers `true` when it landed, with
   * the catalog re-read and the toast "Added to the catalog" raised; on `false` the toast has said why and nothing was written.
   */
  promote: (id: string, input: CerberusPromoteInput) => Promise<boolean>;
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
 * Read by src/modules/project-workspace, through the module's barrel, as the Cerberus tab's count
 * pill on the strip — the same number the tab's headline says.
 */
export function useCerberusNeeds(): number {
  return useCerberus().overview?.counts.needsYou ?? 0;
}
