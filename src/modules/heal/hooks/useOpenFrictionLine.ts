import { useCallback } from 'react';

import { usePaletteOps } from '@/modules/command-palette';
import type { HealItem } from '@/modules/heal/healTypes';

/**
 * What a friction row's transcript press does: the healed item's transcript is a path in the SAME project this
 * workspace has open, so the press brings the Files tab forward at the row's line rather than teaching this module a
 * second way to open a file. A row with no transcript opens nothing.
 *
 * Used by this module's HealKindList, and through the barrel by Cerberus's Uploads view, to give `HealItemRow` its
 * `onOpen` — the press is the workspace's own opener on both tabs.
 *
 * The press does nothing, and says nothing, wherever no workspace has registered its opener: outside `PaletteOpsProvider`
 * (the app's one layout mounts it) or before `WorkspaceMain` has registered. The Inbox's and Cerberus's panels are views of
 * that workspace, so a row drawn in either is covered; one rendered in a root of its own must stand under the provider.
 */
export function useOpenFrictionLine(): (item: HealItem) => void {
  const { openFileReference } = usePaletteOps();
  return useCallback(
    (item: HealItem) => {
      if (item.transcript) openFileReference(item.transcript, item.transcript_line ?? undefined);
    },
    [openFileReference],
  );
}
