import { useCallback } from 'react';

import { usePaletteOps } from '@/modules/command-palette';
import type { HealCard } from '@/modules/heal/healTypes';

/**
 * What a heal's chain can be opened BY. The record itself
 * (`state/dispatch-chains/chain-<slug>-<stamp>-<hex>/chain.json`) is not addressable from here: the
 * runner mints that trailing hex, no route in this app lists that store, and the Roadmap tab's In flight face carries
 * the dispatcher's own plans, which a heal's chain is not. The heal's OWN id is exact,
 * and it names the brief the chain was handed — `state/heal_reflex/briefs/<heal id>.md`, written for
 * every heal whose chain started, and that is what a reader wants open: the friction that heal was
 * told to fix. The briefing is written before the launch and only a PROVED launch gets a
 * `chain_id`, which is why this press is offered exactly where the button is.
 *
 * Used by this module's HealCardList, and through the barrel by Cerberus's Uploads view, to give `HealCardView` its
 * `onOpenChain` — the press is the workspace's own opener on both tabs.
 *
 * The press does nothing, and says nothing, wherever no workspace has registered its opener: outside `PaletteOpsProvider`
 * (the app's one layout mounts it) or before `WorkspaceMain` has registered. The Inbox's and Cerberus's panels are views of
 * that workspace, so a card drawn in either is covered; one rendered in a root of its own must stand under the provider.
 */
export function useOpenHealBrief(): (heal: HealCard) => void {
  const { openFileReference } = usePaletteOps();
  return useCallback(
    (heal: HealCard) => {
      if (heal.chain_id === null) return;
      openFileReference(`state/heal_reflex/briefs/${heal.id}.md`, 1);
    },
    [openFileReference],
  );
}
