// The two facts about warden updates that the header's button and the Update wardens dialog must read the
// same way, so they live in one file: which node can take the release, and where a running batch stands.
import type { CerberusUpdateView, CerberusWardens } from '@/shared/cerberus-types';

/**
 * Whether a node can take the release: its warden is behind and has said hello. The server counts a node with
 * no version as behind, but one that has never said hello is on no link to offer the release on, so neither
 * the header nor the dialog offers what would answer "Update 0 nodes".
 */
export function canTake(node: CerberusWardens['nodes'][number]): boolean {
  return node.behind && node.version !== null;
}

/** How much of its story a view of an update holds: an ended update outweighs any steps, otherwise the steps it has. */
function knowledgeOf(update: CerberusUpdateView): number {
  return update.result === null ? update.steps.length : Number.MAX_SAFE_INTEGER;
}

/**
 * Two reads of the same batch, laid together: per update (in `held`'s order), whichever read knows more. An
 * update only moves forward — steps are added, never taken away, and an ended one stays ended — so more is
 * later, and a read that left earlier and answered later can never put an update back a step. The dialog
 * holds two such reads: the one it polls and the one the provider pushes on every update frame.
 */
export function freshestBatch(held: CerberusUpdateView[], incoming: CerberusUpdateView[]): CerberusUpdateView[] {
  return held.map((update) => {
    const other = incoming.find((candidate) => candidate.id === update.id);
    return other !== undefined && knowledgeOf(other) > knowledgeOf(update) ? other : update;
  });
}

/**
 * Where the running batch stands, counting from 1: `index` is the place of the first update that has not ended
 * (the one being taken now), `of` the batch's size. `wardens.running` keeps the ended updates of a batch until
 * the whole batch ends, so "2 of 3" can be said while the first is done. When every one has ended but the read
 * has not yet dropped the batch, the last place stands. `null` while no batch runs.
 */
export function batchPlace(running: CerberusUpdateView[]): { index: number; of: number } | null {
  if (running.length === 0) return null;
  const first = running.findIndex((update) => update.result === null);
  return { index: first === -1 ? running.length : first + 1, of: running.length };
}
