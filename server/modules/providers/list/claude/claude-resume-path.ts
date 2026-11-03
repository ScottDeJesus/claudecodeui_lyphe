import type { AnyRecord } from '@/shared/types.js';

/**
 * Returns the uuids on the chain the next `claude --resume` replays, from the
 * leaf it continues from back to the root.
 *
 * Mirrors the transcript loader of the Claude CLI, which the Agent SDK's
 * `resume` spawns as well. Every CLI process stamps a `last-prompt` row naming
 * the leaf it was on when it exits, so with two writers on one session it is
 * that stamp — not the newest row — that decides which branch is replayed. The
 * newest conversation row only takes over when it descends from the stamped
 * leaf (the stamping process kept going), or when the file carries no stamp.
 * A compact boundary clears the stamp, and `progress` rows are skipped over
 * when linking a row to its parent, as the CLI does.
 *
 * Used by `claude-sessions.provider.ts` (`dropSupersededPromptBranches`) to keep, among
 * sibling prompts, the one the model will actually be sent.
 */
export function resolveResumePath(rows: AnyRecord[]): Set<string> {
  const conversation = new Map<string, AnyRecord>();
  const progressParents = new Map<string, string | null>();
  const parentOf = (row: AnyRecord): string | undefined => {
    const parentUuid = typeof row.parentUuid === 'string' ? row.parentUuid : undefined;
    if (parentUuid && progressParents.has(parentUuid)) {
      return progressParents.get(parentUuid) ?? undefined;
    }
    return parentUuid;
  };

  let newestRow: string | undefined;
  let stampedLeaf: string | undefined;
  let stampIsExplicit = false;

  for (const row of rows) {
    if (row.type === 'progress' && typeof row.uuid === 'string') {
      progressParents.set(row.uuid, parentOf(row) ?? null);
      continue;
    }
    if (typeof row.uuid === 'string'
      && (row.type === 'user' || row.type === 'assistant' || row.type === 'attachment' || row.type === 'system')) {
      conversation.set(row.uuid, row);
      if (row.isSidechain !== true) {
        newestRow = row.uuid;
        stampIsExplicit = false;
      }
      if (row.type === 'system' && row.subtype === 'compact_boundary') {
        stampedLeaf = undefined;
        stampIsExplicit = false;
      }
    } else if (row.type === 'last-prompt' && typeof row.leafUuid === 'string' && row.leafUuid) {
      stampIsExplicit = row.explicit === true || (stampIsExplicit && row.leafUuid === stampedLeaf);
      stampedLeaf = row.leafUuid;
    }
  }

  const chainFrom = (leaf: string | undefined): string[] => {
    const chain: string[] = [];
    const seen = new Set<string>();
    let cursor = leaf;
    while (cursor && conversation.has(cursor) && !seen.has(cursor)) {
      seen.add(cursor);
      chain.push(cursor);
      cursor = parentOf(conversation.get(cursor) as AnyRecord);
    }
    return chain;
  };

  let leaf = stampedLeaf && conversation.has(stampedLeaf) ? stampedLeaf : undefined;
  if (leaf && !stampIsExplicit && newestRow && newestRow !== leaf && chainFrom(newestRow).includes(leaf)) {
    leaf = newestRow;
  }

  return new Set(chainFrom(leaf ?? newestRow));
}

/**
 * Maps each row's uuid to the file position of the newest row in its subtree.
 *
 * The transcript is append-only and a child is always written after its
 * parent, so one backward pass hands every row's position to its parent and
 * each uuid ends up holding the position of the last line its branch grew.
 * Rows after a compact boundary do not link back across it, so this only
 * orders branches within one compaction segment.
 *
 * Used by `claude-sessions.provider.ts` (`dropSupersededPromptBranches`) as the fallback that
 * picks a survivor when a fork lies off the resume chain, such as one made before a compaction.
 */
export function indexNewestRowPerBranch(rows: AnyRecord[]): Map<string, number> {
  const newestByUuid = new Map<string, number>();

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (typeof row.uuid !== 'string') {
      continue;
    }
    const newest = newestByUuid.get(row.uuid) ?? index;
    newestByUuid.set(row.uuid, newest);
    if (typeof row.parentUuid === 'string' && (newestByUuid.get(row.parentUuid) ?? -1) < newest) {
      newestByUuid.set(row.parentUuid, newest);
    }
  }

  return newestByUuid;
}
